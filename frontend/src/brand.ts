/**
 * Display brand (white-label). Chosen at build/dev time with VITE_BRAND:
 *   chase       Chase Marketplace (default; approved for the internal demo)
 *   shopsphere  ShopSphere (the original concept brand)
 * The logo is an approved asset you provide: frontend/public/brand/chase-logo.svg
 * (or set VITE_BRAND_LOGO to another path). Until it exists, a text wordmark shows.
 * Only names, logo, colours and footer text change — never the business logic.
 */
export interface Brand {
  key: "chase" | "shopsphere";
  name: string;            // "Chase Marketplace"
  short: string;           // "Chase"
  wordmark: string;        // text shown when there's no logo file
  wordmarkSuffix: string;  // small text after the wordmark
  logo: string | null;
  wallet: string;
  points: string;
  memberCard: string;      // label on the member card
  disclaimer: string;
}

const BRANDS: Record<Brand["key"], Brand> = {
  chase: {
    key: "chase", name: "Chase Marketplace", short: "Chase", wordmark: "CHASE", wordmarkSuffix: "Marketplace",
    logo: (import.meta.env.VITE_BRAND_LOGO as string | undefined) || "/brand/chase-logo.svg",
    wallet: "Marketplace Wallet", points: "Chase Marketplace points", memberCard: "Chase Marketplace member",
    disclaimer: "Internal concept demo. Accounts, cards, rewards and payments are simulated; no live Chase or Visa "
      + "systems are used.",
  },
  shopsphere: {
    key: "shopsphere", name: "ShopSphere", short: "ShopSphere", wordmark: "SHOPSPHERE", wordmarkSuffix: "",
    logo: null, wallet: "ShopSphere Wallet", points: "ShopSphere points", memberCard: "ShopSphere member",
    disclaimer: "Concept demo. ShopSphere is not affiliated with JPMorgan Chase or Visa. Identities, cards, rewards "
      + "and payments are simulated.",
  },
};

const key = String(import.meta.env.VITE_BRAND ?? "chase").toLowerCase() as Brand["key"];
export const BRAND: Brand = BRANDS[key] ?? BRANDS.chase;

if (typeof document !== "undefined") {
  document.documentElement.setAttribute("data-brand", BRAND.key);
  document.title = BRAND.name;
}
