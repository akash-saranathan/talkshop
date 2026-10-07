"""
ACPAdapter — wraps SPT issuance + verification for the generic shopping agent.

Flow:
  1. UCP create_session() returns the exact total (e.g. $116.61 = 11661 cents)
  2. Agent calls ACPAdapter.issue() with the opaque payment_method reference
     and maximum_amount_cents = UCP total. ACP SPT is issued and scoped.
  3. SPT id (spt_xxx) is passed to UCP complete_session() as the credential token.
  4. ACPAdapter.verify() confirms the SPT is still active before the UCP call.

The agent never touches raw card data at any point in this chain.
"""
from __future__ import annotations

from backend.acp.models import ACPSharedPaymentToken
from backend.acp.token import _sign_token, issue_spt, verify_spt


class ACPAdapter:

    def issue(
        self,
        payment_method: str,   # opaque PM id from MockHostedPaymentField — never raw card
        merchant_id: str,
        total_cents: int,       # must equal UCP session total exactly
        brand: str = "visa",
        last4: str = "0000",
        currency: str = "USD",
    ) -> ACPSharedPaymentToken:
        """Issue SPT scoped to this merchant and this exact cart total."""
        seller_profile = f"nbp_{merchant_id}"
        return issue_spt(payment_method, seller_profile, total_cents, currency, brand, last4)

    def verify(
        self,
        token_id: str,
        merchant_id: str,
        charge_cents: int,
        currency: str = "USD",
    ) -> tuple[bool, str]:
        """Verify SPT before passing it to UCP complete. Returns (ok, reason)."""
        seller_profile = f"nbp_{merchant_id}"
        return verify_spt(token_id, charge_cents, currency, seller_profile)

    def issue_document(
        self,
        dpat_token_id: str,
        merchant_id: str,
        total_cents: int,
        brand: str,
        last4: str,
        currency: str = "USD",
    ) -> dict:
        """SPT bound to one DPAT authorization, as a signed document the caller persists."""
        token = self.issue(dpat_token_id, merchant_id, total_cents, brand, last4, currency)
        seller_profile = f"nbp_{merchant_id}"
        return {
            "token": token.model_dump(),
            "seller_profile": seller_profile,
            "dpat_token_id": dpat_token_id,
            "signature": _sign_token(token.id, token.constraints, seller_profile),
        }
