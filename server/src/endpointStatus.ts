import { pool } from './db.js';

export type EndpointStatus = 'missing' | 'expired' | 'active';

export async function getEndpointStatus(id: string): Promise<EndpointStatus> {
  const { rows } = await pool.query<{ expires_at: Date }>(
    'SELECT expires_at FROM endpoints WHERE id = $1',
    [id],
  );
  if (rows.length === 0) return 'missing';
  return rows[0].expires_at.getTime() > Date.now() ? 'active' : 'expired';
}
