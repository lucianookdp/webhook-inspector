-- Lets a user configure what the capture route replies with for their
-- endpoint instead of the fixed 200 "ok" — useful for testing how a real
-- sender reacts to a 4xx/5xx (retries, backoff) or a specific response
-- body. All nullable: null means "use the default" (see webhook.ts).
ALTER TABLE endpoints ADD COLUMN IF NOT EXISTS response_status smallint;
ALTER TABLE endpoints ADD COLUMN IF NOT EXISTS response_body text;
ALTER TABLE endpoints ADD COLUMN IF NOT EXISTS response_content_type text;
