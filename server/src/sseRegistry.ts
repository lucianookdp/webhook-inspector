import type { ServerResponse } from 'node:http';

// Tracks every open SSE response so a graceful shutdown can close them
// itself. Fastify no longer manages a hijacked reply (see routes/stream.js),
// so app.close() has no way to know these connections exist, let alone end
// them — without this, the process would hang waiting for sockets that are
// never going to close on their own.
const connections = new Set<ServerResponse>();

export function registerSseConnection(res: ServerResponse) {
  connections.add(res);
}

export function unregisterSseConnection(res: ServerResponse) {
  connections.delete(res);
}

export function closeAllSseConnections() {
  for (const res of connections) {
    // A named event rather than a plain message: the frontend doesn't
    // special-case it yet, so it surfaces as a closed connection like any
    // other today, but it gives future reconnect logic something to
    // distinguish "the server told me it's shutting down" from a dropped
    // network connection.
    res.write('event: shutdown\ndata: server is shutting down\n\n');
    res.end();
  }
  connections.clear();
}
