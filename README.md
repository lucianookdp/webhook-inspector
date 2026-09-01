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
