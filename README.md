# portaria

[![CI](https://github.com/lucianookdp/webhook-inspector/actions/workflows/ci.yml/badge.svg)](https://github.com/lucianookdp/webhook-inspector/actions/workflows/ci.yml)

A disposable webhook inspector: generate a URL, register it with any service that fires webhooks, and watch requests arrive in real time with their full content formatted.

![portaria](screenshot.png)

## Features

- **Live capture** — any HTTP method, any content type, headers and query string included, showing up in about a second.
- **Signature verification** — set a secret per endpoint and check that a request really came from who it claims (GitHub, Shopify, and a few others).
- **Configurable response** — reply with a custom status, body and content-type instead of the default `200 ok`.
- **Replay/forward** — resend a captured request to any URL you choose, safely (it won't let you point it at your own internal network).
- **Filter and export** — search by method, path, body or headers, and export what's shown to a JSON file.
- **Named endpoints** — give an endpoint a memorable name (`/w/my-webhook`) instead of a random id.
- **Multi-instance ready** — works the same whether you run one server or several.
- **Usage dashboard** — a password-protected admin page (`/admin.html`) shows how much the site is being used. See [Usage stats](#usage-stats).

## Running locally

Requirements: Node 20+, a Postgres database.

`server/.env`:

```
DATABASE_URL=postgres://user:password@host/dbname?sslmode=require
PORT=3001
TRUST_PROXY=127.0.0.1,::1
REDIS_URL=redis://localhost:6379
```

`REDIS_URL` is optional for local use (rate limiting just falls back to in-memory) but is needed for any real deployment. `TRUST_PROXY` can be left at the default above for local use — see the production section below for what to set it to when deploying.

`web/.env` (optional, defaults to `http://localhost:3001`):

```
VITE_API_BASE=http://localhost:3001
```

```bash
cd server && npm install && npm run migrate && npm run dev
cd web && npm install && npm run dev
```

Open `http://localhost:5173`.

Endpoints expire after 24 hours, so nothing captured here sticks around longer than the debugging session it was for.

### Database roles

The app connects to the database with a limited account that can only read and write the data it needs — it can't change the database structure. `server/sql/roles.sql` creates that account once; run it as the database owner. `npm run migrate` (which does set up the database structure) uses a separate, more privileged connection (`MIGRATION_DATABASE_URL`) so the two never mix. For local development, both variables can just point at the same database.

### Usage stats

Set `ADMIN_TOKEN` (a random value — `openssl rand -hex 32`) to turn on a small stats page at `/admin.html`: how many endpoints exist, how many requests have been captured, day by day. It never shows anyone's actual captured data, just counts. Leave `ADMIN_TOKEN` unset to turn the page off entirely.

## Deploying to production

The server runs as a Docker container (these steps use [Railway](https://railway.com), including its own Postgres and Redis) and the frontend publishes as a static site on [GitHub Pages](https://pages.github.com/).

### 1. Database

1. Add a Postgres database to the Railway project.
2. Open its **Console** tab in the Railway dashboard (a terminal into the database itself) and run `server/sql/roles.sql` there, after filling in a real password and database name: `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f <file>`. This sets up the limited account the app will connect as.
3. Nothing else to do here — the app sets up its own database structure automatically the first time it starts.

**One Railway quirk**: Railway's Postgres uses a certificate the app doesn't automatically trust, so it'll fail to connect at first with a "self-signed certificate" error. Fix: in that same Console tab, run `cat /var/lib/postgresql/data/certs/root.crt`, copy everything between `-----BEGIN CERTIFICATE-----` and `-----END CERTIFICATE-----`, and paste it into the server's `DATABASE_CA_CERT` variable (step 2 below).

### 2. Server (Railway)

1. Create a Railway service from this repo, with root directory set to `server`. Railway will pick up its settings automatically.
2. Add Redis to the project and point the server's `REDIS_URL` at it (Railway lets you reference it directly rather than copy-pasting the value).
3. Set the server's environment variables (see `server/.env.example` for the full list and explanations):
   - `NODE_ENV=production`
   - `DATABASE_URL` — the limited account from step 1
   - `MIGRATION_DATABASE_URL` — the database owner account
   - `DATABASE_CA_CERT` — see the certificate quirk above
   - `WEB_ORIGIN` — the frontend's URL (step 3 below)
   - `ADMIN_TOKEN` — optional, see [Usage stats](#usage-stats)
   - `TRUST_PROXY` — see below
4. Deploy, and check that `GET /health` returns `200 ok`.

**Setting `TRUST_PROXY` correctly**: this setting tells the app which IP addresses are allowed to say "here's the visitor's real address" — get it wrong and either rate limiting breaks, or someone can fake their IP. Railway doesn't publish a fixed address for this, so you have to find it yourself: temporarily add a line of code that logs the incoming connection's address, deploy, send it a couple of test requests, and see what shows up. Then set `TRUST_PROXY` to that (Railway typically uses addresses in `100.64.0.0/10`, and sometimes routes through a second internal hop too — check for both). Afterwards, confirm it worked: send a request with a fake `X-Forwarded-For` header and make sure the captured request still shows your real address, not the fake one.

### 3. Frontend (GitHub Pages)

A GitHub Actions workflow (`.github/workflows/deploy-pages.yml`) already builds and publishes the `web/` folder whenever `main` changes.

1. In the repo's **Settings > Pages**, set **Source** to **GitHub Actions** (one-time).
2. In **Settings > Secrets and variables > Actions > Variables**, add `API_BASE_URL` set to the server's Railway URL from step 2.
3. Push to `main` (or run the workflow manually from the Actions tab). The site goes live at `https://<username>.github.io/<repo>/`.
4. Set the server's `WEB_ORIGIN` (step 2) to `https://<username>.github.io` — just that, without the repo name — and redeploy the server.

## Abuse handling

Anyone who has (or guesses) an endpoint's URL can send it anything — there's no login required to send requests to it. If one is being misused, an operator can shut it off immediately by marking it disabled directly in the database:

```sql
UPDATE endpoints SET disabled = true WHERE id = '<endpoint id>';
```

To report abuse of the hosted demo (<https://lucianookdp.github.io/webhook-inspector/>), contact lucianokdp@gmail.com.
