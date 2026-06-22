"""Rollup sealing — persist today's Redis aggregates into Postgres rollups."""
import pytest
from django.utils import timezone

from core import readmodel
from core.models import DailyVenueSales, DailyVenueItemSales
from core.tasks import seal_daily_rollups


@pytest.mark.django_db
def test_seal_writes_rollups(fake_redis, venue):
    r = fake_redis
    readmodel.init_venue(r, 1, venue.name)
    readmodel.apply_event(r, 1, venue.name, "sale", 300.0, [{"item": "Beer", "qty": 2}], 12)
    readmodel.apply_event(r, 1, venue.name, "refund", 50.0, [], 13)

    sealed = seal_daily_rollups()
    assert sealed == 1

    today = timezone.localdate()
    row = DailyVenueSales.objects.get(venue=venue, biz_date=today)
    assert float(row.net_sales) == pytest.approx(250.0)  # 300 - 50
    assert row.refund_count == 1
    assert DailyVenueItemSales.objects.filter(venue=venue, biz_date=today, item_id="Beer").exists()


@pytest.mark.django_db
def test_seal_is_idempotent(fake_redis, venue):
    r = fake_redis
    readmodel.init_venue(r, 1, venue.name)
    readmodel.apply_event(r, 1, venue.name, "sale", 100.0, [], 12)

    seal_daily_rollups()
    seal_daily_rollups()  # update_or_create — no duplicate rows
    today = timezone.localdate()
    assert DailyVenueSales.objects.filter(venue=venue, biz_date=today).count() == 1
