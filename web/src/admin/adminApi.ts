const API_BASE = import.meta.env?.VITE_API_BASE ?? 'http://localhost:3001';

export class AdminApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface DailyStat {
  day: string;
  endpointsCreated: number;
  requestsCaptured: number;
}

export interface UsageStats {
  activeEndpoints: number;
  totalEndpointsCreated: number;
  totalRequestsCaptured: number;
  daily: DailyStat[];
}

export async function fetchUsageStats(token: string): Promise<UsageStats> {
  const res = await fetch(`${API_BASE}/api/admin/stats`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new AdminApiError(401, 'Wrong token.');
  if (res.status === 404) throw new AdminApiError(404, 'Admin stats are not enabled on this deployment.');
  if (!res.ok) throw new AdminApiError(res.status, `Failed to load stats: ${res.status}`);
  return res.json();
}
