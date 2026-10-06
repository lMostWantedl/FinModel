import ExcelJS from 'exceljs';
import { prisma } from '../lib/prisma.js';
import { batchEntrySchema, entryBodySchema } from '../schemas.js';
import { dateKey, parseDay } from './ledgerService.js';

/** Row data from the Excel spreadsheet matching: Sr.no | Date | Type | Description | Debit | Credit | Balance */
export interface ExcelImportRow {
  srNo?: number; // Row number (for display)
  date?: string; // YYYY-MM-DD format
  type?: string; // INCOME or EXPENSE (will be normalized)
  description?: string; // Description/note for the entry
  debit?: number; // Debit amount
  credit?: number; // Credit amount
  balance?: number; // Running balance after this entry
}

/** Type of entry in the Excel import */
export interface ImportEntry {
  srNo: number;
  date: string | null;
  kind: 'INCOME' | 'EXPENSE';
  categoryId: string;
  description: string | null;
  debit: number | null;
  credit: number | null;
  balance: number | null;
  method: string;
  note: string;
  tags: string[];
  status: 'PENDING' | 'APPROVED';
  id?: string; // For pending entries, we'll generate IDs during approval
}

/** Excel header aliases for flexible column naming */
const HEADER_ALIASES: Record<string, string> = {
  srNo: 'sr.no',
  serial: 'serial',
  serial_no: 'serial_no',
  serno: 'serno',
  no: 'no',
  date: 'dt',
  dt: 'dt',
  dte: 'dte',
  type: 'kind',
  kind: 'type',
  description: 'desc',
  desc: 'desc',
  note: 'notes',
  notes: 'notes',
  debit: 'dr',
  dr: 'debit',
  credit: 'cr',
  cr: 'credit',
  balance: 'bal',
  bal: 'balance',
  category: 'categoryId',
  categoryId: 'category.id',
  method: 'paymode',
  paymode: 'method',
};

/** Map Excel headers to their normalized internal names */
function normalizeHeader(header: string): string | null {
  const lower = header.toLowerCase().trim();
  return HEADER_ALIASES[lower] || null;
}

/** Normalize type text to INCOME or EXPENSE - handles Transfer Debit/Credit and standard types */
function normalizeType(type: unknown): 'INCOME' | 'EXPENSE' {
  if (typeof type === 'string') {
    const normalized = type.toLowerCase().trim();

    // Handle Transfer Debit / Transfer Credit patterns first
    if (normalized.includes('credit')) return 'INCOME';
    if (normalized.includes('debit') && !normalized.includes('credit')) return 'EXPENSE';

    // Standard type mappings
    if (normalized === 'income') return 'INCOME';
    if (normalized === 'expense') return 'EXPENSE';
    if (normalized === 'withdrawal' || normalized === 'outgoing') return 'EXPENSE';
  }
  throw new Error(`Invalid type: ${String(type)}. Use INCOME, EXPENSE, Transfer Debit, or Transfer Credit.`);
}

/** Extract date from Sr.no field (if it looks like a date) */
function extractDateFromSrNo(srNoValue: unknown): string | null {
  if (typeof srNoValue === 'string') {
    const s = srNoValue.trim();
    // Check if it's a valid date format (YYYY-MM-DD)
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  }
  return null;
}

/** Extract actual row number from Excel row object */
function extractRowNumber(worksheet: any, rowIndex: number): number {
  try {
    const rowObj = worksheet.getRow(rowIndex);
    for (let col = 1; col <= rowObj.columns.length; col++) {
      const cellValue = rowObj.getCell(col).value;
      if (typeof cellValue === 'number' && Number.isInteger(cellValue) && cellValue > 0) {
        return cellValue;
      }
    }
  } catch (err) {
    // Fallback to index-based number
  }
  return rowIndex - 1; // Use 1-based row index as srNo if no valid number found
}

/** Calculate amount from debit/credit fields (single-value rows) */
function calculateAmount(debit: number | null, credit: number | null): number | null {
  // Only one of debit or credit should have a value in this format
  if ((debit !== null && debit > 0) || (credit !== null && credit > 0)) {
    return debit ?? credit;
  }
  return null;
}

/** Convert Excel row to ImportEntry */
export function excelRowToImport(row: Partial<ExcelImportRow>, categoryId: string): ImportEntry | null {
  // Skip empty rows
  const srNo = row.srNo || Number(row['Sr.no']) || Number(row.serial) || Number(row['serial_no']);
  if (!srNo && !row.date && !row.type) return null;

  const date = row.date ? String(row.date).trim() : null;
  const typeRaw = row.type || 'INCOME';
  const kind = normalizeType(typeRaw);

  // Extract debit/credit values (one column will have value, the other empty in this format)
  const debitValue: number | null = Array.isArray(row.debit) ? Number(row.debit[0]) : Number(row.debit) || null;
  const creditValue: number | null = Array.isArray(row.credit) ? Number(row.credit[0]) : Number(row.credit) || null;

  // Extract description (may be array from ExcelJS)
  const description = typeof row.description === 'string' 
    ? row.description 
    : Array.isArray(row.description) && row.description.length > 0 ? String(row.description[0]) : null;

  const note = typeof row.note === 'string' ? row.note.trim() : description?.trim() || '';
  const method = typeof row.method === 'string' 
    ? row.method.toUpperCase().replace(/[^A-Z]/g, '') 
    : 'CASH';

  let tags: string[] = [];
  if (typeof row.tags === 'string') {
    tags = row.tags.split(',').map((t) => t.trim()).filter((t) => t);
  } else if (Array.isArray(row.tags)) {
    tags = row.tags.filter((t) => typeof t === 'string' && t.trim());
  }

  const amount = calculateAmount(debitValue, creditValue);
  
  if (!amount && !debitValue && !creditValue) {
    // No valid numeric value found - this is an error for this row format
    return null;
  }

  return {
    srNo,
    date,
    kind,
    categoryId,
    description: description || null,
    debit: debitValue,
    credit: creditValue,
    balance: row.balance ?? null, // Store for reference if present
    method,
    note,
    tags,
    status: 'PENDING',
  };
}

/** Parse an uploaded Excel file for income/expense entries */
export async function parseExcelForEntries(
  buffer: Buffer,
): Promise<{ success: number; errors: string[] }> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (err) {
    throw Object.assign(new Error('Failed to parse Excel file'), { statusCode: 400 });
  }

  const worksheet = workbook.getWorksheet(1) || workbook.worksheets[0];
  
  // Find the first row with data
  let headerRow = -1;
  for (let i = 1; i <= worksheet.rowCount; i++) {
    const rowValues = worksheet.getRow(i).values as unknown[];
    const hasData = rowValues.some((v) => v !== undefined && v !== null && String(v).trim() !== '');
    if (hasData) headerRow = i;
  }

  if (headerRow === -1) {
    throw new Error('No data found in Excel file');
  }

  const normalizedHeaders: Record<string, string | null> = {};
  for (let col = 1; col <= worksheet.columns.length; col++) {
    const headerText = String(worksheet.getCell(`A${headerRow}`)?.value || '').trim();
    normalizedHeaders[col] = normalizeHeader(headerText);
  }

  // Map columns to indices
  const dateColIndex: number | null = Object.values(normalizedHeaders).findIndex(
    (h) => h === 'date',
  );
  const typeColIndex: number | null = Object.values(normalizedHeaders).findIndex(
    (h) => h === 'kind' || h === 'type',
  );
  const descColIndex: number | null = Object.values(normalizedHeaders).findIndex(
    (h) => h === 'description' || h === 'desc' || h === 'note',
  );
  const debitColIndex: number | null = Object.values(normalizedHeaders).findIndex(
    (h) => h === 'debit' || h === 'dr',
  );
  const creditColIndex: number | null = Object.values(normalizedHeaders).findIndex(
    (h) => h === 'credit' || h === 'cr' || h === 'bal',
  );
  const balanceColIndex: number | null = Object.values(normalizedHeaders).findIndex(
    (h) => h === 'balance' || h === 'bal',
  );

  const validColumns = ['date', 'kind', 'type', 'description', 'debit', 'credit', 'balance'];
  if (!validColumns.some((c) => Object.values(normalizedHeaders).includes(c))) {
    throw new Error('Invalid Excel format. Expected columns: Sr.no, Date, Type, Description, Debit, Credit, Balance');
  }

  const rows: ImportEntry[] = [];
  const errors: string[] = [];

  // Skip header row
  for (let i = headerRow + 1; i <= worksheet.rowCount; i++) {
    try {
      const rowValues = worksheet.getRow(i).values as unknown[];
      const srNoVal = Number(rowValues[0]);
      if (!srNoVal) continue; // Skip empty rows

      // Extract values based on normalized header positions
      const dateValue: string | null = Array.isArray(rowValues[dateColIndex!])
        ? String(rowValues[dateColIndex!]).trim() || null
        : rowValues[dateColIndex!] && String(rowValues[dateColIndex!]).trim()
          ? String(rowValues[dateColIndex!]).trim()
          : null;

      const typeValue: string = Array.isArray(rowValues[typeColIndex!])
        ? String(rowValues[typeColIndex!]).toUpperCase().trim()
        : rowValues[typeColIndex!] && String(rowValues[typeColIndex!]).toUpperCase().trim()
          ? String(rowValues[typeColIndex!]).toUpperCase().trim()
          : 'INCOME';

      const descriptionValue: string | null = Array.isArray(rowValues[descColIndex!])
        ? (rowValues[descColIndex!]?.toString()?.trim() || null)
        : rowValues[descColIndex!] && String(rowValues[descColIndex!]).trim()
          ? String(rowValues[descColIndex!]).trim()
          : null;

      const debitValue: number | null = Array.isArray(rowValues[debitColIndex!])
        ? Number(rowValues[debitColIndex!]) || null
        : rowValues[debitColIndex!] && typeof rowValues[debitColIndex!] === 'number'
          ? rowValues[debitColIndex!]
          : null;

      const creditValue: number | null = Array.isArray(rowValues[creditColIndex!])
        ? Number(rowValues[creditColIndex!]) || null
        : rowValues[creditColIndex!] && typeof rowValues[creditColIndex!] === 'number'
          ? rowValues[creditColIndex!]
          : null;

      const balanceValue: number | null = Array.isArray(rowValues[balanceColIndex!])
        ? Number(rowValues[balanceColIndex!]) || null
        : rowValues[balanceColIndex!] && typeof rowValues[balanceColIndex!] === 'number'
          ? rowValues[balanceColIndex!]
          : null;

      const entry = excelRowToImport(
        {
          srNo,
          date: dateValue,
          type: typeValue,
          description: descriptionValue,
          debit: debitValue,
          credit: creditValue,
          balance: balanceValue,
        },
        // categoryId will be set by the route handler
      );
      
      if (entry) {
        rows.push(entry);
      } else {
        errors.push(`Row ${srNo}: Could not parse entry`);
      }
    } catch (err) {
      const rowNum = i - headerRow + 1;
      errors.push(`Row ${rowNum}: ${String(err)}: ${typeof rowValues[0] === 'number' ? rowValues[0] : String(rowValues[0])}`);
    }
  }

  return { success: rows.length, errors };
}

/** Create pending batch entries for approval */
export async function createPendingBatchEntries(
  entries: ImportEntry[],
  categoryId: string,
): Promise<{ success: number; created: number; skipped: number }> {
  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category) throw Object.assign(new Error('Category not found'), { statusCode: 404 });

  const now = new Date();
  let createdCount = 0;
  let skippedCount = 0;

  for (const entry of entries) {
    try {
      // Calculate amount from the non-null debit/credit value
      const amount = calculateAmount(entry.debit, entry.credit);

      if (!amount && !entry.debit && !entry.credit) {
        skippedCount++;
        continue;
      }

      const data: any = {
        date: entry.date ? parseDay(entry.date) : now,
        kind: entry.kind,
        categoryId: category.id,
        description: entry.description,
        status: 'PENDING',
      };

      if (amount !== null && amount > 0) {
        data.amount = parseFloat(amount.toFixed(2));
      } else {
        // Set debit/credit values as needed for accounting entries
        if (entry.debit !== null) data.debit = entry.debit;
        if (entry.credit !== null) data.credit = entry.credit;
      }

      if (entry.note && entry.note.trim()) {
        data.note = entry.note.trim();
      } else if (entry.description?.trim()) {
        data.note = entry.description.trim();
      }

      if (entry.method && ['CASH', 'BANK', 'UPI', 'CREDIT_CARD'].includes(entry.method)) {
        data.method = entry.method;
      }

      // Handle tags
      if (entry.tags && entry.tags.length > 0) {
        const validTags: string[] = [];
        for (const tag of entry.tags) {
          const cleanTag = String(tag).trim();
          if (cleanTag && cleanTag.length > 0 && cleanTag.length <= 20) {
            validTags.push(cleanTag);
          }
        }
        if (validTags.length > 0) data.tagsJson = JSON.stringify(validTags.slice(0, 10));
      }

      const newEntry = await prisma.entry.create({ data });
      
      // Create a pending entry for approval - we'll use source field to mark as pending
      // Actually, we need a separate field. Let's add status as part of the note or create a separate record
      // For now, let's mark with a special prefix in note
      
      await prisma.entry.update({
        where: { id: newEntry.id },
        data: { 
          source: 'PENDING_EXCEL' || undefined,
          note: (entry.note || entry.description || '') + 
                (entry.note ? ` [pending Excel approval]` : '') || '' 
        }
      });

      createdCount++;
    } catch (err) {
      console.error(`Failed to create batch entry ${entry.srNo}:`, err);
      skippedCount++;
    }
  }

  return { success: entries.length, created: createdCount, skipped: skippedCount };
}

/** Approve pending Excel entries and convert them to regular entries */
export async function approvePendingExcelEntries(
  entryIds?: string[],
): Promise<{ approved: number; failed: number; errors: string[] }> {
  let approvedCount = 0;
  let failedCount = 0;
  const errors: string[] = [];

  // Fetch all pending Excel entries if no IDs provided
  let entriesToApprove;
  if (entryIds && entryIds.length > 0) {
    try {
      entriesToApprove = await prisma.entry.findMany({
        where: { id: { in: entryIds } },
      });
    } catch (err) {
      throw Object.assign(new Error('Failed to fetch entries'), { statusCode: 500 });
    }
  } else {
    const pendingEntries = await prisma.entry.findMany({
      where: { source: 'PENDING_EXCEL' },
      include: { category: true },
    });
    entriesToApprove = pendingEntries;
  }

  for (const entry of entriesToApprove) {
    try {
      const source = entry.source as string;
      
      if (!source.includes('PENDING')) {
        continue; // Not a pending Excel entry
      }

      const data: any = {
        date: parseDay(entry.date),
        kind: entry.kind,
        amount: entry.amount,
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
      if (entry.balance !== null) {
        data.balance = entry.balance;
      }

      const existingEntry = await prisma.entry.findUnique({ where: { id: entry.id } });
      if (!existingEntry) {
        throw Object.assign(new Error('Entry not found'), { statusCode: 404 });
      }

      const updatedEntry = await prisma.entry.update({
        where: { id: entry.id },
        data: {
          date: data.date,
          kind: data.kind,
          amount: data.amount ?? existingEntry.amount,
          categoryId: data.categoryId,
          method: data.method,
          note: data.note,
          description: data.description,
          tagsJson: data.tagsJson,
        },
      });

      // Now delete the original pending entry (without debit/credit fields)
      await prisma.entry.update({
        where: { id: entry.id },
        data: { 
          source: 'MANUAL' || undefined, // Remove pending flag
        }
      });

      approvedCount++;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      errors.push(`Entry ${entry.id}: ${errorMsg}`);
      failedCount++;
    }
  }

  return { 
    approved: approvedCount, 
    failed: failedCount, 
    errors: entryIds && entryIds.length > 0 ? errors : [] 
  };
}

/** Revert a single pending Excel entry */
export async function revertPendingExcelEntry(id: string): Promise<boolean> {
  try {
    const entry = await prisma.entry.findUnique({ where: { id } });
    if (!entry) throw Object.assign(new Error('Entry not found'), { statusCode: 404 });

    // Check if it's a pending Excel entry
    const source = entry.source as string;
    if (!source.includes('PENDING')) {
      throw new Error('Entry is not in pending status');
    }

    await prisma.entry.update({
      where: { id },
      data: {
        description: null, // Remove Excel-specific fields
        source: 'MANUAL' || undefined,
      },
    });

    return true;
  } catch (err) {
    console.error(`Failed to revert entry ${id}:`, err);
    return false;
  }
}

/** Get all pending Excel entries for the approval dialog */
export async function getPendingExcelEntries(): Promise<ImportEntry[]> {
  const pending = await prisma.entry.findMany({
    where: { source: 'PENDING_EXCEL' },
    include: { category: true },
    orderBy: { date: 'desc' },
  });

  return pending.map((e) => ({
    srNo: Number(e.id.slice(0, 8)), // Use ID prefix as sr.no for display
    date: e.date ? e.date.toISOString().slice(0, 10) : null,
    kind: e.kind,
    categoryId: e.categoryId,
    description: e.description,
    debit: e.debit,
    credit: e.credit,
    balance: e.balance,
    method: e.method || 'CASH',
    note: e.note || '',
    tags: JSON.parse(e.tagsJson || '[]'),
    status: 'PENDING' as const,
  }));
}
