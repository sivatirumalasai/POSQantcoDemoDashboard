"""Explainable anomaly rules (sweep_anomalies → flags:active)."""
import json

from core import readmodel
from core.tasks import sweep_anomalies


def _set(r, vid, name, net, txns, voids=0, refunds=0):
    readmodel.init_venue(r, vid, name)
    r.hset(f"venue:{vid}", mapping={"net": net, "txns": txns, "voids": voids, "refunds": refunds})
    r.zadd("ranking:today", {str(vid): net})


def test_spike_flag(fake_redis):
    r = fake_redis
    _set(r, 1, "Normal", 1000, 100, voids=0, refunds=0)
    _set(r, 2, "Normal2", 1000, 100, voids=0, refunds=0)
    _set(r, 3, "Spiky", 1000, 100, voids=8, refunds=8)  # (8+8)/100 = 16% > 9%

    n = sweep_anomalies()
    flags = json.loads(r.get("flags:active"))
    spiky = [f for f in flags if f["venue"] == "Spiky"]
    assert n >= 1
    assert spiky and spiky[0]["type"] == "spike"
    assert r.hget("venue:3", "flag") == "spike"


def test_hot_flag(fake_redis):
    r = fake_redis
    _set(r, 1, "Quiet1", 500, 30)
    _set(r, 2, "Quiet2", 500, 30)
    _set(r, 3, "Busy", 5000, 200)  # >> median * 1.6 and > 1000

    sweep_anomalies()
    flags = json.loads(r.get("flags:active"))
    busy = [f for f in flags if f["venue"] == "Busy"]
    assert busy and busy[0]["type"] == "hot"


def test_no_flags_when_healthy(fake_redis):
    r = fake_redis
    _set(r, 1, "A", 1000, 100)
    _set(r, 2, "B", 1050, 100)
    _set(r, 3, "C", 980, 100)

    n = sweep_anomalies()
    assert n == 0
    assert json.loads(r.get("flags:active")) == []


def test_flag_clears_on_recompute(fake_redis):
    r = fake_redis
    _set(r, 1, "A", 1000, 100)
    _set(r, 2, "B", 1000, 100)
    _set(r, 3, "Spiky", 1000, 100, voids=10, refunds=10)
    sweep_anomalies()
    assert r.hget("venue:3", "flag") == "spike"

    # condition resolves → next sweep clears it
    r.hset("venue:3", mapping={"voids": 0, "refunds": 0})
    sweep_anomalies()
    assert r.hget("venue:3", "flag") == ""
