/**
 * Cardmember marketplace (Part 2): who the member is, their offers and
 * rewards, and the VIC-inspired agent-payment simulator. Everything Visa /
 * Chase here is a LOCAL SIMULATION (backend/vic, backend/gateway).
 */
import { call, json } from "./shop";

export interface CardAccountView {
  account_id: string; issuer: string; account_type: "credit_card" | "checking" | "savings"; product_name: string;
  network: "Visa" | "Mastercard" | null; last4: string; status: string; marketplace_eligible: boolean;
  payment_method_id: string | null;
}
export interface AgentPayStatus {
  card_account_id: string; network: string; last4: string;
  status: "NOT_ENROLLED" | "PENDING_AUTHENTICATION" | "ACTIVE" | "SUSPENDED" | "REVOKED";
  agent: string; agent_token: string | null; activated_at: string | null; label: string;
}
export interface MemberInfo {
  signed_in: boolean; eligible: boolean; code: "LOGIN_REQUIRED" | "NO_ELIGIBLE_CARD" | null; message: string | null;
  member: null | {
    name: string; member_since: string | null; status: string; accounts: CardAccountView[];
    primary_card: CardAccountView | null; rewards_balance: number; agent_pay?: AgentPayStatus[];
  };
}
export interface Offer {
  offer_id: string; title: string; description: string;
  kind: "discount_percent" | "discount_amount" | "bonus_points" | "cashback";
  value: number; department: string | null; subcategories: string[]; min_subtotal: number;
  audience: "all_cardmembers" | "visa_agent_pay"; uses_left: number | null; label: string;
}
export interface LedgerEntry {
  kind: "earned" | "bonus" | "redeemed" | "welcome" | "cashback" | "discount";
  points: number | null; amount: number | null; reason: string; order_id: string | null; at: string | null;
}
export interface Rewards {
  balance: number; value: number; lifetime_points: number; cashback_total: number; offer_savings_total: number;
  programme: string; redemption_rate: string; ledger: LedgerEntry[];
}
/** What the browser needs to show the simulated passkey prompt (never a real WebAuthn/Visa passkey). */
export interface PasskeyChallenge {
  challenge_id: string; nonce: string; purpose: string; expires_at: string; method: string; label: string;
}
export interface InstructionView {
  instruction_id: string; status: string; lifecycle_state: string; checkout_id: string; merchant_id: string;
  amount: number; currency: string; max_transactions: number; transactions_used: number; agent_token: string;
  agent_id: string; expires_at: string; status_reason: string | null;
}

export const member = {
  me: () => call<MemberInfo>("/api/member"),
  offers: () => call<Offer[]>("/api/offers"),
  rewards: () => call<Rewards>("/api/rewards"),
  /** Signed-in account without an eligible card: its name + email + these digits must match. */
  verifyCard: (last4: string) => call<MemberInfo>("/api/member/verify-card", json("POST", { last4 })),
};

export const vic = {
  status: () => call<{ simulated: boolean; disclaimer: string; cards: AgentPayStatus[] }>("/api/vic/status"),
  enrollStart: (card_account_id: string) =>
    call<{ status: string; agent_token: string; passkey: PasskeyChallenge }>("/api/vic/enrollment/start",
      json("POST", { card_account_id })),
  enrollComplete: (card_account_id: string, p: PasskeyChallenge, user_verified: boolean) =>
    call<{ cards: AgentPayStatus[] }>("/api/vic/enrollment/complete",
      json("POST", { card_account_id, challenge_id: p.challenge_id, nonce: p.nonce, user_verified })),
  tokenAction: (action: "suspend" | "resume" | "revoke", card_account_id: string) =>
    call<{ cards: AgentPayStatus[] }>(`/api/vic/enrollment/${action}`, json("POST", { card_account_id })),
  createInstruction: (checkout_id: string, consent_mode: "button" | "typed" | "auto_countdown" = "button") =>
    call<{ instruction: InstructionView; passkey: PasskeyChallenge }>("/api/vic/instructions",
      json("POST", { checkout_id, consent_mode })),
  authenticate: (instruction_id: string, p: PasskeyChallenge, user_verified: boolean) =>
    call<{ instruction: InstructionView }>(`/api/vic/instructions/${instruction_id}/authenticate`,
      json("POST", { challenge_id: p.challenge_id, nonce: p.nonce, user_verified })),
  cancel: (instruction_id: string) =>
    call<{ instruction: InstructionView }>(`/api/vic/instructions/${instruction_id}/cancel`, json("POST")),
  scenario: (outcome: "decline" | "timeout" | "duplicate" | "none") =>
    call<{ next_outcome: string | null }>("/api/vic/demo/scenario", json("POST", { outcome })),
};
