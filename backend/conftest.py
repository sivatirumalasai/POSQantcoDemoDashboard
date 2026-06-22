"""Shared pytest fixtures. Redis is mocked with fakeredis so no real Redis is
needed; the DB is SQLite in-memory (see ops/test_settings.py)."""
import fakeredis
import pytest

from core import readmodel


@pytest.fixture
def fake_redis(monkeypatch):
    """Patch readmodel.client() to return an isolated fake Redis per test."""
    fake = fakeredis.FakeStrictRedis(decode_responses=True)
    monkeypatch.setattr(readmodel, "client", lambda: fake)
    return fake


@pytest.fixture
def api():
    from rest_framework.test import APIClient
    return APIClient()


@pytest.fixture
def venue(db):
    from core.models import Venue
    return Venue.objects.create(id=1, name="Sydney Taphouse", city="Sydney")


@pytest.fixture
def venues3(db):
    from core.models import Venue
    return [
        Venue.objects.create(id=i, name=f"Venue {i}", city="City")
        for i in (1, 2, 3)
    ]
