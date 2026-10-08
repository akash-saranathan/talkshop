/**
 * authFetch() — attaches the bearer token to every request.
 * Token is persisted in localStorage so a page refresh doesn't log the user out.
 */
const TOKEN_KEY = "talkshop_token";

// Stored in sessionStorage (not localStorage) so the demo identity lives for
// the life of the tab: a refresh keeps the same session (earned/spent points
// persist), but closing/reopening or a new tab starts a fresh demo session,
// which resets the seeded demo state on the backend.
export function getToken(): string | null {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function setToken(token: string): void {
  try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* noop */ }
}

export function clearToken(): void {
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* noop */ }
}

export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, { ...options, headers });

  // No login screen: on an expired/invalid token, drop it and reload so the
  // app re-bootstraps a fresh demo session rather than bouncing to a login.
  if (res.status === 401) {
    clearToken();
    window.location.reload();
  }

  return res;
}
