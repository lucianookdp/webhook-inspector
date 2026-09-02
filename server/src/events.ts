import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { FastifyBaseLogger } from 'fastify';
import { Client } from 'pg';
import * as config from './config.js';
import { pool } from './db.js';
import { buildDatabaseSsl } from './tls.js';
import type { RequestRow } from './types.js';

// Local pub/sub covers same-process subscribers instantly. Running more than
// one instance (e.g. scaled out on a platform like Fly.io) needs a second
// path so a request captured on instance A also reaches an SSE client
// connected to instance B: publishRequest additionally NOTIFYs a fixed
// Postgres channel, and every instance LISTENs on it, looks the row up by
// id, and re-emits it locally — the database is already the shared state
// every instance can see, so it doubles as the fan-out bus.
const emitter = new EventEmitter();
emitter.setMaxListeners(0);

// Exported for tests, which simulate another instance by NOTIFYing this
// channel directly rather than going through publishRequest.
export const CHANNEL = 'webhook_inspector_requests';
const RECONNECT_DELAY_MS = 2000;

// NOTIFY delivers back to the sending session too if it's LISTENing on the
// same channel — tagging our own notifications lets us skip the redundant
// row lookup for the instance that already emitted locally at publish time.
const instanceId = randomUUID();

interface NotifyPayload {
  instanceId: string;
  endpointId: string;
  requestId: string;
}

function parsePayload(payload: string | undefined): NotifyPayload | undefined {
  if (!payload) return undefined;
  try {
    const parsed = JSON.parse(payload) as Partial<NotifyPayload>;
    if (
      typeof parsed.instanceId === 'string' &&
      typeof parsed.endpointId === 'string' &&
      typeof parsed.requestId === 'string'
    ) {
      return parsed as NotifyPayload;
    }
  } catch {
    // Ignore a payload that isn't the JSON this process writes — nothing on
    // this channel should come from anywhere else, but a malformed message
    // is just a missed local re-emit, not worth crashing over.
  }
  return undefined;
}

async function handleNotification(rawPayload: string | undefined, log: FastifyBaseLogger) {
  const payload = parsePayload(rawPayload);
  if (!payload || payload.instanceId === instanceId) return;

  try {
    const { rows } = await pool.query<RequestRow>(
      `SELECT id, method, path, query, headers, body, body_is_binary, truncated, content_type, ip, size_bytes, received_at
       FROM requests WHERE id = $1 AND endpoint_id = $2`,
      [payload.requestId, payload.endpointId],
    );
    const row = rows[0];
    if (row) emitter.emit(payload.endpointId, row);
  } catch (err) {
    // The row lookup failing just means this instance's own SSE clients
    // miss one live update; they still see it on their next history fetch
    // or reconnect (see web/src/App.tsx's catch-up fetch), so this is
    // logged and dropped rather than retried.
    log.error({ err }, 'failed to look up notified request');
  }
}

let client: Client | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let stopped = true;

async function connectAndListen(log: FastifyBaseLogger): Promise<Client> {
  const c = new Client({
    connectionString: config.databaseUrl,
    ssl: buildDatabaseSsl(config.databaseUrl, {
      insecureTls: config.databaseInsecureTls,
      caCert: config.databaseCaCert,
    }),
  });
  c.on('error', (err) => log.warn({ err }, 'event listener connection error'));
  c.on('notification', (msg) => void handleNotification(msg.payload, log));
  await c.connect();
  await c.query(`LISTEN ${CHANNEL}`);
  return c;
}

function scheduleReconnect(log: FastifyBaseLogger) {
  if (stopped) return;
  reconnectTimer = setTimeout(() => void attemptConnect(log), RECONNECT_DELAY_MS);
}

// Never throws: a failed attempt logs and schedules a retry rather than
// propagating, so a caller awaiting the very first attempt (see
// startEventListener) doesn't need its own error handling for something
// that already recovers on its own.
async function attemptConnect(log: FastifyBaseLogger): Promise<void> {
  try {
    const c = await connectAndListen(log);
    client = c;
    // Registered only after a successful connect, so a failed attempt below
    // can schedule its own retry without this also firing for the same drop.
    c.once('end', () => {
      client = undefined;
      scheduleReconnect(log);
    });
  } catch (err) {
    log.warn({ err }, 'could not start event listener, will retry');
    scheduleReconnect(log);
  }
}

// Awaited by index.js before accepting traffic, so the very first requests
// aren't the ones most likely to race a not-yet-established LISTEN
// connection. Resolves either way — a failed first attempt is logged and
// retried in the background rather than blocking startup on it.
export function startEventListener(log: FastifyBaseLogger): Promise<void> {
  stopped = false;
  return attemptConnect(log);
}

export async function stopEventListener(): Promise<void> {
  stopped = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  if (client) {
    await client.end().catch(() => {});
    client = undefined;
  }
}

export function publishRequest(endpointId: string, row: RequestRow) {
  const payload: NotifyPayload = { instanceId, endpointId, requestId: row.id };
  void pool.query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify(payload)]).catch(() => {
    // Best-effort fan-out to other instances; the local emit below still
    // reaches this instance's own subscribers even if NOTIFY itself fails.
  });
  emitter.emit(endpointId, row);
}

export function subscribeToRequests(endpointId: string, listener: (row: RequestRow) => void) {
  emitter.on(endpointId, listener);
  return () => emitter.off(endpointId, listener);
}
