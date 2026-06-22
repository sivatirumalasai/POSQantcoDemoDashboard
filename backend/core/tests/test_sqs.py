"""SQS ingest path + shared processing (mocked SQS client — no LocalStack)."""
import json

import pytest

from core import sqs, processing
from core.models import Transaction

URL = "/api/ingest/"


def _payload(**over):
    base = {"transaction_id": "q1", "venue_id": 1, "kind": "sale",
            "amount": "30.00", "items": [{"item": "Beer", "qty": 1, "price": 30}]}
    base.update(over)
    return base


@pytest.mark.django_db
def test_ingest_sqs_mode_publishes_and_does_not_write(api, fake_redis, venue, settings, monkeypatch):
    settings.INGEST_MODE = "sqs"
    published = {}
    monkeypatch.setattr(sqs, "publish", lambda body: published.update(body))

    res = api.post(URL, _payload(), format="json")
    assert res.status_code == 202
    assert res.json()["queued"] is True
    assert Transaction.objects.count() == 0          # the consumer persists, not the request
    assert published["transaction_id"] == "q1"
    assert published["kind"] == "sale"


@pytest.mark.django_db
def test_ingest_sqs_unavailable_returns_503(api, venue, settings, monkeypatch):
    settings.INGEST_MODE = "sqs"
    def boom(_):
        raise RuntimeError("queue down")
    monkeypatch.setattr(sqs, "publish", boom)
    res = api.post(URL, _payload(), format="json")
    assert res.status_code == 503


@pytest.mark.django_db
def test_process_event_persists_and_updates_readmodel(fake_redis, venue):
    created, err = processing.process_event({
        "transaction_id": "c1", "venue_id": 1, "kind": "sale",
        "amount": "40.00", "items": [{"item": "Beer", "qty": 2}], "ts": "2026-06-21T12:00:00Z"})
    assert created is True and err is None
    assert Transaction.objects.filter(transaction_id="c1").exists()
    assert float(fake_redis.hget("venue:1", "net")) == pytest.approx(40.0)
    assert float(fake_redis.hget("hourly:1", "12")) == pytest.approx(40.0)


@pytest.mark.django_db
def test_process_event_idempotent(fake_redis, venue):
    body = {"transaction_id": "dup", "venue_id": 1, "kind": "sale", "amount": "10", "items": []}
    a, _ = processing.process_event(body)
    b, _ = processing.process_event(body)
    assert a is True and b is False
    assert Transaction.objects.filter(transaction_id="dup").count() == 1


@pytest.mark.django_db
def test_process_event_unknown_venue(fake_redis):
    created, err = processing.process_event(
        {"transaction_id": "x", "venue_id": 999, "kind": "sale", "amount": "1", "items": []})
    assert created is False and err == "unknown venue"


def test_publish_and_queue_url(monkeypatch, settings):
    settings.SQS_QUEUE_URL = ""
    sent = {}

    class FakeSQS:
        def send_message(self, QueueUrl, MessageBody):
            sent["url"] = QueueUrl
            sent["body"] = MessageBody
        def get_queue_url(self, QueueName):
            return {"QueueUrl": f"http://localstack:4566/000000000000/{QueueName}"}

    monkeypatch.setattr(sqs, "client", lambda: FakeSQS())
    assert sqs.queue_url().endswith("/venue-ingest")
    sqs.publish({"transaction_id": "z"})
    assert json.loads(sent["body"])["transaction_id"] == "z"
