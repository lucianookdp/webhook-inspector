import type { RequestRow } from './types';

// Filters over whatever's already loaded client-side (initial page, any
// "Load more" pages, and live SSE pushes) rather than a server-side query —
// the per-endpoint cap is 500 rows, small enough that this stays instant and
// avoids re-fetching/re-syncing the list against the SSE connection's own
// lifecycle every time a filter changes.
export function matchesFilter(row: RequestRow, method: string, query: string): boolean {
  if (method && row.method.toUpperCase() !== method.trim().toUpperCase()) return false;
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  if (row.path.toLowerCase().includes(trimmed)) return true;
  if (row.body?.toLowerCase().includes(trimmed)) return true;
  if (JSON.stringify(row.headers).toLowerCase().includes(trimmed)) return true;
  if (JSON.stringify(row.query).toLowerCase().includes(trimmed)) return true;
  return false;
}
