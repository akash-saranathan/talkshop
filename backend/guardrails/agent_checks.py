"""
Basic boundary checks on merchant agent responses. Each check always runs.
Products that fail a blocking check are dropped before they reach the product list.
"""
from backend.models.product import NormalizedProduct


def _result(check: str, failed: list, reason: str) -> dict:
    return {
        "framework": "custom",
        "check": check,
        "status": "blocked" if failed else "pass",
        "reason": reason if failed else None,
    }


def check_merchant_response(merchant_id: str, products: list[NormalizedProduct]) -> tuple[list[NormalizedProduct], list[dict]]:
    wrong_merchant = [p for p in products if p.merchant_id != merchant_id]
    bad_price = [p for p in products if p.price <= 0]
    kept = [p for p in products if p.merchant_id == merchant_id and p.price > 0]
    checks = [
        _result("merchant_identity", wrong_merchant,
                f"{len(wrong_merchant)} product(s) claimed another merchant and were dropped."),
        _result("price_positive", bad_price,
                f"{len(bad_price)} product(s) had no valid price and were dropped."),
    ]
    return kept, checks
