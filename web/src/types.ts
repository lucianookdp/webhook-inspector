export interface EndpointInfo {
  id: string;
  expiresAt: string;
}

export interface RequestRow {
  id: string;
  method: string;
  path: string;
  query: Record<string, unknown>;
  headers: Record<string, string>;
  body: string | null;
  body_is_binary: boolean;
  truncated: boolean;
  content_type: string | null;
  ip: string | null;
  size_bytes: number;
  received_at: string;
}
