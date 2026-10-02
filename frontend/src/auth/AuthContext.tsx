import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { authFetch, clearToken, getToken, setToken } from "../api/client";

export interface User {
  user_id: string;
  name: string;
  email: string;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  isGuest: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  loginAsGuest: (name: string, email: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const GUEST_KEY = "talkshop_guest";

async function parseAuthResponse(res: Response): Promise<{ access_token: string; user: User }> {
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || "Authentication failed");
  }
  return res.json();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(() => {
    try { return localStorage.getItem(GUEST_KEY) === "1"; } catch { return false; }
  });

  // Restore session on load, if a token was persisted from a previous visit.
  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    authFetch("/api/auth/me")
      .then((res) => {
        if (!res.ok) throw new Error("session expired");
        return res.json();
      })
      .then((data: User) => setUser(data))
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await parseAuthResponse(res);
    setToken(data.access_token);
    setUser(data.user);
  }

  async function register(name: string, email: string, password: string) {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    const data = await parseAuthResponse(res);
    setToken(data.access_token);
    setUser(data.user);
  }

  async function loginAsGuest(name: string, email: string) {
    // Auto-generate a random password — guest user never needs to remember it
    const guestPassword = `guest_${Math.random().toString(36).slice(2)}${Date.now()}`;
    let data: { access_token: string; user: User };
    // Try registering first; if email already exists (returning guest), log in
    const regRes = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password: guestPassword }),
    });
    if (regRes.ok) {
      data = await regRes.json();
    } else if (regRes.status === 409) {
      // Email already has an account — reset its password so we can log in as guest.
      // This lets a returning guest (or someone who forgot they registered) continue
      // without needing their old password.
      const resetRes = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, new_password: guestPassword }),
      });
      if (!resetRes.ok) {
        const d = await resetRes.json().catch(() => ({}));
        throw new Error(d.detail || "Could not start guest session");
      }
      const loginRes = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: guestPassword }),
      });
      data = await parseAuthResponse(loginRes);
    } else {
      // Any other registration error (server error, validation, etc.)
      const d = await regRes.json().catch(() => ({}));
      throw new Error(d.detail || "Could not start guest session. Please try again.");
    }
    setToken(data.access_token);
    setUser(data.user);
    setIsGuest(true);
    try { localStorage.setItem(GUEST_KEY, "1"); } catch { /* noop */ }
  }

  function logout() {
    clearToken();
    setUser(null);
    setIsGuest(false);
    try { localStorage.removeItem(GUEST_KEY); } catch { /* noop */ }
  }

  return (
    <AuthContext.Provider value={{ user, loading, isGuest, login, register, loginAsGuest, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
