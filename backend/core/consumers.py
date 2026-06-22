import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async

GROUP = "dashboard"


class DashboardConsumer(AsyncWebsocketConsumer):
    """One WS connection per viewer. Joins the dashboard group; the 1s ticker
    fans one coalesced snapshot out to the whole group. On connect (and on an
    explicit {action:'snapshot'}) the client gets a snapshot-on-connect so it
    catches up immediately rather than waiting for the next delta."""

    async def connect(self):
        await self.channel_layer.group_add(GROUP, self.channel_name)
        # echo the negotiated subprotocol (the JWT) back, per the handshake
        subproto = None
        for p in self.scope.get("subprotocols", []):
            if p != "access_token":
                subproto = p
        await self.accept(subprotocol=subproto)
        await self.send_snapshot()

    async def disconnect(self, code):
        await self.channel_layer.group_discard(GROUP, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        try:
            msg = json.loads(text_data or "{}")
        except json.JSONDecodeError:
            return
        if msg.get("action") == "snapshot":
            await self.send_snapshot()

    async def send_snapshot(self):
        snap = await _build_connect_snapshot()
        await self.send(text_data=json.dumps(snap))

    # group broadcast from the ticker
    async def dashboard_snapshot(self, event):
        await self.send(text_data=json.dumps(event["data"]))


@database_sync_to_async
def _build_connect_snapshot():
    from . import readmodel
    r = readmodel.client()
    core = readmodel.read_snapshot_core(r)
    net = sum(v["net"] for v in core["venues"].values())
    return {
        "venues": core["venues"],
        "order": core["order"],
        "groupItems": core["groupItems"],
        "flags": core["flags"],
        "kpis": {"net": net, "rate": 0, "tps": 0, "totalTxns": core["totalTxns"], "netTrend": 0},
        "history": {"net": [], "rate": [], "tps": []},
        "flashId": None,
        "tick": 0,
    }
