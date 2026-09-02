-- Lets a user pick a memorable name for their capture URL instead of only
-- the random id (routes/endpoints.ts, routes/webhook.ts). A plain UNIQUE
-- constraint already permits any number of NULLs in Postgres, so endpoints
-- that never set one don't collide with each other.
ALTER TABLE endpoints ADD COLUMN IF NOT EXISTS slug text UNIQUE;
