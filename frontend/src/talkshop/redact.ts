/**
 * Card details typed into the chat are masked before the message leaves the
 * browser. The server masks again (backend/talkshop/parse.py) — the card form
 * is the only place card details are entered.
 */
const CARD_RUN = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;
const CVC = /\b(cvv2?|cvc2?|cid|security code)\s*(?:is|:|#)?\s*\d{3,4}\b/gi;
const EXPIRY = /\b(exp(?:iry|ires|iration)?(?: date)?)\s*(?:is|:)?\s*\d{1,2}\s*\/\s*\d{2,4}\b/gi;

function luhn(digits: string): boolean {
  let total = 0;
  [...digits].reverse().forEach((ch, i) => {
    let d = Number(ch) * (i % 2 ? 2 : 1);
    if (d > 9) d -= 9;
    total += d;
  });
  return total % 10 === 0;
}

export function maskPaymentData(text: string): string {
  return text
    .replace(CARD_RUN, (run) => {
      const digits = run.replace(/\D/g, "");
      return digits.length >= 13 && digits.length <= 19 && luhn(digits) ? `•••• ${digits.slice(-4)}` : run;
    })
    .replace(CVC, (_m, label: string) => `${label} •••`)
    .replace(EXPIRY, (_m, label: string) => `${label} ••/••`);
}
