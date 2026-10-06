"""
Demo reset — wipe the local database and reseed it, so every demo run starts
from the same state: fresh catalog and stock, the demo customer with their
saved details, and no carts, chats, checkouts, or orders.

    python -m backend.db.reset_demo          # asks for confirmation
    python -m backend.db.reset_demo --yes    # no prompt (scripts)

Stop the backend first: the running server holds the same SQLite file.
All app state lives in this database (nothing is written to data/), so
dropping and reseeding it is a complete reset.
"""
import sys
from pathlib import Path

from backend.db import init_db
from backend.db.schema import Base


def reset_demo(db_path: Path = init_db.DB_PATH) -> None:
    engine = init_db.get_engine(db_path)
    Base.metadata.drop_all(engine)
    engine.dispose()
    init_db.run(db_path)


if __name__ == "__main__":
    if "--yes" not in sys.argv:
        answer = input(
            f"This deletes ALL users, carts, chats and orders in {init_db.DB_PATH}\n"
            "and reseeds the demo data. Continue? [y/N] "
        )
        if answer.strip().lower() not in ("y", "yes"):
            print("Cancelled.")
            sys.exit(1)
    reset_demo()
    print("Demo reset complete.")
