from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field


class Order(BaseModel):
    order_id: str
    user_id: str
    merchant_id: str
    merchant_name: str
    product_id: str
    product_title: str
    amount: float
    currency: str = "USD"
    status: Literal["confirmed", "failed", "blocked"] = "confirmed"
    transaction_id: Optional[str] = None
    delivery_date: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class AuditEventRecord(BaseModel):
    event_id: str
    user_id: Optional[str] = None
    agent_id: Optional[str] = None
    agent_name: Optional[str] = None
    authorization_id: Optional[str] = None
    order_id: Optional[str] = None
    event_type: str
    event_timestamp: datetime = Field(default_factory=datetime.utcnow)
    metadata: Optional[dict] = None
