/**
 * Mock card tokenizer — runs entirely in the browser.
 * Raw card digits are passed in and never sent anywhere — only the
 * opaque pm reference (mock_pm_<last4>) leaves this function.
 *
 * Production equivalent: a hosted-fields iframe that calls the PSP
 * vault API and returns an opaque PM id without ever exposing the PAN.
 */
export interface TokenizedCard {
  pm: string;    // "mock_pm_<last4>" — the only thing sent to the backend
  last4: string;
  brand: string; // "visa" | "mastercard" | "amex" | "card"
}

export function mockTokenize(cardNumber: string): TokenizedCard {
  const digits = cardNumber.replace(/\D/g, "");
  if (digits.length < 13) throw new Error("Card number too short");
  const last4 = digits.slice(-4);
  const brand =
    digits.startsWith("4")             ? "visa"       :
    /^5[1-5]/.test(digits)             ? "mastercard" :
    /^3[47]/.test(digits)              ? "amex"       :
    digits.startsWith("6")             ? "discover"   : "card";
  return { pm: `mock_pm_${last4}`, last4, brand };
}

export function formatCardNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 16);
  return digits.replace(/(.{4})/g, "$1 ").trim();
}

export function formatExpiry(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  if (digits.length > 2) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return digits;
}

// ── Client-side card tokenization ────────────────────────────────────────────
// The browser is the trust boundary: it validates the raw card and derives the
// non-sensitive reference (brand + last4 + expiry). The PAN and CVC are used
// only inside tokenizeCard and are never returned or sent anywhere.

export interface CardReference {
  brand: string;        // "Visa" | "Mastercard" | "Amex" | "Discover" | "Card"
  last4: string;
  exp_month: number;
  exp_year: number;     // 4-digit
}

export type TokenizeError = "card_number_invalid" | "expiry_invalid" | "card_expired" | "cvc_invalid";

export function detectBrand(digits: string): string {
  if (digits.startsWith("4")) return "Visa";
  if (/^5[1-5]/.test(digits) || (digits.length >= 4 && +digits.slice(0, 4) >= 2221 && +digits.slice(0, 4) <= 2720)) return "Mastercard";
  if (/^3[47]/.test(digits)) return "Amex";
  if (digits.startsWith("6")) return "Discover";
  return "Card";
}

/**
 * Validate a raw card entirely in the browser and return only its safe
 * reference. Raw number/CVC are consumed here and never leave.
 * (Demo PSP: a plausible 13–19 digit number is accepted — no Luhn gate, so a
 * made-up demo card isn't rejected.)
 */
export function tokenizeCard(input: { number: string; expiry: string; cvc: string }): { ref?: CardReference; error?: TokenizeError } {
  const digits = input.number.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return { error: "card_number_invalid" };
  const m = /^(\d{2})\/(\d{2})$/.exec(input.expiry.trim());
  if (!m) return { error: "expiry_invalid" };
  const exp_month = +m[1];
  const exp_year = 2000 + +m[2];
  if (exp_month < 1 || exp_month > 12) return { error: "expiry_invalid" };
  const now = new Date();
  if (exp_year < now.getFullYear() || (exp_year === now.getFullYear() && exp_month < now.getMonth() + 1)) {
    return { error: "card_expired" };
  }
  if (!/^\d{3,4}$/.test(input.cvc)) return { error: "cvc_invalid" };
  return { ref: { brand: detectBrand(digits), last4: digits.slice(-4), exp_month, exp_year } };
}
