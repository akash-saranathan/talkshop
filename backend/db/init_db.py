"""
Initialize the SQLite database and seed it with agents and merchants from config.
Run directly:  python -m backend.db.init_db
"""
import json
import os
from pathlib import Path

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session

from backend.auth.security import hash_password
from backend.config.agents import ALL_AGENTS
from backend.db.schema import Base, Agent, LoyaltyPoints, Merchant, Product, User, Wallet

DB_PATH = Path(__file__).parent / "commerce.db"
DATA_DIR = Path(__file__).parent.parent.parent / "data"
DEMO_PASSWORD = "demo1234"
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


def _recreate_if_missing_column(engine, table: str, column: str) -> None:
    """
    For tables whose SHAPE changed (new column plus a changed unique constraint,
    which SQLite can't ALTER): if an old-shaped table is missing `column`, drop
    it so create_all() rebuilds it fresh. Only used for tables that hold seeded
    demo data (loyalty balances, saved cards), which are re-seeded afterwards —
    so nothing durable is lost.
    """
    inspector = inspect(engine)
    if table not in inspector.get_table_names():
        return
    columns = {c["name"] for c in inspector.get_columns(table)}
    if column not in columns:
        with engine.connect() as conn:
            conn.execute(text(f"DROP TABLE {table}"))
            conn.commit()


def init_db(db_path: Path = DB_PATH):
    engine = get_engine(db_path)
    # Rebuild loyalty/saved-card tables that predate merchant-scoping (changed
    # unique constraint, not just a new column) BEFORE create_all re-creates them.
    _recreate_if_missing_column(engine, "loyalty_points", "merchant_id")
    _recreate_if_missing_column(engine, "saved_payment_methods", "merchant_id")
    Base.metadata.create_all(engine)
    _ensure_column(engine, "users", "password_hash", "password_hash VARCHAR(255) NOT NULL DEFAULT ''")
    _ensure_column(engine, "users", "is_guest", "is_guest BOOLEAN NOT NULL DEFAULT 0")
    _ensure_column(engine, "orders", "tracking_number", "tracking_number VARCHAR(50)")
    _ensure_column(engine, "products", "image_url", "image_url VARCHAR(500)")
    _ensure_column(engine, "loyalty_transactions", "merchant_id", "merchant_id VARCHAR(50)")
    _ensure_column(engine, "saved_payment_methods", "provider", "provider VARCHAR(20) DEFAULT 'card'")
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
    exists = session.query(User).filter_by(user_id="USR001").first()
    if not exists:
        session.add(User(
            user_id="USR001",
            name="Demo User",
            email="demo@talkshop.io",
            password_hash=hash_password(DEMO_PASSWORD),
            status="active",
        ))
    elif not exists.password_hash:
        # Pre-auth seed data — backfill so the demo account can actually log in
        exists.password_hash = hash_password(DEMO_PASSWORD)
    session.commit()


def seed_demo_wallet(session: Session):
    exists = session.query(Wallet).filter_by(user_id="USR001").first()
    if not exists:
        session.add(Wallet(user_id="USR001", balance=STARTING_WALLET_BALANCE))
    session.commit()


def seed_demo_loyalty(session: Session):
    exists = session.query(LoyaltyPoints).filter_by(user_id="USR001").first()
    if not exists:
        session.add(LoyaltyPoints(user_id="USR001", balance=0, lifetime_points=0))
    session.commit()


def seed_merchants(session: Session):
    merchants_file = DATA_DIR / "merchants.json"
    if not merchants_file.exists():
        return
    with open(merchants_file) as f:
        merchants = json.load(f)
    for m in merchants:
        exists = session.query(Merchant).filter_by(merchant_id=m["merchant_id"]).first()
        if not exists:
            session.add(Merchant(**m))
    # The six A2A merchant agents (Nike, Adidas, ...) sell from their own catalogs.
    # Orders reference them by merchant_id, and the order list joins on this
    # table, so they must exist here too or their orders never show up.
    registry_file = Path(__file__).parent.parent / "data" / "merchant_registry.json"
    if registry_file.exists():
        for m in json.loads(registry_file.read_text(encoding="utf-8")):
            if not session.query(Merchant).filter_by(merchant_id=m["id"]).first():
                session.add(Merchant(merchant_id=m["id"], merchant_name=m["name"],
                                     trust_status="trusted", tier="a2a"))
    session.commit()


def seed_products(session: Session):
    products_file = DATA_DIR / "products.json"
    if not products_file.exists():
        return
    with open(products_file) as f:
        products = json.load(f)
    for p in products:
        existing_row = session.query(Product).filter_by(product_id=p["product_id"]).first()
        if not existing_row:
            session.add(Product(**p))
        elif existing_row.image_url != p.get("image_url"):
            # Backfill image_url on rows seeded before this field existed —
            # cosmetic metadata only, safe to patch without touching
            # price/inventory that a real merchant feed would own.
            existing_row.image_url = p.get("image_url")
    session.commit()


def run():
    engine = init_db()
    with Session(engine) as session:
        seed_agents(session)
        seed_demo_user(session)
        seed_demo_wallet(session)
        seed_demo_loyalty(session)
        seed_merchants(session)
        seed_products(session)
    print(f"Database initialized at {DB_PATH}")


if __name__ == "__main__":
    run()
