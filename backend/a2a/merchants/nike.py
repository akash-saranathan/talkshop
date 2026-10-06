from backend.a2a.merchants.base import BaseMerchantAgent


class NikeAgent(BaseMerchantAgent):
    merchant_id = "nike"
    merchant_name = "Nike"
    categories = ["shoes", "running", "sneakers", "sportswear", "apparel", "clothing"]
    catalog_file = "nike_catalog.json"


agent = NikeAgent()
