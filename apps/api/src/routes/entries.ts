import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { emiPaymentSchema, entriesQuerySchema, entryBodySchema, entryPatchSchema } from '../schemas.js';
import {
  dateKey,
  emiDueThisMonth,
  listEntries,
  logEmiPayment,
  parseDay,
  reconcileLoanEmis,
  syncAutoEntries,
} from '../services/ledgerService.js';

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const defaultRange = () => {
  const now = new Date();
  const from = new Date(now.getTime() - 30 * 86_400_000);
  return { from: dateKey(from), to: dateKey(now) };
};

export const entryRoutes: FastifyPluginAsync = async (app) => {
  app.get('/entries', async (req) => {
    const q = entriesQuerySchema.parse(req.query ?? {});
    const range = defaultRange();
    return listEntries({
      from: parseDay(q.from ?? range.from),
      to: parseDay(q.to ?? range.to),
      kind: q.kind,
      categoryId: q.categoryId,
    });
  });

  /** This month's EMIs and which are still unpaid (no ledger row yet). */
  app.get('/emi-due', async () => emiDueThisMonth());

  /** Automatically detect and reconcile unlinked ledger entries with loan EMIs. */
  app.post('/entries/reconcile-emis', async () => {
    return reconcileLoanEmis();
  });

  /** Log an EMI payment linked to a loan + this month, so sync won't duplicate
   * it. Use for EMIs paid early (before the due date / before auto-sync). */
  app.post('/entries/pay-emi', async (req, reply) => {
    const body = emiPaymentSchema.parse(req.body);
    const entry = await logEmiPayment(body);
    return reply.code(201).send(entry);
  });

  app.post('/entries', async (req, reply) => {
    const body = entryBodySchema.parse(req.body);
    const category = await prisma.category.findUnique({ where: { id: body.categoryId } });
    if (!category) throw Object.assign(new Error('Unknown category'), { statusCode: 422 });
    if (category.kind !== body.kind)
      throw Object.assign(new Error(`Category ${category.name} is ${category.kind}, not ${body.kind}`), {
        statusCode: 422,
      });
    const entry = await prisma.entry.create({
      data: {
        date: parseDay(body.date),
        kind: body.kind,
        amount: body.amount,
        categoryId: body.categoryId,
        method: body.method,
        note: body.note,
        tagsJson: JSON.stringify(body.tags),
      },
    });
    return reply.code(201).send(entry);
  });

  /** Edit any entry — auto-logged EMI rows included. Source is preserved. */
  app.patch('/entries/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = entryPatchSchema.parse(req.body);
    const entry = await prisma.entry.findUnique({ where: { id } });
    if (!entry) throw Object.assign(new Error('Entry not found'), { statusCode: 404 });
    const kind = body.kind ?? entry.kind;
    if (body.categoryId !== undefined || body.kind !== undefined) {
      const category = await prisma.category.findUnique({
        where: { id: body.categoryId ?? entry.categoryId },
      });
      if (!category) throw Object.assign(new Error('Unknown category'), { statusCode: 422 });
      if (category.kind !== kind)
        throw Object.assign(new Error(`Category ${category.name} is ${category.kind}, not ${kind}`), {
          statusCode: 422,
        });
    }
    return prisma.entry.update({
      where: { id },
      data: {
        ...(body.date !== undefined ? { date: parseDay(body.date) } : {}),
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
        ...(body.amount !== undefined ? { amount: body.amount } : {}),
        ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
        ...(body.method !== undefined ? { method: body.method } : {}),
        ...(body.note !== undefined ? { note: body.note } : {}),
        ...(body.tags !== undefined ? { tagsJson: JSON.stringify(body.tags) } : {}),
      },
    });
  });

  /** Backfill missing auto entries — loan EMIs and subscription charges
   * (idempotent). An optional `from` date limits how far back gaps are filled. */
  const syncHandler = async (req: { body?: unknown }) => {
    const body = (req.body ?? {}) as { from?: string };
    const from = body.from && /^\d{4}-\d{2}-\d{2}$/.test(body.from) ? parseDay(body.from) : undefined;
    await reconcileLoanEmis();
    return syncAutoEntries(from);
  };
  app.post('/entries/sync-auto', syncHandler);
  app.post('/entries/sync-emis', syncHandler); // deprecated alias

  app.delete('/entries/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await prisma.entry.delete({ where: { id } }).catch(() => {
      throw Object.assign(new Error('Entry not found'), { statusCode: 404 });
    });
    return reply.code(204).send();
  });

  /** Attach a receipt/document (multipart form, field name "file"). */
  app.post('/entries/:id/attachments', async (req, reply) => {
    const { id } = req.params as { id: string };
    const entry = await prisma.entry.findUnique({ where: { id } });
    if (!entry) throw Object.assign(new Error('Entry not found'), { statusCode: 404 });
    const file = await req.file({ limits: { fileSize: MAX_ATTACHMENT_BYTES } });
    if (!file) throw Object.assign(new Error('No file uploaded'), { statusCode: 400 });
    const data = await file.toBuffer();
    const attachment = await prisma.attachment.create({
      data: {
        entryId: id,
        filename: file.filename,
        mimeType: file.mimetype,
        size: data.length,
        data,
      },
      select: { id: true, filename: true, size: true, mimeType: true },
    });
    return reply.code(201).send(attachment);
  });

  app.get('/attachments/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const att = await prisma.attachment.findUnique({ where: { id } });
    if (!att) throw Object.assign(new Error('Attachment not found'), { statusCode: 404 });
    return reply
      .header('Content-Type', att.mimeType)
      .header('Content-Disposition', `attachment; filename="${att.filename.replace(/"/g, '')}"`)
      .send(Buffer.from(att.data));
  });

  app.delete('/attachments/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await prisma.attachment.delete({ where: { id } }).catch(() => {
      throw Object.assign(new Error('Attachment not found'), { statusCode: 404 });
    });
    return reply.code(204).send();
  });
};
