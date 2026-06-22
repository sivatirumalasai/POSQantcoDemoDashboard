import random
import time
import uuid

import requests
from django.core.management.base import BaseCommand

from core.models import Venue
from core import seeddata


class Command(BaseCommand):
    help = "Transaction simulator — POSTs synthetic transactions to the real /ingest endpoint."

    def add_arguments(self, parser):
        parser.add_argument("--api", default="http://localhost:8000", help="API base URL")
        parser.add_argument("--rate", type=int, default=40, help="transactions/sec")
        parser.add_argument("--venues", type=int, default=40)

    def handle(self, *args, **opts):
        api = opts["api"].rstrip("/")
        rate = max(1, opts["rate"])
        ingest_url = f"{api}/api/ingest/"

        # wait for venues to exist (migrations + seed run in the web entrypoint;
        # tolerate the table not existing yet during that race)
        from django.db import connection
        ids = []
        while not ids:
            try:
                ids = list(Venue.objects.values_list("id", flat=True))
            except Exception:
                connection.close()  # drop the broken cursor; reconnect next loop
                ids = []
            if not ids:
                self.stdout.write("waiting for venues…")
                time.sleep(2)

        rnd = random.Random()
        sess = requests.Session()
        self.stdout.write(self.style.SUCCESS(f"simulator → {ingest_url} @ {rate} txn/s across {len(ids)} venues"))

        interval = 1.0 / rate
        while True:
            vid = rnd.choice(ids)
            roll = rnd.random()
            if roll < 0.04:
                kind, amount, items = "refund", round(rnd.uniform(8, 78), 2), []
            elif roll < 0.07:
                kind, amount, items = "void", 0, []
            else:
                kind = "sale"
                item = rnd.choice(seeddata.ITEMS)
                amount = round(rnd.uniform(8, 78), 2)
                items = [{"item": item, "qty": 1, "price": amount}]
            payload = {"transaction_id": uuid.uuid4().hex, "venue_id": vid,
                       "kind": kind, "amount": amount, "items": items}
            try:
                sess.post(ingest_url, json=payload, timeout=5)
            except requests.RequestException:
                time.sleep(1)
            time.sleep(interval)
