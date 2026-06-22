"""GET /api/reports/sales — rollup aggregation + today's live union."""
import datetime

import pytest
from django.utils import timezone

from core import readmodel
from core.models import DailyVenueSales, DailyVenueItemSales


def _seed_rollups(venue, days, per_day_net=100):
    for d in days:
        DailyVenueSales.objects.create(
            venue=venue, biz_date=d, net_sales=per_day_net,
            txn_count=10, void_count=1, refund_count=2)
        DailyVenueItemSales.objects.create(
            venue=venue, biz_date=d, item_id="Beer", qty=5, revenue=per_day_net * 0.6)


@pytest.mark.django_db
def test_reports_group_by_day(api, fake_redis, venue):
    days = [datetime.date(2026, 1, 1), datetime.date(2026, 1, 2), datetime.date(2026, 1, 3)]
    _seed_rollups(venue, days, per_day_net=100)

    res = api.get("/api/reports/sales?group_by=day&from=2026-01-01&to=2026-01-03")
    assert res.status_code == 200
    data = res.json()
    assert data["groupBy"] == "day"
    assert len(data["rows"]) == 3
    assert data["summary"]["totalNet"] == pytest.approx(300.0)
    assert data["summary"]["dayCount"] == 3
    assert data["summary"]["avgPerDay"] == pytest.approx(100.0)
    assert data["summary"]["bestDay"]["net"] == pytest.approx(100.0)


@pytest.mark.django_db
def test_reports_group_by_venue(api, fake_redis, venue):
    days = [datetime.date(2026, 1, 1), datetime.date(2026, 1, 2)]
    _seed_rollups(venue, days, per_day_net=100)

    res = api.get("/api/reports/sales?group_by=venue&from=2026-01-01&to=2026-01-02")
    data = res.json()
    assert data["groupBy"] == "venue"
    row = data["rows"][0]
    assert row["label"] == "Sydney Taphouse"
    assert row["net"] == pytest.approx(200.0)
    assert row["txns"] == 20


@pytest.mark.django_db
def test_reports_group_by_item(api, fake_redis, venue):
    days = [datetime.date(2026, 1, 1), datetime.date(2026, 1, 2)]
    _seed_rollups(venue, days, per_day_net=100)

    res = api.get("/api/reports/sales?group_by=item&from=2026-01-01&to=2026-01-02")
    data = res.json()
    assert data["groupBy"] == "item"
    beer = next(r for r in data["rows"] if r["label"] == "Beer")
    assert beer["qty"] == 10
    assert beer["net"] == pytest.approx(120.0)  # 2 days * 60


@pytest.mark.django_db
def test_reports_unions_today_from_redis(api, fake_redis, venue):
    r = fake_redis
    readmodel.init_venue(r, 1, venue.name)
    readmodel.apply_event(r, 1, venue.name, "sale", 250.0, [{"item": "Beer", "qty": 1}], 12)

    today = timezone.localdate().isoformat()
    res = api.get(f"/api/reports/sales?group_by=day&from={today}&to={today}")
    row = res.json()["rows"][0]
    assert row["live"] is True
    assert row["net"] == pytest.approx(250.0)  # straight from the live read model
