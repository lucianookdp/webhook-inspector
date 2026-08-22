import { EventEmitter } from 'node:events';
import type { RequestRow } from './types.js';

// In-memory pub/sub is enough because this runs as a single process; the
// database (not this emitter) is the source of truth for anyone who wasn't
// connected when a request arrived.
const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export function publishRequest(endpointId: string, row: RequestRow) {
  emitter.emit(endpointId, row);
}

export function subscribeToRequests(endpointId: string, listener: (row: RequestRow) => void) {
  emitter.on(endpointId, listener);
  return () => emitter.off(endpointId, listener);
}
