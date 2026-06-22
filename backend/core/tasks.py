import json
from datetime import datetime, timezone as dt_timezone

from celery import shared_task
from django.utils import timezone

from . import readmodel


@shared_task
def sweep_anomalies():
    """Explainable, rule-based anomaly detection. Writes flags:active in Redis.
    Recomputed each run, so flags clear automatically when conditions resolve.
    Never blocks ingest or the WS tick."""
    r = readmodel.client()
    core = readmodel.read_snapshot_core(r)
    venues = list(core["venues"].values())
    if not venues:
        return 0

    nets = sorted(v["net"] for v in venues)
    median = nets[len(nets) // 2] or 1
    now = datetime.now(dt_timezone.utc).strftime("%H:%M:%S")

    flags = []
    flag_by_id = {}
    for v in venues:
        txns = max(v["txns"], 1)
        ratio = (v["voids"] + v["refunds"]) / txns
        ftype = why = None
        if ratio > 0.09:
            ftype = "spike"
            why = (f"(voids + refunds) / txns hit {ratio*100:.0f}% — above this "
                   f"venue's threshold over the rolling window.")
        elif v["net"] > median * 1.6 and v["net"] > 1000:
            ftype = "hot"
            why = (f"Trading {v['net']/median*100-100:.0f}% above the group median — "
                   f"positive signal. Consider routing support to this venue.")
        elif v["net"] < median * 0.45 and v["txns"] > 20:
            ftype = "drop"
            why = "Run-rate well below the group baseline for consecutive windows."
        flag_by_id[v["id"]] = ftype or ""
        if ftype:
            flags.append({"id": f"{v['id']}-{ftype}", "venue": v["name"],
                          "type": ftype, "why": why, "time": now, "active": True})

    p = r.pipeline()
    for vid, ftype in flag_by_id.items():
        p.hset(f"venue:{vid}", "flag", ftype)
    p.set("flags:active", json.dumps(flags[-12:]))
    p.execute()
    return len(flags)


@shared_task
def seal_daily_rollups():
    """Persist today's Redis aggregates into the daily rollup tables (idempotent
    upsert). The README's 'seal at day-close' — run on a schedule here so the
    History view always has a fresh 'today' sealed alongside the seeded history."""
    from .models import Venue, DailyVenueSales, DailyVenueItemSales

    r = readmodel.client()
    core = readmodel.read_snapshot_core(r)
    biz_date = timezone.localdate()
    sealed = 0
    for vid, v in core["venues"].items():
        if not Venue.objects.filter(pk=vid).exists():
            continue
        DailyVenueSales.objects.update_or_create(
            venue_id=vid, biz_date=biz_date,
            defaults={"net_sales": round(v["net"], 2), "txn_count": v["txns"],
                      "void_count": v["voids"], "refund_count": v["refunds"]},
        )
        for item, qty in v["items"].items():
            DailyVenueItemSales.objects.update_or_create(
                venue_id=vid, biz_date=biz_date, item_id=item,
                defaults={"qty": qty, "revenue": round(qty * 18.0, 2)},
            )
        sealed += 1
    return sealed
