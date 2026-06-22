"""WebSocket consumer — snapshot-on-connect + group broadcast fan-out."""
import pytest
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator

from core import readmodel
from core.routing import websocket_urlpatterns
from core.consumers import GROUP


@pytest.mark.asyncio
async def test_snapshot_on_connect(fake_redis):
    readmodel.init_venue(fake_redis, 1, "Alpha")
    readmodel.apply_event(fake_redis, 1, "Alpha", "sale", 120.0, [{"item": "Beer", "qty": 1}], 12)

    comm = WebsocketCommunicator(URLRouter(websocket_urlpatterns), "/ws/dashboard/")
    connected, _ = await comm.connect()
    assert connected

    msg = await comm.receive_json_from(timeout=3)
    assert "venues" in msg and "kpis" in msg
    assert msg["kpis"]["net"] == pytest.approx(120.0)
    await comm.disconnect()


@pytest.mark.asyncio
async def test_group_broadcast_reaches_client(fake_redis):
    from channels.layers import get_channel_layer

    comm = WebsocketCommunicator(URLRouter(websocket_urlpatterns), "/ws/dashboard/")
    await comm.connect()
    await comm.receive_json_from(timeout=3)  # drain the connect snapshot

    payload = {"venues": {"1": {"id": 1, "net": 5}}, "order": [1], "tick": 99,
               "kpis": {"net": 5}, "flags": [], "groupItems": {}, "history": {},
               "flashId": None}
    layer = get_channel_layer()
    await layer.group_send(GROUP, {"type": "dashboard.snapshot", "data": payload})

    msg = await comm.receive_json_from(timeout=3)
    assert msg["tick"] == 99
    await comm.disconnect()
