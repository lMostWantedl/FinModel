import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getAllCategories } from '../services/ledgerService.js';
import { parseExcelStatement, saveBatchEntries, type BatchEntryInput } from '../services/ledgerExcelService.js';
import { prisma } from '../lib/prisma.js';

const batchImportPayloadSchema = z.object({
  entries: z.array(
    z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      kind: z.enum(['INCOME', 'EXPENSE']),
      amount: z.coerce.number().positive(),
      categoryId: z.string().min(1),
      method: z.enum(['CASH', 'BANK', 'UPI', 'CREDIT_CARD', 'OTHER']).default('BANK'),
      note: z.string().max(500).optional().default(''),
      description: z.string().max(500).nullish(),
      debit: z.coerce.number().nonnegative().nullish(),
      credit: z.coerce.number().nonnegative().nullish(),
      balance: z.coerce.number().nullish(),
      tags: z.array(z.string()).optional(),
    }),
  ),
});

export const entriesBatchRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Parse an uploaded Excel spreadsheet (multipart/form-data).
   * Returns parsed rows for interactive review and category assignment.
   */
  const handleUpload = async (req: any, reply: any) => {
    try {
      const data = await req.file();
      if (!data) {
        return reply.code(400).send({
          success: false,
          message: 'No file uploaded. Please upload a .xlsx or .xls file.',
        });
      }

      const buffer = await data.toBuffer();
      const parseResult = await parseExcelStatement(buffer);

      return reply.code(200).send({
        success: true,
        filename: data.filename,
        count: parseResult.rowCount,
        totalDebits: parseResult.totalDebits,
        totalCredits: parseResult.totalCredits,
        duplicateCount: parseResult.duplicateCount,
        newCount: parseResult.newCount,
        rows: parseResult.rows,
        message:
          parseResult.newCount === 0
            ? `All ${parseResult.rowCount} transactions in this statement have already been imported.`
            : `Parsed ${parseResult.rowCount} transactions (${parseResult.newCount} new, ${parseResult.duplicateCount} already in ledger).`,
      });
    } catch (err: any) {
      app.log.error(err);
      return reply.code(400).send({
        success: false,
        message: err.message || 'Failed to parse Excel spreadsheet',
      });
    }
  };

  app.post('/entries/batch/upload', handleUpload);
  app.post('/entries/batch/parse', handleUpload);

  /**
   * Finalize and import approved batch entries into the ledger.
   */
  app.post('/entries/batch/import', async (req, reply) => {
    const body = batchImportPayloadSchema.parse(req.body);
    const result = await saveBatchEntries(body.entries as BatchEntryInput[]);

    if (result.count === 0 && result.skippedDuplicates > 0) {
      return reply.code(400).send({
        success: false,
        imported: 0,
        skippedDuplicates: result.skippedDuplicates,
        message: `All ${result.skippedDuplicates} transactions are already in your ledger. No new entries were imported.`,
      });
    }

    return reply.code(201).send({
      success: true,
      imported: result.count,
      skippedDuplicates: result.skippedDuplicates,
      message:
        result.skippedDuplicates > 0
          ? `Successfully imported ${result.count} new entries (${result.skippedDuplicates} duplicates skipped).`
          : `Successfully imported ${result.count} entries into ledger.`,
    });
  });

  /**
   * Backward-compatible approve endpoint.
   */
  app.post('/entries/batch/approve', async (req, reply) => {
    const raw = req.body as any;
    if (raw?.entries && Array.isArray(raw.entries)) {
      const body = batchImportPayloadSchema.parse(raw);
      const result = await saveBatchEntries(body.entries as BatchEntryInput[]);
      return reply.code(200).send({
        status: 'success',
        approved: result.count,
        skippedDuplicates: result.skippedDuplicates,
        message: `Successfully approved ${result.count} entries (${result.skippedDuplicates} duplicates skipped).`,
      });
    }
    return reply.code(200).send({
      status: 'success',
      approved: 0,
      skippedDuplicates: 0,
      message: 'No entries provided to approve.',
    });
  });

  /** Get all categories for category mapping */
  app.get('/entries/batch/categories', async () => {
    return getAllCategories();
  });

  /** Get recently imported entries */
  app.get('/entries/batch/list', async () => {
    const entries = await prisma.entry.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { category: true },
    });
    return {
      status: 'success',
      entries,
      count: entries.length,
    };
  });
};
