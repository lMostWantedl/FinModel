import type { FastifyPluginAsync } from 'fastify';
import { simulateBodySchema } from '../schemas.js';
import { currentMonth, latestSimulation, runSimulation } from '../services/simulationService.js';

export const simulationRoutes: FastifyPluginAsync = async (app) => {
  app.post('/simulate', async (req) => {
    const body = simulateBodySchema.parse(req.body ?? {});
    return runSimulation({ ...body, startMonth: body.startMonth ?? currentMonth() });
  });

  app.get('/simulation', async (_req, reply) => {
    const latest = await latestSimulation();
    if (!latest) return reply.code(404).send({ message: 'No simulation has been run yet' });
    return latest;
  });
};
