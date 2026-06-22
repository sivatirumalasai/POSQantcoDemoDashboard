"""
Redis read model — the dashboard's questions map directly onto Redis structures,
each O(1) or O(log n). Writes happen on the ingest hot path; reads happen in the
1s ticker and on WS connect (snapshot-on-connect).

Keys:
  venue:{id}        hash    name, net, txns, voids, refunds, flag
  venues:all        set     every venue id (so all 40 show before any sale)
  ranking:today     zset    member=id score=net
  topitems:group    zset    member=item score=qty
  items:{id}        zset    per-venue item qty
  hourly:{id}       hash    field=hour(0-23) value=amount
  txn_counter       int     total sales counter (drives tps)
  flags:active      string  JSON list of active anomaly flags
"""
import json
import redis
from django.conf import settings

_pool = None


def client():
    global _pool
    if _pool is None:
        _pool = redis.ConnectionPool.from_url(settings.REDIS_URL, decode_responses=True)
    return redis.Redis(connection_pool=_pool)


def init_venue(r, vid, name):
    p = r.pipeline()
    p.hset(f"venue:{vid}", mapping={"name": name})
    p.hsetnx(f"venue:{vid}", "net", 0)
    p.hsetnx(f"venue:{vid}", "txns", 0)
    p.hsetnx(f"venue:{vid}", "voids", 0)
    p.hsetnx(f"venue:{vid}", "refunds", 0)
    p.hsetnx(f"venue:{vid}", "flag", "")
    p.sadd("venues:all", vid)
    p.zadd("ranking:today", {str(vid): 0}, nx=True)
    p.execute()


def apply_event(r, vid, name, kind, amount, items, hour):
    """Update the read model for one transaction (best-effort, one pipeline)."""
    key = f"venue:{vid}"
    p = r.pipeline()
    p.hset(key, "name", name)
    p.sadd("venues:all", vid)
    if kind == "sale":
        p.hincrbyfloat(key, "net", amount)
        p.hincrby(key, "txns", 1)
        p.hincrbyfloat(f"hourly:{vid}", str(hour), amount)
        p.incr("txn_counter")
        for it in items or []:
            qty = int(it.get("qty", 1))
            p.zincrby("topitems:group", qty, it.get("item", "?"))
            p.zincrby(f"items:{vid}", qty, it.get("item", "?"))
    elif kind == "refund":
        p.hincrbyfloat(key, "net", -amount)
        p.hincrby(key, "refunds", 1)
    elif kind == "void":
        p.hincrby(key, "voids", 1)
    res = p.execute()
    # keep the ranking zset in sync with the venue's new net
    net = r.hget(key, "net")
    if net is not None:
        r.zadd("ranking:today", {str(vid): float(net)})
    return res


def venue_ids(r):
    return sorted(int(x) for x in r.smembers("venues:all"))


def read_snapshot_core(r):
    """Read per-venue aggregates + group items + flags from Redis (no derived
    KPI/history state — the ticker layers that on top)."""
    ids = venue_ids(r)
    venues = {}
    p = r.pipeline()
    for vid in ids:
        p.hgetall(f"venue:{vid}")
        p.hgetall(f"hourly:{vid}")
        p.zrevrange(f"items:{vid}", 0, 7, withscores=True)
    raw = p.execute()

    start = settings.TRADING_START_HOUR
    span = settings.TRADING_HOURS
    for i, vid in enumerate(ids):
        h = raw[i * 3]
        hourly_hash = raw[i * 3 + 1]
        items_z = raw[i * 3 + 2]
        hourly = [round(float(hourly_hash.get(str((start + k) % 24), 0)), 2) for k in range(span)]
        items = {name: int(score) for name, score in items_z}
        venues[vid] = {
            "id": vid,
            "name": h.get("name", f"Venue {vid}"),
            "net": round(float(h.get("net", 0)), 2),
            "txns": int(float(h.get("txns", 0))),
            "voids": int(float(h.get("voids", 0))),
            "refunds": int(float(h.get("refunds", 0))),
            "flag": h.get("flag") or None,
            "hourly": hourly,
            "items": items,
        }

    order = [int(x) for x in r.zrevrange("ranking:today", 0, -1)]
    order = [vid for vid in order if vid in venues] or list(venues.keys())

    group_items = {name: int(score) for name, score in r.zrevrange("topitems:group", 0, 7, withscores=True)}
    flags = json.loads(r.get("flags:active") or "[]")
    total_txns = int(r.get("txn_counter") or 0)

    return {"venues": venues, "order": order, "groupItems": group_items, "flags": flags, "totalTxns": total_txns}
