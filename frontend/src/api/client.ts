/**
 * authFetch() — attaches the bearer token to every request.
 * Token is persisted in localStorage so a page refresh doesn't log the user out.
 */
const TOKEN_KEY = "talkshop_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, { ...options, headers });

  if (res.status === 401 && !window.location.pathname.startsWith("/login")) {
    clearToken();
    window.location.href = "/login";
  }

  return res;
}
