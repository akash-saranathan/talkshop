"""
Initialize the SQLite database and seed it with agents and merchants from config.
Run directly:  python -m backend.db.init_db
"""
import json
import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from backend.config.agents import ALL_AGENTS
from backend.db.schema import Base, Agent, Merchant, Product, User

DB_PATH = Path(__file__).parent / "commerce.db"
DATA_DIR = Path(__file__).parent.parent.parent / "data"


def get_engine(db_path: Path = DB_PATH):
    return create_engine(f"sqlite:///{db_path}", echo=False)


def init_db(db_path: Path = DB_PATH):
    engine = get_engine(db_path)
    Base.metadata.create_all(engine)
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
            email="demo@agentcommerce.local",
            status="active",
        ))
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
        exists = session.query(Product).filter_by(product_id=p["product_id"]).first()
        if not exists:
            session.add(Product(**p))
    session.commit()


def run():
    engine = init_db()
    with Session(engine) as session:
        seed_agents(session)
        seed_demo_user(session)
        seed_merchants(session)
        seed_products(session)
    print(f"Database initialized at {DB_PATH}")


if __name__ == "__main__":
    run()
