import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { authFetch, clearToken, getToken, setToken } from "../api/client";

// Opened from a link the MCP connector returns. Payment only happens when the
// customer presses GO AHEAD here; nothing is charged on load. This page signs in
// on its own, because the checkout belongs to one specific TalkShop account.

type PaymentMethod = { payment_method_id: string; display: string; is_default: boolean };

type CheckoutDoc = {
  checkout_id: string;
  checkout_hash: string;
  merchant_name: string;
  product_title: string;
  quantity: number;
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
  currency: string;
};

type Loaded = { status: string; checkout: CheckoutDoc; payment_methods: PaymentMethod[] };

type GoAheadResult = { status: string; reason?: string; message?: string };

export default function Approve() {
  const { checkoutId } = useParams<{ checkoutId: string }>();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [loginNote, setLoginNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paymentMethodId, setPaymentMethodId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GoAheadResult | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Login form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    if (!checkoutId) return;
    if (!getToken()) {
      setNeedsLogin(true);
      return;
    }
    authFetch(`/api/purchase/checkouts/${encodeURIComponent(checkoutId)}`)
      .then(async (res) => {
        if (res.status === 401) throw new Error("SIGN_IN");
        if (res.status === 404) {
          throw new Error("WRONG_ACCOUNT");
        }
        if (!res.ok) throw new Error("This checkout could not be loaded. Try again.");
        return (await res.json()) as Loaded;
      })
      .then((data) => {
        setLoaded(data);
        setNeedsLogin(false);
        const preferred = data.payment_methods.find((m) => m.is_default) ?? data.payment_methods[0];
        setPaymentMethodId(preferred?.payment_method_id ?? "");
      })
      .catch((e: Error) => {
        if (e.message === "SIGN_IN") {
          setNeedsLogin(true);
        } else if (e.message === "WRONG_ACCOUNT") {
          setNeedsLogin(true);
          setLoginNote("This checkout is not on the account you are signed in with. Sign in with the account that made the proposal.");
        } else {
          setError(e.message);
        }
      });
  }, [checkoutId, reloadKey]);

  async function signIn(e: FormEvent) {
    e.preventDefault();
    setLoginError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      setLoginError("Incorrect email or password.");
      return;
    }
    const data = (await res.json()) as { access_token: string };
    setToken(data.access_token);
    setPassword("");
    setLoginNote(null);
    setReloadKey((k) => k + 1);
  }

  function switchAccount() {
    clearToken();
    setLoaded(null);
    setResult(null);
    setLoginNote(null);
    setNeedsLogin(true);
  }

  async function goAhead() {
    if (!loaded || !paymentMethodId) return;
    setBusy(true);
    setResult(null);
    try {
      const { checkout } = loaded;
      const res = await authFetch("/api/purchase/go-ahead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkout_id: checkout.checkout_id,
          checkout_hash: checkout.checkout_hash,
          total: checkout.total,
          currency: checkout.currency,
          payment_method_id: paymentMethodId,
          consent_mode: "click",
        }),
      });
      setResult((await res.json()) as GoAheadResult);
    } catch {
      setResult({ status: "error", message: "Could not reach TalkShop. Try again." });
    } finally {
      setBusy(false);
    }
  }

  if (error) return <Shell><p>{error}</p></Shell>;

  if (needsLogin) {
    return (
      <Shell>
        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 12 }}>Sign in to approve</h1>
        {loginNote && <p style={{ color: "#b00020" }}>{loginNote}</p>}
        <form onSubmit={signIn}>
          <label style={{ display: "block", marginBottom: 12 }}>
            Email<br />
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={{ width: "100%", padding: 8 }} />
          </label>
          <label style={{ display: "block", marginBottom: 12 }}>
            Password<br />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required style={{ width: "100%", padding: 8 }} />
          </label>
          {loginError && <p style={{ color: "#b00020" }}>{loginError}</p>}
          <button type="submit" style={{ padding: "10px 20px", fontWeight: 600 }}>Sign in</button>
        </form>
      </Shell>
    );
  }

  if (!loaded) return <Shell><p>Loading checkout…</p></Shell>;

  const { checkout } = loaded;
  const alreadyDone = loaded.status !== "proposed";

  return (
    <Shell>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 12 }}>Approve purchase</h1>
      <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <div><strong>{checkout.product_title}</strong> × {checkout.quantity}</div>
        <div>Merchant: {checkout.merchant_name}</div>
        <div>Subtotal: {checkout.subtotal.toFixed(2)} {checkout.currency}</div>
        <div>Shipping: {checkout.shipping.toFixed(2)} {checkout.currency}</div>
        <div>Tax: {checkout.tax.toFixed(2)} {checkout.currency}</div>
        <div style={{ marginTop: 8, fontWeight: 600 }}>
          Total: {checkout.total.toFixed(2)} {checkout.currency}
        </div>
      </div>

      {alreadyDone ? (
        <p>This checkout is already {loaded.status.replace(/_/g, " ")}.</p>
      ) : loaded.payment_methods.length === 0 ? (
        <p>No saved card for this merchant. Add one in TalkShop first.</p>
      ) : (
        <>
          <label style={{ display: "block", marginBottom: 12 }}>
            Pay with{" "}
            <select value={paymentMethodId} onChange={(e) => setPaymentMethodId(e.target.value)} disabled={busy}>
              {loaded.payment_methods.map((m) => (
                <option key={m.payment_method_id} value={m.payment_method_id}>{m.display}</option>
              ))}
            </select>
          </label>
          <button onClick={goAhead} disabled={busy || !paymentMethodId} style={{ padding: "10px 20px", fontWeight: 600 }}>
            {busy ? "Paying…" : "GO AHEAD"}
          </button>
        </>
      )}

      {result && (
        <p style={{ marginTop: 16 }}>
          {result.status === "approved"
            ? "Payment complete. Your order is confirmed."
            : result.message ?? result.reason ?? `Status: ${result.status}`}
        </p>
      )}

      <p style={{ marginTop: 24 }}>
        <button onClick={switchAccount} style={{ background: "none", border: "none", color: "#555", textDecoration: "underline", cursor: "pointer", padding: 0 }}>
          Not your account? Sign in with a different account
        </button>
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div style={{ maxWidth: 520, margin: "40px auto", padding: "0 16px", fontFamily: "system-ui, sans-serif" }}>{children}</div>;
}
