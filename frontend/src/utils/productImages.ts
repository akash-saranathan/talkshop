/**
 * Curated Unsplash photo pools per product category.
 * Each merchant has its own pool; a product gets a photo deterministically
 * based on its position so every product looks different and appropriate.
 *
 * All IDs are stable Unsplash photos — onError in the card handles any 404.
 */

const POOLS: Record<string, string[]> = {
  nike: [
    "1542291026-7eec264c27ff", // red Nike Air
    "1600185365483-26d7a4cc7519", // sneakers on concrete
    "1539185441755-838249926f34", // running shoes on track
    "1584735175097-7ff32c94a6f8", // white Nike flatlay
    "1529810313688-44ea1c2d81d3", // running shoes close-up
    "1515955656352-a1fa3a549ef5", // Nike Air Max
    "1606107557195-0e29a4b5b4aa", // sneakers side
    "1491553895911-0055eca6402d", // white sport shoes
    "1571601624736-b25d9f678f80", // neon sneakers
    "1556906781-9bfb3a2fc3f0", // yellow sneakers
  ],
  adidas: [
    "1491553895911-0055eca6402d", // white Adidas NMD
    "1608231387042-66d1773070a5", // white sneakers
    "1606107557195-0e29a4b5b4aa", // sneakers side view
    "1539185441755-838249926f34", // sport shoes on track
    "1542291026-7eec264c27ff",    // athletic shoes
    "1556906781-9bfb3a2fc3f0",   // colorful sneakers
    "1529810313688-44ea1c2d81d3", // close-up running
    "1600185365483-26d7a4cc7519", // sneakers lifestyle
    "1571601624736-b25d9f678f80", // neon sport
    "1584735175097-7ff32c94a6f8", // flatlay shoes
  ],
  zara: [
    "1515886657613-9f3515b0c78f", // woman in floral dress
    "1469334031218-e382a71b716b", // fashion editorial
    "1572804013309-59a88b7e92f1", // summer floral dress
    "1490481651871-ab68de25d43d", // model in elegant dress
    "1496747911269-b3c6ac8b4f7e", // fashion clothing
    "1551488831-00ddcb6c6bd3",    // casual fashion street
    "1583846712419-d1a23d0e3e58", // boutique fashion
    "1467043237213-65f2da53396f", // summer outfit
    "1485218126466-34e48c18b1e5", // fashion portrait
    "1558618666-fcd25c85cd64",    // dress editorial
  ],
  hm: [
    "1551488831-00ddcb6c6bd3",    // casual fashion
    "1490481651871-ab68de25d43d", // street fashion
    "1496747911269-b3c6ac8b4f7e", // everyday clothing
    "1515886657613-9f3515b0c78f", // dress
    "1467043237213-65f2da53396f", // casual outfit
    "1469334031218-e382a71b716b", // fashion
    "1572804013309-59a88b7e92f1", // colorful dress
    "1485218126466-34e48c18b1e5", // portrait fashion
    "1583846712419-d1a23d0e3e58", // clothing
    "1558618666-fcd25c85cd64",    // editorial
  ],
  fossil: [
    "1523275335684-37898b6baf30", // brown leather watch classic
    "1434494878577-86c2a2a7e527", // minimal watch wrist
    "1612817288484-6f916006741a", // watch flatlay
    "1546868871-7041f2a55e12",    // luxury watch closeup
    "1508685096489-eafdb5405f76", // black watch on surface
    "1524592094714-0f0654e392a9", // watch detail
    "1533139502658-0198f920d8e7", // wrist shot watch
    "1619134778706-7e3e8fe22b03", // watch lifestyle
  ],
  casio: [
    "1508685096489-eafdb5405f76", // black digital watch
    "1546868871-7041f2a55e12",    // rugged watch
    "1523275335684-37898b6baf30", // classic timepiece
    "1524592094714-0f0654e392a9", // watch macro
    "1612817288484-6f916006741a", // watch flatlay
    "1533139502658-0198f920d8e7", // wrist
    "1434494878577-86c2a2a7e527", // minimalist
    "1619134778706-7e3e8fe22b03", // lifestyle watch
  ],
};

/**
 * Returns an Unsplash image URL appropriate for the merchant and product.
 * Products within the same merchant cycle through different photos.
 */
export function getProductImageUrl(merchantId: string, productId: string, w = 300, h = 220): string {
  const pool = POOLS[merchantId] ?? POOLS.nike;
  // Deterministic index from the product id (use last char code + digits sum)
  const sum = [...productId].reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const idx = sum % pool.length;
  const photoId = pool[idx];
  return `https://images.unsplash.com/photo-${photoId}?w=${w}&h=${h}&fit=crop&q=75&auto=format`;
}
