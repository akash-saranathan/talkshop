"""
Simulated passkey / step-up authentication.

This is NOT WebAuthn and NOT a Visa passkey. The server creates a random,
single-use challenge bound to one member and one purpose (enrollment or a
payment instruction). The browser shows a dialog clearly labelled
"Simulated passkey authentication"; the member's tap returns the challenge
nonce with user_verified=true. The server checks it once.
"""
import secrets
from datetime import timedelta

from sqlalchemy import update
from sqlalchemy.orm import Session

from backend.db.schema import PasskeyChallenge
from backend.vic.common import VicError, new_ref, now, sha256

CHALLENGE_TTL = timedelta(minutes=2)
METHOD = "simulated_passkey"


def create(db: Session, user_id: str, purpose: str, subject_ref: str) -> tuple[PasskeyChallenge, str]:
    """Returns the challenge row and the nonce (sent to the browser once; only its hash is stored)."""
    nonce = secrets.token_urlsafe(32)
    ch = PasskeyChallenge(challenge_id=new_ref("chl"), user_id=user_id, purpose=purpose, subject_ref=subject_ref,
                          nonce_hash=sha256(nonce), expires_at=now() + CHALLENGE_TTL)
    db.add(ch)
    return ch, nonce


def verify(db: Session, user_id: str, challenge_id: str, nonce: str, user_verified: bool,
           purpose: str, subject_ref: str) -> PasskeyChallenge:
    ch = db.query(PasskeyChallenge).filter_by(challenge_id=challenge_id, user_id=user_id).first()
    if not ch or ch.purpose != purpose or ch.subject_ref != subject_ref:
        raise VicError("CHALLENGE_NOT_FOUND", "That authentication request isn't valid.", 404)
    if ch.used_at is not None:
        raise VicError("CHALLENGE_ALREADY_USED", "That authentication request was already used.", 409)
    # Claim it atomically: a challenge is checked once, whatever the outcome.
    claimed = db.execute(update(PasskeyChallenge)
                         .where(PasskeyChallenge.id == ch.id, PasskeyChallenge.used_at.is_(None))
                         .values(used_at=now())).rowcount
    if not claimed:
        raise VicError("CHALLENGE_ALREADY_USED", "That authentication request was already used.", 409)
    db.refresh(ch)
    if ch.expires_at < now():
        ch.result = "expired"
        raise VicError("CHALLENGE_EXPIRED", "Authentication timed out. Please try again.", 410)
    if not user_verified or not nonce or not secrets.compare_digest(sha256(nonce), ch.nonce_hash):
        ch.result = "failed"
        raise VicError("AUTHENTICATION_FAILED", "Authentication didn't complete, so nothing was approved.", 401)
    ch.result = "verified"
    return ch


def public(ch: PasskeyChallenge, nonce: str) -> dict:
    """What the browser needs to show the simulated passkey prompt."""
    return {"challenge_id": ch.challenge_id, "nonce": nonce, "purpose": ch.purpose,
            "expires_at": ch.expires_at.isoformat() + "Z", "method": METHOD,
            "label": "Simulated passkey authentication (demo, not a real Visa passkey)"}
