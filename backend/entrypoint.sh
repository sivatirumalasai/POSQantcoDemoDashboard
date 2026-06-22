#!/usr/bin/env bash
set -e

echo "⏳ waiting for Postgres at ${POSTGRES_HOST}:${POSTGRES_PORT} and Redis…"
python - <<'PY'
import os, time, socket
def wait(host, port, name):
    for _ in range(60):
        try:
            with socket.create_connection((host, int(port)), timeout=2):
                print(f"✅ {name} is up"); return
        except OSError:
            time.sleep(1)
    raise SystemExit(f"❌ {name} not reachable")
wait(os.environ.get("POSTGRES_HOST","localhost"), os.environ.get("POSTGRES_PORT","5432"), "Postgres")
import urllib.parse as u
r = u.urlparse(os.environ.get("REDIS_URL","redis://localhost:6379/0"))
wait(r.hostname or "localhost", r.port or 6379, "Redis")
PY

# In SQS mode, every role needs the broker reachable before it starts.
if [ "${INGEST_MODE}" = "sqs" ] && [ -n "${AWS_ENDPOINT_URL}" ]; then
  python - <<'PY'
import os, time, socket, urllib.parse as u
r = u.urlparse(os.environ["AWS_ENDPOINT_URL"])
host, port = r.hostname or "localhost", r.port or 4566
for _ in range(60):
    try:
        with socket.create_connection((host, port), timeout=2):
            print("✅ LocalStack/SQS is up"); break
    except OSError:
        time.sleep(1)
else:
    raise SystemExit("❌ SQS endpoint not reachable")
PY
fi

# Only the web role runs migrations + seed (other roles just wait then start).
if [ "${ROLE}" = "web" ]; then
  echo "🛠  migrating + seeding…"
  python manage.py makemigrations core --noinput
  python manage.py migrate --noinput
  python manage.py seed_venues
  # create the seeded ops user for JWT (idempotent)
  python manage.py shell <<'PY'
from django.contrib.auth import get_user_model
U = get_user_model()
if not U.objects.filter(username="ops").exists():
    U.objects.create_superuser("ops", "ops@example.com", "ops12345")
    print("created ops user (ops / ops12345)")
PY
  # create the SQS queue + DLQ (idempotent) when running in sqs mode
  if [ "${INGEST_MODE}" = "sqs" ]; then
    python manage.py shell -c "from core import sqs; sqs.ensure_queues(); print('✅ SQS queues ready')"
  fi
fi

echo "🚀 starting: $*"
exec "$@"
