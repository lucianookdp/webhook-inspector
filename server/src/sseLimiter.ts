// Each open SSE connection holds a socket and a heartbeat interval, so
// without a cap a client could exhaust either by opening connections in a
// loop — against one endpoint, or spread across many from a single IP.
const MAX_CONNECTIONS_PER_ENDPOINT = 5;
const MAX_CONNECTIONS_PER_IP = 20;

const byEndpoint = new Map<string, number>();
const byIp = new Map<string, number>();

function increment(counts: Map<string, number>, key: string) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function decrement(counts: Map<string, number>, key: string) {
  const next = (counts.get(key) ?? 0) - 1;
  if (next <= 0) counts.delete(key);
  else counts.set(key, next);
}

export function tryAcquireSseSlot(endpointId: string, ip: string): boolean {
  if ((byEndpoint.get(endpointId) ?? 0) >= MAX_CONNECTIONS_PER_ENDPOINT) return false;
  if ((byIp.get(ip) ?? 0) >= MAX_CONNECTIONS_PER_IP) return false;
  increment(byEndpoint, endpointId);
  increment(byIp, ip);
  return true;
}

export function releaseSseSlot(endpointId: string, ip: string) {
  decrement(byEndpoint, endpointId);
  decrement(byIp, ip);
}
