import math
import time

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.core.management.base import BaseCommand

from core import readmodel

GROUP = "dashboard"


class Command(BaseCommand):
    help = "The 1-second batching tick: coalesce the Redis read model into one snapshot and broadcast it."

    def add_arguments(self, parser):
        parser.add_argument("--interval", type=float, default=1.0)

    def handle(self, *args, **opts):
        interval = opts["interval"]
        layer = get_channel_layer()
        r = readmodel.client()

        prev_net = 0.0
        prev_total_txns = 0
        prev_venue_net = {}
        hist = {"net": [], "rate": [], "tps": []}
        tick = 0

        self.stdout.write(self.style.SUCCESS(f"ticker started — {interval}s interval"))
        while True:
            start = time.monotonic()
            core = readmodel.read_snapshot_core(r)
            venues = core["venues"]

            net = sum(v["net"] for v in venues.values())
            total_txns = core["totalTxns"]
            rate = max(0.0, (net - prev_net)) * (60.0 / interval)
            tps = max(0, total_txns - prev_total_txns)

            # biggest mover this tick → flash target
            flash_id, best = None, 30.0
            for vid, v in venues.items():
                delta = v["net"] - prev_venue_net.get(vid, v["net"])
                if delta > best:
                    best, flash_id = delta, vid
                prev_venue_net[vid] = v["net"]

            for k, val in (("net", net), ("rate", rate), ("tps", tps)):
                hist[k].append(round(val, 2))
                if len(hist[k]) > 60:
                    hist[k].pop(0)

            tick += 1
            snapshot = {
                # str keys: the Redis channel layer packs with msgpack, which
                # rejects int map keys (strict_map_key). JSON keys are strings
                # anyway, so the frontend is unaffected.
                "venues": {str(k): v for k, v in venues.items()},
                "order": core["order"],
                "groupItems": core["groupItems"],
                "flags": core["flags"],
                "kpis": {
                    "net": round(net, 2), "rate": round(rate, 2), "tps": tps,
                    "totalTxns": total_txns,
                    "netTrend": round(8 + 6 * math.sin(tick / 9.0), 1),
                },
                "history": {k: list(v) for k, v in hist.items()},
                "flashId": flash_id,
                "tick": tick,
            }
            async_to_sync(layer.group_send)(GROUP, {"type": "dashboard.snapshot", "data": snapshot})

            prev_net, prev_total_txns = net, total_txns
            time.sleep(max(0.0, interval - (time.monotonic() - start)))
