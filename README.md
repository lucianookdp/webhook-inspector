# portaria

[![CI](https://github.com/lucianookdp/webhook-inspector/actions/workflows/ci.yml/badge.svg)](https://github.com/lucianookdp/webhook-inspector/actions/workflows/ci.yml)

A disposable webhook inspector: generate a URL, register it with any service that fires webhooks, and watch requests arrive in real time with their full content formatted.

![portaria](screenshot.png)

## Features

- **Live capture** — any HTTP method, any content type, headers and query
  string included, appearing over SSE within about a second.
- **Signature verification** — set a secret per endpoint and every captured
  request is checked against it (GitHub's `sha256=`-prefixed hex, Shopify's
  base64, and a few other common conventions), so you can confirm a sender
  is really who it claims to be while debugging.
- **Configurable response** — reply with a custom status, body and
  content-type instead of the fixed `200 ok`, to rehearse how a real sender
  reacts to a 4xx/5xx or a specific response body.
- **Replay/forward** — resend a captured request to any URL you choose, with
  SSRF protections (private/loopback/link-local ranges blocked, DNS
  rebinding resisted by resolving once and connecting to the validated
  address) so the feature can't be turned into a probe of your own internal
  network.
- **Filter and export** — narrow the list by method or a text search across
  path/body/headers, and export whatever's currently shown to a JSON file.
- **Named endpoints** — give an endpoint a memorable slug (`/w/my-webhook`)
  instead of only the random id, without losing the id as a working
  alternative.
- **Multi-instance fan-out** — captures are broadcast across every running
  instance over Postgres `LISTEN`/`NOTIFY`, so a browser connected to one
  instance still sees a request captured by another (see `REDIS_URL` below
  for the other half of running more than one instance: shared rate
  limiting).
- **Usage dashboard** — a separate, token-gated admin page
  (`/admin.html`) shows aggregate usage counts, so the site's operator can
  see whether it's actually being used without looking at anyone's captured
  request content. See [Usage stats](#usage-stats) below.

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
`INSERT` and `DELETE` on the `endpoints`, `requests` and `daily_stats`
tables — no DDL, no superuser — plus a handful of narrow, column-level
`UPDATE` grants for the specific fields the app updates in place instead of
only inserting (capping requests per endpoint, a user's signing secret,
response config and slug, the daily usage counters). `server/sql/roles.sql`
is the source of truth for exactly which columns and creates that role
once, run by an admin/owner role; `npm run migrate` (which applies the
files under `server/migrations`, including `CREATE TABLE`/`ALTER TABLE`)
runs under that owner role via `MIGRATION_DATABASE_URL`, kept separate from
the app's own connection. For a single-role local database, both variables
can point at the same connection string and `MIGRATION_DATABASE_URL` can be
left unset. Re-run `server/sql/roles.sql`'s `GRANT` statements (or the new
one added alongside a migration) any time a migration adds a table or
column the app needs to read or write — it's not applied automatically.

### Usage stats

Set `ADMIN_TOKEN` (a long random value — `openssl rand -hex 32`) to enable
`GET /api/admin/stats`, an endpoint that reports active-endpoint count,
all-time totals, and a 30-day daily breakdown of endpoints created and
requests captured. It holds only counts, never ids or captured content.
Leaving `ADMIN_TOKEN` unset makes the route 404 unconditionally — no admin
surface exists at all until you opt in.

Open `/admin.html` on the deployed frontend (e.g.
`https://your-frontend.example/admin.html`) and enter the token once; it's
remembered in that browser's `localStorage` from then on. There's
intentionally no link to it from the main page.

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

## Deploying to production

The server deploys as a Docker container (any host that runs one works;
these steps use [Railway](https://railway.com)) and the frontend as a
static build (these steps use [Vercel](https://vercel.com)). Postgres is
assumed to be [Neon](https://neon.tech) or similar; Redis is optional but
strongly recommended once more than one server instance is running.

### 1. Database

1. Create a Postgres database (Neon's free tier is enough to try this).
2. Connect as the database owner and run `server/sql/roles.sql` once,
   after replacing its placeholder password and database name — this
   creates the least-privilege `webhook_inspector_app` role the running
   server connects as.
3. You won't run `npm run migrate` by hand for this deployment: the
   server's Docker image runs it automatically on every boot (see the
   Dockerfile) using `MIGRATION_DATABASE_URL`, so migrations stay in sync
   with whatever image is currently deployed without a separate step.

### 2. Server (Railway)

1. Create a new Railway service from this GitHub repo, with the service's
   root directory set to `server`. Railway picks up `server/railway.json`
   automatically, which points it at `server/Dockerfile` and configures a
   healthcheck against `GET /health`.
2. Add a Redis instance to the project (Railway's own Redis template, or
   any external one) and set `REDIS_URL` on the server service to its
   connection string — usually via Railway's `${{Redis.REDIS_URL}}`
   variable reference rather than pasting the value directly. Without this,
   rate limits are in-memory and per-instance, which stops being correct
   the moment you run more than one instance.
3. Set the server's environment variables (see `server/.env.example` for
   the full list with explanations):
   - `NODE_ENV=production`
   - `DATABASE_URL` / `MIGRATION_DATABASE_URL` — the app role and the
     owner role from step 1, respectively.
   - `WEB_ORIGIN` — the frontend's production URL (step 3 below). Required
     in production; the process refuses to boot without it.
   - `ADMIN_TOKEN` — optional, see [Usage stats](#usage-stats) above.
   - `TRUST_PROXY` — see the callout below before setting this.
4. Deploy. `GET /health` should return `200 ok` once the service is up.

**`TRUST_PROXY` on Railway**: Railway's edge proxy appends the real client
IP to `X-Forwarded-For` but does not strip anything a client already put in
that header — exactly the situation `TRUST_PROXY` (an address allowlist,
not a bare hop count) exists to handle correctly, *given the right address*.
Railway doesn't publish a single fixed proxy IP that's guaranteed stable
across its infrastructure, so don't guess one. Instead: temporarily log
`req.socket.remoteAddress` (or check what Railway's own docs/support say
for your project at deploy time) to find the actual immediate peer address,
set `TRUST_PROXY` to that, then do the verification the README already
recommends above — send a request with a forged `X-Forwarded-For` header
and confirm the `ip` on the resulting captured request is your real
address, not the forged one. Don't skip that check; getting this wrong
either breaks every per-IP rate limit (too broad) or misattributes real
traffic (too narrow).

### 3. Frontend (Vercel)

1. Create a new Vercel project from this repo, with the project's root
   directory set to `web`. Vercel auto-detects the Vite framework preset;
   the default build command and output directory (`dist`) both already
   match what `npm run build` produces (see the note below about
   `admin.html`).
2. Set `VITE_API_BASE` to the server's Railway URL from step 2. This is
   baked in at build time, not read at runtime — changing it means
   redeploying the frontend.
3. Deploy, then set the server's `WEB_ORIGIN` (step 2 above) to this
   project's production URL and redeploy the server so CORS allows it.
   Vercel's preview deployments (one per branch/PR) each get their own
   origin that won't match a single `WEB_ORIGIN`; if you need those to work
   against the API too, that's a tradeoff to make deliberately; the guide
   here only covers the production domain.

`npm run build` emits **two** pages: `index.html` (the disposable
inspector) and `admin.html` (the usage dashboard — see
[Usage stats](#usage-stats) above), as two independent single-page bundles.
Vercel's static build serves both real files as-is, so no extra
routing/rewrite configuration is needed for this.

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
