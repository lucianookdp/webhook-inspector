ALTER TABLE requests ADD COLUMN IF NOT EXISTS truncated boolean NOT NULL DEFAULT false;
