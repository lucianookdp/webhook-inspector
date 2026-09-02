-- Lets a user set a secret for their endpoint so the app can verify an
-- incoming webhook's HMAC signature (see signature.ts) against it. Nullable:
-- most endpoints never set one, and captured requests are just reported as
-- unconfigured rather than failing verification.
ALTER TABLE endpoints ADD COLUMN IF NOT EXISTS signing_secret text;
