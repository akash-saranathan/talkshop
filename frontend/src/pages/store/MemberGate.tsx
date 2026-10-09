import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, BadgePercent, Bot, CreditCard, Gift, Landmark, LockKeyhole, ShieldCheck } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { useMember } from "../../member/MemberContext";

/**
 * What a guest (Persona D) or a signed-in customer without an eligible credit
 * card (Persona C) sees instead of the marketplace. No catalog data is loaded
 * here — the server refuses it anyway (403 LOGIN_REQUIRED / NO_ELIGIBLE_CARD).
 */
export default function MemberGate() {
  const { info } = useMember();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const ineligible = info?.signed_in && info.code === "NO_ELIGIBLE_CARD";

  return (
    <div>
      <section className="bg-navy text-white relative overflow-hidden">
        <div className="absolute -right-40 -top-40 w-[560px] h-[560px] rounded-full bg-navy-2 opacity-60" aria-hidden />
        <div className="relative mx-auto max-w-[1200px] px-4 sm:px-6 py-16 sm:py-24 grid lg:grid-cols-[1.2fr_1fr] gap-10 items-center">
          <div className="flex flex-col gap-5">
            <p className="text-[11px] font-semibold tracking-[0.24em] text-gold uppercase">ShopSphere cardmember marketplace</p>
            <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.08]">
              {ineligible ? `Sorry, ${info?.member?.name ?? "there"}. This marketplace is for credit-card members.`
                : "A members-only marketplace for eligible Chase credit-card holders."}
            </h1>
            <p className="text-white/75 text-[17px] leading-relaxed max-w-xl">
              {ineligible ? info?.message
                : "Member pricing, rewards on every purchase and Talkshop AI, an assistant that finds what you need and checks out only when you approve."}
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              {ineligible ? (
                <button onClick={async () => { await logout(); navigate("/login", { replace: true }); }}
                  className="inline-flex items-center gap-2 h-12 px-6 rounded-full bg-white text-navy text-[15px] font-semibold hover:opacity-90">
                  Sign in with another account <ArrowRight size={16} />
                </button>
              ) : (
                <Link to="/login" className="inline-flex items-center gap-2 h-12 px-6 rounded-full bg-white text-navy text-[15px] font-semibold hover:opacity-90">
                  Sign in as a cardmember <ArrowRight size={16} />
                </Link>
              )}
            </div>
          </div>
          <div className="rounded-3xl bg-white/[0.06] border border-white/10 p-6 flex flex-col gap-4">
            <p className="text-sm font-semibold flex items-center gap-2"><LockKeyhole size={16} className="text-gold" /> Who can enter</p>
            <ul className="flex flex-col gap-3 text-sm">
              {[
                ["Chase credit-card member (Visa or Mastercard)", true],
                ["Checking or savings account only", false],
                ["Not signed in", false],
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
