"""
Django settings for the Real-Time Venue Operations backend.

Local profile (per the request): SQS is skipped — the /ingest endpoint writes
straight to Postgres (source of truth) and updates the Redis read model inline.
Redis and PostgreSQL are kept exactly as in the README.
"""
import os
from pathlib import Path
from datetime import timedelta

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dev-insecure-key-change-me")
DEBUG = os.environ.get("DJANGO_DEBUG", "1") == "1"
ALLOWED_HOSTS = os.environ.get("DJANGO_ALLOWED_HOSTS", "*").split(",")

INSTALLED_APPS = [
    "daphne",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.staticfiles",
    "rest_framework",
    "channels",
    "core",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "ops.urls"
TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "DIRS": [], "APP_DIRS": True,
    "OPTIONS": {"context_processors": [
        "django.contrib.auth.context_processors.auth",
        "django.contrib.messages.context_processors.messages",
    ]},
}]

WSGI_APPLICATION = "ops.wsgi.application"
ASGI_APPLICATION = "ops.asgi.application"

# ── PostgreSQL: the durable, append-only source of truth ──
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("POSTGRES_DB", "ops"),
        "USER": os.environ.get("POSTGRES_USER", "ops"),
        "PASSWORD": os.environ.get("POSTGRES_PASSWORD", "ops"),
        "HOST": os.environ.get("POSTGRES_HOST", "localhost"),
        "PORT": os.environ.get("POSTGRES_PORT", "5432"),
    }
}

# ── Redis: read model + Channels channel layer ──
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {"hosts": [REDIS_URL]},
    }
}

# ── Ingest mode ──
#   "inline" — /ingest writes straight to Postgres + Redis (no broker)
#   "sqs"    — /ingest publishes to SQS (LocalStack locally); a consumer worker
#              persists + updates the read model. Mirrors the README's durable path.
INGEST_MODE = os.environ.get("INGEST_MODE", "inline")

# boto3 / SQS (LocalStack endpoint locally; unset → real AWS)
AWS_ENDPOINT_URL = os.environ.get("AWS_ENDPOINT_URL") or None
AWS_REGION = os.environ.get("AWS_DEFAULT_REGION", "ap-south-1")
SQS_QUEUE_NAME = os.environ.get("SQS_QUEUE_NAME", "venue-ingest")
SQS_DLQ_NAME = os.environ.get("SQS_DLQ_NAME", SQS_QUEUE_NAME + "-dlq")
SQS_QUEUE_URL = os.environ.get("SQS_QUEUE_URL", "")  # optional override; else resolved by name
SQS_MAX_RECEIVE_COUNT = int(os.environ.get("SQS_MAX_RECEIVE_COUNT", "5"))

# ── Celery: aggregation + anomaly sweep (broker = Redis, no SQS locally) ──
CELERY_BROKER_URL = REDIS_URL
CELERY_RESULT_BACKEND = REDIS_URL
CELERY_TIMEZONE = "UTC"
CELERY_BEAT_SCHEDULE = {
    "anomaly-sweep": {"task": "core.tasks.sweep_anomalies", "schedule": 12.0},
    "seal-rollups": {"task": "core.tasks.seal_daily_rollups", "schedule": 300.0},
}

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    # Local profile: open so the simulator and SPA work out of the box.
    # JWT is wired (see /api/auth/token) and enforced on the WS handshake.
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.AllowAny",),
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": False,
}

AUTH_PASSWORD_VALIDATORS = []
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True
STATIC_URL = "static/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Hours rendered in the per-venue drill-down chart (matches the frontend)
TRADING_START_HOUR = 6
TRADING_HOURS = 18
