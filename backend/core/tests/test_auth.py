"""JWT WebSocket handshake middleware."""
import pytest
from django.contrib.auth.models import AnonymousUser

from core.auth import _extract_token, _user_from_token, JWTAuthMiddleware


def test_extract_token_from_subprotocol():
    assert _extract_token({"subprotocols": ["access_token", "tok123"]}) == "tok123"


def test_extract_token_from_query_string():
    assert _extract_token({"query_string": b"token=abc&x=1"}) == "abc"


def test_extract_token_none():
    assert _extract_token({"subprotocols": [], "query_string": b""}) is None


@pytest.mark.asyncio
async def test_user_from_invalid_token_is_anonymous(db):
    user = await _user_from_token("not-a-real-jwt")
    assert isinstance(user, AnonymousUser)


@pytest.mark.asyncio
async def test_middleware_allows_anonymous_in_debug(settings):
    settings.DEBUG = True
    seen = {}

    async def inner(scope, receive, send):
        seen["user"] = scope["user"]

    mw = JWTAuthMiddleware(inner)
    await mw({"type": "websocket", "subprotocols": [], "query_string": b""}, None, None)
    assert isinstance(seen["user"], AnonymousUser)


@pytest.mark.asyncio
async def test_middleware_rejects_without_token_when_not_debug(settings):
    settings.DEBUG = False
    sent = []

    async def inner(scope, receive, send):
        seen_called.append(True)

    seen_called = []

    async def send(msg):
        sent.append(msg)

    mw = JWTAuthMiddleware(inner)
    await mw({"type": "websocket", "subprotocols": [], "query_string": b""}, None, send)
    assert sent and sent[0]["type"] == "websocket.close"
    assert not seen_called  # inner app never reached
