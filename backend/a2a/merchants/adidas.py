from backend.a2a.merchants.base import BaseMerchantAgent


class AdidasAgent(BaseMerchantAgent):
    merchant_id = "adidas"
    merchant_name = "Adidas"
    categories = ["shoes", "running", "sneakers", "sportswear", "apparel", "clothing"]
    catalog_file = "adidas_catalog.json"


agent = AdidasAgent()
