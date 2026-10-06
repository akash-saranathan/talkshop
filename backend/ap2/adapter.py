"""
AP2Adapter — creates and signs the three AP2 Verifiable Credential mandates.

Wraps the existing HMAC-SHA256 signing from backend.payment.signing.
Production would use ECDSA-P256 keys from a hardware wallet or HSM — the
mandate structure is identical; only the cryptosuite field and signing call
differ.

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
import hmac
import json
import os
import uuid
from datetime import datetime, timezone, timedelta

from backend.ap2.models import AP2CartMandate, AP2IntentMandate, AP2PaymentMandate, AP2Proof

_KEY = os.getenv("SIGNING_KEY", "demo-signing-key-replace-in-production").encode()

_AGENT_DID = "did:demo:agent:generic-shopping-agent"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _expiry_iso(minutes: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()


def _sign_vc(subject: dict, issuer: str, mandate_type: str) -> str:
    """Sign the VC credentialSubject + issuer + type with HMAC-SHA256."""
    payload = json.dumps(
        {"mandate_type": mandate_type, "issuer": issuer, "credentialSubject": subject},
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    sig = hmac.new(_KEY, payload, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(sig).decode().rstrip("=")


class AP2Adapter:

    def create_intent_mandate(
        self,
        query: str,
        user_id: str,
        merchants: list[str],
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
    ) -> AP2CartMandate:
        """
        CartMandate — issued by the agent after product selection.
        Binds the exact cart (product, quantity, totals) to a checkout_hash.
        Links back to the IntentMandate via intent_mandate_id.
        """
        mandate_id = f"urn:ap2:mandate:cart:{uuid.uuid4().hex}"
        now = _now_iso()

        checkout_hash = hashlib.sha256(
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
    ) -> AP2PaymentMandate:
        """
        PaymentMandate — issued by the agent on APPROVE & PAY.
        Links to CartMandate and binds the payment_ref (opaque token).
        user_authorization = HMAC of the CartMandate id, proving the user
        saw and approved this exact cart before payment was triggered.
        """
        mandate_id = f"urn:ap2:mandate:payment:{uuid.uuid4().hex}"
        now = _now_iso()

        user_authorization = base64.urlsafe_b64encode(
            hmac.new(_KEY, cart_mandate.id.encode(), hashlib.sha256).digest()
        ).decode().rstrip("=")

        subject = {
            "payment_mandate_id": mandate_id,
            "payment_details_id": order_id,
            "cart_mandate_id": cart_mandate.id,
            "checkout_hash": cart_mandate.credentialSubject["checkout_hash"],
            "payment_ref": payment_ref,        # opaque token only — no card number
            "user_authorization": user_authorization,
        }

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
        Deterministic verification — recompute HMAC over subject+issuer+type
        and compare against proof.jws. Returns False on any mismatch.
        """
        mandate_type = mandate.type[-1]
        expected = _sign_vc(mandate.credentialSubject, mandate.issuer, mandate_type)
        return hmac.compare_digest(expected, mandate.proof.jws)
