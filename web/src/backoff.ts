const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;

// Full jitter: pick uniformly from [0, cap] rather than cap +/- a fixed
// spread, so a burst of clients that all dropped at once don't end up
// retrying in lockstep against the same endpoint.
export function computeBackoffDelay(attempt: number): number {
  const cap = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
  return Math.random() * cap;
}
