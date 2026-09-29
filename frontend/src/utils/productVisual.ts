/**
 * No real product photography exists for this seed data, and we won't
 * fabricate URLs to real branded product photos we can't verify. Instead:
 * a colored icon tile per product — keyword-matched first (so items within
 * one category still look distinct from each other), falling back to a
 * category-level default. Fully offline, nothing to 404 during a demo.
 */
import {
  Footprints, Headphones, Watch, Laptop, Smartphone, Glasses, Shirt,
  ShoppingBag, Tv, Camera, type LucideIcon,
} from "lucide-react";

export interface ProductVisual {
  icon: LucideIcon;
  bg: string;
  fg: string;
}

const KEYWORD_ICONS: [RegExp, LucideIcon][] = [
  [/headphone|earbud|airpod/i, Headphones],
  [/watch/i, Watch],
  [/laptop|macbook/i, Laptop],
  [/phone|galaxy(?! watch)/i, Smartphone],
  [/\btv\b|television/i, Tv],
  [/camera/i, Camera],
  [/glass|sunglass/i, Glasses],
  [/shirt|jacket|cap|belt|sock|hoodie/i, Shirt],
];

const CATEGORY_VISUAL: Record<string, Omit<ProductVisual, "icon">> = {
  running_shoes: { bg: "bg-orange-100", fg: "text-orange-600" },
  electronics: { bg: "bg-blue-100", fg: "text-blue-600" },
  accessories: { bg: "bg-violet-100", fg: "text-violet-600" },
};

const CATEGORY_ICON: Record<string, LucideIcon> = {
  running_shoes: Footprints,
  electronics: Laptop,
  accessories: Shirt,
};

export function getProductVisual(title: string, category: string): ProductVisual {
  const colors = CATEGORY_VISUAL[category] ?? { bg: "bg-slate-100", fg: "text-slate-600" };
  for (const [pattern, icon] of KEYWORD_ICONS) {
    if (pattern.test(title)) {
      return { icon, ...colors };
    }
  }
  return { icon: CATEGORY_ICON[category] ?? ShoppingBag, ...colors };
}
