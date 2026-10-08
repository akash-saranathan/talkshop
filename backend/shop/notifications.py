"""
Order confirmation email (Demo 1, Phase 10).

ShopSphere has no real email provider. Messages go to a demo outbox (the
email_outbox table), which a real provider would replace. A confirmation is
written after the order is created, to the customer's account email or the
guest's checkout email. It holds no card details beyond the masked
"Visa •••• 4242" the shopper already sees.
"""
import json
import logging
import uuid
from typing import Optional

from sqlalchemy.orm import Session

from backend.db.schema import EmailOutbox, Order, OrderLine, User
from backend.shop import shipping

log = logging.getLogger(__name__)


def _mask(email: str) -> str:
    name, _, domain = email.partition("@")
    return f"{name[:1]}***@{domain}"


def recipient(db: Session, order: Order) -> Optional[str]:
    if order.guest_email:
        return order.guest_email
    user = db.query(User).filter_by(user_id=order.user_id).first()
    return user.email if user and not user.is_guest and user.email else None


def send_order_confirmation(db: Session, order: Order) -> Optional[str]:
    """Queue the confirmation in the outbox. Returns the address it went to."""
    to = recipient(db, order)
    if not to:
        return None
    lines = db.query(OrderLine).filter_by(order_id=order.order_id).order_by(OrderLine.id).all()
    ship_to = json.loads(order.ship_to_json) if order.ship_to_json else {}
    track = shipping.view(order)
    items = "\n".join(
        f"  • {ln.product_name}"
        f"{f' · Size {ln.size}' if ln.size else ''}{f' · {ln.color}' if ln.color else ''}"
        f" × {ln.quantity} — ${ln.line_total:.2f}" for ln in lines)
    tracking = (f"Tracking ID: {track['tracking_number']}\n" if track["tracking_number"]
                else "Tracking ID: you'll get one when your order ships.\n")
    body = (
        f"Hi {(order.guest_name or (ship_to.get('full_name') or 'there')).split()[0]},\n\n"
        f"Your ShopSphere order has been confirmed.\n\n"
        f"Order ID: {order.display_id}\n"
        f"Status: {track['status_label']}\n"
        f"{tracking}"
        f"Estimated delivery: {track['estimated_delivery'] or 'to be confirmed'}\n\n"
        f"Items:\n{items}\n\n"
        f"Order total: ${order.amount:.2f}\n"
        f"Shipping to: {ship_to.get('city', '')}, {ship_to.get('state', '')} {ship_to.get('postal_code', '')}\n\n"
        f"Track your order any time: open ShopSphere, choose \"Track order\", and enter your Order ID "
        f"({order.display_id}) and this email address.\n\n"
        f"Thank you for shopping with ShopSphere."
    )
    db.add(EmailOutbox(message_id=f"MSG_{uuid.uuid4().hex[:12].upper()}", to_email=to,
                       subject=f"Your ShopSphere order {order.display_id} is confirmed",
                       body=body, order_id=order.order_id))
    db.commit()
    log.info("order confirmation email queued (demo outbox) for %s to %s", order.display_id, _mask(to))
    return to


def confirmation_for(db: Session, order: Order) -> Optional[dict]:
    msg = (db.query(EmailOutbox).filter_by(order_id=order.order_id)
           .order_by(EmailOutbox.id.desc()).first())
    if not msg:
        return None
    return {"to": msg.to_email, "subject": msg.subject, "body": msg.body,
            "sent_at": msg.created_at.isoformat() if msg.created_at else None, "demo_outbox": True}
