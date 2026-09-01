import 'dotenv/config';

// Centralises environment parsing so every setting is validated once, at
// startup, instead of scattered `process.env.X` reads each with their own
// (or missing) fallback. A handful of these silently defaulting to
// something permissive would be a real vulnerability — WEB_ORIGIN above
// all, since `?? true`/`?? '*'` reflects or allows any origin — so in
// production those are required and the process refuses to boot rather than
// start in a state that's quietly wide open.

const nodeEnv = process.env.NODE_ENV ?? 'development';
export const isProduction = nodeEnv === 'production';

function fail(message: string): never {
  console.error(`Configuration error: ${message}`);
  process.exit(1);
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) fail(`${name} is required.`);
  return value;
}

function requiredInProduction(name: string): string | undefined {
  const value = process.env[name];
  if (value) return value;
  if (isProduction) fail(`${name} is required when NODE_ENV=production.`);
  return undefined;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) fail(`${name} must be a number, got "${raw}".`);
  return n;
}

const webOriginEnv = requiredInProduction('WEB_ORIGIN');
// `true` tells @fastify/cors to reflect whatever Origin header the caller
// sent, i.e. allow any origin — acceptable for local development, where
// "any origin" isn't a meaningful attack surface, but never in production;
// requiredInProduction above already refused to boot before this line is
// reached if NODE_ENV=production and WEB_ORIGIN is unset.
export const webOrigin: string | true = webOriginEnv ?? true;
if (webOriginEnv === undefined) {
  console.warn('WEB_ORIGIN not set — reflecting any origin for CORS. Only acceptable in development.');
}

export const port = int('PORT', 3000);
export const databaseUrl = required('DATABASE_URL');
export const redisUrl = process.env.REDIS_URL;

// Comma-separated IP/CIDR of the reverse proxy actually in front of this
// process; see index.js for why a bare hop count isn't accepted here.
export const trustProxy = (process.env.TRUST_PROXY ?? '127.0.0.1,::1').split(',').map((entry) => entry.trim());

export const maxLiveEndpoints = int('MAX_LIVE_ENDPOINTS', 5000);
export const maxTotalStoredBytes = int('MAX_TOTAL_STORED_BYTES', 2 * 1024 * 1024 * 1024);
export const databasePoolMax = int('DATABASE_POOL_MAX', 10);
export const databaseStatementTimeoutMs = int('DATABASE_STATEMENT_TIMEOUT_MS', 5000);
