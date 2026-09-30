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
from backend.db.schema import Base, Agent, Merchant, Product, User, Wallet

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


def init_db(db_path: Path = DB_PATH):
    engine = get_engine(db_path)
    Base.metadata.create_all(engine)
    _ensure_column(engine, "users", "password_hash", "password_hash VARCHAR(255) NOT NULL DEFAULT ''")
    _ensure_column(engine, "orders", "tracking_number", "tracking_number VARCHAR(50)")
    _ensure_column(engine, "products", "image_url", "image_url VARCHAR(500)")
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
        seed_merchants(session)
        seed_products(session)
    print(f"Database initialized at {DB_PATH}")


if __name__ == "__main__":
    run()
