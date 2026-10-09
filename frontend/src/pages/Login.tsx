import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Eye, EyeOff, Landmark, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { afterSignIn } from "../auth/afterSignIn";
import { Wordmark } from "../components/shopsphere/StoreHeader";
import { Button, Field, Notice, cx } from "../components/ui";

/**
 * Cardmember sign-in and sign-up (Part 2). ShopSphere is a restricted
 * marketplace for eligible Chase credit-card members (simulated). Demo
 * personas sign in with one click; new customers create an account by
 * matching the name, email and last four digits on their Chase card account
 * (simulated directory). The server decides who may enter (GET /api/member).
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
  const { login, registerCardmember } = useAuth();
  const [params] = useSearchParams();
  const next = params.get("next");
  const [screen, setScreen] = useState<"signin" | "signup">(params.get("signup") ? "signup" : "signin");
  const [fullName, setFullName] = useState("");
  const [last4, setLast4] = useState("");
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
  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError(null); setBusy("signup");
    try {
      const r = await registerCardmember(fullName, email, password, last4);
      navigate(await afterSignIn(next, r.merged_lines), { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const go = (s: "signin" | "signup") => { setScreen(s); setError(null); setPassword(""); };

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
          <div className="grid grid-cols-2 rounded-full bg-panel p-1 text-sm font-medium">
            {(["signin", "signup"] as const).map((s) => (
              <button key={s} type="button" onClick={() => go(s)}
                className={cx("h-9 rounded-full transition-colors", screen === s ? "bg-canvas shadow-card text-ink" : "text-muted hover:text-ink")}>
                {s === "signin" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          {screen === "signup" ? (
            <form onSubmit={create} className="flex flex-col gap-4">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">New to ShopSphere?</h2>
                <p className="text-muted text-sm mt-1 leading-relaxed">
                  Create your account with the <span className="text-ink font-medium">same name and email as your Chase
                  account</span>, and the <span className="text-ink font-medium">last four digits</span> of your Chase
                  credit card. We check them with Chase (simulated) before your account is created.
                </p>
              </div>
              <Field label="Full name (as on your Chase account)" value={fullName} onChange={(e) => setFullName(e.target.value)}
                required autoComplete="name" />
              <Field label="Email (the one on your Chase account)" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                required autoComplete="email" />
              <Field label="Last 4 digits of your Chase credit card" value={last4} required inputMode="numeric"
                autoComplete="off" maxLength={4} pattern="\d{4}" placeholder="e.g. 1188"
                onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))} />
              <div className="relative">
                <Field label="Create a password (min 8 characters)" type={show ? "text" : "password"} value={password}
                  onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
                <button type="button" tabIndex={-1} onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"}
                  className="absolute right-3 bottom-3 text-muted hover:text-ink">{show ? <EyeOff size={17} /> : <Eye size={17} />}</button>
              </div>
              {error && <Notice>{error}</Notice>}
              <Button type="submit" size="lg" loading={busy === "signup"}>Verify and create account</Button>
              <p className="flex items-start gap-2 text-xs text-muted leading-relaxed">
                <ShieldCheck size={14} className="shrink-0 mt-0.5 text-good" />
                We only ask for the last four digits, never your full card number or security code. Demo cardholders
                you can use: Alex Rivera · alex.rivera@cardmember.demo · 1188 (Visa), Jordan Lee ·
                jordan.lee@cardmember.demo · 2277 (Mastercard), Sam Patel · sam.patel@cardmember.demo · 3366 (Visa and
                Mastercard).
              </p>
            </form>
          ) : (
          <>
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
          <p className="text-xs text-muted text-center">All demo personas use the password <span className="font-mono">{PASSWORD}</span>.
            {" "}New here? <button type="button" onClick={() => go("signup")} className="font-medium text-ink underline">Create an account</button></p>
          </>
          )}
        </div>
      </div>
    </div>
  );
}
