import type { EndpointInfo, RequestRow } from './types';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3001';

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
  if (!res.ok) throw new Error(`failed to create endpoint: ${res.status}`);
  return res.json();
}

export interface RequestsPage {
  items: RequestRow[];
  nextCursor: string | null;
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
