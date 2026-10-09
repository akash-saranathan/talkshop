"""
MemberOffersService (Part 2, Phase 14) — ShopSphere cardmember offers.

Deterministic and server-side: which offers a member is entitled to, which
one applies to a checkout, and what it is worth. The browser and the LLM
never send an offer or an amount; the checkout asks this module.

Rules (D41):
  * at most ONE discount offer per checkout — the one that saves the most;
  * bonus-points offers add up (extra points per $1 on matching items);
  * cashback is a simulated statement credit, only after an approved Visa
    agent payment (audience "visa_agent_pay"), never a price reduction;
  * max_uses_per_member counts redemptions on paid orders.

These are demo offers. They are not real Chase or Visa programmes.
"""
from typing import Optional

from sqlalchemy.orm import Session

from backend.db.schema import CardAccount, MemberOffer, OfferRedemption, Product

OFFERS = [
    dict(offer_id="OFF_RUN15", title="15% off running shoes",
         description="Cardmember price on every running shoe in the marketplace.",
         kind="discount_percent", value=0.15, department="shoes", subcategories="running,trail"),
    dict(offer_id="OFF_AUDIO20", title="$20 off headphones & speakers",
         description="On headphones, earbuds or speakers when those items come to $150 or more. Once per member.",
         kind="discount_amount", value=20.0, department="electronics", subcategories="headphones,earbuds,speakers",
         min_subtotal=150.0, max_uses_per_member=1),
    dict(offer_id="OFF_STYLE3X", title="3× points on clothing",
         description="Earn 2 bonus points per $1 on clothing, on top of the usual 1 point.",
         kind="bonus_points", value=2.0, department="clothing"),
    dict(offer_id="OFF_AGENTPAY10", title="$10 back with Visa agent payments",
         description="A simulated $10 statement credit when you pay $50 or more with your enrolled Visa through "
                     "Talkshop AI agent payments. Once per member.",
         kind="cashback", value=10.0, min_subtotal=50.0, audience="visa_agent_pay", max_uses_per_member=1),
]

DISCOUNT_KINDS = ("discount_percent", "discount_amount")


def seed(db: Session) -> None:
    for o in OFFERS:
        if not db.query(MemberOffer).filter_by(offer_id=o["offer_id"]).first():
            db.add(MemberOffer(**{"min_subtotal": 0.0, "audience": "all_cardmembers", **o}))
    db.commit()


def _has_visa(db: Session, user_id: str) -> bool:
    return db.query(CardAccount).filter_by(user_id=user_id, account_type="credit_card", network="Visa",
                                           status="active", marketplace_eligible=True).first() is not None


def uses(db: Session, user_id: str, offer_id: str) -> int:
    return db.query(OfferRedemption).filter_by(user_id=user_id, offer_id=offer_id).count()


def entitled(db: Session, user_id: str) -> list[MemberOffer]:
    """Offers this member may use right now (caller has already checked
    marketplace eligibility). Visa agent-pay offers need an eligible Visa."""
    visa = _has_visa(db, user_id)
    out = []
    for o in db.query(MemberOffer).filter_by(active=True).order_by(MemberOffer.id):
        if o.audience == "visa_agent_pay" and not visa:
            continue
        if o.max_uses_per_member is not None and uses(db, user_id, o.offer_id) >= o.max_uses_per_member:
            continue
        out.append(o)
    return out


def _matches(o: MemberOffer, department: Optional[str], subcategory: Optional[str]) -> bool:
    if o.department and o.department != department:
        return False
    if o.subcategories and subcategory not in o.subcategories.split(","):
        return False
    return True


def _line_scope(db: Session, ln: dict) -> tuple[Optional[str], Optional[str]]:
    p = db.query(Product).filter_by(product_id=ln["product_id"]).first()
    return (p.department, p.subcategory) if p else (None, None)


def eligible_subtotal(db: Session, o: MemberOffer, lines: list[dict]) -> float:
    return round(sum(ln["unit_price"] * ln["quantity"] for ln in lines if _matches(o, *_line_scope(db, ln))), 2)


def discount_value(o: MemberOffer, base: float) -> float:
    if base <= 0 or base < (o.min_subtotal or 0):
        return 0.0
    if o.kind == "discount_percent":
        return round(base * o.value, 2)
    if o.kind == "discount_amount":
        return round(min(o.value, base), 2)
    return 0.0


def best_discount(db: Session, user_id: str, lines: list[dict]) -> tuple[Optional[MemberOffer], float]:
    best, amount = None, 0.0
    for o in entitled(db, user_id):
        if o.kind not in DISCOUNT_KINDS:
            continue
        value = discount_value(o, eligible_subtotal(db, o, lines))
        if value > amount:
            best, amount = o, value
    return best, amount


def bonus_points(db: Session, user_id: str, lines: list[dict]) -> list[dict]:
    out = []
    for o in entitled(db, user_id):
        if o.kind == "bonus_points":
            base = eligible_subtotal(db, o, lines)
            if base > 0 and base >= (o.min_subtotal or 0):
                out.append({"offer_id": o.offer_id, "title": o.title, "points": int(base * o.value)})
    return out


def cashback(db: Session, user_id: str, lines: list[dict], *, agent_pay: bool) -> list[dict]:
    """Simulated statement credits this order would earn. Only the Visa
    agent-payment path qualifies for visa_agent_pay offers."""
    out = []
    subtotal = round(sum(ln["unit_price"] * ln["quantity"] for ln in lines), 2)
    for o in entitled(db, user_id):
        if o.kind != "cashback" or subtotal < (o.min_subtotal or 0):
            continue
        if o.audience == "visa_agent_pay" and not agent_pay:
            continue
        out.append({"offer_id": o.offer_id, "title": o.title, "amount": round(o.value, 2)})
    return out


def offer_view(db: Session, o: MemberOffer, user_id: Optional[str] = None) -> dict:
    left = None
    if user_id and o.max_uses_per_member is not None:
        left = max(0, o.max_uses_per_member - uses(db, user_id, o.offer_id))
    return {"offer_id": o.offer_id, "title": o.title, "description": o.description, "kind": o.kind,
            "value": o.value, "department": o.department,
            "subcategories": o.subcategories.split(",") if o.subcategories else [],
            "min_subtotal": o.min_subtotal, "audience": o.audience, "uses_left": left,
            "label": "Demo offer"}


def badges_for_product(offers: list[MemberOffer], department: Optional[str], subcategory: Optional[str]) -> list[dict]:
    """Short offer labels for a product card (computed on the server)."""
    out = []
    for o in offers:
        if o.kind == "cashback" or not _matches(o, department, subcategory):
            continue
        out.append({"offer_id": o.offer_id, "kind": o.kind, "title": o.title,
                    "short": {"discount_percent": f"{int(o.value * 100)}% off",
                              "discount_amount": f"${o.value:.0f} off" + (f" ${o.min_subtotal:.0f}+" if o.min_subtotal else ""),
                              "bonus_points": f"{int(o.value) + 1}× points"}[o.kind]})
    return out


def record(db: Session, user_id: str, order_id: str, offer_id: str, kind: str, amount: float) -> bool:
    """Record one redemption (idempotent: the same offer on the same order once)."""
    if db.query(OfferRedemption).filter_by(offer_id=offer_id, order_id=order_id).first():
        return False
    db.add(OfferRedemption(offer_id=offer_id, user_id=user_id, order_id=order_id, kind=kind, amount=amount))
    return True
