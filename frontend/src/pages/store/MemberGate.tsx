import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, BadgePercent, Bot, CreditCard, Gift, Landmark, LockKeyhole, ShieldCheck } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { useMember } from "../../member/MemberContext";
import { member as memberApi } from "../../api/member";
import { Button, Field, Notice } from "../../components/ui";

/**
 * The membership page: shown to a guest (Persona D) or a customer without an
 * eligible credit card (Persona C) on member-only pages (cart, checkout,
 * orders, offers, rewards, account) and at /membership. Browsing and Talkshop
 * stay open; buying needs an eligible cardmember (enforced by the server).
 */
export default function MemberGate() {
  const { info, refresh } = useMember();
  const [last4, setLast4] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await memberApi.verifyCard(last4); await refresh(); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  const { logout } = useAuth();
  const navigate = useNavigate();
  const ineligible = info?.signed_in && info.code === "NO_ELIGIBLE_CARD";
  if (info?.eligible) return (
    <div className="mx-auto max-w-[900px] px-4 sm:px-6 py-16 text-center">
      <p className="text-lg font-semibold">You're an eligible cardmember.</p>
      <Link to="/" className="mt-3 inline-block underline">Back to the marketplace</Link>
    </div>
  );

  return (
    <div>
      <section className="bg-navy text-white relative overflow-hidden">
        <div className="absolute -right-40 -top-40 w-[560px] h-[560px] rounded-full bg-navy-2 opacity-60" aria-hidden />
        <div className="relative mx-auto max-w-[1200px] px-4 sm:px-6 py-16 sm:py-24 grid lg:grid-cols-[1.2fr_1fr] gap-10 items-center">
          <div className="flex flex-col gap-5">
            <p className="text-[11px] font-semibold tracking-[0.24em] text-gold uppercase">ShopSphere cardmember marketplace</p>
            <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.08]">
              {ineligible ? `Almost there, ${info?.member?.name ?? "there"}. Buying is for credit-card members.`
                : "Sign in as a cardmember to buy."}
            </h1>
            <p className="text-white/75 text-[17px] leading-relaxed max-w-xl">
              {ineligible ? info?.message
                : "Anyone can browse ShopSphere and ask Talkshop AI. Your cart, member offers, rewards and checkout are for eligible Chase credit-card members."}
            </p>
            {ineligible && (
              <form onSubmit={verify} className="rounded-2xl bg-white text-ink p-5 flex flex-col gap-3 max-w-md">
                <p className="text-sm font-semibold">Have a Chase credit card? Verify it</p>
                <p className="text-xs text-muted leading-relaxed">
                  Your account name ({info?.member?.name}) and email must match your Chase account. Enter only the last
                  four digits of the card (checked with Chase, simulated).
                </p>
                <Field label="Last 4 digits of your Chase credit card" value={last4} required inputMode="numeric"
                  maxLength={4} autoComplete="off" onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))} />
                {error && <Notice>{error}</Notice>}
                <Button type="submit" loading={busy} disabled={last4.length !== 4}>Verify card</Button>
              </form>
            )}
            <div className="flex flex-wrap gap-3 pt-2">
              {ineligible ? (
                <button onClick={async () => { await logout(); navigate("/login", { replace: true }); }}
                  className="inline-flex items-center gap-2 h-12 px-6 rounded-full bg-white text-navy text-[15px] font-semibold hover:opacity-90">
                  Sign in with another account <ArrowRight size={16} />
                </button>
              ) : (
                <>
                  <Link to="/login" className="inline-flex items-center gap-2 h-12 px-6 rounded-full bg-white text-navy text-[15px] font-semibold hover:opacity-90">
                    Sign in as a cardmember <ArrowRight size={16} />
                  </Link>
                  <Link to="/login?signup=1" className="inline-flex items-center h-12 px-6 rounded-full border border-white/30 text-[15px] font-medium hover:border-white">
                    New customer? Create an account
                  </Link>
                </>
              )}
              <Link to="/" className="inline-flex items-center h-12 px-2 text-[15px] font-medium text-white/80 hover:text-white underline">
                Keep browsing
              </Link>
            </div>
          </div>
          <div className="rounded-3xl bg-white/[0.06] border border-white/10 p-6 flex flex-col gap-4">
            <p className="text-sm font-semibold flex items-center gap-2"><LockKeyhole size={16} className="text-gold" /> Who can buy</p>
            <ul className="flex flex-col gap-3 text-sm">
              {[
                ["Chase credit-card member (Visa or Mastercard)", true],
                ["Checking or savings account only", false],
                ["Not signed in (browse only)", false],
              ].map(([label, ok]) => (
                <li key={String(label)} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.05] px-4 py-3">
                  <span className="text-white/85">{label}</span>
                  <span className={ok ? "text-[#86e0ad] text-xs font-semibold" : "text-white/50 text-xs font-semibold"}>
                    {ok ? "Eligible" : "Not eligible"}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-white/50">Checked by ShopSphere's servers on every request, not just hidden in the page.</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 sm:px-6 mt-14 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: <BadgePercent size={18} />, title: "Member offers", text: "Exclusive pricing on selected categories" },
          { icon: <Gift size={18} />, title: "Rewards", text: "Earn demo points on every purchase" },
          { icon: <Bot size={18} />, title: "Talkshop AI", text: "Describe it; Talkshop finds it and builds the order" },
          { icon: <ShieldCheck size={18} />, title: "You approve every payment", text: "Visa agent payments with passkey step-up (simulated)" },
        ].map((b) => (
          <div key={b.title} className="rounded-2xl border border-line p-5 flex flex-col gap-2">
            <span className="w-9 h-9 rounded-full bg-accent-soft text-accent grid place-items-center">{b.icon}</span>
            <p className="font-semibold">{b.title}</p>
            <p className="text-sm text-muted">{b.text}</p>
          </div>
        ))}
      </section>

      <section className="mx-auto max-w-[1200px] px-4 sm:px-6 mt-10">
        <div className="rounded-2xl bg-panel p-5 flex flex-col sm:flex-row gap-3 sm:items-center text-sm text-muted">
          <span className="flex items-center gap-2 font-medium text-ink whitespace-nowrap"><Landmark size={16} /><CreditCard size={16} /> Concept demo</span>
          ShopSphere is an original concept marketplace and is not affiliated with JPMorgan Chase or Visa. Identities,
          accounts, cards, rewards and payments are simulated with demo data.
        </div>
      </section>
    </div>
  );
}
