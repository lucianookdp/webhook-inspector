FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
# Documents the default from config.ts (PORT is otherwise host-supplied —
# Railway, for one, injects its own and expects the app to bind to it).
EXPOSE 3000
# The platform-specific "run this once before switching traffic over" release
# hook (Fly's release_command, Railway's pre-deploy command) isn't something
# every host supports the same way, so migrations run here instead, right
# before the server starts on every boot. migrate.ts's own migrations are all
# idempotent (CREATE TABLE/ADD COLUMN IF NOT EXISTS), so running it more than
# once — including from more than one replica starting around the same
# time — is a safe no-op, just serialized by Postgres's own DDL locking.
CMD ["sh", "-c", "node dist/migrate.js && node dist/index.js"]
