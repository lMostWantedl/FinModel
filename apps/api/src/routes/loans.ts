import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { loanImportSchema, loanJsonSchema } from '../schemas.js';
import { parsedToDbData, rowToJson } from '../services/loanMapper.js';

export const loanRoutes: FastifyPluginAsync = async (app) => {
  app.get('/loans', async () => {
    const rows = await prisma.loan.findMany({ orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] });
    return rows.map(rowToJson);
  });

  app.post('/loans', async (req, reply) => {
    const body = loanJsonSchema.parse(req.body);
    const loan = await prisma.loan.create({ data: parsedToDbData(body) });
    return reply.code(201).send(rowToJson(loan));
  });

  /** Import one loan JSON object or an array of them. */
  app.post('/loans/import', async (req, reply) => {
    const body = loanImportSchema.parse(req.body);
    const parsed = Array.isArray(body) ? body : [body];
    const created = await prisma.$transaction(
      parsed.map((p) => prisma.loan.create({ data: parsedToDbData(p) })),
    );
    return reply.code(201).send({ imported: created.length, loans: created.map(rowToJson) });
  });

  /** Full update: body is the same shape as POST /loans; derived fields recompute. */
  app.put('/loans/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = loanJsonSchema.parse(req.body);
    const loan = await prisma.loan
      .update({ where: { id }, data: parsedToDbData(body) })
      .catch(() => {
        throw Object.assign(new Error('Loan not found'), { statusCode: 404 });
      });
    return rowToJson(loan);
  });

  app.delete('/loans/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await prisma.loan.delete({ where: { id } }).catch(() => {
      throw Object.assign(new Error('Loan not found'), { statusCode: 404 });
    });
    return reply.code(204).send();
  });
};
