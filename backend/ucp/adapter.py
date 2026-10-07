"""
UCPAdapter — manages the UCP checkout-session lifecycle for the generic agent.

Responsibility:
  1. create_session(): POST /checkout-sessions
     Takes the selected product + quantity, computes subtotal / fulfillment /
     tax / total, and stores the locked session.  The exact total returned here
     is what the ACP adapter uses as maximum_amount for the SPT — they must
     agree to the cent.

  2. complete_session(): POST /checkout-sessions/{id}/complete
     Accepts a payment credential token (ACP SPT id or pre-registered mock
     token) and returns a UCP order ID. Raw card data is never accepted here.

Sessions are held in a module-level dict for this demo.
"""
from __future__ import annotations
import uuid

from backend.ucp.models import (
    UCPCheckoutSession, UCPCompleteResponse, UCPCredential, UCPFulfillment,
    UCPFulfillmentDestination, UCPFulfillmentGroup, UCPFulfillmentMethod,
    UCPItem, UCPLineItemResponse, UCPOrder, UCPPayment, UCPPaymentDisplay,
    UCPPaymentInstrument, UCPTotalEntry, UCPVersion,
)

_TAX_RATE = 0.08
_FLAT_SHIPPING = 9.99
_FREE_SHIPPING_THRESHOLD = 100.0

_SESSIONS: dict[str, UCPCheckoutSession] = {}


def _colour_photo(product: dict) -> str | None:
    """Merchant catalog products carry one photo per colour; use the selected variant's colour."""
    images = product.get("images") or {}
    variants = product.get("variants") or []
    colour = variants[0].get("color") if variants else None
    return images.get(colour) or next(iter(images.values()), None)


class UCPAdapter:

    def create_session(
        self,
        product: dict,
        quantity: int = 1,
        buyer_email: str = "demo@example.com",
    ) -> UCPCheckoutSession:
        """
        POST /checkout-sessions — lock totals for the selected product.
        Returns a session with status='ready_for_complete'.
        """
        session_id = f"ucp_{uuid.uuid4().hex[:12]}"
        line_item_id = f"li_{uuid.uuid4().hex[:8]}"

        subtotal = round(product["price"] * quantity, 2)
        fulfillment_cost = 0.0 if subtotal >= _FREE_SHIPPING_THRESHOLD else _FLAT_SHIPPING
        tax = round(subtotal * _TAX_RATE, 2)
        total = round(subtotal + fulfillment_cost + tax, 2)

        totals = [
            UCPTotalEntry(type="subtotal",    display_text="Subtotal",  amount=subtotal),
            UCPTotalEntry(type="fulfillment", display_text="Shipping",  amount=fulfillment_cost),
            UCPTotalEntry(type="tax",         display_text="Tax (8%)",  amount=tax),
            UCPTotalEntry(type="total",       display_text="Total",     amount=total),
        ]

        item = UCPItem(
            id=product["id"],
            title=product["title"],
            price=product["price"],
            image_url=product.get("image_url") or _colour_photo(product),
        )

        line_item = UCPLineItemResponse(
            id=line_item_id,
            item=item,
            quantity=quantity,
            totals=totals,
        )

        dest_id = "dest_demo_sf"
        fulfillment = UCPFulfillment(
            methods=[UCPFulfillmentMethod(
                id="method_standard_shipping",
                type="shipping",
                line_item_ids=[line_item_id],
                destinations=[UCPFulfillmentDestination(
                    id=dest_id,
                    address_locality="San Francisco",
                    address_region="CA",
                    postal_code="94105",
                    address_country="US",
                )],
                selected_destination_id=dest_id,
                groups=[UCPFulfillmentGroup(
                    id="grp_standard",
                    line_item_ids=[line_item_id],
                    options=[{
                        "id": "opt_standard",
                        "title": "Standard Shipping (3–5 days)",
                        "totals": [{"type": "total", "amount": fulfillment_cost}],
                    }],
                    selected_option_id="opt_standard",
                )],
            )]
        )

        session = UCPCheckoutSession(
            id=session_id,
            status="ready_for_complete",
            line_items=[line_item],
            totals=totals,
            fulfillment=fulfillment,
            buyer={"email": buyer_email},
        )

        _SESSIONS[session_id] = session
        return session

    def complete_session(
        self,
        session_id: str,
        token: str,       # ACP SPT id (spt_xxx) or mock_card_XXXX — never raw card
        brand: str,
        last_digits: str,
    ) -> UCPCompleteResponse:
        """
        POST /checkout-sessions/{id}/complete.
        Accepts the payment credential and returns a confirmed UCP order.
        """
        session = _SESSIONS.get(session_id)
        if not session:
            raise ValueError(f"UCP session '{session_id}' not found")

        order_id = f"order_{uuid.uuid4().hex[:10]}"
        payment = UCPPayment(
            instruments=[UCPPaymentInstrument(
                id=f"inst_{uuid.uuid4().hex[:8]}",
                type="card",
                selected=True,
                credential=UCPCredential(token=token, type="PAYMENT_GATEWAY"),
                display=UCPPaymentDisplay(
                    brand=brand,
                    description=f"{brand.title()} ending {last_digits}",
                    last_digits=last_digits,
                ),
            )]
        )

        result = UCPCompleteResponse(
            id=session_id,
            status="completed",
            payment=payment,
            order=UCPOrder(
                id=order_id,
                label=f"Order #{order_id[-6:].upper()} confirmed",
                permalink_url=f"https://demo.talkshop.ai/orders/{order_id}",
            ),
        )

        session.status = "completed"
        session.payment = payment
        return result

    def get_session(self, session_id: str) -> UCPCheckoutSession | None:
        return _SESSIONS.get(session_id)

    def totals_dict(self, session: UCPCheckoutSession) -> dict[str, float]:
        """Returns {type: amount} mapping — e.g. {"subtotal": 99.0, "total": 116.61}."""
        return {t.type: t.amount for t in session.totals}
