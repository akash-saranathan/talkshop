"""
Initialize the SQLite database and seed it: agents, the ShopSphere merchant
and catalog (products + variants from data/shopsphere_catalog.json), and the
demo customer with saved addresses and cards.
Run directly:  python -m backend.db.init_db
"""
import json
import os
import zlib
from pathlib import Path

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session

from backend.auth.security import hash_password
from backend.config.agents import ALL_AGENTS
from backend.db.schema import (
    Base, Address, Agent, LoyaltyPoints, Merchant, PaymentMethod, Product, ProductVariant, User, Wallet,
)

from backend.db.config import DB_PATH  # noqa: E402  (single source; overridable in tests)
DATA_DIR = Path(__file__).parent.parent.parent / "data"
CATALOG_FILE = DATA_DIR / "shopsphere_catalog.json"
# Colour photos live in the frontend's public folder and are served at /catalog/...
CATALOG_IMAGE_DIR = Path(__file__).parent.parent.parent / "frontend" / "public" / "catalog"
DEMO_PASSWORD = "demo1234"
DEMO_USER_ID = "USR001"
DEMO_EMAIL = "kaajal@shopsphere.demo"
STARTING_WALLET_BALANCE = 1000.0


def get_engine(db_path: Path = DB_PATH):
    return create_engine(f"sqlite:///{db_path}", echo=False)


def _ensure_column(engine, table: str, column: str, ddl: str) -> None:
    """
    Defensive migration: Base.metadata.create_all() never ALTERs an existing
    table, so a dev DB created before a column existed won't have it without this.
    """
    inspector = inspect(engine)
    if table not in inspector.get_table_names():
        return
    columns = {c["name"] for c in inspector.get_columns(table)}
    if column not in columns:
        with engine.connect() as conn:
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {ddl}"))
            conn.commit()


def init_db(db_path: Path = DB_PATH):
    engine = get_engine(db_path)
    Base.metadata.create_all(engine)
    _ensure_column(engine, "users", "password_hash", "password_hash VARCHAR(255) NOT NULL DEFAULT ''")
    _ensure_column(engine, "users", "is_guest", "is_guest BOOLEAN NOT NULL DEFAULT 0")
    _ensure_column(engine, "orders", "tracking_number", "tracking_number VARCHAR(50)")
    _ensure_column(engine, "products", "image_url", "image_url VARCHAR(500)")
    # Demo 1: ShopSphere catalog + order detail columns on pre-existing tables
    for col, ddl in [
        ("slug", "slug VARCHAR(120)"), ("department", "department VARCHAR(30)"),
        ("subcategory", "subcategory VARCHAR(50)"), ("gender", "gender VARCHAR(10)"),
        ("description", "description TEXT"), ("tags", "tags TEXT"),
        ("is_new", "is_new BOOLEAN DEFAULT 0"), ("option_label", "option_label VARCHAR(30) DEFAULT 'Size'"),
    ]:
        _ensure_column(engine, "products", col, ddl)
    for col, ddl in [
        ("display_id", "display_id VARCHAR(20)"), ("checkout_id", "checkout_id VARCHAR(50)"),
        ("subtotal", "subtotal FLOAT"), ("tax", "tax FLOAT"), ("shipping", "shipping FLOAT"),
        ("delivery_method", "delivery_method VARCHAR(20)"), ("delivery_date", "delivery_date DATETIME"),
        ("ship_to_json", "ship_to_json TEXT"), ("payment_brand", "payment_brand VARCHAR(20)"),
        ("payment_last4", "payment_last4 VARCHAR(4)"), ("payment_status", "payment_status VARCHAR(20)"),
    ]:
        _ensure_column(engine, "orders", col, ddl)
    _ensure_column(engine, "cart_items", "sku", "sku VARCHAR(60)")
    # Phase 10: guest checkout, wallet at checkout, one-time cards, shipment tracking
    for col, ddl in [("pay_with", "pay_with VARCHAR(10) NOT NULL DEFAULT 'card'"),
                     ("guest_email", "guest_email VARCHAR(255)"), ("guest_name", "guest_name VARCHAR(100)")]:
        _ensure_column(engine, "checkouts", col, ddl)
    for col, ddl in [("payment_method_type", "payment_method_type VARCHAR(10)"),
                     ("guest_email", "guest_email VARCHAR(255)"), ("guest_name", "guest_name VARCHAR(100)"),
                     ("shipment_status", "shipment_status VARCHAR(30)"), ("shipment_events_json", "shipment_events_json TEXT")]:
        _ensure_column(engine, "orders", col, ddl)
    _ensure_column(engine, "payment_methods", "saved", "saved BOOLEAN NOT NULL DEFAULT 1")
    return engine


def seed_agents(session: Session):
    for cfg in ALL_AGENTS:
        exists = session.query(Agent).filter_by(agent_id=cfg.agent_id).first()
        if not exists:
            session.add(Agent(
                agent_id=cfg.agent_id,
                agent_name=cfg.display_name,
                agent_type=cfg.role,
                trust_status=cfg.trust_status,
            ))
    session.commit()


def seed_demo_user(session: Session):
    """The Demo 1 customer, Kaajal, already logged in to ShopSphere in the spec."""
    exists = session.query(User).filter_by(user_id=DEMO_USER_ID).first()
    if not exists:
        session.add(User(
            user_id=DEMO_USER_ID,
            name="Kaajal",
            email=DEMO_EMAIL,
            password_hash=hash_password(DEMO_PASSWORD),
            status="active",
        ))
    else:
        if exists.email == "demo@talkshop.io":
            # Pre-Demo-1 database: rename the old demo account to Kaajal
            exists.name, exists.email = "Kaajal", DEMO_EMAIL
        if not exists.password_hash:
            # Pre-auth seed data — backfill so the demo account can actually log in
            exists.password_hash = hash_password(DEMO_PASSWORD)
    session.commit()


def seed_demo_profile(session: Session):
    """Kaajal's saved checkout details: 2 addresses and 2 cards (masked only).
    The Mastercard is set to decline so the demo can show a refused payment."""
    if not session.query(Address).filter_by(user_id=DEMO_USER_ID).first():
        session.add_all([
            Address(address_id="ADDR_HOME_USR001", user_id=DEMO_USER_ID, label="Home", full_name="Kaajal",
                    line1="48 Willow Creek Lane", line2="Apt 4B", city="Austin", state="TX",
                    postal_code="78704", country="US", is_default=True),
            Address(address_id="ADDR_WORK_USR001", user_id=DEMO_USER_ID, label="Work", full_name="Kaajal",
                    line1="210 Lavaca Street", line2="Suite 900", city="Austin", state="TX",
                    postal_code="78701", country="US", is_default=False),
        ])
    if not session.query(PaymentMethod).filter_by(user_id=DEMO_USER_ID).first():
        session.add_all([
            PaymentMethod(payment_method_id="PM_VISA_4821", user_id=DEMO_USER_ID, brand="Visa", last4="4821",
                          exp_month=8, exp_year=2029, cardholder_name="Kaajal",
                          token_ref="tok_demo_visa_4821", behaviour="approve", is_default=True),
            PaymentMethod(payment_method_id="PM_MC_0019", user_id=DEMO_USER_ID, brand="Mastercard", last4="0019",
                          exp_month=11, exp_year=2028, cardholder_name="Kaajal",
                          token_ref="tok_demo_mc_0019_decline", behaviour="decline", is_default=False),
        ])
    session.commit()


def seed_demo_wallet(session: Session):
    exists = session.query(Wallet).filter_by(user_id=DEMO_USER_ID).first()
    if not exists:
        session.add(Wallet(user_id=DEMO_USER_ID, balance=STARTING_WALLET_BALANCE))
    session.commit()


def seed_demo_loyalty(session: Session):
    exists = session.query(LoyaltyPoints).filter_by(user_id=DEMO_USER_ID).first()
    if not exists:
        session.add(LoyaltyPoints(user_id=DEMO_USER_ID, balance=0, lifetime_points=0))
    session.commit()


def _load_catalog() -> dict:
    with open(CATALOG_FILE, encoding="utf-8") as f:
        return json.load(f)


def _slugify(value: str) -> str:
    return "-".join(value.lower().split())


def catalog_image_url(product_slug: str, color: str) -> str | None:
    """Public URL of a colour photo, or None until that photo has been added."""
    filename = f"{_slugify(color)}.webp"
    if (CATALOG_IMAGE_DIR / product_slug / filename).exists():
        return f"/catalog/{product_slug}/{filename}"
    return None


def _variant_stock(sku: str) -> int:
    # Deterministic so every reset gives the same demo stock: 3–20 units.
    return 3 + zlib.crc32(sku.encode()) % 18


def _is_out_of_stock(rules: list[dict], size: str | None, color: str) -> bool:
    return any(
        (r.get("size") in (None, size)) and (r.get("color") in (None, color))
        for r in rules
    )


def seed_merchants(session: Session):
    """ShopSphere is the only merchant in Demo 1."""
    m = _load_catalog()["merchant"]
    if not session.query(Merchant).filter_by(merchant_id=m["merchant_id"]).first():
        session.add(Merchant(**m))
    session.commit()


def seed_products(session: Session):
    """Products and their variants (SKUs) from data/shopsphere_catalog.json.
    Inserts what's missing and refreshes photo links, so re-running after new
    photos are added picks them up without a reset."""
    catalog = _load_catalog()
    merchant_id = catalog["merchant"]["merchant_id"]
    for p in catalog["products"]:
        sizes = catalog["size_ranges"][p["sizes"]]
        variants = []
        for c in p["colors"]:
            for size in sizes:
                sku = "-".join(x for x in (p["product_id"], c["name"].upper().replace(" ", ""), size) if x)
                stock = 0 if _is_out_of_stock(p["out_of_stock"], size, c["name"]) else _variant_stock(sku)
                variants.append(dict(sku=sku, size=size, color=c["name"], color_hex=c["hex"], stock=stock,
                                     image_url=catalog_image_url(p["slug"], c["name"])))
        default = variants[0]

        product = session.query(Product).filter_by(product_id=p["product_id"]).first()
        if not product:
            product = Product(
                product_id=p["product_id"], merchant_id=merchant_id, name=p["name"], brand=p["brand"],
                category=p["category"], price=p["price"], currency="USD",
                delivery_days=p["delivery_days"], rating=p["rating"], review_count=p["review_count"],
                slug=p["slug"], department=p["department"], subcategory=p["subcategory"], gender=p["gender"],
                description=p["description"], tags=",".join(p["tags"]), is_new=p["is_new"],
                option_label=p["option_label"],
                # Summary fields for pre-variant code paths
                size=None, color=default["color"], inventory=sum(v["stock"] for v in variants),
                image_url=default["image_url"],
            )
            session.add(product)
            for v in variants:
                session.add(ProductVariant(product_id=p["product_id"], **v))
        else:
            product.image_url = default["image_url"]
            for v in variants:
                row = session.query(ProductVariant).filter_by(sku=v["sku"]).first()
                if row:
                    row.image_url = v["image_url"]
                else:
                    session.add(ProductVariant(product_id=p["product_id"], **v))
    session.commit()


def run(db_path: Path = DB_PATH):
    engine = init_db(db_path)
    with Session(engine) as session:
        seed_agents(session)
        seed_demo_user(session)
        seed_demo_profile(session)
        seed_demo_wallet(session)
        seed_demo_loyalty(session)
        seed_merchants(session)
        seed_products(session)
    print(f"Database initialized at {db_path}")


if __name__ == "__main__":
    run()
