"""seed_venues idempotency + deterministic data generation."""
import datetime

import pytest
from django.core.management import call_command

from core.models import Venue, DailyVenueSales
from core import seeddata


@pytest.mark.django_db
def test_seed_creates_venues_and_rollups(fake_redis):
    call_command("seed_venues", "--venues", "3", "--days", "4")
    assert Venue.objects.count() == 3
    assert DailyVenueSales.objects.count() == 3 * 4
    # redis read model initialised
    assert fake_redis.hget("venue:1", "name") is not None


@pytest.mark.django_db
def test_seed_is_idempotent(fake_redis):
    call_command("seed_venues", "--venues", "3", "--days", "4")
    call_command("seed_venues", "--venues", "3", "--days", "4")
    assert Venue.objects.count() == 3              # update_or_create, no dupes
    assert DailyVenueSales.objects.count() == 3 * 4  # history seed skipped 2nd time


def test_day_metrics_deterministic():
    d = datetime.date(2026, 5, 12)
    a = seeddata.day_metrics(7, d)
    b = seeddata.day_metrics(7, d)
    assert a == b
    net, txns, voids, refunds = a
    assert net > 0 and txns > 0


def test_item_weights_normalised():
    w = seeddata.item_weights(3)
    assert abs(sum(w.values()) - 1.0) < 1e-9
    assert len(w) == len(seeddata.ITEMS)
