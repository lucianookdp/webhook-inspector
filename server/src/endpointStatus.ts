import { pool } from './db.js';

export type EndpointStatus = 'missing' | 'expired' | 'disabled' | 'active';

export async function getEndpointStatus(id: string): Promise<EndpointStatus> {
  const { rows } = await pool.query<{ expires_at: Date; disabled: boolean }>(
    'SELECT expires_at, disabled FROM endpoints WHERE id = $1',
    [id],
  );
  if (rows.length === 0) return 'missing';
  if (rows[0].expires_at.getTime() <= Date.now()) return 'expired';
  if (rows[0].disabled) return 'disabled';
  return 'active';
}
