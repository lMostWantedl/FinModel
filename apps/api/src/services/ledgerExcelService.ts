import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { prisma } from '../lib/prisma.js';
import { parseDay, reconcileLoanEmis } from './ledgerService.js';

export interface ParsedStatementRow {
  srNo: number;
  date: string; // YYYY-MM-DD
  kind: 'INCOME' | 'EXPENSE';
  amount: number;
  description: string;
  debit: number | null;
  credit: number | null;
  balance: number | null;
  suggestedCategory?: string;
  isDuplicate?: boolean;
}

export interface BatchEntryInput {
  date: string;
  kind: 'INCOME' | 'EXPENSE';
  amount: number;
  categoryId: string;
  method?: string;
  note?: string;
  description?: string;
  debit?: number | null;
  credit?: number | null;
  balance?: number | null;
  tags?: string[];
}

const HEADER_KEYWORDS: Record<string, string[]> = {
  date: ['date', 'dt', 'txn date', 'transaction date', 'value date'],
  desc: ['description', 'desc', 'narration', 'particulars', 'remarks', 'details'],
  debit: ['debit', 'dr', 'withdrawal', 'dr amount', 'debit amount'],
  credit: ['credit', 'cr', 'deposit', 'cr amount', 'credit amount'],
  type: ['type', 'kind', 'txn type', 'transaction type'],
  balance: ['balance', 'bal', 'closing balance', 'running balance'],
  srno: ['sr.no', 'sr no', 's.no', 'sl.no', 'no', 'serial', 'sno'],
};

function parseCellDate(val: unknown): string | null {
  if (!val) return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return val.toISOString().slice(0, 10);
  }
  if (typeof val === 'number') {
    // Excel date serial number
    if (val > 20000 && val < 80000) {
      const ms = (val - 25569) * 86400 * 1000;
      const d = new Date(ms);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
    return null;
  }
  const s = String(val).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10);
  }
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) {
    const day = dmy[1]!.padStart(2, '0');
    const month = dmy[2]!.padStart(2, '0');
    const year = dmy[3]!;
    return `${year}-${month}-${day}`;
  }
  const ymd = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (ymd) {
    const year = ymd[1]!;
    const month = ymd[2]!.padStart(2, '0');
    const day = ymd[3]!.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

function parseCellNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') {
    return isNaN(val) ? null : val;
  }
  if (typeof val === 'string') {
    const clean = val.replace(/[^0-9.-]/g, '');
    if (!clean) return null;
    const num = Number(clean);
    return isNaN(num) ? null : num;
  }
  return null;
}

function guessCategory(desc: string, kind: 'INCOME' | 'EXPENSE'): string {
  const s = desc.toLowerCase();
  if (kind === 'INCOME') {
    if (s.includes('salary') || s.includes('payroll')) return 'Salary';
    if (s.includes('interest') || s.includes('int.pd') || s.includes('int.coll')) return 'Interest';
    if (s.includes('reimburse')) return 'Reimbursement';
    return 'Other income';
  } else {
    // 1. EMI & Loan checks first so payments via UPI handles like @mairtel aren't misclassified as utility bills
    if (
      s.includes('ach dr inw') ||
      s.includes('nach') ||
      s.includes('finserv') ||
      s.includes('kbma') ||
      s.includes('kredit') ||
      s.includes('moneyview') ||
      s.includes('smfg') ||
      s.includes('northern arc') ||
      s.includes('/nort/') ||
      s.includes('/true/') ||
      s.includes('true balance') ||
      s.includes('pln') ||
      s.includes('emi') ||
      s.includes('loan')
    ) {
      return 'EMI';
    }

    if (s.includes('swiggy') || s.includes('zomato') || s.includes('mcdonald') || s.includes('restaurant') || s.includes('starbucks'))
      return 'Food & dining';
    if (s.includes('grocery') || s.includes('supermarket') || s.includes('bigbasket') || s.includes('dmart') || s.includes('blinkit') || s.includes('zepto') || s.includes('instamart'))
      return 'Groceries';
    if (s.includes('uber') || s.includes('ola') || s.includes('fuel') || s.includes('petrol') || s.includes('hpcl') || s.includes('bpcl') || s.includes('metro') || s.includes('irctc'))
      return 'Transport';
    if (s.includes('electricity') || s.includes('bescom') || s.includes('water') || s.includes('gas') || s.includes('broadband') || s.includes('airtel') || s.includes('jio'))
      return 'Utilities';
    if (s.includes('netflix') || s.includes('spotify') || s.includes('prime') || s.includes('youtube') || s.includes('hotstar'))
      return 'Subscriptions';
    if (s.includes('hospital') || s.includes('pharmacy') || s.includes('apollo') || s.includes('medplus') || s.includes('doctor') || s.includes('clinic') || s.includes('1mg'))
      return 'Health';
    if (s.includes('amazon') || s.includes('flipkart') || s.includes('myntra') || s.includes('zara') || s.includes('shopping'))
      return 'Shopping';
    if (s.includes('rent')) return 'Rent';
    if (s.includes('lend')) return 'Lend';
    return 'Other';
  }
}

/** Fallback parser for SheetJS (handles legacy .xls BIFF8, CSV, and HTML tables) */
function parseSheetJSRows(sheet: XLSX.WorkSheet): {
  rows: ParsedStatementRow[];
  totalDebits: number;
  totalCredits: number;
  rowCount: number;
} {
  const data = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, raw: false, defval: '' });
  if (!data || data.length === 0) {
    throw Object.assign(new Error('Worksheet is empty'), { statusCode: 400 });
  }

  let bestHeaderRow = -1;
  let bestScore = 0;
  let bestColMap: Record<string, number> = {};

  const scanLimit = Math.min(data.length, 50);
  for (let r = 0; r < scanLimit; r++) {
    const row = data[r] || [];
    const colMap: Record<string, number> = {};
    let score = 0;

    for (let c = 0; c < row.length; c++) {
      const cellText = String(row[c] || '').trim().toLowerCase();
      if (!cellText) continue;

      for (const [category, keywords] of Object.entries(HEADER_KEYWORDS)) {
        let matched = false;
        for (const kw of keywords) {
          if (cellText === kw) {
            matched = true;
            break;
          } else if (kw.length > 2 && cellText.includes(kw)) {
            matched = true;
            break;
          }
        }
        if (matched && !(category in colMap)) {
          colMap[category] = c;
          score += 1;
          break;
        }
      }
    }

    if (colMap['date'] && (colMap['debit'] || colMap['credit'] || colMap['desc'])) {
      if (score > bestScore) {
        bestScore = score;
        bestHeaderRow = r;
        bestColMap = colMap;
      }
    }
  }

  if (bestHeaderRow === -1) {
    throw Object.assign(
      new Error(
        'Could not identify table headers in spreadsheet. Expected columns like Date, Description, Debit, Credit.',
      ),
      { statusCode: 400 },
    );
  }

  const rows: ParsedStatementRow[] = [];
  let totalDebits = 0;
  let totalCredits = 0;

  for (let r = bestHeaderRow + 1; r < data.length; r++) {
    const row = data[r] || [];
    const dateVal = bestColMap['date'] !== undefined ? parseCellDate(row[bestColMap['date']]) : null;
    const descVal = bestColMap['desc'] !== undefined ? String(row[bestColMap['desc']] || '').trim() : '';
    const typeVal =
      bestColMap['type'] !== undefined ? String(row[bestColMap['type']] || '').trim().toLowerCase() : '';
    const drVal = bestColMap['debit'] !== undefined ? parseCellNumber(row[bestColMap['debit']]) : null;
    const crVal = bestColMap['credit'] !== undefined ? parseCellNumber(row[bestColMap['credit']]) : null;
    const balVal = bestColMap['balance'] !== undefined ? parseCellNumber(row[bestColMap['balance']]) : null;
    const srNoVal = bestColMap['srno'] !== undefined ? parseCellNumber(row[bestColMap['srno']]) : null;

    if (!dateVal && !descVal && drVal === null && crVal === null) continue;

    const isCredit = typeVal.includes('credit') || (crVal !== null && crVal > 0);
    const kind: 'INCOME' | 'EXPENSE' = isCredit ? 'INCOME' : 'EXPENSE';
    const amount = isCredit ? (crVal ?? drVal ?? 0) : (drVal ?? crVal ?? 0);

    if (amount <= 0 && !descVal) continue;

    if (kind === 'INCOME') totalCredits += amount;
    else totalDebits += amount;

    rows.push({
      srNo: srNoVal ?? rows.length + 1,
      date: dateVal || new Date().toISOString().slice(0, 10),
      kind,
      amount,
      description: descVal,
      debit: drVal,
      credit: crVal,
      balance: balVal,
      suggestedCategory: guessCategory(descVal, kind),
    });
  }

  return {
    rows,
    totalDebits: Math.round(totalDebits * 100) / 100,
    totalCredits: Math.round(totalCredits * 100) / 100,
    rowCount: rows.length,
  };
}

/**
 * Generate a consistent transaction fingerprint for deduplication.
 */
export function buildEntryFingerprint(
  item: {
    date: string | Date;
    kind: string;
    amount: number;
    description?: string | null;
    note?: string | null;
    balance?: number | null;
  },
  includeBalance = true,
): string {
  const dateStr = typeof item.date === 'string' ? item.date.slice(0, 10) : item.date.toISOString().slice(0, 10);
  const kindStr = item.kind.toUpperCase();
  const amtStr = Number(item.amount).toFixed(2);
  const descStr = (item.description || item.note || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  const balStr =
    includeBalance && item.balance !== null && item.balance !== undefined
      ? Number(item.balance).toFixed(2)
      : '';
  return `${dateStr}__${kindStr}__${amtStr}__${descStr}__${balStr}`;
}

/**
 * Annotate parsed rows with duplicate status by checking existing database records.
 */
export async function annotateDuplicates(rows: ParsedStatementRow[]): Promise<{
  rows: ParsedStatementRow[];
  duplicateCount: number;
  newCount: number;
}> {
  if (rows.length === 0) {
    return { rows: [], duplicateCount: 0, newCount: 0 };
  }

  // Get date range from rows with buffer for timezone differences
  const dates = rows.map((r) => r.date).filter(Boolean);
  let existingEntries: Array<{
    date: Date;
    kind: string;
    amount: number;
    description: string | null;
    note: string | null;
    balance: number | null;
  }> = [];

  if (dates.length > 0) {
    const sorted = [...dates].sort();
    const minDate = new Date(`${sorted[0]}T00:00:00.000Z`);
    minDate.setUTCDate(minDate.getUTCDate() - 1);
    const maxDate = new Date(`${sorted[sorted.length - 1]}T23:59:59.999Z`);
    maxDate.setUTCDate(maxDate.getUTCDate() + 1);

    existingEntries = await prisma.entry.findMany({
      where: {
        date: {
          gte: minDate,
          lte: maxDate,
        },
      },
      select: {
        date: true,
        kind: true,
        amount: true,
        description: true,
        note: true,
        balance: true,
      },
    });
  }

  // Multiset counter for existing entries
  const exactCounts = new Map<string, number>();
  const noBalCounts = new Map<string, number>();

  for (const e of existingEntries) {
    const exactKey = buildEntryFingerprint(e, true);
    exactCounts.set(exactKey, (exactCounts.get(exactKey) || 0) + 1);

    if (e.balance === null || e.balance === undefined) {
      const noBalKey = buildEntryFingerprint(e, false);
      noBalCounts.set(noBalKey, (noBalCounts.get(noBalKey) || 0) + 1);
    }
  }

  let duplicateCount = 0;
  for (const row of rows) {
    const exactKey = buildEntryFingerprint(row, true);
    const exactAvailable = exactCounts.get(exactKey) || 0;

    if (exactAvailable > 0) {
      row.isDuplicate = true;
      duplicateCount++;
      exactCounts.set(exactKey, exactAvailable - 1);
      continue;
    }

    // Fallback: if row has balance but DB entry had balance null
    if (row.balance !== null && row.balance !== undefined) {
      const noBalKey = buildEntryFingerprint(row, false);
      const noBalAvailable = noBalCounts.get(noBalKey) || 0;
      if (noBalAvailable > 0) {
        row.isDuplicate = true;
        duplicateCount++;
        noBalCounts.set(noBalKey, noBalAvailable - 1);
        continue;
      }
    }

    row.isDuplicate = false;
  }

  return {
    rows,
    duplicateCount,
    newCount: rows.length - duplicateCount,
  };
}

/** Parse an uploaded Excel file for income/expense entries */
export async function parseExcelStatement(
  buffer: Buffer,
): Promise<{
  rows: ParsedStatementRow[];
  totalDebits: number;
  totalCredits: number;
  rowCount: number;
  duplicateCount: number;
  newCount: number;
}> {
  let parsed: {
    rows: ParsedStatementRow[];
    totalDebits: number;
    totalCredits: number;
    rowCount: number;
  };

  // 1. Check if file is OLE2 Compound Document (magic bytes 0xD0CF11E0)
  // This indicates either a legacy Excel 97-2004 (.xls) file OR an encrypted/password-protected .xlsx file!
  if (buffer.length >= 8 && buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0) {
    try {
      const wb = XLSX.read(buffer, { type: 'buffer' });
      const sheetName = wb.SheetNames[0];
      const firstSheet = sheetName ? wb.Sheets[sheetName] : undefined;
      if (!firstSheet) throw new Error('Worksheet is empty');
      parsed = parseSheetJSRows(firstSheet);
    } catch (err: any) {
      if (err.message && err.message.toLowerCase().includes('password')) {
        throw Object.assign(
          new Error(
            'This statement is password-protected by your bank. Please open it in Microsoft Excel, enter your password, and "Save As" an unprotected .xlsx workbook (e.g. Statements2.xlsx) before uploading.',
          ),
          { statusCode: 400 },
        );
      }
      throw Object.assign(
        new Error(
          'This file is encrypted or in legacy binary Excel (.xls) format that could not be decrypted. Please save it as an unprotected .xlsx workbook in Excel and re-upload.',
        ),
        { statusCode: 400 },
      );
    }
  } else {
    // 2. Try parsing as OpenXML (.xlsx) using ExcelJS
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as any);
    } catch (err: any) {
      // If ExcelJS fails because it's not a valid zip archive, check if it's password protected or alternative format
      if (
        err.message?.includes("Can't find end of central directory") ||
        err.message?.includes('is this a zip file') ||
        err.message?.includes('Corrupted zip')
      ) {
        try {
          const wb = XLSX.read(buffer, { type: 'buffer' });
          const sheetName = wb.SheetNames[0];
          const firstSheet = sheetName ? wb.Sheets[sheetName] : undefined;
          if (!firstSheet) throw new Error('Worksheet is empty');
          parsed = parseSheetJSRows(firstSheet);
        } catch (xlsxErr: any) {
          if (xlsxErr.message && xlsxErr.message.toLowerCase().includes('password')) {
            throw Object.assign(
              new Error(
                'This statement is password-protected by your bank. Please open it in Microsoft Excel, enter your password, and "Save As" an unprotected .xlsx workbook (e.g. Statements2.xlsx) before uploading.',
              ),
              { statusCode: 400 },
            );
          }
          throw Object.assign(
            new Error(
              'The uploaded file is not a valid or unencrypted .xlsx workbook. If this bank statement is password-protected, please open it in Excel, enter your password, and "Save As" an unprotected .xlsx file before uploading.',
            ),
            { statusCode: 400 },
          );
        }
      } else {
        throw err;
      }
    }

    if (!parsed!) {
      const worksheet = workbook.worksheets[0];
      if (!worksheet || worksheet.rowCount === 0) {
        throw Object.assign(new Error('Worksheet is empty'), { statusCode: 400 });
      }

      // Scan rows 1 to 50 for the header row
      let bestHeaderRow = -1;
      let bestScore = 0;
      let bestColMap: Record<string, number> = {};

      const scanLimit = Math.min(worksheet.rowCount, 50);
      for (let r = 1; r <= scanLimit; r++) {
        const row = worksheet.getRow(r);
        const colMap: Record<string, number> = {};
        let score = 0;

        for (let c = 1; c <= Math.max(row.cellCount, 20); c++) {
          const cellText = String(row.getCell(c).text || row.getCell(c).value || '')
            .trim()
            .toLowerCase();
          if (!cellText) continue;

          for (const [category, keywords] of Object.entries(HEADER_KEYWORDS)) {
            let matched = false;
            for (const kw of keywords) {
              if (cellText === kw) {
                matched = true;
                break;
              } else if (kw.length > 2 && cellText.includes(kw)) {
                matched = true;
                break;
              }
            }
            if (matched && !(category in colMap)) {
              colMap[category] = c;
              score += 1;
              break;
            }
          }
        }

        if (colMap['date'] && (colMap['debit'] || colMap['credit'] || colMap['desc'])) {
          if (score > bestScore) {
            bestScore = score;
            bestHeaderRow = r;
            bestColMap = colMap;
          }
        }
      }

      if (bestHeaderRow === -1) {
        throw Object.assign(
          new Error('Could not identify table headers in spreadsheet. Expected columns like Date, Description, Debit, Credit.'),
          { statusCode: 400 },
        );
      }

      const rows: ParsedStatementRow[] = [];
      let totalDebits = 0;
      let totalCredits = 0;

      for (let r = bestHeaderRow + 1; r <= worksheet.rowCount; r++) {
        const row = worksheet.getRow(r);

        const dateVal = bestColMap['date'] ? parseCellDate(row.getCell(bestColMap['date']).value) : null;
        const descVal = bestColMap['desc']
          ? String(row.getCell(bestColMap['desc']).text || row.getCell(bestColMap['desc']).value || '').trim()
          : '';
        const typeVal = bestColMap['type']
          ? String(row.getCell(bestColMap['type']).text || row.getCell(bestColMap['type']).value || '').trim().toLowerCase()
          : '';
        const drVal = bestColMap['debit'] ? parseCellNumber(row.getCell(bestColMap['debit']).value) : null;
        const crVal = bestColMap['credit'] ? parseCellNumber(row.getCell(bestColMap['credit']).value) : null;
        const balVal = bestColMap['balance'] ? parseCellNumber(row.getCell(bestColMap['balance']).value) : null;
        const srNoVal = bestColMap['srno'] ? parseCellNumber(row.getCell(bestColMap['srno']).value) : null;

        // Skip empty rows
        if (!dateVal && !descVal && drVal === null && crVal === null) {
          continue;
        }

        // Determine direction
        const isCredit = typeVal.includes('credit') || (crVal !== null && crVal > 0);
        const kind: 'INCOME' | 'EXPENSE' = isCredit ? 'INCOME' : 'EXPENSE';
        const amount = isCredit ? (crVal ?? drVal ?? 0) : (drVal ?? crVal ?? 0);

        if (amount <= 0 && !descVal) {
          continue;
        }

        if (kind === 'INCOME') totalCredits += amount;
        else totalDebits += amount;

        rows.push({
          srNo: srNoVal ?? rows.length + 1,
          date: dateVal || new Date().toISOString().slice(0, 10),
          kind,
          amount,
          description: descVal,
          debit: drVal,
          credit: crVal,
          balance: balVal,
          suggestedCategory: guessCategory(descVal, kind),
        });
      }

      parsed = {
        rows,
        totalDebits: Math.round(totalDebits * 100) / 100,
        totalCredits: Math.round(totalCredits * 100) / 100,
        rowCount: rows.length,
      };
    }
  }

  // Annotate duplicates against existing entries in ledger
  const annotated = await annotateDuplicates(parsed.rows);

  return {
    rows: annotated.rows,
    totalDebits: parsed.totalDebits,
    totalCredits: parsed.totalCredits,
    rowCount: parsed.rowCount,
    duplicateCount: annotated.duplicateCount,
    newCount: annotated.newCount,
  };
}

/** Save batch of approved entries directly into the ledger, safely filtering out duplicates */
export async function saveBatchEntries(
  entries: BatchEntryInput[],
): Promise<{ count: number; skippedDuplicates: number }> {
  if (!entries || entries.length === 0) {
    return { count: 0, skippedDuplicates: 0 };
  }

  // Query existing entries in date range to prevent duplicate insertion
  const dates = entries.map((e) => e.date).filter(Boolean);
  let existingEntries: Array<{
    date: Date;
    kind: string;
    amount: number;
    description: string | null;
    note: string | null;
    balance: number | null;
  }> = [];

  if (dates.length > 0) {
    const sorted = [...dates].sort();
    const minDate = new Date(`${sorted[0]}T00:00:00.000Z`);
    minDate.setUTCDate(minDate.getUTCDate() - 1);
    const maxDate = new Date(`${sorted[sorted.length - 1]}T23:59:59.999Z`);
    maxDate.setUTCDate(maxDate.getUTCDate() + 1);

    existingEntries = await prisma.entry.findMany({
      where: {
        date: {
          gte: minDate,
          lte: maxDate,
        },
      },
      select: {
        date: true,
        kind: true,
        amount: true,
        description: true,
        note: true,
        balance: true,
      },
    });
  }

  const exactCounts = new Map<string, number>();
  const noBalCounts = new Map<string, number>();

  for (const e of existingEntries) {
    const exactKey = buildEntryFingerprint(e, true);
    exactCounts.set(exactKey, (exactCounts.get(exactKey) || 0) + 1);

    if (e.balance === null || e.balance === undefined) {
      const noBalKey = buildEntryFingerprint(e, false);
      noBalCounts.set(noBalKey, (noBalCounts.get(noBalKey) || 0) + 1);
    }
  }

  // Filter out any entries that already exist in database
  const validNewEntries: BatchEntryInput[] = [];
  let skippedDuplicates = 0;

  for (const e of entries) {
    const exactKey = buildEntryFingerprint(e, true);
    const exactAvail = exactCounts.get(exactKey) || 0;
    if (exactAvail > 0) {
      skippedDuplicates++;
      exactCounts.set(exactKey, exactAvail - 1);
      continue;
    }

    if (e.balance !== null && e.balance !== undefined) {
      const noBalKey = buildEntryFingerprint(e, false);
      const noBalAvail = noBalCounts.get(noBalKey) || 0;
      if (noBalAvail > 0) {
        skippedDuplicates++;
        noBalCounts.set(noBalKey, noBalAvail - 1);
        continue;
      }
    }

    validNewEntries.push(e);
  }

  if (validNewEntries.length === 0) {
    return { count: 0, skippedDuplicates };
  }

  const categories = await prisma.category.findMany();
  const categoryMap = new Map(categories.map((c) => [c.id, c]));

  // Default fallback categories
  const defaultExpense = categories.find((c) => c.kind === 'EXPENSE');
  const defaultIncome = categories.find((c) => c.kind === 'INCOME');

  const createData = validNewEntries.map((e) => {
    let catId = e.categoryId;
    const matched = categoryMap.get(catId);
    if (!matched || matched.kind !== e.kind) {
      catId = (e.kind === 'INCOME' ? defaultIncome?.id : defaultExpense?.id) ?? catId;
    }

    return {
      date: parseDay(e.date),
      kind: e.kind,
      amount: e.amount,
      categoryId: catId,
      method: e.method || 'BANK',
      note: e.note || '',
      description: e.description || null,
      debit: e.debit ?? (e.kind === 'EXPENSE' ? e.amount : null),
      credit: e.credit ?? (e.kind === 'INCOME' ? e.amount : null),
      balance: e.balance ?? null,
      tagsJson: JSON.stringify(e.tags || ['excel-import']),
      source: 'MANUAL',
    };
  });

  // Batch insert into database
  const res = await prisma.entry.createMany({
    data: createData,
  });

  // Automatically reconcile newly imported entries with loan EMIs in real time
  await reconcileLoanEmis();

  return { count: res.count, skippedDuplicates };
}
