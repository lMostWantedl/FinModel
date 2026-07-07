import type { FastifyPluginAsync } from 'fastify';
import { buildDashboard, currentMonth } from '../services/simulationService.js';
import {
  currentMonthStats,
  emiDueThisMonth,
  subscriptionsDueThisMonth,
  suggestedExtraMonthly,
} from '../services/ledgerService.js';

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.get('/dashboard', async (req) => {
    const { extra } = req.query as { extra?: string };
    // No explicit extra -> use the ledger surplus (income − expenses),
    // so the audit log drives the optimizer.
    const suggestedExtra = await suggestedExtraMonthly();
    const extraMonthlyPayment = extra !== undefined ? Number(extra) || 0 : suggestedExtra;
    const dash = await buildDashboard({
      extraMonthlyPayment,
      bonuses: [],
      opportunityRatePct: 6,
      startMonth: currentMonth(),
    });
    return {
      ...dash,
      extraMonthlyPayment,
      suggestedExtra,
      month: await currentMonthStats(),
      monthDue: await emiDueThisMonth(),
      monthSubsDue: await subscriptionsDueThisMonth(),
    };
  });
};
