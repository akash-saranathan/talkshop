"""
Display brand (white-label): BRAND=chase shows "Chase Marketplace" to customers
on Demo 1's marketplace APIs, in Talkshop and in emails; internal ids and
Demo 2's APIs are unchanged.
"""
import json

import pytest
from fastapi.testclient import TestClient

from backend.config import brand
from backend.main import app
from tests.conftest import register_member


@pytest.fixture
def chase(monkeypatch):
    monkeypatch.setenv("BRAND", "chase")


def test_display_text_mapping(chase):
    assert brand.display("Added to your ShopSphere cart.") == "Added to your Chase Marketplace cart."
    assert brand.display("ShopSphere Wallet") == "Marketplace Wallet"
    assert brand.display("You have 10 ShopSphere points") == "You have 10 Chase Marketplace points"
    assert brand.display("merchant SHOPSPHERE, kaajal@shopsphere.demo") == "merchant SHOPSPHERE, kaajal@shopsphere.demo"


def test_shopsphere_brand_leaves_text_alone(monkeypatch):
    monkeypatch.setenv("BRAND", "shopsphere")
    assert brand.display("Added to your ShopSphere cart.") == "Added to your ShopSphere cart."


def test_marketplace_api_and_talkshop_show_the_chase_brand(chase):
    client = TestClient(app)
    tok = client.post("/api/auth/visitor").json()["access_token"]
    r = client.get("/api/products", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 403 and "Chase Marketplace" in r.json()["detail"]["message"]
    h, _ = register_member()
    products = client.get("/api/products?limit=1", headers=h).json()
    assert products[0]["merchant_id"] == "SHOPSPHERE"                       # internal ids unchanged
    r = client.post("/api/talkshop/turn", json={"session_id": "brand1234", "text": "where is my order?"}, headers=h)
    events = [json.loads(l[6:]) for b in r.text.split("\n\n") for l in b.splitlines() if l.startswith("data: ")]
    blob = json.dumps(events)
    assert "ShopSphere" not in blob and "Chase Marketplace" in blob


def test_demo2_apis_are_not_rebranded(chase):
    client = TestClient(app)
    r = client.get("/api/merchants")
    assert r.status_code == 200 and "ShopSphere" in r.text                  # Demo 2's merchant list as before
