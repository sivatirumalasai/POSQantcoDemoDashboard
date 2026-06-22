# Real-Time Venue Operations Dashboard

A live operations dashboard for a hospitality group running **40 venues**. POS terminals stream
sales, voids, and refunds continuously; the ops team watches group-wide trade unfold and acts on it
**within seconds**, with no page refresh.

This README is the front door. It explains how to run the system, the decisions behind it, and what
I'd do with more time.

---

## The problem, in one sentence

Head office is **blind during the day** — end-of-day reports arrive after the moment to act has
passed. The job is to turn a continuous stream of POS transactions into a live, trustworthy picture
the ops team can act on in seconds.

This is a **freshness and correctness problem, not a big-data problem.** The numbers bear that out:

| Dimension            | Estimate                          |
| -------------------- | --------------------------------- |
| Venues               | 40                                |
| Peak transactions    | ~30–100 txns/sec (Friday night)   |
| Daily volume         | 200k–500k transactions            |
| Concurrent viewers   | Tens of ops users, hours at a time |

Every design choice flows from that framing: pre-compute the answers on the write path, serve reads
from memory, and push only deltas to the screen.

---

## How to run

> Target: **one command.** `docker compose up` boots the whole stack — Postgres, Redis, the Django
> API + Channels, the Celery workers, the React dev server, and a transaction simulator.

```bash
# 1. clone and enter
git clone <repo-url> && cd venue-ops

# 2. boot everything (API, web, Postgres, Redis, Celery, simulator)
docker compose up --build

# 3. open the dashboard
#    http://localhost:3000   — login with the seeded ops user (printed on first boot)

# 4. the simulator is already POSTing synthetic transactions to /ingest;
#    watch the board update live. To control the firehose:
docker compose run --rm simulator --venues 40 --rate 80   # 80 txns/sec
```

**Why a simulator?** The brief offered three options (simulate, POST sample data, seed directly). I
chose a **simulator that POSTs to the real `/ingest` endpoint** because it exercises the actual
ingestion path — validate, durable publish to SQS, consume, persist, aggregate — exactly as a real
POS would. Seeding
the DB directly would skip the most interesting part of the system, and a static sample payload
wouldn't demonstrate the real-time behavior that the brief cares most about.

Local dev without Docker (Postgres + Redis must be running):

```bash
# backend
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate && python manage.py seed_venues
python manage.py runserver           # REST + WS via Channels/ASGI
celery -A ops worker -B -l info       # aggregation + anomaly sweep

# frontend
cd frontend && npm install && npm run dev
```

---

## Architecture at a glance

```
POS (40 venues) ──HTTPS──▶ /ingest (DRF: validate)
                               │  publish — POS is acked only once durable
                               ▼
                             SQS  ──────────▶ DLQ  (poison → alarm + redrive)
                               │  long-poll
                               ▼
                    consumer workers (ECS Fargate)
                       commit to Postgres = ack-gating; Redis update best-effort
                  ┌────────────┴────────────┐
                  ▼                         ▼
        Postgres — source of truth     Redis read model
        append-only · partitioned      sorted sets · hashes · windows
        + daily rollups (history)      + mark venue "dirty"
                                              │
                                              ▼
                                     1s ticker coalesces ──▶ Django Channels
                                                                │  one snapshot
                                                                ▼
                                                        all dashboard viewers
```

The shape is **CQRS-lite with a durable broker at the front.** **SQS** is the ingest buffer and the
durability boundary — the POS is acknowledged only once the event is safely queued, so an RDS
failover or a slow consumer never loses or blocks a sale. A consumer commits each event to
**Postgres** (the source of truth — append-only, partitioned, with daily rollups for history) and
updates the **Redis** read model best-effort, since it's fully rebuildable from the log. Redis now
does just two jobs — the read model and the Channels fan-out layer — because the queue and dedup moved
to SQS and the Postgres `UNIQUE(transaction_id)` constraint. Writes optimize for integrity and
replay; reads optimize for O(1) lookups and cheap fan-out.

---

## Key decisions and why

### Backend: Django + DRF + Channels
Django is mandated. DRF gives a clean serializer-based validation boundary for `/ingest` — malformed
payloads return **422, never silently dropped**. **Channels** provides native WebSockets that reuse
Django's auth and a Redis channel layer, so I don't bolt on a separate real-time service.

### Database: PostgreSQL (the source of truth)
Postgres is the **durable, append-only log** that everything else can be rebuilt from. Chosen over:

- **MySQL** — Postgres gives native declarative partitioning, JSONB for the items array, and richer
  window functions for the analytical queries behind drill-down.
- **MongoDB** — transactions are relational and financial. I want foreign keys, constraints, and
  exact numeric types, not eventual schema drift.
- **TimescaleDB** — a fine upgrade later, but plain Postgres comfortably handles this volume.
  No extra moving part until the data earns it.

Schema: `Venue`, `Staff`, `Transaction` (range-partitioned by day, composite index on
`(venue_id, ts)`), `TransactionItem`. **Net sales = sales − refunds; voids are tracked as a health
signal, not subtracted from sales.**

### Read model: Redis (why reads never touch Postgres on the hot path)
The dashboard's questions map directly onto Redis data structures, each O(1) or O(log n):

| Question                       | Structure       | Key                         |
| ------------------------------ | --------------- | --------------------------- |
| Ranked sales by venue          | Sorted Set      | `ranking:today`             |
| Top items (group / per-venue)  | Sorted Sets     | `topitems:group`, `topitems:{venue}` |
| Hourly trade for drill-down    | Hash            | `hourly:{venue}:{date}`     |
| Sales-drop / spike windows     | Sorted Set      | `window:sales:{venue}`      |
| Active anomaly flags           | Set             | `flags:active`              |

Keys TTL to **each venue's local end-of-day** — "today" is per-venue because venues span timezones.
Dedup is no longer a Redis concern: SQS at-least-once delivery plus the Postgres
`UNIQUE(transaction_id)` constraint (`ON CONFLICT DO NOTHING`) make reprocessing safe, so the read
model holds only derived, rebuildable state.

### Real-time delivery: WebSockets + a batching tick
The non-obvious bit. Aggregator workers don't broadcast on every event — they mark the venue
**"dirty."** A single **~1-second ticker** coalesces all dirty venues into **one snapshot** and
broadcasts it once to the dashboard group; Channels fans it out to every viewer.

This **decouples update frequency from event rate.** Whether 5 or 500 transactions landed in the last
second, viewers get one clean update per tick. WebSockets beat polling (wasteful round-trips, lags) and
SSE (one-directional, no clean per-venue subscription) here.

### Anomaly detection: explainable rules, never ML-in-the-hot-path
Every flag answers *"why am I seeing this?"* in one sentence:

- **Sales drop** — current run-rate < ~60% of the trailing baseline for 2 consecutive windows.
- **Void/refund spike** — `(voids + refunds) / sales` over a rolling 30-min window exceeds a
  venue-tuned threshold (catches till errors or fraud).
- **Running hot** — the same machinery in reverse; a *positive* signal so ops can support a busy venue.

A **Celery beat** task sweeps every venue each minute and writes `flags:active`. Detection **never
blocks ingest or the WebSocket tick.**

### Frontend: React + Zustand, render-cost-aware
A single main view (`DashboardPage`) owns one WebSocket connection and a **Zustand store keyed by
`venue_id`.** Components subscribe **selectively** — one venue's update re-renders one row, not all 40.
`React.memo` on row components closes the loop.

```
DashboardPage  (owns WS + store)
├── VenueRankingBoard   selector → memoised rows
├── TopItemsPanel       group / per-venue toggle
├── AnomalyRail         renders flags:active
└── VenueDrillPanel     side panel: hourly chart + items
```

Data flow: `WS message → store.patch() → selector → memoised component → DOM`.

### Auth: JWT (SimpleJWT) on both REST and the WS handshake
Simple but **not wide open** — the token is validated on the REST endpoints and on the WebSocket
handshake, so the live feed isn't an open door.

---

## Historical & reporting reads (by date, "last month", trends)

"Last month's sales" is a **different workload** from the live view, so it gets a **second read
path** rather than being forced through Redis. The Redis read model is deliberately a *today, live*
store — its keys expire at end of day. Historical queries span larger ranges, run far less often, and
tolerate a few hundred ms. They're served from **Postgres**, and to avoid re-scanning the raw log on
every request, they read from **pre-aggregated daily rollup tables**:

```sql
-- one row per venue per business day
CREATE TABLE daily_venue_sales (
  venue_id     int,
  biz_date     date,            -- venue-LOCAL business date
  net_sales    numeric(12,2),   -- sales - refunds
  txn_count    int,
  void_count   int,
  refund_count int,
  PRIMARY KEY (venue_id, biz_date)
);

-- one row per venue/item/day, for historical top-items
CREATE TABLE daily_venue_item_sales (
  venue_id int, biz_date date, item_id text,
  qty int, revenue numeric(12,2),
  PRIMARY KEY (venue_id, biz_date, item_id)
);
```

These tables are tiny (40 venues × 365 days ≈ 15k rows/year), so the common queries are instant and
served straight off the primary key:

```sql
-- last month, ranked by venue
SELECT venue_id, SUM(net_sales) AS sales
FROM daily_venue_sales
WHERE biz_date >= date_trunc('month', now()) - interval '1 month'
  AND biz_date <  date_trunc('month', now())
GROUP BY venue_id ORDER BY sales DESC;
```

A specific date is `WHERE biz_date = '2026-05-12'`; a 90-day venue trend is
`WHERE venue_id = ? AND biz_date >= now() - interval '90 days' ORDER BY biz_date`.

**The rollups are built two ways:**

1. **Seal at day-close.** At each venue's local midnight — the same boundary that already TTLs its
   Redis keys — a Celery task reads the day's final Redis aggregates and upserts them into the rollup
   tables, then lets Redis expire. Since Redis already computed the totals, sealing is just a persist,
   no scan.
2. **Nightly recompute (backstop).** A beat job recomputes the previous day's rollups straight from
   the partitioned `Transaction` table with `INSERT … ON CONFLICT DO UPDATE`. It's idempotent, it
   heals any missed seal, and it lets you **backfill** history for any past range from the raw log.

**API & frontend.** History is plain **REST**, not WebSocket — the data is static once a day closes,
so it's cached aggressively (`GET /api/reports/sales?from=&to=&group_by=venue|day|item`). The UI gets
a date picker with a **Live ↔ History toggle**: Live stays the WebSocket feed for today; History
fires a REST call and renders charts (Recharts), held in a separate Zustand `reports` slice so it
never churns the live store. For a range that includes today, the API unions sealed days from the
rollups with today's partial from Redis — clean, because the seal point *is* the boundary.

**Correctness & scale.** `biz_date` is the venue's **local** day, computed at seal time from the
venue timezone, so cross-venue "last month" comparisons don't drift by hours. Reporting runs on a
**read replica** so it never competes with ingest on the primary. A columnar warehouse
(Fivetran → Snowflake → dbt → Superset) is the later upgrade *only* if heavy ad-hoc slicing appears —
the rollup tables are the 95% solution and handle dashboards trivially.

---

## Performance & scaling through peak load

The principle: **decouple every stage with a buffer, then scale stages independently.**

- **Ingest tier** — stateless DRF workers behind a load balancer; the endpoint only validates +
  publishes to SQS, so it's cheap to add pods linearly.
- **Queue buffer** — SQS absorbs bursts the rest of the system can't instantly process and is the
  durability boundary; back-pressure (and a DLQ for poison) instead of dropped events.
- **Aggregation** — N parallel Fargate consumers long-poll the queue with at-least-once delivery and
  auto-scale on queue depth; sharding the read model by venue scales horizontally (Redis does 100k+
  ops/sec long before that's needed).
- **Real-time** — Channels scales horizontally behind the Redis channel layer.
- **Postgres** — batched `COPY`, day-partitioning for cheap retention, read replica + PgBouncer for
  heavy history queries.

**End-to-end latency budget ≈ 1.1s median**, dominated by the *tunable* 1s batch tick:

| Stage                | Budget    |
| -------------------- | --------- |
| POS → ingest         | ~20 ms    |
| queue                | ~50 ms    |
| aggregate            | ~10 ms    |
| batch tick           | ≤ 1000 ms |
| fan-out              | ~30 ms    |
| browser render       | ~16 ms    |

"Within seconds" is met with comfortable headroom, and the one knob that dominates it (the tick) is a
single config value.

---

## Cloud deployment (AWS) & cost

Every tier maps to a managed AWS service, so there are no servers to patch and each
layer scales independently:

| Architecture tier | AWS service | Why |
| --- | --- | --- |
| API (Django + DRF + Channels) | **ECS Fargate** behind an **ALB** | Serverless containers; the ALB is WebSocket-aware and terminates TLS |
| Aggregation + anomaly workers | **ECS Fargate** (Celery) | Same image, separate scalable service |
| Durable log | **RDS for PostgreSQL** (Multi-AZ, gp3, partitioned) | Managed Postgres with failover and PITR |
| Read model + channel layer | **ElastiCache for Redis** (primary + replica) | Live aggregates + Channels fan-out; derived and rebuildable |
| Durable queue | **Amazon SQS** (+ DLQ) | Ingest buffer and durability boundary; redelivery + dead-letter |
| React SPA | **CloudFront + S3** | Static SPA cached at the edge |
| DNS | **Route 53** | DNS + health checks |
| Images / config / observability | **ECR**, **Secrets Manager / SSM**, **CloudWatch** | Registry, credentials, logs + metrics + alarms |
| Network / identity | **VPC** (private subnets), **IAM**, app-level **JWT** | Private by default; JWT on REST + WS handshake |

### Monthly run-rate

Order-of-magnitude figures (us-east-1, on-demand, before Savings Plans) — a run-rate, not a quote:

| Footprint | ≈ Monthly |
| --- | --- |
| Staging / single-AZ | **~$240** |
| Production · HA | **~$720** |
| Production · HA, optimized | **~$500** |

Production HA breakdown: RDS Multi-AZ ~$240, ElastiCache primary+replica ~$220, Fargate
(API + workers) ~$110, networking (NAT + transfer) ~$60, ops (ECR/CloudWatch/Secrets/Route 53/SQS)
~$50, ALB ~$25, CloudFront + S3 ~$15.

**Levers that move the bill:** Graviton (ARM) across compute, RDS, and Redis (~20% off); 1-year
Compute + Database Savings Plans (30–35% off); Fargate Spot for the interrupt-tolerant aggregation
workers (up to 70% off those tasks); VPC endpoints instead of NAT, and single-AZ + right-sizing for
non-prod. Cost scales **sub-linearly** with venues and viewers — the batched read model and the 1s
fan-out already decouple spend from event volume. (Mumbai / ap-south-1 runs a few percent higher
than us-east-1.)

---

## Production hardening & operations

The six things that separate "works in the demo" from "thought about running it":

**1. Observability — designed, not just mentioned.** Golden signals (latency, traffic, errors,
saturation) at every stage, but two metrics matter most: the SQS **`ApproximateAgeOfOldestMessage`**
(the best "are consumers keeping up?" signal) and **DLQ depth** (should be zero). Plus one
business-level guard — **net sales/min**, alarmed to fire if it hits zero during trading hours, which
catches the silent failure where everything is "green" but no transactions flow. Three pillars:
metrics to CloudWatch/Prometheus, structured JSON logs (structlog) with a correlation id, and
distributed traces (OpenTelemetry) with the trace id propagated through SQS message attributes so one
transaction can be followed `ingest → SQS → consumer → Redis/PG → broadcast`. `/health` (liveness)
and `/ready` (Redis + PG + SQS reachable) back the ECS/ALB checks.

**2. Dead-letter queue.** Redrive policy `maxReceiveCount = 5` → `venue-ingest-dlq`, 14-day
retention. Validation at ingest (422) keeps bad data out of the queue, so the DLQ stays near-empty —
it's a safety net, not a routine path. The part that makes it real: a CloudWatch alarm on DLQ depth
> 0 that pages, plus a triage-and-redrive workflow. A DLQ without an alarm is just a place data goes
to be forgotten.

**3. Redis is critical but not a SPOF.** It's HA (ElastiCache Multi-AZ, ~30s failover), it's derived
and **rebuildable from Postgres** (so a total loss is recoverable, not data loss), and its blast
radius is shrunk: SQS owns the queue, the Postgres `UNIQUE` constraint backstops dedup, and the
Channels channel-layer can run on a separate Redis from the read model so they fail independently. If
the read model is down, the dashboard falls back to reading Postgres directly (polled, slightly
stale) rather than going dark.

**4. Historical aggregates — tiered.** Live (Redis, today) → **hourly** → **daily** → **monthly**
(derived from daily), all bucketed by **event-time** so late/reordered events land in the right
window. Today's Redis aggregates seal into the Postgres rollups at day-close; the nightly recompute
from raw partitions keeps every tier correct and rebuildable. (See *Historical & reporting reads*.)

**5. Event ordering (refund before sale).** Net sales is a **commutative** sum, so out-of-order
processing still nets to the correct total, and event-time bucketing keeps each event in the right
window regardless of arrival order. A refund-ahead-of-sale can transiently dip a venue's net or look
like a blip; it self-corrects within seconds, and the anomaly rules (30-min ratio windows, swept each
minute) won't trip on it. A refund references a sale that may not exist yet, so each event is stored
as an **independent fact** in the append-only log and linked on reconcile, never rejected for a
missing parent. If a sub-flow ever needs strict ordering, the lever is SQS **FIFO** with
`MessageGroupId = venue_id` — not worth its throughput cost for aggregates that are already
commutative.

**6. Recovery — defined, with targets.** **RPO ≈ 0** for acknowledged transactions (durable ingest
boundary + automated backups); per-component RTO:

| Component | Failure | Recovery action | RTO |
| --- | --- | --- | --- |
| Redis read model | node failure | ElastiCache Multi-AZ auto-failover | ~30s |
| Redis read model | total loss | `rebuild-read-model` — replay today's partition | < 1 min |
| Postgres | AZ failure | Multi-AZ failover; consumers retry, SQS buffers, drain | ~60–120s |
| Postgres | corruption | PITR or promote replica; rebuild Redis from log | minutes |
| Consumer/worker | crash | SQS redelivers unacked; autoscaler replaces task | seconds |
| SQS | — | managed, multi-AZ durable; DLQ + redrive for poison | n/a |

Break-glass tools: `rebuild-read-model`, DLQ redrive, `replay-from-log`. Idempotency everywhere
(`ON CONFLICT DO NOTHING`, dedup, rebuildable aggregates) makes every replay safe — and the rebuild
and redrive get **rehearsed**, because a recovery path you've never run isn't a plan.

---

## Auth lifecycle, autoscaling, rate limiting & DR

**JWT lifecycle + WebSocket reconnection.** A short-lived **access token** (~15 min JWT) is the Bearer
on REST calls and on the WebSocket handshake; a longer **refresh token** (~7 days, rotating via
SimpleJWT's rotate + blacklist, with reuse-detection that revokes the whole token family) renews it.
On a REST 401 the client transparently calls `POST /auth/refresh`, gets a new access + rotated refresh,
and retries. The interesting case is the **long-lived socket**: it's authenticated at the handshake
(token passed as a subprotocol, not in the URL), and as the access token nears expiry the client
refreshes over REST and pushes the new token over the existing socket — no drop. On any disconnect
(network blip, deploy, idle, expiry) the client **reconnects with exponential backoff + jitter**,
heartbeat ping/pong detects dead sockets quickly, and on reconnect it re-authenticates, resubscribes,
and requests a **snapshot-on-connect** so it catches up on everything missed during the gap rather
than waiting for the next delta. The reconnection sequence in one line: *disconnect → backoff + jitter
→ re-auth (fresh token) → resubscribe → snapshot-on-connect → live.*

**Autoscaling numbers** (starting points, tuned under load test):

| Service | Scale | Trigger |
| --- | --- | --- |
| Ingest API (Fargate) | 2 → 10 tasks | CPU 60% · ALB request-count-per-target |
| SQS consumers (Fargate) | 2 → 20 tasks | `ApproximateAgeOfOldestMessage` > 30s · backlog-per-task |
| Channels (Fargate) | 2 → 8 tasks | connection count · CPU |
| RDS Postgres | Multi-AZ + read replica | vertical; PgBouncer pooling |
| ElastiCache Redis | 1 primary + 1 replica | shard by venue only if > 100k ops/s |

**Rate limiting.** A per-venue **token bucket** on `/ingest` (~150 req/s + burst, keyed by venue /
API key) means one misbehaving terminal can't flood ingestion; auth endpoints (`/auth/login`,
`/auth/refresh`) get strict per-IP limits to blunt credential stuffing. Over-limit requests get
**429 + Retry-After**, which POS store-and-forward respects. A WAF/ALB global ceiling and DRF throttle
classes sit behind it as the backstop.

**Multi-region DR** (a deferred tier — single-region Multi-AZ is the baseline at this scale). A warm
standby in a second region with **Route 53 health-checked DNS failover**; Postgres via a **cross-region
read replica** (async) that's promoted on region loss; **S3 backups replicated cross-region** (CRR);
Redis simply **rebuilt from Postgres** in the DR region (nothing cross-region to sync); SQS is regional,
so ingest repoints to the DR queue on failover. Region-level **RTO is minutes**, **RPO ≈ replica lag**
(seconds) plus anything in-flight not yet replicated. Worth designing for, not worth standing up until
the business actually requires regional resilience.

---

## Python depth

- **Typed throughout** — full type hints + `mypy`; DRF serializers as the single validation boundary.
- **Async where it counts** — async Channels consumers + an async Redis client for non-blocking fan-out.
- **Idempotency** — `transaction_id` carries a `UNIQUE` constraint in Postgres (`ON CONFLICT DO
  NOTHING`), so SQS's at-least-once redelivery and any replay are safe no-ops.
- **Atomicity** — every aggregate update is one Redis pipeline; raw writes use `transaction.atomic()`.
  No read-modify-write races across workers.
- **Error handling** — typed exceptions → 422 on bad payloads; structured logging via `structlog`.
- **Tests** — focused on the logic that matters: aggregation correctness and anomaly thresholds.
- **Tooling** — `ruff` + `black` + `mypy` in CI.

---

## Trade-offs I made deliberately

- **Redis as a read model** adds a component and a ~1s eventual-consistency window. Worth it for O(1)
  reads and cheap fan-out to many viewers.
- **Modular monolith over microservices** — one deployable, clear module boundaries. The brief is a
  single team shipping one tool; premature service-splitting would cost more than it returns.
- **Rule-based anomalies over ML** — explainable, tunable, and debuggable today. ML is a later
  upgrade once there's labeled history.
- **A 1-second tick** trades a sliver of latency for a massive drop in broadcast volume and a stable
  client experience.

---

## What I'd do differently / next with more time

- **Backfill & replay tooling** — a management command to rebuild the entire Redis read model from the
  Postgres log on demand (the architecture supports it; I'd make it a first-class, tested operation).
- **Per-venue adaptive baselines** — learn each venue's normal rhythm instead of a shared threshold,
  cutting false positives on the anomaly rail.
- **TimescaleDB / continuous aggregates** if history queries grow heavy enough to justify it.
- **Observability** — Prometheus metrics on queue depth, tick latency, and consumer lag; a health
  endpoint that surfaces back-pressure before it becomes user-visible.
- **Richer tests** — property-based tests on the aggregation math and a load test that drives the
  simulator to find the real ceiling of each tier.
- **Graceful WS reconnection + snapshot-on-connect** so a viewer who drops gets a full state catch-up
  rather than waiting for the next delta.

---

## Build plan (how I'd sequence it)

| Phase | Focus                  | Done when                                  |
| ----- | ---------------------- | ------------------------------------------ |
| P1    | Skeleton & data        | Compose boots; events land in Postgres     |
| P2    | Aggregation core       | REST reads return live aggregates          |
| P3    | Real-time layer        | Dashboard updates with no refresh          |
| P4    | Anomalies & drill-down | Flags fire; drill-down opens instantly     |
| P5    | Auth & harden          | Not wide open; key logic tested            |

**Scope discipline:** build less but build it well. If time runs short, P5 hardening is trimmed before
P1–P3 — the live demo is the heart of the brief.
