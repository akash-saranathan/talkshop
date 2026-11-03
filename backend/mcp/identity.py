"""
Who is calling the MCP server. The connector sends the customer's TalkShop token
(the JWT from /api/auth/login) as `Authorization: Bearer <token>`. Tools call
current_user_id() instead of taking a user_id argument, so a caller can't pick
someone else's account.
"""
from fastmcp.exceptions import ToolError
from fastmcp.server.dependencies import get_http_headers

from backend.auth.security import decode_access_token


def current_user_id() -> str:
    headers = get_http_headers(include={"authorization"})
    auth = headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        raise ToolError("Not signed in to TalkShop. Add your TalkShop token to the connector.")
    user_id = decode_access_token(auth[len("Bearer "):])
    if not user_id:
        raise ToolError("TalkShop token is invalid or expired. Log in again and update the connector.")
    return user_id
