import 'dotenv/config';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import { startExpiredEndpointCleanup } from './cleanup.js';
import { endpointRoutes } from './routes/endpoints.js';
import { streamRoutes } from './routes/stream.js';
import { webhookRoutes } from './routes/webhook.js';

const app = Fastify({ logger: true, trustProxy: true });

// The web client and API live on different origins even in production
// (Vercel + Fly.io), so CORS is always needed, not just in dev.
await app.register(cors, {
  origin: process.env.WEB_ORIGIN ?? true,
});

app.register(endpointRoutes);
app.register(streamRoutes);
app.register(webhookRoutes);

startExpiredEndpointCleanup();

const port = Number(process.env.PORT ?? 3000);

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
