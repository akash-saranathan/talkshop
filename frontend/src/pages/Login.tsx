import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Loader, Store, Eye, EyeOff, ArrowLeft } from "lucide-react";
import { useAuth } from "../auth/AuthContext";

type Screen = "login" | "register" | "reset";

export default function Login() {
  const navigate = useNavigate();
  const { login, register } = useAuth();
  const [screen, setScreen] = useState<Screen>("login");
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
      } else {
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
          {screen === "reset" ? (
            <motion.div key="reset" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <button
                type="button"
                onClick={() => { setScreen("login"); reset(); }}
                className="flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-primary)] mb-4 transition-colors"
              >
                <ArrowLeft size={14} /> Back to log in
              </button>
              <h2 className="font-semibold text-[var(--color-text)] mb-1">Reset Password</h2>
              <p className="text-xs text-[var(--color-text-muted)] mb-4">Enter your email and a new password.</p>
              <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Your email"
                  required
                  className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-2.5 text-sm outline-none focus:border-[var(--color-primary)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]"
                />
                <div className="relative">
                  <input
                    type={showNew ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="New password (min 8 chars)"
                    required
                    minLength={8}
                    className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-2.5 pr-10 text-sm outline-none focus:border-[var(--color-primary)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]"
                  />
                  <button type="button" tabIndex={-1} onClick={() => setShowNew((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-primary)]">
                    {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {error && <p className="text-sm text-rose-500 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p>}
                <button type="submit" disabled={loading}
                  className="mt-1 py-2.5 rounded-xl bg-[var(--color-primary)] text-white font-medium text-sm hover:bg-[var(--color-primary-light)] disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                  {loading && <Loader size={14} className="animate-spin" />}
                  Set New Password
                </button>
              </form>
            </motion.div>
          ) : (
            <motion.div key="auth" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {/* Tab switcher */}
              <div className="flex rounded-xl border border-[var(--color-border)] p-1 mb-5 text-sm">
                {(["login", "register"] as const).map((s) => (
                  <button key={s} type="button"
                    onClick={() => { setScreen(s); reset(); }}
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
                    placeholder="Full name" required
                    className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-2.5 text-sm outline-none focus:border-[var(--color-primary)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]" />
                )}
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email" required
                  className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-2.5 text-sm outline-none focus:border-[var(--color-primary)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]" />
                <div className="relative">
                  <input type={showPassword ? "text" : "password"} value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password" required minLength={8}
                    className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-2.5 pr-10 text-sm outline-none focus:border-[var(--color-primary)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]" />
                  <button type="button" tabIndex={-1} onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-primary)]">
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>

                {success && <p className="text-sm text-[var(--color-success)] bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{success}</p>}
                {error && <p className="text-sm text-rose-500 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p>}

                <button type="submit" disabled={loading}
                  className="mt-1 py-2.5 rounded-xl bg-[var(--color-primary)] text-white font-medium text-sm hover:bg-[var(--color-primary-light)] disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
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
