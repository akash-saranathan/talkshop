// Calls to the merchant's account-link endpoints (simulated merchant sign-in, demo only).
import { authFetch } from "./client";

export interface LinkStatus {
  merchant_id: string;
  linked: boolean;
  expires_at?: string;
}

interface LinkResult {
  ok: boolean;
  message: string;
  events?: unknown[];
}

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await authFetch(url, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
}

export async function getLinks(): Promise<LinkStatus[]> {
  const res = await authFetch("/api/merchant-link");
  const data = await res.json();
  return data.links ?? [];
}

export const startLink = (merchantId: string, email: string) =>
  post<LinkResult & { merchant_name: string }>("/api/merchant-link/start", { merchant_id: merchantId, email });

export const verifyLink = (merchantId: string, email: string, code: string) =>
  post<LinkResult>("/api/merchant-link/verify", { merchant_id: merchantId, email, code });

export const approveLink = (merchantId: string, email: string, code: string) =>
  post<LinkResult>("/api/merchant-link/approve", { merchant_id: merchantId, email, code });

export const unlinkMerchant = (merchantId: string) =>
  post<LinkResult>(`/api/merchant-link/${merchantId}/unlink`);

export const resetLinks = () => post<LinkResult>("/api/merchant-link/reset");

export const resetPoints = () => post<LinkResult>("/api/merchant-link/reset-points");
