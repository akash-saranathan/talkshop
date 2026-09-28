"""
Shopify Storefront API adapter — Tier 2.
Requires SHOPIFY_STORE_DOMAIN and SHOPIFY_STOREFRONT_ACCESS_TOKEN in .env.
Falls back to local adapter silently when credentials are absent.
"""
import os
from typing import Optional

import httpx
from dotenv import load_dotenv

from backend.models.product import NormalizedProduct

load_dotenv()

STORE_DOMAIN = os.getenv("SHOPIFY_STORE_DOMAIN", "")
ACCESS_TOKEN = os.getenv("SHOPIFY_STOREFRONT_ACCESS_TOKEN", "")
MERCHANT_ID = "MERCHANT_A"
MERCHANT_NAME = "RunnerWorld"

_QUERY = """
query SearchProducts($query: String!, $first: Int!) {
  products(first: $first, query: $query) {
    edges {
      node {
        id
        title
        vendor
        productType
        variants(first: 1) {
          edges {
            node {
              id
              price { amount currencyCode }
              availableForSale
              quantityAvailable
              selectedOptions { name value }
            }
          }
        }
      }
    }
  }
}
"""


def _credentials_present() -> bool:
    return bool(STORE_DOMAIN and ACCESS_TOKEN)


async def search_products(
    category: Optional[str] = None,
    brand: Optional[str] = None,
    max_price: Optional[float] = None,
    size: Optional[str] = None,
) -> list[NormalizedProduct]:
    """
    Search Shopify Storefront API.
    Returns empty list (caller falls back to local) if credentials absent or request fails.
    """
    if not _credentials_present():
        return []

    query_parts = []
    if category:
        query_parts.append(f"product_type:{category}")
    if brand:
        query_parts.append(f"vendor:{brand}")
    gql_query = " ".join(query_parts) if query_parts else "available_for_sale:true"

    url = f"https://{STORE_DOMAIN}/api/2024-01/graphql.json"
    headers = {
        "X-Shopify-Storefront-Access-Token": ACCESS_TOKEN,
        "Content-Type": "application/json",
    }
    payload = {"query": _QUERY, "variables": {"query": gql_query, "first": 20}}

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
    except Exception:
        return []

    results = []
    edges = data.get("data", {}).get("products", {}).get("edges", [])
    for edge in edges:
        node = edge["node"]
        variants = node.get("variants", {}).get("edges", [])
        if not variants:
            continue
        variant = variants[0]["node"]
        price = float(variant["price"]["amount"])

        if max_price is not None and price > max_price:
            continue

        # Extract size from variant options
        variant_size = None
        for opt in variant.get("selectedOptions", []):
            if opt["name"].lower() == "size":
                variant_size = opt["value"]
        if size and variant_size and variant_size != size:
            continue

        shopify_id = node["id"].split("/")[-1]
        results.append(NormalizedProduct(
            merchant_id=MERCHANT_ID,
            merchant_name=MERCHANT_NAME,
            product_id=f"SH_{shopify_id}",
            title=node["title"],
            brand=node.get("vendor"),
            category=node.get("productType", category or "general"),
            price=price,
            currency=variant["price"]["currencyCode"],
            size=variant_size,
            available=variant.get("availableForSale", False),
            inventory=variant.get("quantityAvailable") or 0,
            delivery_days=5,
            source="shopify_api",
        ))

    return results
