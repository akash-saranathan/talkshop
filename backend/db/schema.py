from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey,
    Integer, String, Text, func
)
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(50), unique=True, nullable=False)
    name = Column(String(100), nullable=False)
    email = Column(String(200), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    status = Column(String(20), default="active")
    # True for accounts created by "Continue as Guest" (random password the
    # shopper never sees). Lets the guest flow resume a guest's own account
    # while refusing to touch a registered customer's.
    is_guest = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, server_default=func.now())


class Agent(Base):
    __tablename__ = "agents"

    id = Column(Integer, primary_key=True, autoincrement=True)
    agent_id = Column(String(50), unique=True, nullable=False)
    agent_name = Column(String(100), nullable=False)
    agent_type = Column(String(50), nullable=False)
    trust_status = Column(String(20), default="trusted")
    created_at = Column(DateTime, server_default=func.now())


class Merchant(Base):
    __tablename__ = "merchants"

    id = Column(Integer, primary_key=True, autoincrement=True)
    merchant_id = Column(String(50), unique=True, nullable=False)
    merchant_name = Column(String(100), nullable=False)
    trust_status = Column(String(20), default="trusted")
    tier = Column(String(20), default="local")
    created_at = Column(DateTime, server_default=func.now())

    products = relationship("Product", back_populates="merchant")


class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, autoincrement=True)
    product_id = Column(String(50), unique=True, nullable=False)
    merchant_id = Column(String(50), ForeignKey("merchants.merchant_id"), nullable=False)
    name = Column(String(200), nullable=False)
    brand = Column(String(100))
    category = Column(String(100), nullable=False)
    size = Column(String(20))
    color = Column(String(50))
    price = Column(Float, nullable=False)
    currency = Column(String(10), default="USD")
    inventory = Column(Integer, default=0)
    delivery_days = Column(Integer, default=5)
    weight_grams = Column(Integer)
    cushioning = Column(String(20))
    rating = Column(Float, default=0.0)
    review_count = Column(Integer, default=0)
    image_url = Column(String(500))

    merchant = relationship("Merchant", back_populates="products")


class Order(Base):
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, autoincrement=True)
    order_id = Column(String(50), unique=True, nullable=False)
    user_id = Column(String(50), nullable=False)
    merchant_id = Column(String(50), nullable=False)
    product_id = Column(String(50), nullable=False)
    amount = Column(Float, nullable=False)
    currency = Column(String(10), default="USD")
    status = Column(String(30), default="pending")
    transaction_id = Column(String(100))
    tracking_number = Column(String(50))
    created_at = Column(DateTime, server_default=func.now())


class Wallet(Base):
    """Per-user mock stored-value balance — separate from the payment-method
    vault (data/mock_wallet.json); this is what actually draws down on a
    purchase, since DPAT tokens authorize against a balance here, not a
    real card swipe."""
    __tablename__ = "wallets"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(50), unique=True, nullable=False)
    balance = Column(Float, nullable=False, default=1000.0)
    currency = Column(String(10), default="USD")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class PaymentAuthorization(Base):
    __tablename__ = "payment_authorizations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    authorization_id = Column(String(50), unique=True, nullable=False)
    user_id = Column(String(50), nullable=False)
    agent_id = Column(String(50), nullable=False)
    merchant_id = Column(String(50), nullable=False)
    order_id = Column(String(50), nullable=False)
    max_amount = Column(Float, nullable=False)
    currency = Column(String(10), default="USD")
    checkout_hash = Column(String(64))
    signature = Column(Text)
    approved_at = Column(DateTime)
    expires_at = Column(DateTime, nullable=False)
    status = Column(String(20), default="pending")


class DelegatedToken(Base):
    __tablename__ = "delegated_tokens"

    id = Column(Integer, primary_key=True, autoincrement=True)
    token_id = Column(String(50), unique=True, nullable=False)
    authorization_id = Column(String(50), ForeignKey("payment_authorizations.authorization_id"), nullable=False)
    single_use = Column(Boolean, default=True)
    issued_at = Column(DateTime, server_default=func.now())
    expires_at = Column(DateTime, nullable=False)
    consumed_at = Column(DateTime)
    revoked_at = Column(DateTime)
    status = Column(String(20), default="active")


class ProtocolMandate(Base):
    """AP2 mandates (intent, cart, payment) as issued, so approval and payment can verify them."""
    __tablename__ = "protocol_mandates"

    id = Column(Integer, primary_key=True, autoincrement=True)
    mandate_id = Column(String(120), unique=True, nullable=False)
    mandate_type = Column(String(20), nullable=False)
    checkout_id = Column(String(50), nullable=False, index=True)
    user_id = Column(String(50), nullable=False)
    document = Column(Text, nullable=False)
    created_at = Column(DateTime, server_default=func.now())


class AcpSharedToken(Base):
    """ACP shared payment token, derived from and bound to one DPAT authorization."""
    __tablename__ = "acp_shared_tokens"

    id = Column(Integer, primary_key=True, autoincrement=True)
    spt_id = Column(String(50), unique=True, nullable=False)
    dpat_token_id = Column(String(50), ForeignKey("delegated_tokens.token_id"), nullable=False, unique=True)
    checkout_id = Column(String(50), nullable=False, index=True)
    document = Column(Text, nullable=False)
    consumed_at = Column(DateTime)


# ── Demo 2 orchestration: agent trust, server-side checkout, consent, delegated token ──

class TrustedAgentSessionRow(Base):
    """A merchant's record that it verified a customer agent and its delegation."""
    __tablename__ = "trusted_agent_sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String(50), unique=True, nullable=False)
    chat_session_id = Column(String(64), nullable=False, index=True)
    user_id = Column(String(50), nullable=False)
    merchant_id = Column(String(50), nullable=False)
    agent_id = Column(String(100), nullable=False)
    customer_ref = Column(String(50), nullable=False)
    merchant_relationship = Column(String(20), nullable=False)
    talkshop_account = Column(String(20), nullable=False)
    scopes = Column(Text, nullable=False)          # JSON list
    max_amount = Column(Float)
    credential = Column(Text, nullable=False)      # JSON AgentCredential, re-verified on every sensitive action
    status = Column(String(20), default="active")
    created_at = Column(DateTime, server_default=func.now())
    expires_at = Column(DateTime, nullable=False)


class MerchantCheckout(Base):
    """The merchant's authoritative copy of a checkout. Payment uses this, never client-sent totals."""
    __tablename__ = "merchant_checkouts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    checkout_id = Column(String(50), unique=True, nullable=False)
    user_id = Column(String(50), nullable=False)
    merchant_id = Column(String(50), nullable=False)
    trusted_session_id = Column(String(50), nullable=False)
    checkout_hash = Column(String(64), nullable=False)
    document = Column(Text, nullable=False)        # JSON CheckoutObject, including delivery_date
    status = Column(String(30), default="proposed")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now())


class CustomerConsent(Base):
    """GO AHEAD: the customer authorized this exact checkout, total and payment method."""
    __tablename__ = "customer_consents"

    id = Column(Integer, primary_key=True, autoincrement=True)
    consent_id = Column(String(50), unique=True, nullable=False)
    user_id = Column(String(50), nullable=False)
    checkout_id = Column(String(50), nullable=False, index=True)
    merchant_id = Column(String(50), nullable=False)
    checkout_hash = Column(String(64), nullable=False)
    total = Column(Float, nullable=False)
    currency = Column(String(10), nullable=False)
    payment_method_id = Column(String(50), nullable=False)
    kind = Column(String(20), default="go_ahead")  # go_ahead | reconsent
    created_at = Column(DateTime, server_default=func.now())


class SavedPaymentMethod(Base):
    """A reference to a card held by the payment processor. Never a card number or CVC.
    Scoped to (user, merchant): a card is held by one merchant, not shared across all."""
    __tablename__ = "saved_payment_methods"

    id = Column(Integer, primary_key=True, autoincrement=True)
    payment_method_id = Column(String(50), unique=True, nullable=False)
    user_id = Column(String(50), nullable=False, index=True)
    merchant_id = Column(String(50), index=True)
    provider = Column(String(20), default="card")  # "card" | "paypal"
    brand = Column(String(20), nullable=False)
    last4 = Column(String(4), nullable=False)
    exp_month = Column(Integer, nullable=False)
    exp_year = Column(Integer, nullable=False)
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=func.now())


class DelegatedPaymentToken(Base):
    """ACP-style scoped payment token: the only payment credential that crosses to the merchant."""
    __tablename__ = "delegated_payment_tokens"

    id = Column(Integer, primary_key=True, autoincrement=True)
    token_id = Column(String(50), unique=True, nullable=False)
    checkout_id = Column(String(50), nullable=False, index=True)
    user_id = Column(String(50), nullable=False)
    merchant_id = Column(String(50), nullable=False)
    consent_id = Column(String(50), nullable=False)
    ap2_payment_mandate_id = Column(String(120), nullable=False)
    payment_method_id = Column(String(50), nullable=False)
    max_amount_cents = Column(Integer, nullable=False)
    currency = Column(String(10), nullable=False)
    document = Column(Text, nullable=False)        # signed token document
    dpat_token_id = Column(String(50))             # internal enforcement token it was mapped to
    status = Column(String(20), default="active")  # active | consumed | revoked
    expires_at = Column(DateTime, nullable=False)
    consumed_at = Column(DateTime)
    revoked_at = Column(DateTime)
    created_at = Column(DateTime, server_default=func.now())


class ChatSession(Base):
    """One chat thread — created lazily on the first message, matching
    ChatGPT's 'New Chat' not existing until you actually send something."""
    __tablename__ = "chat_sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String(50), unique=True, nullable=False)
    user_id = Column(String(50), nullable=False)
    title = Column(String(200), default="New chat")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now())


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String(50), ForeignKey("chat_sessions.session_id"), nullable=False)
    role = Column(String(20), nullable=False)  # "user" | "assistant"
    content = Column(Text, nullable=False)
    products_json = Column(Text)
    blocked_reason = Column(Text)
    created_at = Column(DateTime, server_default=func.now())


class CartItem(Base):
    """A snapshot of the product at add-time (price/rating/image), not a
    live join — same reasoning as ChatMessage.products_json: a cart entry
    shouldn't break or silently change if the catalog is edited later."""
    __tablename__ = "cart_items"

    id = Column(Integer, primary_key=True, autoincrement=True)
    cart_item_id = Column(String(50), unique=True, nullable=False)
    user_id = Column(String(50), nullable=False)
    product_id = Column(String(50), nullable=False)
    merchant_id = Column(String(50), nullable=False)
    merchant_name = Column(String(100), nullable=False)
    title = Column(String(200), nullable=False)
    brand = Column(String(100))
    category = Column(String(100), nullable=False)
    price = Column(Float, nullable=False)
    currency = Column(String(10), default="USD")
    size = Column(String(20))
    color = Column(String(50))
    image_url = Column(String(500))
    rating = Column(Float, default=0.0)
    delivery_days = Column(Integer, default=5)
    quantity = Column(Integer, default=1, nullable=False)
    added_at = Column(DateTime, server_default=func.now())


class LoyaltyPoints(Base):
    """Loyalty balance scoped to (user, merchant) — points earned at Nike are
    separate from Zara's and can't be spent at another merchant."""
    __tablename__ = "loyalty_points"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(50), nullable=False, index=True)
    merchant_id = Column(String(50), index=True)
    balance = Column(Integer, nullable=False, default=0)
    lifetime_points = Column(Integer, nullable=False, default=0)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class LoyaltyTransaction(Base):
    __tablename__ = "loyalty_transactions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    transaction_id = Column(String(50), unique=True, nullable=False)
    user_id = Column(String(50), nullable=False)
    merchant_id = Column(String(50), index=True)
    order_id = Column(String(50))
    points_earned = Column(Integer, nullable=False, default=0)
    reason = Column(String(100), nullable=False, default="purchase")
    created_at = Column(DateTime, server_default=func.now())


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    event_id = Column(String(50), unique=True, nullable=False)
    user_id = Column(String(50))
    agent_id = Column(String(50))
    authorization_id = Column(String(50))
    order_id = Column(String(50))
    event_type = Column(String(100), nullable=False)
    event_timestamp = Column(DateTime, server_default=func.now())
    metadata_json = Column(Text)
