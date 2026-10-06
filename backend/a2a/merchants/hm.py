from backend.a2a.merchants.base import BaseMerchantAgent


class HMAgent(BaseMerchantAgent):
    merchant_id = "hm"
    merchant_name = "H&M"
    categories = ["clothing", "dresses", "fashion", "women", "men", "tops", "bottoms", "knitwear", "apparel"]
    catalog_file = "hm_catalog.json"


agent = HMAgent()
