import type { RequestRow } from './types';

// A reconnect refetches the latest page to catch up on anything missed
// while disconnected; this merges it with what's already on screen instead
// of replacing it, since older rows past that page are still valid.
export function mergeMissedRequests(existing: RequestRow[], fetched: RequestRow[]): RequestRow[] {
  const seen = new Set(existing.map((r) => r.id));
  const additions = fetched.filter((r) => !seen.has(r.id));
  if (additions.length === 0) return existing;
  return [...additions, ...existing].sort((a, b) => (a.received_at > b.received_at ? -1 : 1));
}
