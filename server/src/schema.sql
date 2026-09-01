CREATE TABLE IF NOT EXISTS endpoints (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id text NOT NULL REFERENCES endpoints (id) ON DELETE CASCADE,
  method text NOT NULL,
  path text NOT NULL,
  query jsonb NOT NULL DEFAULT '{}'::jsonb,
  headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  body text,
  body_is_binary boolean NOT NULL DEFAULT false,
  truncated boolean NOT NULL DEFAULT false,
  content_type text,
  ip text,
  size_bytes integer NOT NULL DEFAULT 0,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS requests_endpoint_id_received_at_idx
  ON requests (endpoint_id, received_at DESC);

ALTER TABLE requests ADD COLUMN IF NOT EXISTS truncated boolean NOT NULL DEFAULT false;

-- Lets an operator stop a specific endpoint from accepting new captures
-- immediately (e.g. in response to an abuse report), without waiting for
-- its 24-hour expiry. Flipped by direct database access — see the README's
-- abuse handling section — there's deliberately no public API for it.
ALTER TABLE endpoints ADD COLUMN IF NOT EXISTS disabled boolean NOT NULL DEFAULT false;
