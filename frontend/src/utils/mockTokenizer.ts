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
