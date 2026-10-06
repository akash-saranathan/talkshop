"""
Shared DB session + audit-logging helpers.
Extracted from routers/authorizations.py so Phase 4's payments router
uses the exact same session/audit conventions instead of duplicating them.
"""
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from backend.db.schema import AuditEvent

from backend.db.config import DB_PATH


def get_session() -> Session:
    engine = create_engine(f"sqlite:///{DB_PATH}")
    return Session(engine)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def write_audit_event(session: Session, event_type: str, user_id: str = "USR001",
                       agent_id: str = "", order_id: str = "",
                       authorization_id: str = "", metadata: dict = {}):
    session.add(AuditEvent(
        event_id=f"EVT_{uuid.uuid4().hex[:10].upper()}",
        user_id=user_id,
        agent_id=agent_id,
        authorization_id=authorization_id,
        order_id=order_id,
        event_type=event_type,
        metadata_json=json.dumps(metadata),
    ))
