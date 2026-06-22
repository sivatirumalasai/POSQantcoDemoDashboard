"""/ingest — the single validation boundary + idempotent write path."""
import pytest

from core.models import Transaction

URL = "/api/ingest/"


def _payload(**over):
    base = {"transaction_id": "txn-1", "venue_id": 1, "kind": "sale",
            "amount": "25.00", "items": [{"item": "Pale Ale Schooner", "qty": 2, "price": 12.5}]}
    base.update(over)
    return base


@pytest.mark.django_db
def test_valid_sale_persists_and_updates_readmodel(api, fake_redis, venue):
    res = api.post(URL, _payload(), format="json")
    assert res.status_code == 202
    assert res.json()["duplicate"] is False
    assert Transaction.objects.count() == 1

    r = fake_redis
    assert float(r.hget("venue:1", "net")) == pytest.approx(25.0)
    assert int(r.hget("venue:1", "txns")) == 1
    assert int(r.get("txn_counter")) == 1
    assert r.zscore("ranking:today", "1") == pytest.approx(25.0)
    assert r.zscore("topitems:group", "Pale Ale Schooner") == 2


@pytest.mark.django_db
def test_refund_subtracts_void_does_not(api, fake_redis, venue):
    api.post(URL, _payload(transaction_id="s1", kind="sale", amount="100.00", items=[]), format="json")
    api.post(URL, _payload(transaction_id="r1", kind="refund", amount="30.00", items=[]), format="json")
    api.post(URL, _payload(transaction_id="v1", kind="void", amount="0", items=[]), format="json")

    r = fake_redis
    assert float(r.hget("venue:1", "net")) == pytest.approx(70.0)  # net = sales - refunds
    assert int(r.hget("venue:1", "refunds")) == 1
    assert int(r.hget("venue:1", "voids")) == 1
    assert int(r.hget("venue:1", "txns")) == 1  # only the sale counts as a txn


@pytest.mark.django_db
def test_duplicate_transaction_is_idempotent(api, fake_redis, venue):
    first = api.post(URL, _payload(), format="json")
    second = api.post(URL, _payload(), format="json")
    assert first.json()["duplicate"] is False
    assert second.json()["duplicate"] is True
    assert Transaction.objects.count() == 1
    # net counted once despite the replay
    assert float(fake_redis.hget("venue:1", "net")) == pytest.approx(25.0)


@pytest.mark.django_db
def test_missing_field_returns_422(api, fake_redis, venue):
    bad = _payload()
    del bad["transaction_id"]
    res = api.post(URL, bad, format="json")
    assert res.status_code == 422
    assert "transaction_id" in res.json()


@pytest.mark.django_db
def test_invalid_kind_returns_422(api, fake_redis, venue):
    res = api.post(URL, _payload(kind="banana"), format="json")
    assert res.status_code == 422
    assert "kind" in res.json()


@pytest.mark.django_db
def test_unknown_venue_returns_422(api, fake_redis):
    res = api.post(URL, _payload(venue_id=999), format="json")
    assert res.status_code == 422
    assert "venue_id" in res.json()
