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
