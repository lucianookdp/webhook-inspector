import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';
import { getEndpointStatus } from '../endpointStatus.js';
import { generateId } from '../id.js';

const ENDPOINT_TTL_MS = 24 * 60 * 60 * 1000;

export async function endpointRoutes(app: FastifyInstance) {
  app.post('/api/endpoints', async (_req, reply) => {
    const id = generateId();
    const expiresAt = new Date(Date.now() + ENDPOINT_TTL_MS);

    await pool.query('INSERT INTO endpoints (id, expires_at) VALUES ($1, $2)', [id, expiresAt]);

    reply.code(201).send({ id, expiresAt: expiresAt.toISOString() });
  });

  app.get<{ Params: { id: string } }>('/api/endpoints/:id/requests', async (req, reply) => {
    const status = await getEndpointStatus(req.params.id);
    if (status === 'missing') {
      reply.code(404).send({ error: 'endpoint not found' });
      return;
    }
    if (status === 'expired') {
      reply.code(410).send({ error: 'endpoint expired' });
      return;
    }

    const { rows } = await pool.query(
      `SELECT id, method, path, query, headers, body, body_is_binary, truncated, content_type, ip, size_bytes, received_at
       FROM requests
       WHERE endpoint_id = $1
       ORDER BY received_at DESC`,
      [req.params.id],
    );

    reply.send(rows);
  });
}
