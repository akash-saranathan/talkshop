from backend.a2a.merchants.base import BaseMerchantAgent


class FossilAgent(BaseMerchantAgent):
    merchant_id = "fossil"
    merchant_name = "Fossil"
    categories = ["watches", "accessories", "smartwatch", "chronograph", "gifts"]
    catalog_file = "fossil_catalog.json"


agent = FossilAgent()
