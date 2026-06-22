"""Test settings — SQLite in-memory DB and an in-memory channel layer so the
suite runs with no Postgres or Redis (Redis is mocked with fakeredis)."""
from .settings import *  # noqa: F401,F403

DEBUG = True

DATABASES = {
    "default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}
}

CHANNEL_LAYERS = {
    "default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}
}

# keep Celery tasks synchronous in tests
CELERY_TASK_ALWAYS_EAGER = True
