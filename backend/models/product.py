from typing import Literal, Optional
from pydantic import BaseModel, Field


class NormalizedProduct(BaseModel):
    """
    Canonical product schema — all merchant adapters must produce this.
    LLMs never write financial fields; all values come from merchant tool responses.
    """

    merchant_id: str
    merchant_name: str
    product_id: str
    title: str
    brand: Optional[str] = None
    category: str
    price: float = Field(..., ge=0)
    currency: str = Field(default="USD")
    size: Optional[str] = None
    color: Optional[str] = None
    available: bool = True
    inventory: int = Field(default=0, ge=0)
    delivery_days: int = Field(default=5, ge=0)
    weight_grams: Optional[int] = None
    cushioning: Optional[Literal["low", "medium", "high"]] = None
    rating: float = Field(default=0.0, ge=0.0, le=5.0)
    review_count: int = Field(default=0, ge=0)
    shipping_cost: float = Field(default=0.0, ge=0)
    product_url: Optional[str] = None
    source: Literal["local", "shopify_api", "playwright"] = "local"

    # Deterministic ranking score — set by SneakPeek, never by LLM
    rank_score: float = Field(default=0.0, ge=0.0)
