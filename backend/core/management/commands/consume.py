"""SQS consumer — long-polls the ingest queue, persists each transaction to
Postgres + updates the Redis read model, then deletes the message. A message
that throws is left un-deleted, so SQS redelivers it; after maxReceiveCount it
lands in the DLQ. Scale with: docker compose up -d --scale consumer=N."""
import json
import time

from django.core.management.base import BaseCommand

from core import sqs, processing


class Command(BaseCommand):
    help = "Consume transactions from SQS and apply them to Postgres + Redis."

    def add_arguments(self, parser):
        parser.add_argument("--wait", type=int, default=20, help="long-poll seconds")
        parser.add_argument("--batch", type=int, default=10, help="max messages per poll")

    def handle(self, *args, **opts):
        c = sqs.client()

        # wait until the queue exists (web creates it on startup)
        q = None
        while q is None:
            try:
                q = sqs.queue_url()
            except Exception:
                self.stdout.write("waiting for SQS queue…")
                time.sleep(2)
        self.stdout.write(self.style.SUCCESS(f"consumer → long-polling {q}"))

        while True:
            resp = c.receive_message(
                QueueUrl=q, MaxNumberOfMessages=opts["batch"], WaitTimeSeconds=opts["wait"])
            for m in resp.get("Messages", []):
                try:
                    processing.process_event(json.loads(m["Body"]))
                    c.delete_message(QueueUrl=q, ReceiptHandle=m["ReceiptHandle"])
                except Exception as e:  # noqa: BLE001 — leave un-deleted → redelivery/DLQ
                    self.stderr.write(f"consume error (will redeliver): {e}")
