"""
Real MCP client — calls the commerce-server's tools over actual MCP
Streamable HTTP transport (the ASGI app mounted at /mcp in backend/main.py),
instead of importing backend.mcp.server's functions and calling them
in-process. Same function names/signatures/return shapes as the in-process
versions, so callers (sneakpeek.py, cartup.py) only change their import.
"""
from __future__ import annotations

from typing import Any, Optional

from fastmcp import Client

MCP_URL = "http://localhost:8000/mcp/"


async def _call(name: str, **kwargs: Any) -> Any:
    async with Client(MCP_URL) as client:
        result = await client.call_tool(name, kwargs)
        return result.data


async def search_products(
    query: str,
    category: Optional[str] = None,
    brand: Optional[str] = None,
    max_price: Optional[float] = None,
    size: Optional[str] = None,
) -> list[dict]:
    return await _call("search_products", query=query, category=category, brand=brand,
                       max_price=max_price, size=size)


async def check_inventory(product_id: str, size: Optional[str] = None) -> dict:
    return await _call("check_inventory", product_id=product_id, size=size)


async def get_price(product_id: str, size: Optional[str] = None) -> dict:
    return await _call("get_price", product_id=product_id, size=size)


async def calculate_shipping(product_id: str, merchant_id: str, quantity: int = 1) -> dict:
    return await _call("calculate_shipping", product_id=product_id, merchant_id=merchant_id, quantity=quantity)
