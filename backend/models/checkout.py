from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class CheckoutObject(BaseModel):
    """
    Created by CartUp. checkout_hash binds this to the DPAT token — any
    tampering invalidates the hash and blocks payment.
    """

    checkout_id: str
    merchant_id: str
    merchant_name: str
    product_id: str
    product_title: str
    quantity: int = Field(default=1, ge=1)
    size: Optional[str] = None
    color: Optional[str] = None
    subtotal: float = Field(..., ge=0)
    shipping: float = Field(default=0.0, ge=0)
    tax: float = Field(default=0.0, ge=0)
    total: float = Field(..., ge=0)
    currency: str = Field(default="USD")
    delivery_date: Optional[str] = None
    checkout_hash: str = Field(..., description="SHA-256 of canonicalized checkout JSON")
    created_at: datetime = Field(default_factory=datetime.utcnow)
