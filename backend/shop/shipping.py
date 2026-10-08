"""
Simulated shipping for ShopSphere orders (Demo 1, Phase 10).

There is no real carrier integration. This is a clearly labelled demo
service. An order gets a shipment the moment it's created. The shipment then
moves through the steps below, one step at a time (demo control on the
Track Order page). The tracking ID (TRK + 6 digits) is created when the
order ships. The Order ID (SS-#####) and the tracking ID are different things.
"""
import json
import random
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from backend.db.schema import Order

CARRIER = "ShopSphere Demo Shipping (simulated)"
STEPS = [
    ("confirmed", "Order confirmed"),
    ("payment_completed", "Payment completed"),
    ("processing", "Processing"),
    ("packed", "Packed"),
    ("shipped", "Shipped"),
    ("out_for_delivery", "Out for delivery"),
    ("delivered", "Delivered"),
]
KEYS = [k for k, _ in STEPS]
LABELS = dict(STEPS)
# Where a brand-new order starts: confirmed, paid and being processed.
START = "processing"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _events(order: Order) -> dict[str, str]:
    try:
        return json.loads(order.shipment_events_json or "{}")
    except ValueError:
        return {}


def start(order: Order) -> None:
    """A new order: confirmed, payment completed, processing. No tracking ID yet."""
    now = _now()
    order.shipment_status = START
    # The payment pipeline (TrackIt) stamps a placeholder tracking number at
    # payment time; a ShopSphere order gets its real one when it ships.
    order.tracking_number = None
    order.shipment_events_json = json.dumps({k: now for k in KEYS[: KEYS.index(START) + 1]})


def new_tracking_id(db: Session) -> str:
    while True:
        candidate = f"TRK{random.randint(100000, 999999)}"
        if not db.query(Order).filter_by(tracking_number=candidate).first():
            return candidate


def advance(db: Session, order: Order) -> bool:
    """Move the shipment one step (demo control). Returns False when already delivered."""
    current = order.shipment_status or START
    i = KEYS.index(current) if current in KEYS else KEYS.index(START)
    if i >= len(KEYS) - 1:
        return False
    nxt = KEYS[i + 1]
    events = _events(order)
    events[nxt] = _now()
    order.shipment_status = nxt
    order.shipment_events_json = json.dumps(events)
    if nxt == "shipped" and not order.tracking_number:
        order.tracking_number = new_tracking_id(db)
    db.commit()
    return True


def view(order: Order) -> dict:
    """What the shopper sees: each step done or not, tracking ID once shipped."""
    current = order.shipment_status or START          # orders from before Phase 10 count as processing
    reached = KEYS.index(current) if current in KEYS else KEYS.index(START)
    events = _events(order)
    created = order.created_at.isoformat() if order.created_at else None
    return {
        "status": current,
        "status_label": LABELS.get(current, "Processing"),
        "steps": [{"key": k, "label": label, "done": i <= reached,
                   "at": events.get(k) or (created if i <= reached else None)}
                  for i, (k, label) in enumerate(STEPS)],
        "tracking_number": order.tracking_number if reached >= KEYS.index("shipped") else None,
        "carrier": CARRIER if reached >= KEYS.index("shipped") else None,
        "estimated_delivery": order.delivery_date.date().isoformat() if order.delivery_date else None,
        "simulated": True,
    }


def summary(order: Order) -> Optional[str]:
    """The short status used by My Orders badges: processing | shipped | delivered."""
    current = order.shipment_status or START
    if current == "delivered":
        return "delivered"
    if current in ("shipped", "out_for_delivery"):
        return "shipped"
    return "processing"
