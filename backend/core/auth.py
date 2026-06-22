"""
JWT auth for the WebSocket handshake. The token is passed as a subprotocol
(not in the URL), validated here, and the user attached to the scope.

Local profile: in DEBUG an unauthenticated socket is allowed (Anonymous) so the
demo never blocks; outside DEBUG a valid token is required.
"""
from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from django.conf import settings
from django.contrib.auth.models import AnonymousUser


@database_sync_to_async
def _user_from_token(token):
    try:
        from rest_framework_simplejwt.tokens import AccessToken
        from django.contrib.auth import get_user_model
        data = AccessToken(token)
        return get_user_model().objects.get(id=data["user_id"])
    except Exception:
        return AnonymousUser()


def _extract_token(scope):
    # 1) subprotocol form: ["access_token", "<jwt>"]
    protos = scope.get("subprotocols", [])
    if "access_token" in protos:
        idx = protos.index("access_token")
        if idx + 1 < len(protos):
            return protos[idx + 1]
    # 2) query-string fallback: ?token=<jwt>
    qs = parse_qs((scope.get("query_string") or b"").decode())
    if "token" in qs:
        return qs["token"][0]
    return None


class JWTAuthMiddleware(BaseMiddleware):
    async def __call__(self, scope, receive, send):
        token = _extract_token(scope)
        user = await _user_from_token(token) if token else AnonymousUser()
        if not user.is_authenticated and not settings.DEBUG:
            await send({"type": "websocket.close", "code": 4401})
            return
        scope["user"] = user
        return await super().__call__(scope, receive, send)
