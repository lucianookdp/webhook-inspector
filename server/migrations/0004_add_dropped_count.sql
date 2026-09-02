-- Tracks how many of an endpoint's captured requests have been discarded
-- because it hit the per-endpoint storage cap (see webhook.ts), so the
-- frontend can say "N older requests were discarded" instead of silently
-- showing fewer rows than were actually sent.
ALTER TABLE endpoints ADD COLUMN IF NOT EXISTS dropped_count integer NOT NULL DEFAULT 0;
