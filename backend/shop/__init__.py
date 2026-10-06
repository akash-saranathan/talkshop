"""
ShopSphere merchant services (Demo 1, Phase 2) — the deterministic side of the
"LLM decides, ShopSphere does" split. Catalog/search, inventory, cart,
checkout and orders live here as plain functions with no AI in them; the
website calls them through the routers and Talkshop calls them as tools.
"""
