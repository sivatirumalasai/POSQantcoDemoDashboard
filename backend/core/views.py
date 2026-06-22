from datetime import datetime, timedelta

from django.conf import settings
from django.db.models import Sum
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import DailyVenueSales, DailyVenueItemSales
from .serializers import IngestSerializer
from . import readmodel, processing, sqs


@api_view(["GET"])
def health(request):
    return Response({"status": "ok"})


@api_view(["POST"])
def ingest(request):
    """Validate, then either:
      • INGEST_MODE=inline — persist to Postgres + update Redis in-request, or
      • INGEST_MODE=sqs    — publish to SQS and ack (a consumer persists later).
    The validation boundary (422 on bad payloads) is identical in both modes."""
    s = IngestSerializer(data=request.data)
    if not s.is_valid():
        return Response(s.errors, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
    d = s.validated_data

    event = {
        "transaction_id": d["transaction_id"],
        "venue_id": d["venue_id"],
        "kind": d["kind"],
        "amount": str(d["amount"]),
        "items": [dict(it) for it in d.get("items", [])],
        "ts": (d.get("ts") or timezone.now()).isoformat(),
    }

    if settings.INGEST_MODE == "sqs":
        # durable publish — the POS is acked only once the event is safely queued
        try:
            sqs.publish(event)
        except Exception:  # noqa: BLE001
            return Response({"detail": "ingest queue unavailable"},
                            status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response({"ok": True, "queued": True}, status=status.HTTP_202_ACCEPTED)

    # inline: write straight through
    created, err = processing.process_event(event)
    if err:
        return Response({"venue_id": err}, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
    return Response({"ok": True, "duplicate": not created}, status=status.HTTP_202_ACCEPTED)


def _parse_date(s, default):
    if not s:
        return default
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        return default


@api_view(["GET"])
def reports_sales(request):
    """GET /api/reports/sales?from=&to=&group_by=day|venue|item&venue=

    Served from the daily rollup tables (Postgres). When the range includes
    today, today's partial is unioned from the Redis read model."""
    today = timezone.localdate()
    frm = _parse_date(request.GET.get("from"), today - timedelta(days=29))
    to = _parse_date(request.GET.get("to"), today)
    group_by = request.GET.get("group_by", "day")
    venue_id = request.GET.get("venue")

    qs = DailyVenueSales.objects.filter(biz_date__gte=frm, biz_date__lte=to)
    iqs = DailyVenueItemSales.objects.filter(biz_date__gte=frm, biz_date__lte=to)
    if venue_id:
        qs = qs.filter(venue_id=venue_id)
        iqs = iqs.filter(venue_id=venue_id)

    include_today = frm <= today <= to
    live = _live_today(venue_id) if include_today else None
    day_count = (to - frm).days + 1

    if group_by == "venue":
        agg = qs.values("venue_id", "venue__name").annotate(
            net=Sum("net_sales"), txns=Sum("txn_count"), voids=Sum("void_count"), refunds=Sum("refund_count"))
        rows = [{"key": a["venue_id"], "label": a["venue__name"],
                 "net": float(a["net"] or 0), "txns": a["txns"] or 0,
                 "voids": a["voids"] or 0, "refunds": a["refunds"] or 0} for a in agg]
        if live:
            by_id = {r["key"]: r for r in rows}
            for vid, lv in live["perVenue"].items():
                row = by_id.get(vid)
                if row:
                    row["net"] += lv["net"]; row["txns"] += lv["txns"]
                    row["voids"] += lv["voids"]; row["refunds"] += lv["refunds"]
                else:
                    rows.append({"key": vid, "label": lv["name"], **lv})
        rows.sort(key=lambda x: x["net"], reverse=True)
        return Response(_finalize(rows, group_by, day_count))

    if group_by == "item":
        agg = iqs.values("item_id").annotate(net=Sum("revenue"), qty=Sum("qty"))
        rows = [{"key": a["item_id"], "label": a["item_id"],
                 "net": float(a["net"] or 0), "qty": a["qty"] or 0} for a in agg]
        rows.sort(key=lambda x: x["net"], reverse=True)
        return Response(_finalize(rows, group_by, day_count))

    # group_by == "day"
    agg = qs.values("biz_date").annotate(
        net=Sum("net_sales"), txns=Sum("txn_count"), voids=Sum("void_count"), refunds=Sum("refund_count"))
    by_date = {a["biz_date"]: a for a in agg}
    rows = []
    cur = frm
    while cur <= to:
        iso = cur.isoformat()
        if include_today and cur == today and live:
            t = live["totals"]
            rows.append({"key": iso, "label": iso, "net": t["net"], "txns": t["txns"],
                         "voids": t["voids"], "refunds": t["refunds"], "live": True})
        else:
            a = by_date.get(cur)
            rows.append({"key": iso, "label": iso,
                         "net": float(a["net"]) if a else 0.0,
                         "txns": a["txns"] if a else 0,
                         "voids": a["voids"] if a else 0,
                         "refunds": a["refunds"] if a else 0})
        cur += timedelta(days=1)
    return Response(_finalize(rows, group_by, day_count))


def _live_today(venue_id):
    r = readmodel.client()
    core = readmodel.read_snapshot_core(r)
    per = {}
    totals = {"net": 0.0, "txns": 0, "voids": 0, "refunds": 0}
    for vid, v in core["venues"].items():
        if venue_id and int(venue_id) != vid:
            continue
        per[vid] = {"name": v["name"], "net": v["net"], "txns": v["txns"], "voids": v["voids"], "refunds": v["refunds"]}
        totals["net"] += v["net"]; totals["txns"] += v["txns"]
        totals["voids"] += v["voids"]; totals["refunds"] += v["refunds"]
    return {"perVenue": per, "totals": totals}


def _finalize(rows, group_by, day_count):
    total_net = sum(r["net"] for r in rows)
    total_txns = sum(r.get("txns", 0) for r in rows)
    total_voids = sum(r.get("voids", 0) for r in rows)
    total_refunds = sum(r.get("refunds", 0) for r in rows)
    best = max(rows, key=lambda x: x["net"]) if (group_by == "day" and rows) else None
    return {
        "rows": rows,
        "groupBy": group_by,
        "summary": {
            "totalNet": total_net, "totalTxns": total_txns,
            "totalVoids": total_voids, "totalRefunds": total_refunds,
            "dayCount": day_count, "avgPerDay": (total_net / day_count) if day_count else 0,
            "bestDay": {"label": best["label"], "net": best["net"]} if best else None,
        },
    }
