import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Eye, EyeOff, Sparkles } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { Wordmark } from "../components/shopsphere/StoreHeader";
import { Button, Field, Notice, cx } from "../components/ui";

// Demo 1: ShopSphere assumes a logged-in customer, so there is no guest
// option — the page opens straight on Log in / Sign up.
type Screen = "login" | "register" | "reset";
const DEMO = { email: "kaajal@shopsphere.demo", password: "demo1234" };
const COLLAGE = [
  "/catalog/runner-pro-x/black.webp",
  "/catalog/structured-leather-handbag/coral.webp",
  "/catalog/sony-wh-1000xm5-headphones/black.webp",
  "/catalog/converse-chuck-taylor-all-star/red.webp",
];

export default function Login() {
  const navigate = useNavigate();
  const { login, register } = useAuth();
  const [screen, setScreen] = useState<Screen>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const go = (s: Screen) => { setScreen(s); setError(null); setSuccess(null); setPassword(""); setNewPassword(""); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null); setSuccess(null); setLoading(true);
    try {
      if (screen === "login") { await login(email, password); navigate("/"); }
      else if (screen === "register") { await register(name, email, password); navigate("/"); }
      else {
        const res = await fetch("/api/auth/reset-password", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, new_password: newPassword }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Reset failed");
        go("login");
        setSuccess("Password updated. You can log in now.");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ss-app min-h-screen grid lg:grid-cols-2">
      {/* Brand side */}
      <div className="hidden lg:flex flex-col justify-between bg-panel p-12">
        <Wordmark />
        <div className="grid grid-cols-2 gap-4 max-w-md">
          {COLLAGE.map((src, i) => (
            <div key={src} className={cx("rounded-3xl bg-photo overflow-hidden aspect-square", i % 2 === 1 && "translate-y-8")}>
              <img src={src} alt="" className="h-full w-full object-cover" />
            </div>
          ))}
        </div>
        <div className="max-w-md">
          <h2 className="text-3xl font-semibold tracking-tight leading-tight">Everyday essentials, done well.</h2>
          <p className="text-muted mt-2 flex items-center gap-2">
            <Sparkles size={16} className="text-talk" /> Talkshop, our shopping assistant, is ready when you are.
          </p>
        </div>
      </div>

      {/* Form side */}
      <div className="flex flex-col items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm flex flex-col gap-6">
          <Wordmark className="lg:hidden self-center" />
          {screen === "reset" ? (
            <>
              <button onClick={() => go("login")} className="self-start inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
                <ArrowLeft size={15} /> Back to log in
              </button>
              <div><h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
                <p className="text-muted text-sm mt-1">Enter your email and a new password.</p></div>
            </>
          ) : (
            <>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">{screen === "login" ? "Welcome back" : "Create your account"}</h1>
                <p className="text-muted text-sm mt-1">{screen === "login" ? "Log in to ShopSphere to keep shopping." : "Save your details for faster checkout."}</p>
              </div>
              <div className="grid grid-cols-2 rounded-full bg-panel p-1 text-sm font-medium">
                {(["login", "register"] as const).map((s) => (
                  <button key={s} type="button" onClick={() => go(s)}
                    className={cx("h-9 rounded-full transition-colors", screen === s ? "bg-canvas shadow-card text-ink" : "text-muted hover:text-ink")}>
                    {s === "login" ? "Log in" : "Sign up"}
                  </button>
                ))}
              </div>
            </>
          )}

          <form onSubmit={submit} className="flex flex-col gap-4">
            {screen === "register" && <Field label="Full name" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />}
            <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            {screen !== "reset" ? (
              <div className="relative">
                <Field label="Password" type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)}
                  required minLength={8} autoComplete={screen === "login" ? "current-password" : "new-password"} />
                <button type="button" tabIndex={-1} onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"}
                  className="absolute right-3 bottom-3 text-muted hover:text-ink">{show ? <EyeOff size={17} /> : <Eye size={17} />}</button>
              </div>
            ) : (
              <Field label="New password (min 8 characters)" type="password" value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
            )}
            {success && <Notice tone="good">{success}</Notice>}
            {error && <Notice>{error}</Notice>}
            <Button type="submit" size="lg" loading={loading}>
              {screen === "login" ? "Log in" : screen === "register" ? "Create account" : "Set new password"}
            </Button>
          </form>

          {screen === "login" && (
            <>
              <button onClick={() => go("reset")} className="text-sm text-muted hover:text-ink">Forgot password?</button>
              <div className="rounded-2xl border border-dashed border-line-strong p-4 text-sm">
                <p className="font-medium">Demo account</p>
                <p className="text-muted mt-0.5">{DEMO.email} · {DEMO.password}</p>
                <button onClick={() => { setEmail(DEMO.email); setPassword(DEMO.password); }} className="mt-2 text-sm font-medium underline">
                  Use demo account
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
