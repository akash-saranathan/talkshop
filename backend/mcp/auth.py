"""
Bearer-token check in front of the /mcp transport. Two kinds of caller pass:
  * the internal client (backend/mcp/client.py), which sends MCP_BEARER_TOKEN;
  * a connector acting for a customer, which sends that customer's TalkShop JWT.
Anything else gets 401. If MCP_BEARER_TOKEN is not set, only customer tokens pass.
"""
import hmac
import os

from dotenv import load_dotenv

from backend.auth.security import decode_access_token

load_dotenv()

MCP_BEARER_TOKEN = os.getenv("MCP_BEARER_TOKEN", "")


def _accepted(supplied: str, shared: str) -> bool:
    if shared and hmac.compare_digest(supplied, f"Bearer {shared}"):
        return True
    return supplied.startswith("Bearer ") and decode_access_token(supplied[len("Bearer "):]) is not None


class BearerAuthMiddleware:
    def __init__(self, app, token: str = MCP_BEARER_TOKEN):
        self.app = app
        self.token = token

    @staticmethod
    def _challenge() -> str:
        # Tells Claude where to sign in. Without PUBLIC_BASE_URL, Claude can't find the
        # sign-in server, so the challenge is a plain Bearer.
        base = os.getenv("PUBLIC_BASE_URL", "").rstrip("/")
        if not base:
            return "Bearer"
        return f'Bearer resource_metadata="{base}/.well-known/oauth-protected-resource"'

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers", []))
        supplied = headers.get(b"authorization", b"").decode("latin-1")
        if not _accepted(supplied, self.token):
            body = b'{"detail":"MCP bearer token missing or invalid"}'
            await send({
                "type": "http.response.start",
                "status": 401,
                "headers": [(b"content-type", b"application/json"),
                            (b"www-authenticate", self._challenge().encode("latin-1"))],
            })
            await send({"type": "http.response.body", "body": body})
            return

        await self.app(scope, receive, send)


class McpPathMiddleware:
    """Treats /mcp the same as /mcp/. A redirect would drop the sign-in header on the retry."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope.get("path") == "/mcp":
            scope = {**scope, "path": "/mcp/", "raw_path": b"/mcp/"}
        await self.app(scope, receive, send)
