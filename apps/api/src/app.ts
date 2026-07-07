import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { ZodError } from 'zod';
import { loanRoutes } from './routes/loans.js';
import { simulationRoutes } from './routes/simulation.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { exportRoutes } from './routes/export.js';
import { categoryRoutes } from './routes/categories.js';
import { entryRoutes } from './routes/entries.js';
import { subscriptionRoutes } from './routes/subscriptions.js';
import { summaryRoutes } from './routes/summary.js';
import { seedPresetCategories } from './services/ledgerService.js';

export async function buildApp() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  // Tolerate an application/json content type with an empty body (e.g. DELETE
  // sent by generic HTTP clients) instead of Fastify's default 400.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (body === '') return done(null, undefined);
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(Object.assign(err as Error, { statusCode: 400 }), undefined);
    }
  });

  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ message: 'Validation failed', issues: err.issues });
    }
    const e = err as { statusCode?: number; message?: string };
    const statusCode = typeof e.statusCode === 'number' ? e.statusCode : 500;
    if (statusCode >= 500) app.log.error(err);
    return reply.code(statusCode).send({ message: e.message ?? 'Internal server error' });
  });

  await app.register(multipart);

  app.get('/health', async () => ({ status: 'ok' }));
  await app.register(loanRoutes);
  await app.register(simulationRoutes);
  await app.register(dashboardRoutes);
  await app.register(exportRoutes);
  await app.register(categoryRoutes);
  await app.register(entryRoutes);
  await app.register(subscriptionRoutes);
  await app.register(summaryRoutes);

  await seedPresetCategories();
  return app;
}
