-- Run once by a superuser/owner role against the database, before pointing
-- the app's DATABASE_URL at the role created here. It is not part of
-- migrate.ts: creating a role needs privileges the runtime role must not
-- have, and running it automatically on every deploy would mean storing
-- admin credentials next to the app.
--
-- After running this, MIGRATION_DATABASE_URL should use the owner/admin
-- role (whatever applied schema.sql) and DATABASE_URL should use
-- webhook_inspector_app. Replace the placeholders below first.

CREATE ROLE webhook_inspector_app WITH LOGIN PASSWORD '<choose-a-strong-password>';

GRANT CONNECT ON DATABASE <database_name> TO webhook_inspector_app;
GRANT USAGE ON SCHEMA public TO webhook_inspector_app;

-- INSERT, SELECT, DELETE only: the app doesn't otherwise update a row in
-- place, and it must not be able to run DDL (CREATE, ALTER, DROP) even if a
-- bug or a future SQL-construction mistake ever gave an attacker a way to
-- try.
GRANT SELECT, INSERT, DELETE ON endpoints, requests TO webhook_inspector_app;

-- One narrow exception: capping requests per endpoint (webhook.ts) tallies
-- how many rows it trims onto endpoints.dropped_count. A column-level grant
-- keeps this to exactly that counter — the role still can't touch id,
-- expires_at or disabled.
GRANT UPDATE (dropped_count) ON endpoints TO webhook_inspector_app;

-- A second narrow exception: a user setting or clearing their endpoint's
-- signing secret (routes/endpoints.js) updates exactly that column.
GRANT UPDATE (signing_secret) ON endpoints TO webhook_inspector_app;

-- A third: a user configuring what the capture route replies with for
-- their endpoint (routes/endpoints.js) updates exactly these three.
GRANT UPDATE (response_status, response_body, response_content_type) ON endpoints TO webhook_inspector_app;

-- No sequence grants needed: endpoints.id is an application-generated text
-- id and requests.id defaults to gen_random_uuid(), so nothing here reads
-- from a sequence.

-- Re-run the GRANT above (or add a matching line) whenever schema.sql adds
-- a table the app needs to read or write.
