import { buildApp } from './app.js';
import { startExpiredEndpointCleanup } from './cleanup.js';
import * as config from './config.js';
import { pool } from './db.js';
import { startResourceUsageTracking } from './limits.js';
import { closeAllSseConnections } from './sseRegistry.js';

const app = await buildApp();

const cleanupInterval = startExpiredEndpointCleanup(app.log);
startResourceUsageTracking(app.log);

app.listen({ port: config.port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutting down');

  // app.close() stops the server accepting new connections immediately, but
  // its returned promise won't resolve until every open socket closes —
  // which includes the hijacked SSE ones Fastify no longer tracks, so
  // they're closed explicitly below rather than left for app.close() to
  // wait on forever.
  const closing = app.close();

  closeAllSseConnections();
  clearInterval(cleanupInterval);

  try {
    await closing;
  } catch (err) {
    app.log.error({ err }, 'error while closing server');
  }

  try {
    await pool.end();
  } catch (err) {
    app.log.error({ err }, 'error while closing database pool');
  }

  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
