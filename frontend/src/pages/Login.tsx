import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Eye, EyeOff, Landmark, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { afterSignIn } from "../auth/afterSignIn";
import { Wordmark } from "../components/shopsphere/StoreHeader";
import { Button, Field, Notice, cx } from "../components/ui";

/**
 * Cardmember sign-in (Part 2). ShopSphere is a restricted marketplace for
 * eligible Chase credit-card members (simulated). Demo personas sign in with
 * one click; the server decides who may enter (GET /api/member).
 */
const PASSWORD = "demo1234";
const PERSONAS = [
  { key: "A", name: "Kaajal", email: "kaajal@shopsphere.demo", card: "Chase Visa ending 4821",
    note: "Eligible · Visa agent payments active", tone: "good" },
  { key: "B", name: "Marcus", email: "marcus@shopsphere.demo", card: "Chase Mastercard ending 5510",
    note: "Eligible · standard card payment (no VIC)", tone: "good" },
  { key: "E", name: "Elena", email: "elena@shopsphere.demo", card: "Chase Visa ending 4002",
    note: "Eligible · must set up agent payments first", tone: "warn" },
  { key: "C", name: "Priya", email: "priya@shopsphere.demo", card: "Chase checking ending 7702",
    note: "Not eligible · checking account only", tone: "bad" },
] as const;

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [params] = useSearchParams();
  const next = params.get("next");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const signIn = async (mail: string, pass: string, who: string) => {
    setError(null); setBusy(who);
    try {
      const r = await login(mail, pass);
      navigate(await afterSignIn(next, r.merged_lines), { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); void signIn(email, password, "form"); };

  return (
    <div className="ss-app min-h-screen grid lg:grid-cols-[1.05fr_1fr]">
      {/* Brand side */}
      <div className="hidden lg:flex flex-col justify-between bg-navy text-white p-12 relative overflow-hidden">
        <div className="absolute -right-32 -top-32 w-[520px] h-[520px] rounded-full bg-navy-2 opacity-70" aria-hidden />
        <div className="absolute -right-10 bottom-24 w-[260px] h-[260px] rounded-full border border-white/10" aria-hidden />
        <Wordmark className="relative [&_span:last-child]:text-white" />
        <div className="relative max-w-md flex flex-col gap-5">
          <p className="text-[11px] font-semibold tracking-[0.24em] text-gold uppercase">Cardmember marketplace</p>
          <h1 className="text-4xl font-semibold tracking-tight leading-[1.1]">
            Member pricing, rewards and an AI shopping assistant, in one place.
          </h1>
          <ul className="flex flex-col gap-3 text-white/80 text-[15px]">
            <li className="flex gap-3"><Landmark size={18} className="text-gold shrink-0 mt-0.5" />For eligible Chase credit-card members</li>
            <li className="flex gap-3"><Sparkles size={18} className="text-gold shrink-0 mt-0.5" />Shop by conversation with Talkshop AI</li>
            <li className="flex gap-3"><ShieldCheck size={18} className="text-gold shrink-0 mt-0.5" />Every payment approved by you, one exact order at a time</li>
          </ul>
        </div>
        <p className="relative text-xs text-white/50 max-w-md">
          Concept demo. ShopSphere is not affiliated with JPMorgan Chase or Visa. All identities, cards, rewards and
          payments are simulated.
        </p>
      </div>

      {/* Sign-in side */}
      <div className="flex flex-col items-center justify-center p-5 sm:p-12">
        <div className="w-full max-w-md flex flex-col gap-6">
          <Wordmark className="lg:hidden self-center" />
          {next && <Notice tone="talk">Sign in with your cardmember account to continue.</Notice>}
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Cardmember sign in</h2>
            <p className="text-muted text-sm mt-1">Pick a demo persona, or sign in with email and password.</p>
          </div>

          <div className="flex flex-col gap-2" role="list" aria-label="Demo personas">
            {PERSONAS.map((p) => (
              <button key={p.key} role="listitem" onClick={() => signIn(p.email, PASSWORD, p.key)} disabled={!!busy}
                className="group flex items-center gap-3 rounded-2xl border border-line hover:border-ink px-4 py-3 text-left transition-colors disabled:opacity-60">
                <span className="w-9 h-9 rounded-full bg-navy text-white grid place-items-center text-sm font-semibold shrink-0">{p.key}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{p.name} <span className="font-normal text-muted">· {p.card}</span></span>
                  <span className={cx("block text-xs mt-0.5", p.tone === "good" ? "text-good" : p.tone === "warn" ? "text-gold" : "text-bad")}>
                    {p.note}
                  </span>
                </span>
                {busy === p.key ? <span className="text-xs text-muted">Signing in…</span>
                  : <ArrowRight size={16} className="text-muted group-hover:text-ink shrink-0" />}
              </button>
            ))}
            <Link to="/" className="flex items-center gap-3 rounded-2xl border border-dashed border-line-strong px-4 py-3 hover:border-ink">
              <span className="w-9 h-9 rounded-full bg-panel text-muted grid place-items-center shrink-0"><UserRound size={16} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">D · Guest</span>
                <span className="block text-xs text-muted mt-0.5">Not signed in · sees the public page only</span>
              </span>
              <ArrowRight size={16} className="text-muted shrink-0" />
            </Link>
          </div>

          <div className="flex items-center gap-3 text-xs text-muted"><span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" /></div>

          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            <div className="relative">
              <Field label="Password" type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)}
                required minLength={8} autoComplete="current-password" />
              <button type="button" tabIndex={-1} onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"}
                className="absolute right-3 bottom-3 text-muted hover:text-ink">{show ? <EyeOff size={17} /> : <Eye size={17} />}</button>
            </div>
            {error && <Notice>{error}</Notice>}
            <Button type="submit" size="lg" loading={busy === "form"}>Sign in</Button>
          </form>
          <p className="text-xs text-muted text-center">All demo personas use the password <span className="font-mono">{PASSWORD}</span>.</p>
        </div>
      </div>
    </div>
  );
}
