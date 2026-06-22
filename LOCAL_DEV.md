# Running the full stack locally

One command boots everything — Postgres, Redis, the Django ASGI API (DRF +
Channels), a Celery worker (+ beat), the 1-second ticker, the transaction
simulator, and the React frontend:

```bash
cd QantcoPOSDashboard
docker compose up --build
```

Then open **http://localhost:3000**.

- The board updates live over a WebSocket (status pill reads `LIVE · WebSocket`).
- Click **History** in the top bar for day-wise reporting served from Postgres
  rollups (REST), with today's partial unioned from Redis.

> Ingest path: the stack defaults to **`INGEST_MODE=sqs`**, which routes
> transactions through **SQS (LocalStack)** + a consumer worker — mirroring the
> README's durable architecture. Set `INGEST_MODE=inline` to skip the broker and
> have `/ingest` write straight to Postgres + Redis. See **Ingest modes** below.

## What each container does

| Service      | Role                                                             |
| ------------ | --------------------------------------------------------------- |
| `db`         | PostgreSQL 16 — durable source of truth + daily rollups          |
| `redis`      | Redis 7 — read model **and** the Channels fan-out layer          |
| `localstack` | Emulates **AWS SQS** locally (the ingest buffer + DLQ)           |
| `web`        | Daphne ASGI: DRF `/ingest` + `/api/reports/sales` + `/ws/...`    |
| `consumer`   | `manage.py consume` — long-polls SQS → Postgres + Redis (sqs mode)|
| `worker`     | Celery worker + beat — anomaly sweep, rollup sealing             |
| `ticker`     | `manage.py run_ticker` — coalesces Redis into one snapshot/sec   |
| `simulator`  | `manage.py simulate` — POSTs synthetic txns to the real `/ingest`|
| `frontend`   | Vite dev server on :3000, proxying `/api` and `/ws` to `web`     |

On first boot `web` runs migrations, seeds 40 venues + ~120 days of history, and
creates an ops user (`ops` / `ops12345`) used for the JWT handshake.

## Endpoints

| Method | Path                         | Purpose                                |
| ------ | ---------------------------- | -------------------------------------- |
| POST   | `/api/ingest/`               | ingest a transaction (422 on bad data) |
| GET    | `/api/reports/sales`         | historical rollups (`from`,`to`,`group_by`,`venue`) |
| POST   | `/api/auth/token`            | obtain JWT (SimpleJWT)                  |
| WS     | `/ws/dashboard/`             | live snapshot stream (JWT via subprotocol) |

## Developer commands

Run all of these from the `QantcoPOSDashboard/` directory.

> **First time in a terminal getting `permission denied … /var/run/docker.sock`?**
> Your shell hasn't picked up the `docker` group yet. Open a new terminal, or run
> `newgrp docker` once in the current one.

### Start / stop / restart

```bash
docker compose up --build          # build (first run or after code changes) + start, foreground
docker compose up -d               # start in the background (detached)
docker compose up -d --build       # rebuild + start detached
docker compose stop                # stop containers, keep them (fast restart)
docker compose start               # start previously-stopped containers
docker compose restart             # restart everything
docker compose restart web ticker  # restart specific services
docker compose down                # stop AND remove containers + network (DB volume kept)
docker compose down -v             # ^ and also WIPE the Postgres data volume (fresh seed next up)
```

### Status

```bash
docker compose ps                  # running services
docker compose ps -a               # include stopped/exited services
docker compose top                 # processes inside each container
docker stats                       # live CPU / memory per container
```

### Logs

```bash
docker compose logs                # all services, all history
docker compose logs -f             # follow (live tail) all services
docker compose logs -f web         # follow one service
docker compose logs -f web ticker simulator   # follow several
docker compose logs --tail=100 worker          # last 100 lines of a service
docker compose logs --since=5m web             # last 5 minutes
docker compose logs -t web         # with timestamps
```

Common things to watch:
- `web` — migrations, seeding, HTTP/WS requests, ingest errors (422s).
- `ticker` — `ticker started — 1.0s interval` then quiet (it broadcasts silently).
- `simulator` — `simulator → http://web:8000/api/ingest/ @ 45 txn/s`.
- `worker` — Celery anomaly sweep / rollup-seal task runs.

### Rebuild after changes

```bash
docker compose build               # rebuild all images
docker compose build web           # rebuild one
docker compose up -d --build web worker ticker simulator   # rebuild backend images + recreate
```

Frontend code is bind-mounted, so React/Vite changes hot-reload with **no rebuild**.
Backend code is baked into the image — rebuild the backend-based services after
editing anything under `backend/`.

### Shell into a container

```bash
docker compose exec web bash               # shell in the API container
docker compose exec db psql -U ops ops     # psql into Postgres
docker compose exec redis redis-cli        # redis-cli into Redis
```

### Django management commands (run inside `web`)

```bash
docker compose exec web python manage.py migrate
docker compose exec web python manage.py seed_venues            # idempotent
docker compose exec web python manage.py createsuperuser
docker compose exec web python manage.py shell
# run the simulator manually at a custom rate:
docker compose exec web python manage.py simulate --api http://web:8000 --rate 80
```

### Quick endpoint checks (from the host)

```bash
curl -s http://localhost:8000/api/health/
curl -s "http://localhost:8000/api/reports/sales?group_by=day&from=$(date +%F)&to=$(date +%F)"
curl -s -X POST http://localhost:8000/api/auth/token \
  -H 'Content-Type: application/json' -d '{"username":"ops","password":"ops12345"}'
```

### How data is ingested

The simulator (or any POS) just HTTP-POSTs to `/api/ingest/`. The endpoint always
validates first (422 on bad payloads); what happens next depends on `INGEST_MODE`:

```
INGEST_MODE=sqs (default):
  POS/sim ─▶ /ingest: validate → PUBLISH to SQS → 202
                                   │  (acked once durably queued)
                              LocalStack SQS ──poison(×5)──▶ DLQ
                                   │ long-poll
                                   ▼
                          consumer → Postgres + Redis → delete msg ─▶ ticker ─▶ WS ─▶ dashboard

INGEST_MODE=inline:
  POS/sim ─▶ /ingest: validate → Postgres + Redis (in-request) ─▶ ticker ─▶ WS ─▶ dashboard
```

Either way the `unique(transaction_id)` constraint makes redelivery/replay an
idempotent no-op, so SQS at-least-once delivery is safe.

POST a transaction by hand (same path the simulator uses):

```bash
curl -X POST http://localhost:8000/api/ingest/ \
  -H 'Content-Type: application/json' \
  -d '{"transaction_id":"demo-001","venue_id":1,"kind":"sale",
       "amount":42.50,"items":[{"item":"Wagyu Burger","qty":1,"price":42.50}]}'
# inline mode → {"ok":true,"duplicate":false}   (kind = sale | refund | void)
# sqs mode    → {"ok":true,"queued":true}        (consumer persists it shortly after)
# re-POSTing the same transaction_id is a safe no-op in both modes
```

### Ingest modes + inspecting SQS

Switch modes via the `INGEST_MODE` env in `docker-compose.yml` (`x-backend-env`):

```bash
# default is sqs. To run the broker-less path instead:
#   set INGEST_MODE: inline   in docker-compose.yml, then:
docker compose up -d web consumer simulator
```

Scale consumers (sqs mode): `docker compose up -d --scale consumer=3`.

Inspect the queues via LocalStack's `awslocal` CLI. **Pass `--region ap-south-1`**
— queues are region-scoped and the backend creates them in `ap-south-1`, while
`awslocal` defaults to `us-east-1`:

```bash
# list the queues
docker compose exec -T localstack awslocal --region ap-south-1 sqs list-queues

# backlog — "are consumers keeping up?" (should hover near 0) + the redrive policy
docker compose exec -T localstack awslocal --region ap-south-1 sqs get-queue-attributes \
  --queue-url http://localhost:4566/000000000000/venue-ingest \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible RedrivePolicy

# DLQ depth — poison messages (should be 0)
docker compose exec -T localstack awslocal --region ap-south-1 sqs get-queue-attributes \
  --queue-url http://localhost:4566/000000000000/venue-ingest-dlq \
  --attribute-names ApproximateNumberOfMessages

# follow the consumer
docker compose logs -f consumer
```

### Demo: simulate an SQS spike (backlog → drain)

Show the queue backing up and then being drained — the README's "SQS absorbs
bursts + autoscale on queue depth" story, live.

**Watch the depth** (run in its own terminal, leave it up during the demo):

```bash
watch -n1 'docker compose exec -T localstack awslocal --region ap-south-1 \
  sqs get-queue-attributes --queue-url http://localhost:4566/000000000000/venue-ingest \
  --attribute-names ApproximateNumberOfMessages \
  --query Attributes.ApproximateNumberOfMessages --output text'
```

**Create the spike** — pick one:

```bash
# A) pause the consumer → queue climbs at the simulator's rate (~45/s)
docker compose stop consumer

# B) crank the publish rate well above one consumer's throughput
docker compose up -d --scale simulator=8        # ~360 msg/s

# C) one-off burst from an extra publisher (leaves compose untouched)
docker compose run --rm --no-deps web python manage.py simulate --api http://web:8000 --rate 500
```

**Drain it** — bring consumers back / scale them out:

```bash
docker compose start consumer                   # if you used (A)
docker compose up -d --scale consumer=4         # scale out to clear a big backlog
docker compose up -d --scale simulator=1        # reset the publish rate after (B)
```

The relationship to narrate:

```
depth grows when   publish rate  >  consumers × throughput
depth drains when  publish rate  <  consumers × throughput
```

> Observed locally: one consumer drains ~800 queued messages in ~6s, so for a
> *sustained* visible spike use (A), or (B) with a single consumer.

### Inspect Postgres (SQL)

Open an interactive psql shell (`-U ops` = user, trailing `ops` = database):

```bash
docker compose exec db psql -U ops ops
```

Or run a single query non-interactively with `-c`:

```bash
docker compose exec -T db psql -U ops ops -c "SELECT count(*) FROM core_transaction;"
```

Handy queries:

```sql
\dt core_*                                  -- list the tables

-- counts + totals by kind (today's live ingest)
SELECT kind, count(*), round(sum(amount),2) AS total
FROM core_transaction GROUP BY kind ORDER BY kind;

-- latest ingested transactions
SELECT transaction_id, venue_id, kind, amount, ts
FROM core_transaction ORDER BY ts DESC LIMIT 5;

-- find one transaction by id
SELECT * FROM core_transaction WHERE transaction_id = 'demo-001';

-- per-venue sales today, ranked
SELECT venue_id, count(*) AS txns, round(sum(amount),2) AS net
FROM core_transaction WHERE kind = 'sale'
GROUP BY venue_id ORDER BY net DESC;

-- venues
SELECT id, name, city FROM core_venue ORDER BY id;

-- historical rollups (one row per venue per business day)
SELECT * FROM core_dailyvenuesales
WHERE venue_id = 1 ORDER BY biz_date DESC LIMIT 7;

-- rollup coverage (row count + date span)
SELECT count(*) AS rollup_rows, min(biz_date), max(biz_date) FROM core_dailyvenuesales;
```

The 5 tables: `core_venue`, `core_staff`, `core_transaction` (append-only log),
`core_dailyvenuesales` + `core_dailyvenueitemsales` (reporting rollups).

> Postgres data persists across restarts (the `pgdata` volume). The Redis read
> model is rebuilt fresh on each `web` start, so the live "today" numbers reset
> to zero and climb again — the rollups + raw log in Postgres are the durable copy.

### Inspect the Redis read model

```bash
docker compose exec redis redis-cli get txn_counter            # total sales counter
docker compose exec redis redis-cli zrevrange ranking:today 0 4 withscores
docker compose exec redis redis-cli hgetall venue:1
docker compose exec redis redis-cli get flags:active
```

### Cleanup

```bash
docker compose down -v             # remove containers + DB volume (full reset)
docker compose down --rmi local    # also delete the images built here
docker system prune -f             # reclaim dangling images/networks (host-wide)
```

## Tests + coverage

Both suites run **without** Postgres or Redis — the backend uses SQLite in-memory
and `fakeredis`; the frontend runs in jsdom.

| Suite | Tests | Coverage | Runs without |
| --- | --- | --- | --- |
| Backend (pytest) | **37 passed** | **~90%** | Postgres (SQLite in-mem) + Redis (`fakeredis`) + SQS (mocked) |
| Frontend (Vitest) | **33 passed** | **~76%** | a browser (jsdom) |

### What's covered

**Backend** — `backend/core/tests/`
- `test_ingest` — valid sale → 202 + read-model update; refund subtracts / void doesn't; idempotent duplicate; 422s for missing field / bad kind / unknown venue
- `test_sqs` — sqs-mode publishes (no in-request write) + 503 when queue down; shared `process_event` persist/idempotency/unknown-venue; publish + queue-url resolution
- `test_readmodel` — net = sales − refunds, voids excluded; ranking / topitems / hourly / txn_counter; snapshot shape
- `test_reports` — group-by day/venue/item aggregation + summary/bestDay; today unioned from Redis
- `test_anomalies` — spike/hot rules fire, healthy → none, flags clear on recompute
- `test_tasks` — rollup sealing writes + idempotent
- `test_auth` — JWT token extraction (subprotocol/query), anonymous in DEBUG, reject otherwise
- `test_consumer` — snapshot-on-connect + group broadcast reaches the client
- `test_seed` — `seed_venues` idempotency + deterministic generators

**Frontend** — `src/__tests__/` + `src/components/__tests__/`
- `store` — `applySnapshot`, view/selection, `runReport` backend success + local fallback
- `history` — date helpers, presets, deterministic day/venue/item queries, today-union
- `connect` — auth → WebSocket handshake (subprotocol) → `backendMode` + snapshot request
- `simulator` — primes 40 venues
- components — RankingBoard (click-to-select), TopItems (scope toggle), DrillPanel, AnomalyRail, KpiStrip, AreaChart, Header (Live↔History), ReportsView (loads via mocked fetch)

### Backend (pytest + coverage)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
pytest                              # runs tests + prints coverage, writes htmlcov/
```

Or inside Docker (no local Python needed):

```bash
docker compose run --rm --no-deps web sh -c "pip install -q -r requirements-dev.txt && pytest"
```

Coverage report: terminal summary + `backend/htmlcov/index.html` + `backend/coverage.xml`.
Current: **31 tests, ~92%** covering ingest validation/idempotency, the Redis
read-model math, reports aggregation + today-union, anomaly rules, rollup sealing,
the JWT WS middleware, and the consumer snapshot/broadcast.

### Frontend (Vitest + coverage)

```bash
npm install
npm test                           # run once
npm run test:watch                 # watch mode
npm run coverage                   # run + coverage report → coverage/index.html
```

Or inside Docker:

```bash
docker compose run --rm --no-deps frontend sh -c "npm install && npm run coverage"
```

Current: **33 tests, ~76%** covering the store (`applySnapshot`, `runReport`
backend + local fallback), the history/rollup generator, the WS client handshake,
the simulator, and the dashboard components.

## Without Docker

If you prefer to run pieces by hand, start your own Postgres + Redis, then in
`backend/`: `pip install -r requirements.txt`, set the `POSTGRES_*` / `REDIS_URL`
env vars, `python manage.py migrate && python manage.py seed_venues`, and run
`daphne`, `celery -A ops worker -B`, `manage.py run_ticker`, and
`manage.py simulate` in separate shells. The frontend is `npm run dev`.

If the frontend can't reach the backend, the UI automatically falls back to the
in-browser simulator (status pill reads `LIVE · Simulator`).
