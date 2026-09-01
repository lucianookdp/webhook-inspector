# portaria

A disposable webhook inspector: generate a URL, register it with any service that fires webhooks, and watch requests arrive in real time with their full content formatted.

![portaria](screenshot.png)

## Running locally

Requirements: Node 20+, a Postgres database (this project targets [Neon](https://neon.tech)).

`server/.env`:

```
DATABASE_URL=postgres://user:password@host/dbname?sslmode=require
PORT=3001
TRUST_PROXY=127.0.0.1,::1
REDIS_URL=redis://localhost:6379
```

`REDIS_URL` backs rate limiting with Redis so limits survive a restart and
are shared across instances, rather than each process tracking its own
in-memory counters. It's optional locally (rate limiting falls back to
in-memory with a startup warning) but should be set for any deployment
running more than one instance.

`MAX_LIVE_ENDPOINTS` and `MAX_TOTAL_STORED_BYTES` are absolute ceilings,
independent of the per-IP rate limits: a flood spread across many IPs (or
many distinct endpoints) would sail past those but could still fill the
database and run up a hosting bill. Once either is reached, new endpoints
or captures are rejected with `503` until usage drops below the ceiling
again (endpoints expiring is what makes that happen).

`TRUST_PROXY` is a comma-separated list of the reverse proxy IP(s)/CIDR(s)
actually in front of this process; only an `X-Forwarded-For` relayed by one
of those addresses is trusted. It gates `req.ip`, which every per-IP rate
limit is keyed on: too broad a value (or `true`) lets a caller forge the
header and reset their own limit. A bare hop count isn't accepted either —
it can't validate who the immediate peer is. Defaults to loopback, correct
for local development; in production, set it to your platform's actual
proxy address rather than guessing. After deploying, verify it: send a
request with a forged `X-Forwarded-For` header and confirm the `ip`
recorded on the resulting captured request is still your real address, not
the forged one.

### Configuration

All environment parsing lives in `server/src/config.ts` and is validated
once at startup rather than scattered across the codebase with per-call
fallbacks. When `NODE_ENV=production`, `WEB_ORIGIN` is required and the
process refuses to boot without it, logging a clear error and exiting
rather than silently falling back to reflecting any origin for CORS. In
development, that fallback is still permitted, but logged loudly at
startup so it isn't easy to miss.

### Database roles

The app's `DATABASE_URL` should connect as a role with only `SELECT`,
`INSERT` and `DELETE` on the `endpoints` and `requests` tables — no DDL, no
superuser — plus a column-level `UPDATE` on `endpoints.dropped_count` (the
one counter the app updates in place, when capping requests per endpoint).
`server/sql/roles.sql` creates that role once, run by an admin/owner role;
`npm run migrate` (which applies the files under `server/migrations`,
including `CREATE TABLE`/`ALTER TABLE`) runs under that owner role via
`MIGRATION_DATABASE_URL`, kept separate from the app's own connection. For a
single-role local database, both variables can point at the same
connection string and `MIGRATION_DATABASE_URL` can be left unset.

`web/.env` (optional, defaults to `http://localhost:3001`):

```
VITE_API_BASE=http://localhost:3001
```

```bash
cd server && npm install && npm run migrate && npm run dev
cd web && npm install && npm run dev
```

Open `http://localhost:5173`.

SSE was chosen over WebSockets because the data only flows one way, server to browser — SSE gets that over plain HTTP, with reconnection handled by the browser instead of hand-rolled protocol code on both ends. Endpoints expire after 24 hours because a disposable inspector has no business holding onto someone else's request bodies, headers, and tokens past the debugging session they were captured for; a hard expiry keeps that data from quietly becoming a long-term store.

### Why the caller's IP is stored

Every captured request records the caller's IP, truncated to its /24
network for IPv4 or /48 for IPv6 (the last octet, or the last 80 bits,
zeroed) rather than the exact address. It's kept because it's genuinely
useful while debugging a webhook integration — checking that requests are
actually arriving from a provider's documented IP range, or telling two
different sources apart when more than one is hitting the same endpoint —
and the truncation is enough for both without pinning down an individual
caller. Like every other captured field, it's deleted along with its
endpoint after 24 hours; it never outlives the debugging session it was
captured for.

## Abuse handling

This is a public, unauthenticated write endpoint — anyone who has (or
guesses) an endpoint URL can send it anything. If an endpoint is being used
for something it shouldn't be, an operator can stop it from accepting new
captures immediately, without waiting for its 24-hour expiry, by setting its
`disabled` flag directly in the database:

```sql
UPDATE endpoints SET disabled = true WHERE id = '<endpoint id>';
```

A disabled endpoint responds identically to one that never existed, so
whoever was using it gets no signal that it was deliberately shut off rather
than simply gone. There's no public API for this — only direct database
access — since a self-service version of it would itself be a way to
disrupt someone else's endpoint by anyone who happened to see its URL.

To report abuse of the hosted demo, contact lucianokdp@gmail.com.
