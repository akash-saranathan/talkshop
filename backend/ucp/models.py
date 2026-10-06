"""
UCP (Universal Commerce Protocol) models.

UCP — Google + Shopify + Walmart + Target + Etsy + Wayfair, Jan 2026.
UCP defines WHAT a merchant exposes to agents: product search, cart,
checkout session, totals, fulfillment, and order lifecycle.

Why UCP in this flow:
  Before any payment token can be issued or any authorization mandate can be
  signed, the agent must know the exact total. UCP's checkout-session is the
  canonical source of that total. Every downstream step (ACP SPT issuance,
  AP2 CartMandate) is capped to or binds against this UCP-computed total.

Wire format mirrors ucp.dev/specification/checkout-rest/ (2026-01-23):
  POST /checkout-sessions          → create session, lock totals
  PUT  /checkout-sessions/{id}     → update buyer / fulfillment address
  POST /checkout-sessions/{id}/complete → submit payment credential, get order ID
"""
from __future__ import annotations
from typing import Any, Literal
from pydantic import BaseModel


class UCPVersion(BaseModel):
    version: str = "2026-01-23"
    capabilities: dict[str, Any] = {}


class UCPItem(BaseModel):
    id: str
    title: str
    price: float
    image_url: str | None = None


class UCPTotalEntry(BaseModel):
    type: Literal["subtotal", "fulfillment", "tax", "total"]
    display_text: str
    amount: float


class UCPFulfillmentDestination(BaseModel):
    id: str
    address_locality: str = "San Francisco"
    address_region: str = "CA"
    postal_code: str = "94105"
    address_country: str = "US"


class UCPFulfillmentGroup(BaseModel):
    id: str
    line_item_ids: list[str]
    options: list[dict[str, Any]] = []
    selected_option_id: str | None = None


class UCPFulfillmentMethod(BaseModel):
    id: str
    type: Literal["shipping"] = "shipping"
    line_item_ids: list[str]
    destinations: list[UCPFulfillmentDestination]
    selected_destination_id: str
    groups: list[UCPFulfillmentGroup] = []


class UCPFulfillment(BaseModel):
    methods: list[UCPFulfillmentMethod]


class UCPCredential(BaseModel):
    """Payment credential — ACP SPT id or pre-registered mock token. Never raw card data."""
    token: str
    type: Literal["PAYMENT_GATEWAY"] = "PAYMENT_GATEWAY"


class UCPPaymentDisplay(BaseModel):
    brand: str
    description: str
    last_digits: str


class UCPPaymentInstrument(BaseModel):
    id: str
    type: Literal["card"] = "card"
    selected: bool = True
    credential: UCPCredential
    display: UCPPaymentDisplay
    billing_address: dict[str, Any] | None = None


class UCPPayment(BaseModel):
    instruments: list[UCPPaymentInstrument]


class UCPLineItemResponse(BaseModel):
    id: str
    item: UCPItem
    quantity: int
    totals: list[UCPTotalEntry]


class UCPCheckoutSession(BaseModel):
    """Full checkout session as returned by POST /checkout-sessions."""
    ucp: UCPVersion = UCPVersion()
    id: str
    status: Literal["incomplete", "ready_for_complete", "completed", "canceled"]
    currency: str = "USD"
    line_items: list[UCPLineItemResponse]
    totals: list[UCPTotalEntry]
    fulfillment: UCPFulfillment | None = None
    payment: UCPPayment | None = None
    buyer: dict[str, Any] | None = None
    messages: list[dict[str, Any]] = []


class UCPOrder(BaseModel):
    id: str
    label: str
    permalink_url: str | None = None


class UCPCompleteResponse(BaseModel):
    """Response from POST /checkout-sessions/{id}/complete."""
    ucp: UCPVersion = UCPVersion()
    id: str
    status: Literal["completed", "incomplete"]
    currency: str = "USD"
    payment: UCPPayment | None = None
    order: UCPOrder | None = None
    messages: list[dict[str, Any]] = []
