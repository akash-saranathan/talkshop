/** "✦ Talkshop picks for you" — Talkshop's latest top 3, shown full-size on
 *  the storefront next to the chat (plan I5). Hidden until Talkshop recommends. */
import { Sparkles } from "lucide-react";
import ProductTile from "../shopsphere/ProductTile";
import { useTalkshopShared } from "../../talkshop/TalkshopContext";

export default function TalkshopPicks() {
  const { picks, selectedId, setOpen } = useTalkshopShared();
  if (!picks.length) return null;
  return (
    <section className="mx-auto max-w-[1400px] px-4 sm:px-6 mt-10">
      <div className="rounded-3xl bg-talk-soft/60 border border-talk/20 p-5 sm:p-7">
        <div className="flex items-center justify-between gap-3 mb-5">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold tracking-[0.2em] text-talk"><Sparkles size={14} /> TALKSHOP PICKS FOR YOU</p>
            <p className="text-sm text-muted mt-1">From your conversation with Talkshop</p>
          </div>
          <button onClick={() => setOpen(true)} className="text-sm font-medium text-talk hover:underline shrink-0">Open chat</button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-5 gap-y-8">
          {picks.map((p) => (
            <ProductTile key={p.product_id} product={p} picked reason={p.reason} selected={p.product_id === selectedId} />
          ))}
        </div>
      </div>
    </section>
  );
}
