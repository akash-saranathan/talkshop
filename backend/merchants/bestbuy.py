"""
Best Buy Open API adapter — Tier 2/3.
Requires BESTBUY_API_KEY in .env.
Falls back to local adapter when credentials are absent or request fails.
Playwright scraping is the fallback-of-last-resort for visual demo impact (Phase 2).
"""
import os
from typing import Optional

import httpx
from dotenv import load_dotenv

from backend.models.product import NormalizedProduct

load_dotenv()

API_KEY = os.getenv("BESTBUY_API_KEY", "")
MERCHANT_ID = "MERCHANT_B"
MERCHANT_NAME = "TechStore"
BASE_URL = "https://api.bestbuy.com/v1/products"

_CATEGORY_MAP = {
    "electronics": "abcat0100000",
    "laptops": "abcat0502000",
    "phones": "abcat0800000",
    "accessories": "abcat0204000",
}


def _credentials_present() -> bool:
    return bool(API_KEY)


async def search_products(
    category: Optional[str] = None,
    brand: Optional[str] = None,
    max_price: Optional[float] = None,
    query: Optional[str] = None,
) -> list[NormalizedProduct]:
    """
    Search Best Buy Open API.
    Returns empty list if credentials absent or request fails.
    """
    if not _credentials_present():
        return []

    filters = ["inStoreAvailability=true", "onlineAvailability=true"]
    if brand:
        filters.append(f'manufacturer="{brand}"')
    if max_price is not None:
        filters.append(f"salePrice<={max_price}")
    if category and category in _CATEGORY_MAP:
        filters.append(f'categoryPath.id="{_CATEGORY_MAP[category]}"')
    elif query:
        filters.append(f'search={query}')

    filter_str = "(" + "&".join(filters) + ")"
    params = {
        "apiKey": API_KEY,
        "show": "sku,name,manufacturer,salePrice,onSale,inStoreAvailability,onlineAvailability,quantityLimit,customerReviewAverage,customerReviewCount,shippingCost,shortDescription",
        "pageSize": 15,
        "format": "json",
    }

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(f"{BASE_URL}{filter_str}", params=params)
            resp.raise_for_status()
            data = resp.json()
    except Exception:
        return []

    results = []
    for item in data.get("products", []):
        results.append(NormalizedProduct(
            merchant_id=MERCHANT_ID,
            merchant_name=MERCHANT_NAME,
            product_id=f"BB_{item['sku']}",
            title=item["name"],
            brand=item.get("manufacturer"),
            category=category or "electronics",
            price=float(item.get("salePrice", 0)),
            currency="USD",
            available=item.get("onlineAvailability", False),
            inventory=10 if item.get("onlineAvailability") else 0,
            delivery_days=3,
            rating=float(item.get("customerReviewAverage") or 0),
            review_count=int(item.get("customerReviewCount") or 0),
            shipping_cost=float(item.get("shippingCost") or 0),
            source="shopify_api",  # using structured API source label
        ))

    return results


async def search_products_playwright(
    query: str,
    max_results: int = 5,
) -> list[NormalizedProduct]:
    """
    Playwright fallback — extracts products from Best Buy search results page.
    Used only for visual demo impact when no API key; wraps with 5s timeout.
    Returns empty list on any failure.
    """
    try:
        from playwright.async_api import async_playwright
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True)
            page = await browser.new_page()
            url = f"https://www.bestbuy.com/site/searchpage.jsp?st={query.replace(' ', '+')}"
            await page.goto(url, timeout=5000)
            await page.wait_for_selector(".sku-item", timeout=4000)

            items = await page.query_selector_all(".sku-item")
            results = []
            for item in items[:max_results]:
                title_el = await item.query_selector(".sku-title a")
                price_el = await item.query_selector(".priceView-customer-price span")
                title = await title_el.inner_text() if title_el else "Unknown"
                price_text = await price_el.inner_text() if price_el else "$0"
                try:
                    price = float(price_text.replace("$", "").replace(",", "").strip())
                except ValueError:
                    price = 0.0

                results.append(NormalizedProduct(
                    merchant_id=MERCHANT_ID,
                    merchant_name=MERCHANT_NAME,
                    product_id=f"BBP_{len(results)}",
                    title=title.strip(),
                    category="electronics",
                    price=price,
                    available=True,
                    inventory=1,
                    delivery_days=3,
                    source="playwright",
                ))
            await browser.close()
            return results
    except Exception:
        return []
