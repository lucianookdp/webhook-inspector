-- Lets an operator stop a specific endpoint from accepting new captures
-- immediately (e.g. in response to an abuse report), without waiting for
-- its 24-hour expiry. Flipped by direct database access — see the README's
-- abuse handling section — there's deliberately no public API for it.
ALTER TABLE endpoints ADD COLUMN IF NOT EXISTS disabled boolean NOT NULL DEFAULT false;
