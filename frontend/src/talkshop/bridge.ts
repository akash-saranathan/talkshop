/**
 * The seam between ShopSphere pages and the Talkshop panel: pages dispatch,
 * TalkshopProvider listens (talkshop/TalkshopContext.tsx).
 */
export const TALKSHOP_ENABLED = true;

export const TALKSHOP_ASK_EVENT = "talkshop:ask";

/** "Ask Talkshop about this" on a product page → panel opens with the product selected. */
export function askTalkshop(productId: string, name?: string) {
  window.dispatchEvent(new CustomEvent(TALKSHOP_ASK_EVENT, { detail: { productId, name } }));
}
