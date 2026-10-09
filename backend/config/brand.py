"""
Display brand for Demo 1 (white-label). The code and data keep the internal
merchant name ShopSphere (merchant id SHOPSPHERE); what customers SEE —
Talkshop's messages, marketplace API responses, confirmation emails — uses
the brand chosen here:

  BRAND=chase        Chase Marketplace (default; approved for the internal demo)
  BRAND=shopsphere   ShopSphere (the original concept brand)

Only Demo 1's marketplace paths are re-branded; Demo 2's APIs are untouched.
Payments, cards and rewards stay simulated whatever the brand.
"""
import json
import os

BRANDS = {
    "chase": {"name": "Chase Marketplace", "short": "Chase", "wallet": "Marketplace Wallet",
              "points": "Chase Marketplace points"},
    "shopsphere": {"name": "ShopSphere", "short": "ShopSphere", "wallet": "ShopSphere Wallet",
                   "points": "ShopSphere points"},
}


def current() -> dict:
    return BRANDS.get((os.getenv("BRAND") or "chase").strip().lower(), BRANDS["chase"])


def display(text: str) -> str:
    """Customer-facing text with the internal name replaced by the display brand."""
    if not text or "ShopSphere" not in text:
        return text
    b = current()
    if b["name"] == "ShopSphere":
        return text
    return (text.replace("ShopSphere Wallet", b["wallet"]).replace("ShopSphere points", b["points"])
            .replace("ShopSphere Demo Shipping", f"{b['short']} Demo Shipping").replace("ShopSphere", b["name"]))


def display_obj(value):
    """display() applied to every string inside a JSON-like value."""
    if isinstance(value, str):
        return display(value)
    if isinstance(value, list):
        return [display_obj(v) for v in value]
    if isinstance(value, dict):
        return {k: display_obj(v) for k, v in value.items()}
    return value


# Demo 1 marketplace APIs whose JSON responses are shown to customers.
BRANDED_PREFIXES = ("/api/products", "/api/cart/lines", "/api/me/", "/api/checkouts", "/api/member", "/api/offers",
                    "/api/rewards", "/api/vic", "/api/orders", "/api/auth/register-cardmember",
                    "/api/talkshop/sessions")


class BrandMiddleware:
    """Pure ASGI middleware: re-brands JSON responses on Demo 1 marketplace paths.
    Streaming Talkshop turns are branded where events are emitted instead."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "") if scope["type"] == "http" else ""
        if not path.startswith(BRANDED_PREFIXES) or current()["name"] == "ShopSphere":
            return await self.app(scope, receive, send)
        start: dict = {}
        chunks: list[bytes] = []

        async def capture(message):
            if message["type"] == "http.response.start":
                start.update(message)
                return
            if message["type"] == "http.response.body":
                chunks.append(message.get("body", b""))
                if message.get("more_body"):
                    return
                headers = [(k, v) for k, v in start.get("headers", [])]
                ctype = next((v for k, v in headers if k.lower() == b"content-type"), b"")
                body = b"".join(chunks)
                if b"application/json" in ctype and b"ShopSphere" in body:
                    body = json.dumps(display_obj(json.loads(body))).encode()
                    headers = [(k, v) for k, v in headers if k.lower() != b"content-length"]
                    headers.append((b"content-length", str(len(body)).encode()))
                await send({**start, "headers": headers})
                await send({"type": "http.response.body", "body": body})
                return
            await send(message)

        await self.app(scope, receive, capture)
