import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { subscriptionBodySchema } from '../schemas.js';
import { parseDay } from '../services/ledgerService.js';

type ParsedSub = ReturnType<typeof subscriptionBodySchema.parse>;

const toData = (body: ParsedSub) => ({
  name: body.name,
  amount: body.amount,
  categoryId: body.categoryId,
  method: body.method,
  cadence: body.cadence,
  billingDay: body.billingDay,
  billingMonth: body.cadence === 'YEARLY' ? (body.billingMonth ?? null) : null,
  startDate: body.startDate ? parseDay(body.startDate) : new Date(),
  endDate: body.endDate ? parseDay(body.endDate) : null,
  active: body.active,
  note: body.note,
});

async function assertExpenseCategory(categoryId: string): Promise<void> {
  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category) throw Object.assign(new Error('Unknown category'), { statusCode: 422 });
  if (category.kind !== 'EXPENSE')
    throw Object.assign(new Error('Subscriptions must use an expense category'), { statusCode: 422 });
}

export const subscriptionRoutes: FastifyPluginAsync = async (app) => {
  app.get('/subscriptions', async () =>
    prisma.subscription.findMany({ include: { category: true }, orderBy: { createdAt: 'asc' } }),
  );

  app.post('/subscriptions', async (req, reply) => {
    const body = subscriptionBodySchema.parse(req.body);
    await assertExpenseCategory(body.categoryId);
    const sub = await prisma.subscription.create({
      data: toData(body),
      include: { category: true },
    });
    return reply.code(201).send(sub);
  });

  app.put('/subscriptions/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = subscriptionBodySchema.parse(req.body);
    await assertExpenseCategory(body.categoryId);
    return prisma.subscription
      .update({ where: { id }, data: toData(body), include: { category: true } })
      .catch(() => {
        throw Object.assign(new Error('Subscription not found'), { statusCode: 404 });
      });
  });

  /** Past charges keep their audit trail (entry.subscriptionId becomes null). */
  app.delete('/subscriptions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await prisma.subscription.delete({ where: { id } }).catch(() => {
      throw Object.assign(new Error('Subscription not found'), { statusCode: 404 });
    });
    return reply.code(204).send();
  });
};
