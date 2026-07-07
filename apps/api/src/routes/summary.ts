import type { FastifyPluginAsync } from 'fastify';
import { summaryQuerySchema } from '../schemas.js';
import { buildSummary, dateKey, parseDay } from '../services/ledgerService.js';

const DEFAULT_SPAN_DAYS: Record<string, number> = { day: 14, week: 84, month: 365 };

export const summaryRoutes: FastifyPluginAsync = async (app) => {
  app.get('/summary', async (req) => {
    const q = summaryQuerySchema.parse(req.query ?? {});
    const to = q.to ? parseDay(q.to) : new Date();
    const span = DEFAULT_SPAN_DAYS[q.granularity] ?? 365;
    const from = q.from ? parseDay(q.from) : new Date(to.getTime() - span * 86_400_000);
    return buildSummary(q.granularity, from, to);
  });
};
