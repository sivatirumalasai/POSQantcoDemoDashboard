"""Redis read-model aggregation math (the heart of the live view)."""
import pytest

from core import readmodel


def test_init_venue_seeds_baseline(fake_redis):
    r = fake_redis
    readmodel.init_venue(r, 1, "V1")
    assert r.hget("venue:1", "name") == "V1"
    assert float(r.hget("venue:1", "net")) == 0
    assert 1 in readmodel.venue_ids(r)
    assert r.zscore("ranking:today", "1") == 0


def test_apply_event_math(fake_redis):
    r = fake_redis
    readmodel.init_venue(r, 1, "V1")
    readmodel.apply_event(r, 1, "V1", "sale", 100.0, [{"item": "Beer", "qty": 2}], 14)
    readmodel.apply_event(r, 1, "V1", "sale", 50.0, [{"item": "Pizza", "qty": 1}], 14)
    readmodel.apply_event(r, 1, "V1", "refund", 30.0, [], 15)
    readmodel.apply_event(r, 1, "V1", "void", 0.0, [], 15)

    assert float(r.hget("venue:1", "net")) == pytest.approx(120.0)  # 150 - 30
    assert int(r.hget("venue:1", "txns")) == 2
    assert int(r.hget("venue:1", "refunds")) == 1
    assert int(r.hget("venue:1", "voids")) == 1
    assert int(r.get("txn_counter")) == 2
    assert r.zscore("ranking:today", "1") == pytest.approx(120.0)
    assert r.zscore("topitems:group", "Beer") == 2
    assert float(r.hget("hourly:1", "14")) == pytest.approx(150.0)


def test_read_snapshot_core_shape(fake_redis):
    r = fake_redis
    readmodel.init_venue(r, 1, "Alpha")
    readmodel.init_venue(r, 2, "Beta")
    readmodel.apply_event(r, 1, "Alpha", "sale", 200.0, [{"item": "Beer", "qty": 3}], 12)
    readmodel.apply_event(r, 2, "Beta", "sale", 80.0, [{"item": "Wine", "qty": 1}], 12)

    snap = readmodel.read_snapshot_core(r)
    assert set(snap.keys()) == {"venues", "order", "groupItems", "flags", "totalTxns"}
    assert snap["venues"][1]["net"] == pytest.approx(200.0)
    assert snap["venues"][1]["name"] == "Alpha"
    assert len(snap["venues"][1]["hourly"]) == 18      # trading-hours window
    assert snap["order"][0] == 1                        # ranked by net desc
    assert snap["groupItems"]["Beer"] == 3
    assert snap["totalTxns"] == 2
