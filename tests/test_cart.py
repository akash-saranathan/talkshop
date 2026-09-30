"""Cart tests — add/increment, list, update quantity, delete, per-user scoping."""
import pytest
from fastapi.testclient import TestClient

from backend.main import app


@pytest.fixture
def client():
    return TestClient(app)


def _sample_item(**overrides):
    item = {
        "product_id": "RW001",
        "merchant_id": "MERCHANT_A",
        "merchant_name": "RunnerWorld",
        "title": "Nike Pegasus 41",
        "brand": "Nike",
        "category": "running_shoes",
        "price": 109.0,
        "currency": "USD",
        "size": "10",
        "color": "black",
        "image_url": "https://images.pexels.com/photos/1027130/pexels-photo-1027130.jpeg",
        "rating": 4.8,
        "delivery_days": 3,
    }
    item.update(overrides)
    return item


def test_add_cart_item_creates_row(client, auth_headers):
    resp = client.post("/api/cart/items", json=_sample_item(), headers=auth_headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["product_id"] == "RW001"
    assert data["quantity"] == 1

    items = client.get("/api/cart", headers=auth_headers).json()
    assert len(items) == 1
    assert items[0]["title"] == "Nike Pegasus 41"


def test_add_same_product_increments_quantity_instead_of_duplicating(client, auth_headers):
    client.post("/api/cart/items", json=_sample_item(), headers=auth_headers)
    client.post("/api/cart/items", json=_sample_item(), headers=auth_headers)

    items = client.get("/api/cart", headers=auth_headers).json()
    assert len(items) == 1
    assert items[0]["quantity"] == 2


def test_add_different_products_creates_separate_rows(client, auth_headers):
    client.post("/api/cart/items", json=_sample_item(), headers=auth_headers)
    client.post("/api/cart/items", json=_sample_item(product_id="TS001", title="Sony Headphones"), headers=auth_headers)

    items = client.get("/api/cart", headers=auth_headers).json()
    assert len(items) == 2


def test_update_quantity(client, auth_headers):
    added = client.post("/api/cart/items", json=_sample_item(), headers=auth_headers).json()
    resp = client.patch(
        f"/api/cart/items/{added['cart_item_id']}",
        json={"quantity": 5},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["quantity"] == 5


def test_update_quantity_rejects_zero(client, auth_headers):
    added = client.post("/api/cart/items", json=_sample_item(), headers=auth_headers).json()
    resp = client.patch(
        f"/api/cart/items/{added['cart_item_id']}",
        json={"quantity": 0},
        headers=auth_headers,
    )
    assert resp.status_code == 422


def test_delete_cart_item(client, auth_headers):
    added = client.post("/api/cart/items", json=_sample_item(), headers=auth_headers).json()
    resp = client.delete(f"/api/cart/items/{added['cart_item_id']}", headers=auth_headers)
    assert resp.status_code == 200

    items = client.get("/api/cart", headers=auth_headers).json()
    assert items == []


def test_cart_is_scoped_per_user(client, auth_headers):
    added = client.post("/api/cart/items", json=_sample_item(), headers=auth_headers).json()

    import uuid
    other = client.post("/api/auth/register", json={
        "name": "Other User", "email": f"other-{uuid.uuid4().hex[:8]}@example.com", "password": "otherpass123",
    })
    other_headers = {"Authorization": f"Bearer {other.json()['access_token']}"}

    assert client.get("/api/cart", headers=other_headers).json() == []

    update_resp = client.patch(
        f"/api/cart/items/{added['cart_item_id']}",
        json={"quantity": 2},
        headers=other_headers,
    )
    assert update_resp.status_code == 404

    delete_resp = client.delete(f"/api/cart/items/{added['cart_item_id']}", headers=other_headers)
    assert delete_resp.status_code == 404


def test_unknown_cart_item_404s(client, auth_headers):
    resp = client.patch("/api/cart/items/CART_UNKNOWN", json={"quantity": 2}, headers=auth_headers)
    assert resp.status_code == 404
    resp = client.delete("/api/cart/items/CART_UNKNOWN", headers=auth_headers)
    assert resp.status_code == 404


def test_cart_requires_auth(client):
    assert client.get("/api/cart").status_code == 401
    assert client.post("/api/cart/items", json=_sample_item()).status_code == 401
