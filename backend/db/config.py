"""
Single source for the SQLite database location. Defaults to
backend/db/commerce.db; COMMERCE_DB_PATH overrides it — the test suite uses
that to run against its own throwaway database instead of the app's data.
"""
import os
from pathlib import Path

DB_PATH = Path(os.getenv("COMMERCE_DB_PATH") or Path(__file__).parent / "commerce.db")
