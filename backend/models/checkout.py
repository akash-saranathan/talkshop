from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class CheckoutLine(BaseModel):
    """One product in a checkout. A cart from one merchant is one checkout with one line per item."""

    product_id: str
    product_title: str
    size: Optional[str] = None
    color: Optional[str] = None
    quantity: int = Field(default=1, ge=1)
    unit_price: float = Field(..., ge=0)
    line_total: float = Field(..., ge=0)
    image_url: Optional[str] = None


class CheckoutObject(BaseModel):
    """
    Created by CartUp. checkout_hash binds this to the DPAT token — any
    tampering invalidates the hash and blocks payment.

    The product fields (product_id, product_title, size, color) describe the first
    line, for code that still reads a single product. `lines` is the full cart.
    quantity is the total number of units across all lines.
    """

    checkout_id: str
    merchant_id: str
    merchant_name: str
    product_id: str
    product_title: str
    quantity: int = Field(default=1, ge=1)
    size: Optional[str] = None
    color: Optional[str] = None
    lines: list[CheckoutLine] = Field(default_factory=list)
    subtotal: float = Field(..., ge=0)
    shipping: float = Field(default=0.0, ge=0)
    tax: float = Field(default=0.0, ge=0)
    total: float = Field(..., ge=0)
    # Loyalty redemption (merchant reward, settled by the merchant's own ledger,
    # not the card rails). amount_due is what the card/PayPal is charged: the
    # order total minus the value covered by points.
    loyalty_points_redeemed: int = Field(default=0, ge=0)
    loyalty_value: float = Field(default=0.0, ge=0)
    amount_due: Optional[float] = Field(default=None, ge=0)
    currency: str = Field(default="USD")
    delivery_date: Optional[str] = None
    checkout_hash: str = Field(..., description="SHA-256 of canonicalized checkout JSON")
    created_at: datetime = Field(default_factory=datetime.utcnow)

    @property
    def payable(self) -> float:
        """Amount charged to the card/PayPal (total when no points are redeemed)."""
        return self.total if self.amount_due is None else self.amount_due
