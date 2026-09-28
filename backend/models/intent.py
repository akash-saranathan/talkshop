from typing import Optional
from pydantic import BaseModel, Field


class ShoppingIntent(BaseModel):
    """Structured output from VibeCheck — never modified by downstream agents."""

    category: str = Field(..., description="Product category, e.g. 'running_shoes'")
    brand: Optional[str] = Field(None, description="Preferred brand, e.g. 'Nike'")
    size: Optional[str] = Field(None, description="Size as string to handle shoe/clothing/electronics sizes")
    color: Optional[str] = Field(None, description="Preferred color")
    max_price: Optional[float] = Field(None, ge=0, description="Maximum price in USD")
    delivery_days: Optional[int] = Field(None, ge=1, description="Maximum acceptable delivery days")
    preferences: list[str] = Field(default_factory=list, description="Free-form preferences, e.g. ['lightweight', 'high cushioning']")
    use_case: Optional[str] = Field(None, description="Use case context, e.g. 'road running'")
    currency: str = Field(default="USD")
    raw_query: Optional[str] = Field(None, description="Original user text — kept for audit, never used for financial decisions")
