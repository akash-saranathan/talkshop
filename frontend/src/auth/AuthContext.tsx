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
// The server never stores a guest's name/email (only customers' details are
// persisted), so the guest's own copy lives here — browser only — to keep
// showing their name after a page reload.
const GUEST_PROFILE_KEY = "talkshop_guest_profile";

function readGuestProfile(): Pick<User, "name" | "email"> | null {
  try { return JSON.parse(localStorage.getItem(GUEST_PROFILE_KEY) ?? "null"); } catch { return null; }
}

// Chat keeps the open conversation (and its in-progress checkout / guest
// card) in this tab's sessionStorage so navigating to Cart and back resumes
// it. Any login/logout wipes that, so every sign-in starts on a fresh chat
// and nothing carries over between accounts. Past chats stay in the sidebar.
function clearChatSessionState() {
  try {
    Object.keys(sessionStorage)
      .filter((k) => k.startsWith("talkshop_"))
      .forEach((k) => sessionStorage.removeItem(k));
  } catch { /* noop */ }
}

// Thrown by loginAsGuest when the email belongs to a registered account, so
// the login page can offer "Log in instead" rather than a generic error.
export class ExistingCustomerError extends Error {}

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
      .then((data: User) => setUser(isGuest ? { ...data, ...readGuestProfile() } : data))
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
    clearChatSessionState();
    setToken(data.access_token);
    setUser(data.user);
    setIsGuest(false);
    try { localStorage.removeItem(GUEST_KEY); localStorage.removeItem(GUEST_PROFILE_KEY); } catch { /* noop */ }
  }

  async function register(name: string, email: string, password: string) {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    const data = await parseAuthResponse(res);
    clearChatSessionState();
    setToken(data.access_token);
    setUser(data.user);
    setIsGuest(false);
    try { localStorage.removeItem(GUEST_KEY); localStorage.removeItem(GUEST_PROFILE_KEY); } catch { /* noop */ }
  }

  async function loginAsGuest(name: string, email: string) {
    // Fresh guest session (nothing about the guest is stored server-side); an
    // email that belongs to a registered customer is refused (409) so they're
    // sent to log in instead.
    const res = await fetch("/api/auth/guest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email }),
    });
    if (res.status === 409) {
      const d = await res.json().catch(() => ({}));
      throw new ExistingCustomerError(d.detail || "You're already a customer with this email. Please log in instead.");
    }
    const data = await parseAuthResponse(res);
    clearChatSessionState();
    setToken(data.access_token);
    setUser(data.user);
    setIsGuest(true);
    try {
      localStorage.setItem(GUEST_KEY, "1");
      localStorage.setItem(GUEST_PROFILE_KEY, JSON.stringify({ name: data.user.name, email: data.user.email }));
    } catch { /* noop */ }
  }

  function logout() {
    clearChatSessionState();
    clearToken();
    setUser(null);
    setIsGuest(false);
    try { localStorage.removeItem(GUEST_KEY); localStorage.removeItem(GUEST_PROFILE_KEY); } catch { /* noop */ }
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
