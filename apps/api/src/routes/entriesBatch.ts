import type { FastifyPluginAsync } from 'fastify';
import multer from '@fastify/multipart';
import { prisma } from '../lib/prisma.js';
import { getAllCategories, parseDay } from '../services/ledgerService.js';

export const entriesBatchRoutes: FastifyPluginAsync = async (app) => {
  /** Maximum file size for Excel uploads (50MB) */
  const MAX_EXCEL_SIZE = 50 * 1024 * 1024;

  // Multer configuration for file uploads
  app.post(
    '/entries/batch/upload',
    {
      config: {
        fileFilter: (req, file, cb) => {
          const ext = (file as any).originalname?.split('.').pop()?.toLowerCase();
          if (!ext || !['xlsx', 'xls'].includes(ext)) {
            return cb(
              new Error(`Only .xlsx and .xls files are allowed.`),
              false,
            );
          }
          cb(null, true);
        },
      },
    },
    async (req: { file?: any; body?: { categoryId: string } }) => {
      const file = req.file;
      if (!file) throw new Error('No file uploaded');

      // Validate category ID
      const categoryId = req.body.categoryId;
      if (!categoryId || typeof categoryId !== 'string' || categoryId.trim() === '') {
        throw new Error('categoryId is required and must be a valid string');
      }

      try {
        const buffer = await file.toBuffer();
        
        // Parse the Excel file
        const parseResult = await parseExcelForEntries(buffer);
        
        if (parseResult.success === 0) {
          return {
            success: 0,
            entries: [],
            errors: parseResult.errors,
            message: `Could not parse any rows from the Excel file.`
          };
        }

        // Create pending entries in database with category assigned
        const entryData = [];
        for (let i = 1; i <= parseResult.success; i++) {
          entryData.push({
            date: null,
            kind: 'INCOME' as 'INCOME' | 'EXPENSE', // Will be corrected on approve based on debit/credit
            amount: 0,
            categoryId,
            method: 'CASH',
            note: '',
            description: '',
            tags: [],
            source: 'PENDING_EXCEL' as const,
          });
        }

        if (entryData.length > 0) {
          await prisma.entry.createMany({ data: entryData });
          
          // Fetch created entries to return them with full details
          const newPending = await prisma.entry.findMany({
            where: { 
              source: 'PENDING_EXCEL',
              amount: 0,
              createdAt: { gte: new Date(Date.now() - 100) } // Very recent entries
            },
            orderBy: [{ createdAt: 'desc' }],
            include: { category: true }
          });

          return {
            success: parseResult.success,
            entries: newPending.map((e) => ({
              id: e.id,
              srNo: Number(e.id.slice(0, 8)) || 1,
              date: e.date?.toISOString().slice(0, 10) || null,
              kind: e.kind as 'INCOME' | 'EXPENSE',
              categoryId: e.categoryId,
              categoryName: e.category.name,
              description: e.description || '',
              debit: e.debit ?? null,
              credit: e.credit ?? null,
              method: e.method || 'CASH',
              note: e.note || '',
              status: 'PENDING' as const,
            })),
            errors: parseResult.errors,
            message: `Parsed ${parseResult.success} rows. You can now assign categories.`
          };
        }

      } catch (err) {
        throw Object.assign(new Error('Failed to process Excel file'), { statusCode: 400 });
      }
    },
  );

  /** Get all categories for the upload dialog */
  app.get('/entries/batch/categories', async (_req) => {
    return getAllCategories();
  });

  /** Approve pending Excel entries and add them to the ledger */
  app.post('/entries/batch/approve', async (req, reply) => {
    const entryIds = req.body.entryIds as string[];

    // Validate at least one ID is provided
    if (!entryIds || entryIds.length === 0) {
      throw new Error('At least one entry ID must be provided for approval');
    }

    try {
      // Fetch entries to approve
      const entriesToApprove = await prisma.entry.findMany({
        where: { id: { in: entryIds } },
        include: { category: true }
      });

      let approvedCount = 0;
      for (const entry of entriesToApprove) {
        try {
          const data: any = {
            date: parseDay(entry.date),
            kind: entry.kind,
            amount: entry.amount || 0,
            categoryId: entry.categoryId,
            method: entry.method || 'CASH',
            note: entry.note || '',
            description: entry.description,
            tagsJson: entry.tagsJson || '[]',
          };

          // Preserve debit/credit if they exist (for accounting)
          if (entry.debit !== null && entry.debit > 0) {
            data.debit = entry.debit;
          }
          if (entry.credit !== null && entry.credit > 0) {
            data.credit = entry.credit;
          }

          const updatedEntry = await prisma.entry.update({
            where: { id: entry.id },
            data,
          });

          approvedCount++;
        } catch (err) {
          console.error(`Failed to approve entry ${entry.id}:`, err);
        }
      }

      return reply.code(200).send({
        status: 'success',
        approved: approvedCount,
        errors: [],
        message: `Successfully approved ${approvedCount} entries.`
      });

    } catch (err) {
      const error = err as { statusCode?: number; message?: string };
      return reply.code(error.statusCode || 500).send({
        status: 'error',
        message: error.message || 'Failed to approve entries',
      });
    }
  });

  /** Delete a pending entry */
  app.delete('/entries/batch/:id', async (req) => {
    const { id } = req.params as { id: string };

    try {
      let existingEntry = await prisma.entry.findUnique({ where: { id } });

      if (!existingEntry) {
        throw Object.assign(new Error('Entry not found'), { statusCode: 404 });
      }

      const source = existingEntry.source as string;
      if (!source.includes('PENDING') && source !== 'MANUAL') {
        throw new Error('Only pending Excel entries can be deleted from the batch');
      }

      await prisma.entry.delete({ where: { id } });

      return {
        status: 'success',
        message: `Deleted pending entry ${id}`,
      };

    } catch (err) {
      const error = err as { statusCode?: number; message?: string };
      return {
        status: 'error',
        statusCode: error.statusCode ?? 500,
        message: error.message || 'Failed to delete entry',
      };
    }
  });

  /** Get pending entries for display */
  app.get('/entries/batch/list', async (req) => {
    try {
      const pending = await prisma.entry.findMany({
        where: { source: 'PENDING_EXCEL' },
        include: { category: true },
        orderBy: { createdAt: 'desc' },
      });

      return {
        status: 'success',
        entries: pending.map((e) => ({
          id: e.id,
          srNo: Number(e.id.slice(0, 8)) || 1,
          date: e.date?.toISOString().slice(0, 10) || null,
          kind: e.kind,
          categoryId: e.categoryId,
          categoryName: e.category.name,
          description: e.description || '',
          debit: e.debit ?? null,
          credit: e.credit ?? null,
          method: e.method || 'CASH',
          note: e.note || '',
          status: 'PENDING' as const,
        })),
        count: pending.length,
      };
    } catch (err) {
      return {
        status: 'error',
        statusCode: 500,
        message: 'Failed to fetch pending entries',
      };
    }
  });
};
