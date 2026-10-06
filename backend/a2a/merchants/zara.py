from backend.a2a.merchants.base import BaseMerchantAgent


class ZaraAgent(BaseMerchantAgent):
    merchant_id = "zara"
    merchant_name = "Zara"
    categories = ["clothing", "dresses", "fashion", "women", "tops", "bottoms", "outerwear", "apparel"]
    catalog_file = "zara_catalog.json"


agent = ZaraAgent()
