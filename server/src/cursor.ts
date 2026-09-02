export interface RequestCursor {
  receivedAt: string;
  id: string;
}

export function encodeCursor(row: { received_at: Date | string; id: string }): string {
  const receivedAt = row.received_at instanceof Date ? row.received_at.toISOString() : row.received_at;
  return Buffer.from(JSON.stringify({ receivedAt, id: row.id })).toString('base64url');
}

export function decodeCursor(raw: string): RequestCursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf-8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as RequestCursor).receivedAt === 'string' &&
      typeof (parsed as RequestCursor).id === 'string'
    ) {
      return parsed as RequestCursor;
    }
    return null;
  } catch {
    return null;
  }
}
