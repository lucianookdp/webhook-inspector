import { pool } from './db.js';

export type EndpointStatus = 'missing' | 'expired' | 'disabled' | 'active';

export interface EndpointStatusResult {
  status: EndpointStatus;
  droppedCount: number;
}

export async function getEndpointStatus(id: string): Promise<EndpointStatusResult> {
  const { rows } = await pool.query<{ expires_at: Date; disabled: boolean; dropped_count: number }>(
    'SELECT expires_at, disabled, dropped_count FROM endpoints WHERE id = $1',
    [id],
  );
  if (rows.length === 0) return { status: 'missing', droppedCount: 0 };

  const { expires_at, disabled, dropped_count } = rows[0];
  if (expires_at.getTime() <= Date.now()) return { status: 'expired', droppedCount: dropped_count };
  if (disabled) return { status: 'disabled', droppedCount: dropped_count };
  return { status: 'active', droppedCount: dropped_count };
}
