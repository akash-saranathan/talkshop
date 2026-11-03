"""
TalkShop's OAuth 2.1 authorization server for the MCP connector (Claude / ChatGPT).

Flow:
  1. Claude registers itself (POST /oauth/register) and gets a public client_id.
  2. Claude sends the customer's browser to GET /oauth/authorize. The customer signs
     in with their existing TalkShop email and password (same accounts as the web app).
  3. TalkShop redirects back with a one-time code. Claude exchanges the code at
     POST /oauth/token with a PKCE verifier and gets a TalkShop access token
     (the same JWT the web app uses) plus a refresh token.
  4. Claude sends the access token as `Authorization: Bearer` to /mcp/.
     Refresh tokens rotate, so the customer does not sign in again every time.

State (clients, codes, refresh tokens) is kept in memory. A backend restart drops
it, so the connector asks the customer to sign in again. Fine for the demo.
"""
import base64
import hashlib
import hmac
import html
import os
import secrets
import time
from urllib.parse import urlencode, urlparse

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from backend.auth.security import create_access_token, verify_password
from backend.db.schema import User
from backend.db.session_utils import get_session

router = APIRouter()

ACCESS_TOKEN_TTL = 24 * 3600          # matches TOKEN_TTL_HOURS in backend/auth/security.py
CODE_TTL = 300                        # authorization codes are valid for 5 minutes
REFRESH_TTL = 30 * 24 * 3600          # refresh tokens are valid for 30 days

_clients: dict[str, dict] = {}        # client_id -> {redirect_uris, client_name}
_codes: dict[str, dict] = {}          # code -> {client_id, redirect_uri, code_challenge, user_id, expires_at}
_refresh_tokens: dict[str, dict] = {}  # refresh token -> {client_id, user_id, expires_at}


def public_base_url(request: Request) -> str:
    """The public address Claude uses. Set PUBLIC_BASE_URL to the tunnel address; the
    request's own host is only a fallback for local testing."""
    return (os.getenv("PUBLIC_BASE_URL") or str(request.base_url)).rstrip("/")


def _valid_redirect_uri(uri: str) -> bool:
    parsed = urlparse(uri)
    if parsed.scheme == "https" and parsed.netloc:
        return True
    return parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1")


def _error(status: int, error: str, description: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": error, "error_description": description})


@router.get("/.well-known/oauth-protected-resource")
def protected_resource_metadata(request: Request):
    base = public_base_url(request)
    return {
        "resource": f"{base}/mcp/",
        "authorization_servers": [base],
        "bearer_methods_supported": ["header"],
    }


@router.get("/.well-known/oauth-authorization-server")
def authorization_server_metadata(request: Request):
    base = public_base_url(request)
    return {
        "issuer": base,
        "authorization_endpoint": f"{base}/oauth/authorize",
        "token_endpoint": f"{base}/oauth/token",
        "registration_endpoint": f"{base}/oauth/register",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
    }


@router.post("/oauth/register", status_code=201)
async def register_client(request: Request):
    body = await request.json()
    redirect_uris = body.get("redirect_uris") or []
    if not redirect_uris or not all(_valid_redirect_uri(uri) for uri in redirect_uris):
        return _error(400, "invalid_redirect_uri", "redirect_uris must be https (or localhost http).")

    client_id = secrets.token_urlsafe(16)
    client_name = str(body.get("client_name") or "MCP client")
    _clients[client_id] = {"redirect_uris": redirect_uris, "client_name": client_name}
    return {
        "client_id": client_id,
        "client_id_issued_at": int(time.time()),
        "client_name": client_name,
        "redirect_uris": redirect_uris,
        "token_endpoint_auth_method": "none",
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
    }


def _check_authorize_params(params: dict) -> str | None:
    """Returns an error description, or None when the request can be shown to the customer."""
    if params.get("response_type") != "code":
        return "Only response_type=code is supported."
    client = _clients.get(params.get("client_id", ""))
    if client is None:
        return "Unknown client. Add the connector again."
    if params.get("redirect_uri") not in client["redirect_uris"]:
        return "The redirect address does not match the one registered for this client."
    if not params.get("code_challenge") or params.get("code_challenge_method") != "S256":
        return "PKCE with code_challenge_method=S256 is required."
    return None


def _login_page(params: dict, error: str | None = None) -> HTMLResponse:
    hidden = "".join(
        f'<input type="hidden" name="{name}" value="{html.escape(params.get(name, ""), quote=True)}">'
        for name in ("client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "response_type")
    )
    client = _clients.get(params.get("client_id", ""), {})
    client_name = html.escape(client.get("client_name", "an app"))
    error_html = f'<p style="color:#b00020">{html.escape(error)}</p>' if error else ""
    return HTMLResponse(f"""<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in to TalkShop</title></head>
<body style="font-family:system-ui,sans-serif;max-width:360px;margin:48px auto;padding:0 16px">
<h1 style="font-size:22px">Sign in to TalkShop</h1>
<p>{client_name} wants to use your TalkShop account.</p>
{error_html}
<form method="post" action="/oauth/authorize">
{hidden}
<label>Email<br><input type="email" name="email" required style="width:100%;padding:8px"></label><br><br>
<label>Password<br><input type="password" name="password" required style="width:100%;padding:8px"></label><br><br>
<button type="submit" style="padding:10px 18px">Sign in</button>
</form>
</body></html>""")


@router.get("/oauth/authorize")
async def authorize_page(request: Request):
    params = dict(request.query_params)
    problem = _check_authorize_params(params)
    if problem:
        return HTMLResponse(f"<p>{html.escape(problem)}</p>", status_code=400)
    return _login_page(params)


@router.post("/oauth/authorize")
async def authorize_submit(request: Request):
    form = await request.form()
    params = {k: str(v) for k, v in form.items()}
    problem = _check_authorize_params(params)
    if problem:
        return HTMLResponse(f"<p>{html.escape(problem)}</p>", status_code=400)

    email = params.get("email", "")
    password = params.get("password", "")
    with get_session() as session:
        user = session.query(User).filter(User.email == email).first()
        user_id = user.user_id if user and verify_password(password, user.password_hash) else None
    if user_id is None:
        return _login_page(params, error="Incorrect email or password.")

    code = secrets.token_urlsafe(32)
    _codes[code] = {
        "client_id": params["client_id"],
        "redirect_uri": params["redirect_uri"],
        "code_challenge": params["code_challenge"],
        "user_id": user_id,
        "expires_at": time.time() + CODE_TTL,
    }
    query = {"code": code}
    if params.get("state"):
        query["state"] = params["state"]
    separator = "&" if urlparse(params["redirect_uri"]).query else "?"
    return RedirectResponse(f"{params['redirect_uri']}{separator}{urlencode(query)}", status_code=302)


def _pkce_matches(verifier: str, challenge: str) -> bool:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    expected = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return hmac.compare_digest(expected, challenge)


def _token_response(user_id: str, client_id: str) -> dict:
    refresh_token = secrets.token_urlsafe(32)
    _refresh_tokens[refresh_token] = {
        "client_id": client_id,
        "user_id": user_id,
        "expires_at": time.time() + REFRESH_TTL,
    }
    return {
        "access_token": create_access_token(user_id),
        "token_type": "Bearer",
        "expires_in": ACCESS_TOKEN_TTL,
        "refresh_token": refresh_token,
    }


@router.post("/oauth/token")
async def token(request: Request):
    form = await request.form()
    grant_type = form.get("grant_type")

    if grant_type == "authorization_code":
        code_data = _codes.pop(str(form.get("code", "")), None)  # single use
        if code_data is None or code_data["expires_at"] < time.time():
            return _error(400, "invalid_grant", "The authorization code is invalid or has expired.")
        if code_data["client_id"] != form.get("client_id") or code_data["redirect_uri"] != form.get("redirect_uri"):
            return _error(400, "invalid_grant", "The code was issued to a different client or redirect address.")
        if not _pkce_matches(str(form.get("code_verifier", "")), code_data["code_challenge"]):
            return _error(400, "invalid_grant", "PKCE verification failed.")
        return _token_response(code_data["user_id"], code_data["client_id"])

    if grant_type == "refresh_token":
        refresh = _refresh_tokens.pop(str(form.get("refresh_token", "")), None)  # rotate: old token is used up
        if refresh is None or refresh["expires_at"] < time.time():
            return _error(400, "invalid_grant", "The refresh token is invalid or has expired. Sign in again.")
        if refresh["client_id"] != form.get("client_id"):
            return _error(400, "invalid_grant", "The refresh token was issued to a different client.")
        return _token_response(refresh["user_id"], refresh["client_id"])

    return _error(400, "unsupported_grant_type", "Use authorization_code or refresh_token.")
