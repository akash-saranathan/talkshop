/**
 * The seam between the ShopSphere website and the Talkshop panel.
 * Pages call these; the panel (Phase 5) listens. Until the panel exists the
 * flag keeps Talkshop entry points hidden so nothing on the page is dead.
 */
export const TALKSHOP_ENABLED = false;

export const TALKSHOP_ASK_EVENT = "talkshop:ask";

/** "Ask Talkshop about this" on a product page → panel opens with the product selected. */
export function askTalkshop(productId: string) {
  window.dispatchEvent(new CustomEvent(TALKSHOP_ASK_EVENT, { detail: { productId } }));
}
