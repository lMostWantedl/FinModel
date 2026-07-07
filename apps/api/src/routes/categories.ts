import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { categoryBodySchema } from '../schemas.js';

export const categoryRoutes: FastifyPluginAsync = async (app) => {
  app.get('/categories', async () =>
    prisma.category.findMany({ orderBy: [{ kind: 'asc' }, { name: 'asc' }] }),
  );

  app.post('/categories', async (req, reply) => {
    const body = categoryBodySchema.parse(req.body);
    const category = await prisma.category.create({
      data: { ...body, budgetMonthly: body.budgetMonthly ?? null },
    });
    return reply.code(201).send(category);
  });

  /** Update the monthly budget target (or rename a custom category). */
  app.patch('/categories/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = categoryBodySchema.partial().parse(req.body);
    return prisma.category.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.budgetMonthly !== undefined ? { budgetMonthly: body.budgetMonthly } : {}),
      },
    });
  });

  app.delete('/categories/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const category = await prisma.category.findUnique({ where: { id }, include: { entries: { take: 1 } } });
    if (!category) throw Object.assign(new Error('Category not found'), { statusCode: 404 });
    if (category.preset) throw Object.assign(new Error('Preset categories cannot be deleted'), { statusCode: 422 });
    if (category.entries.length > 0)
      throw Object.assign(new Error('Category has entries; reassign them first'), { statusCode: 422 });
    await prisma.category.delete({ where: { id } });
    return reply.code(204).send();
  });
};
