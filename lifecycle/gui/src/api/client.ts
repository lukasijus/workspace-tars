import type { ApplicationDetail, DashboardData, Id } from "../types";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.error || `Request failed with HTTP ${response.status}`,
    );
  }

  return payload as T;
}

function post<T>(url: string, body: Record<string, unknown> = {}) {
  return requestJson<T>(url, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchDashboard() {
  return requestJson<DashboardData>("/api/dashboard");
}

export async function fetchApplication(id: Id) {
  const response = await requestJson<{ ok: true; detail: ApplicationDetail }>(
    `/api/applications/${id}`,
  );
  return response.detail;
}

export function approveApplication(id: Id) {
  return post<{ ok: true; detail: ApplicationDetail }>(`/api/applications/${id}/approve`);
}

export function rejectApplication(id: Id) {
  return post<{ ok: true; detail: ApplicationDetail }>(`/api/applications/${id}/reject`);
}

export function retryDiscovery(id: Id) {
  return post<{ ok: true; detail: ApplicationDetail }>(`/api/applications/${id}/retry-discovery`);
}

export function retryDiscoveryAll() {
  return post<{ ok: true; attempted: number }>("/api/retry-discovery-all");
}

export function markInactive(id: Id, reason?: string) {
  return post<{ ok: true; detail: ApplicationDetail }>(
    `/api/applications/${id}/mark-inactive`,
    { reason },
  );
}

export function markSubmitted(id: Id) {
  return post<{ ok: true; detail: ApplicationDetail }>(
    `/api/applications/${id}/mark-submitted`,
  );
}

export function submitApproved() {
  return post<{ ok: true; result: unknown }>("/api/submit-approved");
}

export function submitOne(id: Id) {
  return post<{ ok: true; detail: ApplicationDetail; result: unknown }>(
    `/api/applications/${id}/submit`,
  );
}
