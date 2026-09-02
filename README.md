# portaria

[![CI](https://github.com/lucianookdp/webhook-inspector/actions/workflows/ci.yml/badge.svg)](https://github.com/lucianookdp/webhook-inspector/actions/workflows/ci.yml)

A disposable webhook inspector: generate a URL, register it with any service that fires webhooks, and watch requests arrive in real time with their full content formatted.

![portaria](screenshot.png)

## Features

- **Live capture** — any HTTP method, any content type, headers and query string included, appearing over SSE within about a second.
- **Signature verification** — set a secret per endpoint and every captured request is checked against it (GitHub, Shopify, and a few other common conventions).
- **Configurable response** — reply with a custom status, body and content-type instead of the fixed `200 ok`.
- **Replay/forward** — resend a captured request to any URL you choose, with SSRF protections (private/loopback/link-local ranges blocked, DNS rebinding resisted).
- **Filter and export** — narrow the list by method or a text search across path/body/headers, and export whatever's shown to JSON.
- **Named endpoints** — give an endpoint a memorable slug (`/w/my-webhook`) instead of only the random id.
- **Multi-instance fan-out** — captures broadcast across every running instance via Postgres `LISTEN`/`NOTIFY`; see `REDIS_URL` below for shared rate limiting.
- **Usage dashboard** — a token-gated admin page (`/admin.html`) shows aggregate usage counts. See [Usage stats](#usage-stats).

## Running locally

Requirements: Node 20+, a Postgres database.

`server/.env`:

```
DATABASE_URL=postgres://user:password@host/dbname?sslmode=require
PORT=3001
TRUST_PROXY=127.0.0.1,::1
REDIS_URL=redis://localhost:6379
```

`REDIS_URL` backs rate limiting with Redis so limits survive a restart and are shared across instances; optional locally (falls back to in-memory), required for any deployment running more than one instance.

`MAX_LIVE_ENDPOINTS` / `MAX_TOTAL_STORED_BYTES` are absolute ceilings independent of per-IP rate limits, so a flood spread across many IPs or endpoints can't fill the database. New endpoints/captures get `503` once either is reached, until usage drops.

`TRUST_PROXY` is a comma-separated list of the reverse proxy IP(s)/CIDR(s) actually in front of this process — only an `X-Forwarded-For` relayed by one of those addresses is trusted, since it gates `req.ip`, which per-IP rate limiting is keyed on. Defaults to loopback. In production, set it to your platform's actual proxy address (never guess) and verify: send a request with a forged `X-Forwarded-For` and confirm the `ip` on the resulting captured request is still your real address.

### Configuration

All environment parsing lives in `server/src/config.ts`, validated once at startup. When `NODE_ENV=production`, `WEB_ORIGIN` is required and the process refuses to boot without it rather than silently reflecting any origin for CORS.

### Database roles

The app's `DATABASE_URL` should connect as a role with only `SELECT`/`INSERT`/`DELETE` on `endpoints`, `requests` and `daily_stats` — no DDL, no superuser — plus a few narrow column-level `UPDATE` grants. `server/sql/roles.sql` creates that role once, run by an admin/owner role. `npm run migrate` (applies `server/migrations`) runs under that owner role via `MIGRATION_DATABASE_URL`, kept separate from the app's own connection. For a single-role local database, both variables can point at the same connection string. Re-run `roles.sql`'s `GRANT`s any time a migration adds a table/column the app needs.

### Usage stats

Set `ADMIN_TOKEN` (`openssl rand -hex 32`) to enable `GET /api/admin/stats` — active-endpoint count, all-time totals, and a 30-day daily breakdown. It holds only counts, never ids or captured content. Unset, the route 404s unconditionally.

Open `/admin.html` on the deployed frontend and enter the token once; it's remembered in that browser's `localStorage`. There's intentionally no link to it from the main page.

`web/.env` (optional, defaults to `http://localhost:3001`):

```
VITE_API_BASE=http://localhost:3001
```

```bash
cd server && npm install && npm run migrate && npm run dev
cd web && npm install && npm run dev
```

Open `http://localhost:5173`.

SSE was chosen over WebSockets because the data only flows one way, server to browser. Endpoints expire after 24 hours — a disposable inspector has no business holding onto someone else's request bodies, headers, and tokens past the debugging session they were captured for.

### Why the caller's IP is stored

Every captured request records the caller's IP, truncated to its /24 network (IPv4) or /48 (IPv6) rather than the exact address — useful for checking requests arrive from a provider's documented range, or telling two sources apart, without pinning down an individual caller. Deleted along with its endpoint after 24 hours.

## Deploying to production

The server deploys as a Docker container (these steps use [Railway](https://railway.com), including its own Postgres and Redis plugins) and the frontend as a static build on [GitHub Pages](https://pages.github.com/). An external Postgres (e.g. [Neon](https://neon.tech)) works too — everything below applies except the self-signed certificate note.

### 1. Database

1. Add a Postgres plugin to the Railway project (or create an external database).
2. Connect as the database owner and run `server/sql/roles.sql` once, after replacing its placeholder password and database name. On Railway, do this from the Postgres service's **Console** tab (a root shell in the database container) rather than printing the owner connection string: `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f <file>`.
3. `npm run migrate` doesn't need to be run by hand — the server's Docker image runs it automatically on every boot via `MIGRATION_DATABASE_URL`.

**Self-signed certificate on Railway's Postgres plugin**: Railway's `postgres-ssl` template generates its own CA rather than a publicly-trusted one, so `migrate.js` fails with `self-signed certificate in certificate chain` until `DATABASE_CA_CERT` is set. Don't work around this with `DATABASE_INSECURE_TLS=true` — fetch the real CA instead: in the Postgres service's Console tab, `cat /var/lib/postgresql/data/certs/root.crt` and copy the `-----BEGIN CERTIFICATE-----`…`-----END CERTIFICATE-----` block (skip the human-readable header above it) into `DATABASE_CA_CERT`. Not needed for a provider with a publicly-trusted cert (Neon and most others).

### 2. Server (Railway)

1. Create a Railway service from this repo with root directory `server`. Railway picks up `server/railway.json` automatically (Dockerfile build, healthcheck on `GET /health`).
2. Add Redis to the project and set `REDIS_URL` — usually via `${{Redis.REDIS_URL}}` rather than pasting the value. Without it, rate limits are in-memory and per-instance.
3. Set the server's environment variables (see `server/.env.example` for the full list):
   - `NODE_ENV=production`
   - `DATABASE_URL` / `MIGRATION_DATABASE_URL` — the app role and owner role from step 1.
   - `DATABASE_CA_CERT` — Railway's own Postgres plugin only, see above.
   - `WEB_ORIGIN` — the frontend's production URL (step 3 below); required in production.
   - `ADMIN_TOKEN` — optional, see [Usage stats](#usage-stats).
   - `TRUST_PROXY` — see the callout below.
4. Deploy. `GET /health` should return `200 ok`. If `roles.sql` hasn't run yet, temporarily point `DATABASE_URL` at the same owner connection string as `MIGRATION_DATABASE_URL` so migrations can create the tables it grants against, then switch to the least-privilege role and redeploy.

**`TRUST_PROXY` on Railway**: Railway's edge sets `X-Forwarded-For` itself and discards whatever a client put there — a forged header doesn't survive. What can vary is the hop count: `req.socket.remoteAddress` lands somewhere in `100.64.0.0/10` (the CGNAT range), but the chain sometimes carries a *second* Railway-internal address before that. Don't guess either range — temporarily log `req.socket.remoteAddress` alongside the full `X-Forwarded-For`, send a few requests (including one with a forged header) to see the actual chain, and set `TRUST_PROXY` to cover every hop you see (comma-separated, CIDR allowed, e.g. `100.64.0.0/10,<other hop>/24`). Then verify: confirm the `ip` on a captured request is your real address, not the forged one.

### 3. Frontend (GitHub Pages)

`.github/workflows/deploy-pages.yml` builds and publishes `web/` on every push to `main` that touches it (or via manual dispatch), running typecheck/lint/test first.

1. In the repo's Settings > Pages, set **Source** to **GitHub Actions** (one-time).
2. In Settings > Secrets and variables > Actions > Variables, add `API_BASE_URL` set to the server's Railway URL. The workflow bakes it in at build time as `VITE_API_BASE`.
3. Push to `main` (or run the workflow manually). The site goes live at `https://<username>.github.io/<repo>/` (project page) or `https://<username>.github.io/` (user page or custom domain) — `actions/configure-pages` handles the base path automatically.
4. Set the server's `WEB_ORIGIN` to that origin — just `https://<username>.github.io`, no repo path, since CORS matches scheme+host only — and redeploy.

`npm run build` emits two pages, `index.html` and `admin.html`, served as-is by Pages with no extra routing needed.

## Abuse handling

This is a public, unauthenticated write endpoint — anyone who has (or guesses) an endpoint URL can send it anything. An operator can stop an endpoint from accepting new captures immediately, without waiting for its 24-hour expiry, by setting its `disabled` flag directly in the database:

```sql
UPDATE endpoints SET disabled = true WHERE id = '<endpoint id>';
```

A disabled endpoint responds identically to one that never existed. There's no public API for this — only direct database access — since a self-service version would itself be a way to disrupt someone else's endpoint.

To report abuse of the hosted demo (<https://lucianookdp.github.io/webhook-inspector/>), contact lucianokdp@gmail.com.
