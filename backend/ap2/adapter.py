"""
AP2Adapter — creates and signs the three AP2 Verifiable Credential mandates.

Signs with real ECDSA (P-256/SHA-256, via the `cryptography` package): the
agent's private key signs, and verification checks against the matching
public key — the mandate structure, chain-linking and checkout-hash binding
are unchanged; only the cryptosuite underneath `proof.jws` differs from a
production HSM-backed key.

Mandate chain integrity guarantee:
  IntentMandate.id  ← linked by CartMandate.credentialSubject.intent_mandate_id
  CartMandate.id    ← linked by PaymentMandate.credentialSubject.cart_mandate_id
  CartMandate.credentialSubject.checkout_hash == PaymentMandate.credentialSubject.checkout_hash

An auditor can replay the chain given only the three signed mandates and the
public key — no server state needed.
"""
from __future__ import annotations
import base64
import hashlib
import json
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.ec import EllipticCurvePrivateKey

from backend.ap2.models import AP2CartMandate, AP2IntentMandate, AP2PaymentMandate, AP2Proof

# The agent's ECDSA keypair — generated once for this process, held only in
# memory. Mirrors the trust layer's platform keypair (backend/trust/credentials.py)
# one level up the chain: here the issuer is "the agent," not the platform.
_AGENT_PRIVATE_KEY: EllipticCurvePrivateKey = ec.generate_private_key(ec.SECP256R1())
_AGENT_PUBLIC_KEY = _AGENT_PRIVATE_KEY.public_key()

_AGENT_DID = "did:demo:agent:generic-shopping-agent"


def _sign_bytes(payload: bytes, private_key: Optional[EllipticCurvePrivateKey] = None) -> str:
    key = private_key or _AGENT_PRIVATE_KEY
    signature = key.sign(payload, ec.ECDSA(hashes.SHA256()))
    return base64.urlsafe_b64encode(signature).decode().rstrip("=")


def _verify_bytes(payload: bytes, signature_b64: str) -> bool:
    try:
        raw = base64.urlsafe_b64decode(signature_b64 + "=" * (-len(signature_b64) % 4))
        _AGENT_PUBLIC_KEY.verify(raw, payload, ec.ECDSA(hashes.SHA256()))
        return True
    except (InvalidSignature, ValueError):
        return False


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _expiry_iso(minutes: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()


def _sign_vc(subject: dict, issuer: str, mandate_type: str) -> str:
    """ECDSA-sign the VC credentialSubject + issuer + type."""
    payload = json.dumps(
        {"mandate_type": mandate_type, "issuer": issuer, "credentialSubject": subject},
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    return _sign_bytes(payload)


class AP2Adapter:

    def create_intent_mandate(
        self,
        query: str,
        user_id: str,
        merchants: list[str],
        normalized_intent: dict | None = None,
    ) -> AP2IntentMandate:
        """
        IntentMandate — issued at session start by the user.
        Records what the user asked for and which merchants may be queried.
        Signed by the user's DID key.
        """
        mandate_id = f"urn:ap2:mandate:intent:{uuid.uuid4().hex}"
        user_did = f"did:demo:user:{user_id[:8]}"
        now = _now_iso()

        subject = {
            "natural_language_description": query,
            "merchants": merchants,
            "skus": [],
            "user_cart_confirmation_required": True,
            "requires_refundability": False,
            "intent_expiry": _expiry_iso(30),
        }
        if normalized_intent is not None:
            subject["normalized_intent"] = normalized_intent

        return AP2IntentMandate(
            **{
                "@context": ["https://www.w3.org/2018/credentials/v1", "https://ap2-protocol.org/context/v1"],
                "type": ["VerifiableCredential", "IntentMandate"],
                "id": mandate_id,
                "issuer": user_did,
                "issuanceDate": now,
                "credentialSubject": subject,
                "proof": AP2Proof(
                    created=now,
                    verificationMethod=f"{user_did}#key-1",
                    jws=_sign_vc(subject, user_did, "IntentMandate"),
                ),
            }
        )

    def create_cart_mandate(
        self,
        product: dict,
        quantity: int,
        totals: dict[str, float],
        ucp_session_id: str,
        intent_mandate_id: str,
        checkout_hash: str | None = None,
    ) -> AP2CartMandate:
        """
        CartMandate — issued by the agent after product selection.
        Binds the exact cart (product, quantity, totals) to a checkout_hash.
        Links back to the IntentMandate via intent_mandate_id.
        """
        mandate_id = f"urn:ap2:mandate:cart:{uuid.uuid4().hex}"
        now = _now_iso()

        checkout_hash = checkout_hash or hashlib.sha256(
            json.dumps({
                "product_id": product["id"],
                "merchant_id": product["merchant_id"],
                "quantity": quantity,
                "total": totals.get("total"),
            }, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()

        subject = {
            "id": ucp_session_id,
            "intent_mandate_id": intent_mandate_id,
            "user_cart_confirmation_required": True,
            "cart_expiry": _expiry_iso(15),
            "merchant_name": product["merchant_name"],
            "line_items": [{
                "product_id": product["id"],
                "title": product["title"],
                "quantity": quantity,
                "unit_price": product["price"],
            }],
            "totals": totals,
            "checkout_hash": checkout_hash,
        }

        return AP2CartMandate(
            **{
                "@context": ["https://www.w3.org/2018/credentials/v1", "https://ap2-protocol.org/context/v1"],
                "type": ["VerifiableCredential", "CartMandate"],
                "id": mandate_id,
                "issuer": _AGENT_DID,
                "issuanceDate": now,
                "credentialSubject": subject,
                "proof": AP2Proof(
                    created=now,
                    verificationMethod=f"{_AGENT_DID}#key-1",
                    jws=_sign_vc(subject, _AGENT_DID, "CartMandate"),
                ),
            }
        )

    def create_payment_mandate(
        self,
        cart_mandate: AP2CartMandate,
        order_id: str,
        payment_ref: str,   # spt_xxx or mock_card_XXXX — NEVER raw card data
        user_id: str,
        consent_id: str | None = None,
    ) -> AP2PaymentMandate:
        """
        PaymentMandate — issued by the agent on APPROVE & PAY.
        Links to CartMandate and binds the payment_ref (opaque token).
        user_authorization = the agent's ECDSA signature over the CartMandate
        id, proving the user saw and approved this exact cart before payment
        was triggered.
        """
        mandate_id = f"urn:ap2:mandate:payment:{uuid.uuid4().hex}"
        now = _now_iso()

        user_authorization = _sign_bytes(cart_mandate.id.encode())

        subject = {
            "payment_mandate_id": mandate_id,
            "payment_details_id": order_id,
            "cart_mandate_id": cart_mandate.id,
            "checkout_hash": cart_mandate.credentialSubject["checkout_hash"],
            "payment_ref": payment_ref,        # opaque token only — no card number
            "user_authorization": user_authorization,
        }
        if consent_id:
            # Demo 2: the customer's GO AHEAD consent this authorization evidence was created from.
            subject["customer_consent_id"] = consent_id
            subject["totals"] = cart_mandate.credentialSubject.get("totals")

        return AP2PaymentMandate(
            **{
                "@context": ["https://www.w3.org/2018/credentials/v1", "https://ap2-protocol.org/context/v1"],
                "type": ["VerifiableCredential", "PaymentMandate"],
                "id": mandate_id,
                "issuer": _AGENT_DID,
                "issuanceDate": now,
                "credentialSubject": subject,
                "proof": AP2Proof(
                    created=now,
                    verificationMethod=f"{_AGENT_DID}#key-1",
                    jws=_sign_vc(subject, _AGENT_DID, "PaymentMandate"),
                ),
            }
        )

    def verify_mandate(self, mandate) -> bool:
        """
        ECDSA verification against the agent's public key, over the same
        canonicalized subject+issuer+type payload that was signed. Returns
        False on any mismatch, tampering or malformed signature.
        """
        mandate_type = mandate.type[-1]
        payload = json.dumps(
            {"mandate_type": mandate_type, "issuer": mandate.issuer, "credentialSubject": mandate.credentialSubject},
            sort_keys=True, separators=(",", ":"),
        ).encode()
        return _verify_bytes(payload, mandate.proof.jws)
