# portaria

A disposable webhook inspector: generate a URL, register it with any service that fires webhooks, and watch requests arrive in real time with their full content formatted.

![portaria](screenshot.png)

## Running locally

Requirements: Node 20+, a Postgres database (this project targets [Neon](https://neon.tech)).

`server/.env`:

```
DATABASE_URL=postgres://user:password@host/dbname?sslmode=require
PORT=3001
```

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
