from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field


class DPATToken(BaseModel):
    """
    Delegated Payment Authorization Token.
    Agents receive ONLY token_id — all sensitive fields stay in the authorization service DB.
    """

    token_id: str
    authorization_id: str
    customer_id: str
    agent_id: str
    merchant_id: str
    order_id: str
    max_amount: float = Field(..., ge=0)
    currency: str = Field(default="USD")
    checkout_hash: str
    purpose: str = Field(default="ECOMMERCE_PURCHASE")
    single_use: bool = True
    issued_at: datetime = Field(default_factory=datetime.utcnow)
    expires_at: datetime
    status: Literal["active", "consumed", "expired", "revoked"] = "active"


class PaymentRequest(BaseModel):
    """Submitted by PayIt to the mock payment processor after DPAT validation passes."""

    token_id: str
    agent_id: str
    merchant_id: str
    order_id: str
    amount: float = Field(..., ge=0)
    currency: str = Field(default="USD")
    # Demo 1: the customer's saved card to charge (a token reference only —
    # never card data). None = legacy wallet-default behaviour.
    payment_method_id: Optional[str] = None


class PaymentResult(BaseModel):
    """Response from the mock payment processor."""

    status: Literal["success", "declined"]
    transaction_id: Optional[str] = None
    authorization_code: Optional[str] = None
    decline_reason: Optional[str] = None
    amount: float
    currency: str
    processed_at: datetime = Field(default_factory=datetime.utcnow)


class GuardrailEvent(BaseModel):
    """Emitted when a validation check fails."""

    check_number: int
    check_name: str
    passed: bool
    reason_code: Optional[str] = None
    detail: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)
