from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey,
    Integer, String, Text, UniqueConstraint, func
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
    # ShopSphere catalog (Demo 1). A product is the parent of its sellable
    # variants (product_variants). size/color/inventory/image_url above are
    # kept as a summary for code that predates variants: no single size,
    # the default colour, total stock across variants, the default photo.
    slug = Column(String(120))
    department = Column(String(30))      # shoes | clothing | accessories | electronics
    subcategory = Column(String(50))     # e.g. running, jeans, headphones
    gender = Column(String(10))          # women | men | unisex
    description = Column(Text)
    tags = Column(Text)                  # comma-separated, e.g. "everyday running,cushioned"
    is_new = Column(Boolean, default=False)
    option_label = Column(String(30), default="Size")  # what the size slot means: Size, Waist, Storage...

    merchant = relationship("Merchant", back_populates="products")
    variants = relationship("ProductVariant", back_populates="product", order_by="ProductVariant.id")


class ProductVariant(Base):
    """One sellable SKU: a product in a specific size/option and colour."""
    __tablename__ = "product_variants"

    id = Column(Integer, primary_key=True, autoincrement=True)
    sku = Column(String(60), unique=True, nullable=False)
    product_id = Column(String(50), ForeignKey("products.product_id"), nullable=False, index=True)
    size = Column(String(20))            # None for one-size products
    color = Column(String(50), nullable=False)
    color_hex = Column(String(9))
    stock = Column(Integer, nullable=False, default=0)
    image_url = Column(String(500))      # photo for this colour

    product = relationship("Product", back_populates="variants")


class Address(Base):
    __tablename__ = "addresses"

    id = Column(Integer, primary_key=True, autoincrement=True)
    address_id = Column(String(50), unique=True, nullable=False)
    user_id = Column(String(50), nullable=False, index=True)
    label = Column(String(30))           # Home, Work...
    full_name = Column(String(100), nullable=False)
    line1 = Column(String(200), nullable=False)
    line2 = Column(String(200))
    city = Column(String(100), nullable=False)
    state = Column(String(50), nullable=False)
    postal_code = Column(String(20), nullable=False)
    country = Column(String(2), default="US")
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=func.now())


class PaymentMethod(Base):
    """A saved card — masked details plus a processor token reference only.
    The full card number and CVV are never stored."""
    __tablename__ = "payment_methods"

    id = Column(Integer, primary_key=True, autoincrement=True)
    payment_method_id = Column(String(50), unique=True, nullable=False)
    user_id = Column(String(50), nullable=False, index=True)
    brand = Column(String(20), nullable=False)       # Visa, Mastercard, Amex...
    last4 = Column(String(4), nullable=False)
    exp_month = Column(Integer, nullable=False)
    exp_year = Column(Integer, nullable=False)
    cardholder_name = Column(String(100))
    token_ref = Column(String(100), nullable=False)  # processor-side token, never the PAN
    # Demo-only: how the mock processor treats this card ("approve" | "decline").
    behaviour = Column(String(10), nullable=False, default="approve")
    is_default = Column(Boolean, default=False)
    # Phase 10: False = tokenized for one order only (not shown as a saved card)
    saved = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, server_default=func.now())


class CardAccount(Base):
    """A simulated issuer account (Part 2). Demo fixtures only — no real bank
    or card-account verification. Marketplace eligibility comes from these:
    an active, eligible Chase credit card. A checking/savings account alone
    doesn't qualify. Card accounts link to the masked saved card used to pay."""
    __tablename__ = "card_accounts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    account_id = Column(String(50), unique=True, nullable=False)
    user_id = Column(String(50), nullable=False, index=True)
    issuer = Column(String(30), nullable=False, default="Chase")      # simulated issuer
    account_type = Column(String(20), nullable=False)                   # credit_card | checking | savings
    product_name = Column(String(80), nullable=False)
    network = Column(String(20))                                        # Visa | Mastercard (cards only)
    last4 = Column(String(4), nullable=False)
    status = Column(String(20), nullable=False, default="active")      # active | suspended | closed
    marketplace_eligible = Column(Boolean, nullable=False, default=False)
    payment_method_id = Column(String(50))                              # the masked saved card, if a card
    credit_limit = Column(Float)
    available_credit = Column(Float)
    created_at = Column(DateTime, server_default=func.now())


class MemberOffer(Base):
    """A ShopSphere cardmember offer (Part 2, demo). Not a real Chase or Visa benefit.
    kind: discount_percent | discount_amount (lower the price, before tax),
          bonus_points (extra points per $1 on matching items),
          cashback (simulated statement credit after an approved payment)."""
    __tablename__ = "member_offers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    offer_id = Column(String(40), unique=True, nullable=False)
    title = Column(String(120), nullable=False)
    description = Column(String(300), nullable=False)
    kind = Column(String(20), nullable=False)
    value = Column(Float, nullable=False)
    department = Column(String(30))          # scope filters (all optional)
    subcategories = Column(String(200))      # comma-separated
    min_subtotal = Column(Float, nullable=False, default=0.0)
    audience = Column(String(30), nullable=False, default="all_cardmembers")   # | visa_agent_pay
    max_uses_per_member = Column(Integer)    # None = unlimited
    active = Column(Boolean, nullable=False, default=True)


class OfferRedemption(Base):
    """One use of an offer on one order. Unique per (offer, order) so a retry
    can never redeem twice."""
    __tablename__ = "offer_redemptions"
    __table_args__ = (UniqueConstraint("offer_id", "order_id", name="uq_offer_order"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    offer_id = Column(String(40), nullable=False, index=True)
    user_id = Column(String(50), nullable=False, index=True)
    order_id = Column(String(50), nullable=False)
    kind = Column(String(20), nullable=False)
    amount = Column(Float, nullable=False, default=0.0)     # $ discount / $ cashback / bonus points
    created_at = Column(DateTime, server_default=func.now())


class Checkout(Base):
    """The canonical checkout snapshot the customer reviews and consents to.
    Amounts here — not anything the browser sends — are what get charged."""
    __tablename__ = "checkouts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    checkout_id = Column(String(50), unique=True, nullable=False)
    user_id = Column(String(50), nullable=False, index=True)
    status = Column(String(20), nullable=False, default="open")  # open | consented | paid | cancelled
    lines_json = Column(Text, nullable=False)          # [{sku, product_id, name, size, color, qty, unit_price, image_url}]
    cart_item_ids = Column(Text)                       # comma-separated cart lines this checkout covers
    address_id = Column(String(50))
    delivery_method = Column(String(20), default="standard")  # standard | express
    delivery_date = Column(DateTime)
    payment_method_id = Column(String(50))
    pay_with = Column(String(10), nullable=False, default="card")   # card | wallet (Phase 10)
    guest_email = Column(String(255))                  # guest checkout: no customer account (Phase 10)
    guest_name = Column(String(100))
    # Phase 12: loyalty points spent on this checkout (100 points = $1 off, before tax)
    points_used = Column(Integer, nullable=False, default=0)
    points_discount = Column(Float, nullable=False, default=0.0)
    # Part 2: the member offer applied by the server (best discount) and its value
    offer_id = Column(String(40))
    offer_discount = Column(Float, nullable=False, default=0.0)
    subtotal = Column(Float, nullable=False, default=0.0)
    tax = Column(Float, nullable=False, default=0.0)
    shipping = Column(Float, nullable=False, default=0.0)
    total = Column(Float, nullable=False, default=0.0)
    currency = Column(String(10), default="USD")
    checkout_hash = Column(String(64))
    consented_at = Column(DateTime)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


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
    # Demo 1 order record. product_id/amount above stay for older code; a
    # ShopSphere order's full detail is these fields plus its order_lines.
    display_id = Column(String(20), unique=True)       # customer-facing, e.g. SS-48291
    checkout_id = Column(String(50))
    subtotal = Column(Float)
    tax = Column(Float)
    shipping = Column(Float)
    delivery_method = Column(String(20))                # standard | express
    delivery_date = Column(DateTime)
    ship_to_json = Column(Text)                         # address snapshot at purchase time
    payment_brand = Column(String(20))                  # masked payment shown to the customer
    payment_last4 = Column(String(4))
    payment_status = Column(String(20))                 # authorized | declined
    payment_method_type = Column(String(10))            # card | wallet
    # Guest orders (Phase 10): the checkout email/name; never linked to a customer account
    guest_email = Column(String(255), index=True)
    guest_name = Column(String(100))
    # Simulated shipment (backend/shop/shipping.py); tracking_number is set when it ships
    shipment_status = Column(String(30))
    shipment_events_json = Column(Text)
    # Loyalty points (Phase 12): spent on this order, the discount they gave, and earned
    points_used = Column(Integer)
    points_discount = Column(Float)
    points_earned = Column(Integer)
    # Part 2: member offer + simulated cashback, and which payment path ran (vic | standard | wallet)
    offer_id = Column(String(40))
    offer_discount = Column(Float)
    bonus_points = Column(Integer)
    cashback = Column(Float)
    payment_path = Column(String(20))


class EmailOutbox(Base):
    """Demo stand-in for an email provider: every message ShopSphere would send."""
    __tablename__ = "email_outbox"

    id = Column(Integer, primary_key=True, autoincrement=True)
    message_id = Column(String(50), unique=True, nullable=False)
    to_email = Column(String(255), nullable=False, index=True)
    subject = Column(String(200), nullable=False)
    body = Column(Text, nullable=False)
    order_id = Column(String(50), index=True)          # internal order id
    # Phase 11: outbox (no SMTP) | sending | sent | failed
    delivery = Column(String(20), nullable=False, default="outbox")
    delivery_error = Column(String(200))
    created_at = Column(DateTime, server_default=func.now())


class OrderLine(Base):
    __tablename__ = "order_lines"

    id = Column(Integer, primary_key=True, autoincrement=True)
    order_id = Column(String(50), ForeignKey("orders.order_id"), nullable=False, index=True)
    sku = Column(String(60), nullable=False)
    product_id = Column(String(50), nullable=False)
    product_name = Column(String(200), nullable=False)
    size = Column(String(20))
    color = Column(String(50))
    quantity = Column(Integer, nullable=False, default=1)
    unit_price = Column(Float, nullable=False)
    line_total = Column(Float, nullable=False)
    image_url = Column(String(500))


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
    sku = Column(String(60))  # the exact variant (Demo 1); null on pre-variant cart lines


class LoyaltyPoints(Base):
    __tablename__ = "loyalty_points"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(50), unique=True, nullable=False)
    balance = Column(Integer, nullable=False, default=0)
    lifetime_points = Column(Integer, nullable=False, default=0)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class LoyaltyTransaction(Base):
    __tablename__ = "loyalty_transactions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    transaction_id = Column(String(50), unique=True, nullable=False)
    user_id = Column(String(50), nullable=False)
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


# ── Part 2: Visa Intelligent Commerce-INSPIRED local simulator ────────────────
# Everything below is simulated locally. None of it is issued by, connected to
# or certified by Visa (no Visa Token Service, no VisaNet) or Chase.

class AgentToken(Base):
    """A simulated agent-specific payment token: one member + one permitted
    agent + one Visa card fixture. The reference is random and opaque (never
    derived from card digits) and is not a VTS / network token."""
    __tablename__ = "agent_tokens"

    id = Column(Integer, primary_key=True, autoincrement=True)
    agent_token_ref = Column(String(64), unique=True, nullable=False)
    user_id = Column(String(50), nullable=False, index=True)
    card_account_id = Column(String(50), nullable=False)
    payment_method_id = Column(String(50), nullable=False)
    agent_id = Column(String(50), nullable=False)
    # NOT_ENROLLED is "no row"; then PENDING_AUTHENTICATION → ACTIVE (→ SUSPENDED ⇄ ACTIVE, → REVOKED)
    status = Column(String(30), nullable=False, default="PENDING_AUTHENTICATION")
    status_reason = Column(String(100))
    passkey_credential_id = Column(String(64))
    created_at = Column(DateTime, server_default=func.now())
    activated_at = Column(DateTime)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class PasskeyChallenge(Base):
    """Simulated passkey / step-up challenge: random, single use, short-lived,
    bound to one member and one purpose. NOT WebAuthn and NOT a Visa passkey."""
    __tablename__ = "passkey_challenges"

    id = Column(Integer, primary_key=True, autoincrement=True)
    challenge_id = Column(String(64), unique=True, nullable=False)
    user_id = Column(String(50), nullable=False, index=True)
    purpose = Column(String(20), nullable=False)            # enrollment | instruction
    subject_ref = Column(String(64), nullable=False)        # agent_token_ref or instruction_id
    nonce_hash = Column(String(64), nullable=False)         # sha256 of the nonce; the nonce goes to the browser once
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime)
    result = Column(String(20))                             # verified | failed | expired
    created_at = Column(DateTime, server_default=func.now())


class PaymentInstruction(Base):
    """The member's authenticated instruction for ONE exact purchase."""
    __tablename__ = "payment_instructions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    instruction_id = Column(String(64), unique=True, nullable=False)
    user_id = Column(String(50), nullable=False, index=True)
    agent_token_ref = Column(String(64), nullable=False)
    agent_id = Column(String(50), nullable=False)
    merchant_id = Column(String(50), nullable=False)
    checkout_id = Column(String(50), nullable=False, index=True)
    checkout_hash = Column(String(64), nullable=False)
    amount = Column(Float, nullable=False)
    currency = Column(String(10), nullable=False)
    max_transactions = Column(Integer, nullable=False, default=1)
    transactions_used = Column(Integer, nullable=False, default=0)
    # PENDING_AUTHENTICATION | AUTHENTICATED | CONSUMED | CANCELLED | EXPIRED | FAILED
    status = Column(String(30), nullable=False, default="PENDING_AUTHENTICATION")
    status_reason = Column(String(100))
    consent_mode = Column(String(20))
    lifecycle_state = Column(String(40), nullable=False, default="CHECKOUT_CREATED")
    payment_ref = Column(String(60))
    expires_at = Column(DateTime, nullable=False)
    authenticated_at = Column(DateTime)
    created_at = Column(DateTime, server_default=func.now())


class PaymentCredential(Base):
    """Purchase-specific credential issued by the simulator after the controls
    pass. Only the opaque reference leaves the server-side services; the
    simulated cryptogram is stored hashed and never shown."""
    __tablename__ = "payment_credentials"

    id = Column(Integer, primary_key=True, autoincrement=True)
    credential_ref = Column(String(64), unique=True, nullable=False)
    instruction_id = Column(String(64), nullable=False, index=True)
    user_id = Column(String(50), nullable=False)
    merchant_id = Column(String(50), nullable=False)
    checkout_id = Column(String(50), nullable=False)
    amount = Column(Float, nullable=False)
    currency = Column(String(10), nullable=False)
    cryptogram_hash = Column(String(64), nullable=False)
    status = Column(String(20), nullable=False, default="ISSUED")   # ISSUED | USED | EXPIRED | REVOKED
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime)
    created_at = Column(DateTime, server_default=func.now())


class CommerceSignal(Base):
    """Transaction outcome sent back to the (simulated) VIC service, linked to
    the member's original instruction."""
    __tablename__ = "commerce_signals"

    id = Column(Integer, primary_key=True, autoincrement=True)
    signal_id = Column(String(64), unique=True, nullable=False)
    instruction_id = Column(String(64), index=True)
    agent_token_ref = Column(String(64))
    credential_ref = Column(String(64))
    checkout_id = Column(String(50))
    merchant_id = Column(String(50))
    amount = Column(Float)
    currency = Column(String(10))
    outcome = Column(String(20), nullable=False)        # APPROVED | DECLINED | TIMEOUT | ERROR
    reason = Column(String(60))
    gateway_ref = Column(String(64))
    order_id = Column(String(50))
    created_at = Column(DateTime, server_default=func.now())


class VicLifecycleEvent(Base):
    """Every lifecycle transition of a Visa-path purchase (audit + trace)."""
    __tablename__ = "vic_lifecycle_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    instruction_id = Column(String(64), index=True)
    user_id = Column(String(50))
    state = Column(String(40), nullable=False)
    detail = Column(String(300))
    created_at = Column(DateTime, server_default=func.now())


class GatewayAuthorization(Base):
    """The mock gateway/PSP's own record (simulated). idempotency_key is unique:
    a retried request gets the stored response instead of a second authorization."""
    __tablename__ = "gateway_authorizations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    gateway_ref = Column(String(64), unique=True, nullable=False)
    idempotency_key = Column(String(100), unique=True, nullable=False)
    request_hash = Column(String(64), nullable=False)
    merchant_id = Column(String(50), nullable=False)
    amount = Column(Float, nullable=False)
    currency = Column(String(10), nullable=False)
    instrument_type = Column(String(20), nullable=False)   # vic_credential | card_on_file
    payment_method_id = Column(String(50))                 # which card the issuer held (for voids)
    status = Column(String(20), nullable=False)            # approved | declined | timeout | voided
    response_json = Column(Text, nullable=False)
    created_at = Column(DateTime, server_default=func.now())


class SimScenario(Base):
    """Demo control: the next authorization for this member ends as
    decline | timeout | duplicate (used once, then cleared)."""
    __tablename__ = "sim_scenarios"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(50), unique=True, nullable=False)
    outcome = Column(String(20), nullable=False)
    created_at = Column(DateTime, server_default=func.now())

