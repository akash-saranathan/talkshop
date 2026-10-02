import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Loader, Store, Eye, EyeOff, ArrowLeft, UserCheck, UserPlus } from "lucide-react";
import { useAuth } from "../auth/AuthContext";

type Screen = "landing" | "login" | "register" | "guest" | "reset";

export default function Login() {
  const navigate = useNavigate();
  const { login, register, loginAsGuest } = useAuth();
  const [screen, setScreen] = useState<Screen>("landing");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const reset = () => { setError(null); setSuccess(null); setPassword(""); setNewPassword(""); };
  const goBack = () => { setScreen("landing"); reset(); };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      if (screen === "login") {
        await login(email, password);
        navigate("/");
      } else if (screen === "register") {
        await register(name, email, password);
        navigate("/");
      } else if (screen === "guest") {
        if (!name.trim()) throw new Error("Please enter your name");
        await loginAsGuest(name.trim(), email.trim());
        navigate("/");
      } else if (screen === "reset") {
        const res = await fetch("/api/auth/reset-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, new_password: newPassword }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.detail || "Reset failed");
        }
        setSuccess("Password updated! You can now log in.");
        setScreen("login");
        setPassword("");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const inputCls = "rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-2.5 text-sm outline-none focus:border-[var(--color-primary)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] w-full";

  return (
    <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8"
      >
        {/* Logo */}
        <div className="flex flex-col items-center gap-2 mb-6">
          <div className="w-12 h-12 rounded-xl bg-[var(--color-primary)] text-white grid place-items-center">
            <Store size={22} />
          </div>
          <h1 className="text-xl font-bold text-[var(--color-primary)]">Talkshop</h1>
          <p className="text-sm text-[var(--color-text-muted)]">Your AI shopping assistant</p>
        </div>

        <AnimatePresence mode="wait">

          {/* ── Landing ──────────────────────────────────────────────────────── */}
          {screen === "landing" && (
            <motion.div key="landing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-3">
              <p className="text-sm text-center text-[var(--color-text-muted)] mb-1">How would you like to continue?</p>

              {/* Known Customer */}
              <button
                onClick={() => { reset(); setScreen("login"); }}
                className="w-full flex items-start gap-4 p-4 rounded-xl border-2 border-[var(--color-primary)] bg-[var(--color-primary)]/5 hover:bg-[var(--color-primary)]/10 transition-colors text-left group"
              >
                <div className="w-10 h-10 rounded-full bg-[var(--color-primary)] text-white grid place-items-center shrink-0 mt-0.5">
                  <UserCheck size={18} />
                </div>
                <div>
                  <p className="text-sm font-bold text-[var(--color-text)] group-hover:text-[var(--color-primary)] transition-colors">Returning Customer</p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Log in with your account — your saved cards and order history are ready</p>
                </div>
              </button>

              {/* Guest */}
              <button
                onClick={() => { reset(); setScreen("guest"); }}
                className="w-full flex items-start gap-4 p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-primary)]/50 hover:bg-[var(--color-surface-2)] transition-colors text-left group"
              >
                <div className="w-10 h-10 rounded-full border-2 border-[var(--color-border)] text-[var(--color-text-muted)] grid place-items-center shrink-0 mt-0.5 group-hover:border-[var(--color-primary)] group-hover:text-[var(--color-primary)] transition-colors">
                  <UserPlus size={18} />
                </div>
                <div>
                  <p className="text-sm font-bold text-[var(--color-text)]">Continue as Guest</p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Browse and buy without an account — enter your card at checkout</p>
                </div>
              </button>

              <button
                onClick={() => { reset(); setScreen("register"); }}
                className="text-xs text-center text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors mt-1"
              >
                New here? Create an account →
              </button>
            </motion.div>
          )}

          {/* ── Guest flow ──────────────────────────────────────────────────── */}
          {screen === "guest" && (
            <motion.div key="guest" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <button type="button" onClick={goBack}
                className="flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-primary)] mb-4 transition-colors">
                <ArrowLeft size={14} /> Back
              </button>
              <h2 className="font-semibold text-[var(--color-text)] mb-0.5">Continue as Guest</h2>
              <p className="text-xs text-[var(--color-text-muted)] mb-4">Just your name and email — you'll enter payment details at checkout.</p>
              <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                <input value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="Your name" required className={inputCls} />
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email address" required className={inputCls} />
                {error && <p className="text-sm text-rose-500 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p>}
                <button type="submit" disabled={loading}
                  className="mt-1 py-2.5 rounded-xl bg-[var(--color-primary)] text-white font-medium text-sm hover:bg-[var(--color-primary-dark)] disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                  {loading && <Loader size={14} className="animate-spin" />}
                  Start Shopping
                </button>
              </form>
            </motion.div>
          )}

          {/* ── Password reset ───────────────────────────────────────────────── */}
          {screen === "reset" && (
            <motion.div key="reset" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <button type="button" onClick={() => { setScreen("login"); reset(); }}
                className="flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-primary)] mb-4 transition-colors">
                <ArrowLeft size={14} /> Back to log in
              </button>
              <h2 className="font-semibold text-[var(--color-text)] mb-1">Reset Password</h2>
              <p className="text-xs text-[var(--color-text-muted)] mb-4">Enter your email and a new password.</p>
              <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="Your email" required className={inputCls} />
                <div className="relative">
                  <input type={showNew ? "text" : "password"} value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="New password (min 8 chars)" required minLength={8}
                    className={inputCls + " pr-10"} />
                  <button type="button" tabIndex={-1} onClick={() => setShowNew((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-primary)]">
                    {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {error && <p className="text-sm text-rose-500 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p>}
                <button type="submit" disabled={loading}
                  className="mt-1 py-2.5 rounded-xl bg-[var(--color-primary)] text-white font-medium text-sm hover:bg-[var(--color-primary-dark)] disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                  {loading && <Loader size={14} className="animate-spin" />}
                  Set New Password
                </button>
              </form>
            </motion.div>
          )}

          {/* ── Login / Register ─────────────────────────────────────────────── */}
          {(screen === "login" || screen === "register") && (
            <motion.div key="auth" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <button type="button" onClick={goBack}
                className="flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-primary)] mb-4 transition-colors">
                <ArrowLeft size={14} /> Back
              </button>

              {/* Tab switcher */}
              <div className="flex rounded-xl border border-[var(--color-border)] p-1 mb-5 text-sm">
                {(["login", "register"] as const).map((s) => (
                  <button key={s} type="button" onClick={() => { setScreen(s); reset(); }}
                    className={`flex-1 py-1.5 rounded-lg font-medium transition-colors ${
                      screen === s ? "bg-[var(--color-primary)] text-white" : "text-[var(--color-text-muted)]"
                    }`}>
                    {s === "login" ? "Log in" : "Sign up"}
                  </button>
                ))}
              </div>

              <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                {screen === "register" && (
                  <input value={name} onChange={(e) => setName(e.target.value)}
                    placeholder="Full name" required className={inputCls} />
                )}
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email" required className={inputCls} />
                <div className="relative">
                  <input type={showPassword ? "text" : "password"} value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password" required minLength={8}
                    className={inputCls + " pr-10"} />
                  <button type="button" tabIndex={-1} onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-primary)]">
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>

                {success && <p className="text-sm text-[var(--color-success)] bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{success}</p>}
                {error && <p className="text-sm text-rose-500 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p>}

                <button type="submit" disabled={loading}
                  className="mt-1 py-2.5 rounded-xl bg-[var(--color-primary)] text-white font-medium text-sm hover:bg-[var(--color-primary-dark)] disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                  {loading && <Loader size={14} className="animate-spin" />}
                  {screen === "login" ? "Log in" : "Create account"}
                </button>
              </form>

              {screen === "login" && (
                <button type="button" onClick={() => { setScreen("reset"); reset(); }}
                  className="w-full text-xs text-[var(--color-text-muted)] hover:text-[var(--color-primary)] text-center mt-4 transition-colors">
                  Forgot password?
                </button>
              )}
            </motion.div>
          )}

        </AnimatePresence>
      </motion.div>
    </div>
  );
}
