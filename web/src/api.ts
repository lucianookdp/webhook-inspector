import type { EndpointInfo, RequestRow } from './types';

// import.meta.env only exists under Vite; the node:test runner (tsx --test)
// loads this file directly outside that environment now that RequestDetail
// pulls it in, so env itself — not just the property on it — can be
// undefined here.
const API_BASE = import.meta.env?.VITE_API_BASE ?? 'http://localhost:3001';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function endpointUrl(id: string): string {
  return `${API_BASE}/w/${id}`;
}

export async function createEndpoint(): Promise<EndpointInfo> {
  const res = await fetch(`${API_BASE}/api/endpoints`, { method: 'POST' });
  if (!res.ok) throw new ApiError(res.status, `failed to create endpoint: ${res.status}`);
  return res.json();
}

export interface ResponseConfig {
  status: number | null;
  body: string | null;
  contentType: string | null;
}

export interface RequestsPage {
  items: RequestRow[];
  nextCursor: string | null;
  droppedCount: number;
  signingSecretConfigured: boolean;
  responseConfig: ResponseConfig;
}

export async function fetchRequests(endpointId: string, cursor?: string): Promise<RequestsPage> {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  const query = params.toString();
  const res = await fetch(`${API_BASE}/api/endpoints/${endpointId}/requests${query ? `?${query}` : ''}`);
  if (!res.ok) throw new ApiError(res.status, `failed to fetch requests: ${res.status}`);
  return res.json();
}

export function streamUrl(endpointId: string): string {
  return `${API_BASE}/api/endpoints/${endpointId}/stream`;
}

export async function setSigningSecret(endpointId: string, secret: string | null): Promise<void> {
  const res = await fetch(`${API_BASE}/api/endpoints/${endpointId}/signing-secret`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret }),
  });
  if (!res.ok) throw new ApiError(res.status, `failed to update signing secret: ${res.status}`);
}

export async function setResponseConfig(endpointId: string, config: ResponseConfig): Promise<void> {
  const res = await fetch(`${API_BASE}/api/endpoints/${endpointId}/response-config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new ApiError(res.status, `failed to update response config: ${res.status}`);
}

export interface ForwardResult {
  status: number;
  headers: Record<string, string>;
  body: string;
  bodyTruncated: boolean;
  durationMs: number;
}

export async function forwardRequest(endpointId: string, requestId: string, url: string): Promise<ForwardResult> {
  const res = await fetch(`${API_BASE}/api/endpoints/${endpointId}/requests/${requestId}/forward`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  const data = await res.json().catch(() => undefined);
  if (!res.ok) {
    const message = data && typeof data.error === 'string' ? data.error : `failed to forward: ${res.status}`;
    throw new ApiError(res.status, message);
  }
  return data as ForwardResult;
}
