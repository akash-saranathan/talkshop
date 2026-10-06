from backend.a2a.merchants.base import BaseMerchantAgent


class CasioAgent(BaseMerchantAgent):
    merchant_id = "casio"
    merchant_name = "Casio"
    categories = ["watches", "accessories", "digital", "sport", "gifts", "outdoor"]
    catalog_file = "casio_catalog.json"


agent = CasioAgent()
