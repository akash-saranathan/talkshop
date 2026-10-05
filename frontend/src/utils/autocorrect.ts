/**
 * Phone-style autocorrect for the chat box. Desktop browsers only underline
 * misspellings, so we fix common typos ourselves when a word is finished
 * (space/punctuation) or the message is sent.
 *
 * Deliberately a fixed list of unambiguous typos rather than a dictionary
 * or LLM call: it's instant, works offline, and never "corrects" a real
 * word (brand names, sizes, slang) into something the shopper didn't mean.
 */

const TYPOS: Record<string, string> = {
  // Everyday words & contractions
  i: "I", im: "I'm", ive: "I've", dont: "don't", doesnt: "doesn't", didnt: "didn't",
  isnt: "isn't", cant: "can't", thats: "that's", whats: "what's", wouldnt: "wouldn't",
  wnat: "want", wnats: "wants", wnated: "wanted", waht: "what", teh: "the", hte: "the",
  adn: "and", nad: "and", cna: "can", jsut: "just", knwo: "know", konw: "know",
  liek: "like", lkie: "like", nede: "need", neeed: "need", wich: "which", whcih: "which",
  woudl: "would", coudl: "could", shoudl: "should", becuase: "because", beacuse: "because",
  somethign: "something", soemthing: "something", anythign: "anything", untill: "until",
  thnaks: "thanks", thakns: "thanks", definately: "definitely", seperate: "separate",
  recieve: "receive", similiar: "similar", avaliable: "available", availible: "available",
  // Shopping words
  shose: "shoes", sheos: "shoes", shoees: "shoes", runing: "running", runnign: "running",
  sze: "size", szie: "size", siez: "size", uner: "under", udner: "under",
  budjet: "budget", buget: "budget", pirce: "price", prcie: "price",
  delivry: "delivery", delivary: "delivery", ordr: "order", oder: "order", trak: "track",
  crat: "cart", chekout: "checkout", checkotu: "checkout", comapre: "compare", compair: "compare",
  recomend: "recommend", reccomend: "recommend", recommand: "recommend",
  headphnes: "headphones", headphoens: "headphones", earbds: "earbuds",
  shrit: "shirt", jakcet: "jacket", jackte: "jacket", dres: "dress",
  // Colours
  blakc: "black", balck: "black", whiet: "white", wihte: "white", bleu: "blue",
  brwon: "brown", borwn: "brown", gren: "green", gery: "grey",
};

function correctWord(word: string): string | null {
  const fix = TYPOS[word.toLowerCase()];
  if (!fix || fix === word) return null;
  // Keep a capital the user typed ("Wnat" → "Want").
  return word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase()
    ? fix[0].toUpperCase() + fix.slice(1)
    : fix;
}

export interface Correction {
  /** Text exactly as typed — restored if the user presses Backspace right away. */
  original: string;
  corrected: string;
}

/**
 * Called on every edit. Corrects only when exactly one word-ending character
 * was typed at the end of the text, so editing mid-sentence or pasting never
 * rewrites anything.
 */
export function autocorrectOnType(prev: string, next: string): Correction | null {
  if (next.length !== prev.length + 1 || !next.startsWith(prev)) return null;
  const m = next.match(/(^|[^A-Za-z'])([A-Za-z']+)([\s.,!?;:])$/);
  if (!m) return null;
  const fixed = correctWord(m[2]);
  if (!fixed) return null;
  const start = next.length - m[2].length - 1;
  return { original: next, corrected: next.slice(0, start) + fixed + m[3] };
}

/** Corrects the final word when a message is sent without a trailing space. */
export function autocorrectLastWord(text: string): string {
  const m = text.match(/(^|[^A-Za-z'])([A-Za-z']+)$/);
  const fixed = m && correctWord(m[2]);
  return fixed ? text.slice(0, text.length - m![2].length) + fixed : text;
}
