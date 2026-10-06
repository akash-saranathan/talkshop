"""
CATALOG_SOURCES (Phase 0.1) — Demo 1 searches the ShopSphere catalog only;
external adapters are not called unless explicitly enabled.
"""
import asyncio
from unittest.mock import AsyncMock, patch

from backend.mcp import server


def _search(**kw):
    # A private loop rather than asyncio.run(), which unsets the global loop
    # that older tests (test_phase2) still fetch with get_event_loop().
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(
            server.search_products(query="running shoes", category="running_shoes", **kw)
        )
    finally:
        loop.close()


def test_default_searches_shopsphere_only(monkeypatch):
    monkeypatch.delenv("CATALOG_SOURCES", raising=False)
    with patch.object(server.dummyjson_adapter, "search_products", new=AsyncMock(return_value=[])) as dj, \
         patch.object(server.shopify_adapter, "search_products", new=AsyncMock(return_value=[])) as sh, \
         patch.object(server.bestbuy_adapter, "search_products", new=AsyncMock(return_value=[])) as bb:
        results = _search()
    assert results, "ShopSphere catalog should return running shoes"
    assert not dj.called and not sh.called and not bb.called


def test_external_source_called_only_when_enabled(monkeypatch):
    monkeypatch.setenv("CATALOG_SOURCES", "shopsphere,dummyjson")
    with patch.object(server.dummyjson_adapter, "search_products", new=AsyncMock(return_value=[])) as dj:
        _search()
    assert dj.called
