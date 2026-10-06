"""
Demo reset (Phase 0.4) — runs against a temporary database so the real
local commerce.db is never touched by the test.
"""
from sqlalchemy.orm import Session

from backend.db import init_db
from backend.db.reset_demo import reset_demo
from backend.db.schema import CartItem, Product, User


def test_reset_wipes_activity_and_reseeds_demo_data(tmp_path):
    db = tmp_path / "demo.db"
    init_db.run(db)
    engine = init_db.get_engine(db)
    with Session(engine) as s:
        seeded_products = s.query(Product).count()
        s.add(User(user_id="USR_TMP", name="Temp", email="temp@example.com", password_hash="x"))
        s.commit()
    engine.dispose()

    reset_demo(db)

    engine = init_db.get_engine(db)
    with Session(engine) as s:
        assert s.query(User).filter_by(user_id="USR_TMP").first() is None   # activity wiped
        assert s.query(User).filter_by(user_id="USR001").first() is not None  # demo customer reseeded
        assert s.query(Product).count() == seeded_products                    # catalog reseeded
        assert s.query(CartItem).count() == 0
    engine.dispose()
