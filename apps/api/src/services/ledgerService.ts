import { prisma } from '../lib/prisma.js';

export type EntryKind = 'INCOME' | 'EXPENSE';
export type Granularity = 'day' | 'week' | 'month';

export interface LedgerEntry {
  id: string;
  date: string; // YYYY-MM-DD
  kind: EntryKind;
  amount: number;
  categoryId: string;
  categoryName: string;
  method: string;
  note: string;
  tags: string[];
  source: 'MANUAL' | 'EMI_AUTO' | 'SUB_AUTO';
  loanId: string | null;
  attachments: { id: string; filename: string; size: number; mimeType: string }[];
}

const PRESET_CATEGORIES: { name: string; kind: EntryKind }[] = [
  { name: 'Salary', kind: 'INCOME' },
  { name: 'Business', kind: 'INCOME' },
  { name: 'Interest', kind: 'INCOME' },
  { name: 'Other income', kind: 'INCOME' },
  { name: 'Rent', kind: 'EXPENSE' },
  { name: 'Groceries', kind: 'EXPENSE' },
  { name: 'Food & dining', kind: 'EXPENSE' },
  { name: 'Transport', kind: 'EXPENSE' },
  { name: 'Utilities', kind: 'EXPENSE' },
  { name: 'Health', kind: 'EXPENSE' },
  { name: 'Entertainment', kind: 'EXPENSE' },
  { name: 'Shopping', kind: 'EXPENSE' },
  { name: 'Education', kind: 'EXPENSE' },
  { name: 'EMI', kind: 'EXPENSE' },
  { name: 'Subscriptions', kind: 'EXPENSE' },
  { name: 'Fees & charges', kind: 'EXPENSE' },
  { name: 'Other', kind: 'EXPENSE' },
  { name: 'Reimbursement', kind: 'INCOME' },
  { name: 'Lend', kind: 'EXPENSE' },
];

export async function seedPresetCategories(): Promise<void> {
  for (const c of PRESET_CATEGORIES) {
    await prisma.category.upsert({
      where: { name_kind: { name: c.name, kind: c.kind } },
      update: { preset: true },
      create: { ...c, preset: true },
    });
  }
}

export const dateKey = (d: Date): string => d.toISOString().slice(0, 10);

/** Get all categories for the Excel import dialog */
export async function getAllCategories(): Promise<{ id: string; name: string; kind: 'INCOME' | 'EXPENSE' }[]> {
  const categories = await prisma.category.findMany({
    select: { id: true, name: true, kind: true },
    orderBy: [{ kind: 'asc' }, { name: 'asc' }],
  });
  
  // Add type based on kind
  return categories.map((c) => ({
    ...c,
    type: c.kind, // INCOME or EXPENSE
  }));
}
export const monthKey = (d: Date): string => d.toISOString().slice(0, 7);
export const parseDay = (s: string): Date => new Date(`${s}T00:00:00.000Z`);

/** Monday of the ISO week containing d (UTC). */
export function weekStart(d: Date): Date {
  const day = (d.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  const out = new Date(d);
  out.setUTCDate(d.getUTCDate() - day);
  return out;
}

export function bucketKey(d: Date, granularity: Granularity): string {
  if (granularity === 'day') return dateKey(d);
  if (granularity === 'week') return dateKey(weekStart(d));
  return monthKey(d);
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

interface AutoRow {
  date: Date;
  kind: string;
  amount: number;
  categoryId: string;
  method: string;
  note: string;
  tagsJson: string;
  source: string;
  loanId?: string;
  subscriptionId?: string;
  periodKey: string;
}

/** Monthly due dates from `start`, clamped to month length, up to `end`. */
function* monthlyDueDates(start: Date, payDay: number, end: Date): Generator<Date> {
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  for (;;) {
    const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const due = new Date(Date.UTC(y, m, Math.min(payDay, daysInMonth)));
    if (due.getTime() > end.getTime()) return;
    if (due.getTime() >= start.getTime()) yield due;
    m += 1;
    if (m === 12) {
      m = 0;
      y += 1;
    }
  }
}

/**
 * Materialize auto entries — loan EMIs and subscription charges — as real,
 * persisted expense rows, one per source per period, from each source's start
 * date up to today. Idempotent: a period that already has a row (even an
 * edited one) is skipped, so re-runs only fill gaps. `fromDate` limits how far
 * back gaps are filled — due dates before it are left alone (so deleted
 * history stays deleted).
 */
export async function syncAutoEntries(
  fromDate?: Date,
  today = new Date(),
): Promise<{ created: number; emis: number; subscriptions: number }> {
  const inWindow = (due: Date) => !fromDate || due.getTime() >= fromDate.getTime();
  const rows: AutoRow[] = [];

  // --- Loan EMIs ---
  const loans = await prisma.loan.findMany();
  const emiCategory = await prisma.category.findUnique({
    where: { name_kind: { name: 'EMI', kind: 'EXPENSE' } },
  });
  if (!emiCategory) throw new Error('EMI category missing');
  const existingEmi = await prisma.entry.findMany({
    where: { loanId: { not: null } },
    select: { loanId: true, periodKey: true },
  });
  const seenEmi = new Set(existingEmi.map((e) => `${e.loanId}:${e.periodKey}`));

  for (const loan of loans) {
    let i = 0;
    for (const due of monthlyDueDates(loan.startDate, loan.emiDay || loan.startDate.getUTCDate(), today)) {
      if (loan.tenureMonths > 0 && ++i > loan.tenureMonths) break;
      const period = monthKey(due);
      if (!inWindow(due) || seenEmi.has(`${loan.id}:${period}`)) continue;
      rows.push({
        date: due,
        kind: 'EXPENSE',
        amount: round2(loan.emi),
        categoryId: emiCategory.id,
        method: 'BANK',
        note: `${loan.name} EMI (auto)`,
        tagsJson: JSON.stringify(['emi', 'auto']),
        source: 'EMI_AUTO',
        loanId: loan.id,
        periodKey: period,
      });
    }
  }
  const emiCount = rows.length;

  // --- Subscriptions ---
  const subs = await prisma.subscription.findMany({ where: { active: true } });
  const existingSub = await prisma.entry.findMany({
    where: { subscriptionId: { not: null } },
    select: { subscriptionId: true, periodKey: true },
  });
  const seenSub = new Set(existingSub.map((e) => `${e.subscriptionId}:${e.periodKey}`));

  for (const sub of subs) {
    const end = sub.endDate && sub.endDate.getTime() < today.getTime() ? sub.endDate : today;
    const dues: Date[] = [];
    if (sub.cadence === 'YEARLY') {
      const month = (sub.billingMonth ?? sub.startDate.getUTCMonth() + 1) - 1;
      for (let y = sub.startDate.getUTCFullYear(); ; y++) {
        const daysInMonth = new Date(Date.UTC(y, month + 1, 0)).getUTCDate();
        const due = new Date(Date.UTC(y, month, Math.min(sub.billingDay, daysInMonth)));
        if (due.getTime() > end.getTime()) break;
        if (due.getTime() >= sub.startDate.getTime()) dues.push(due);
      }
    } else {
      for (const due of monthlyDueDates(sub.startDate, sub.billingDay, end)) dues.push(due);
    }
    for (const due of dues) {
      const period = monthKey(due);
      if (!inWindow(due) || seenSub.has(`${sub.id}:${period}`)) continue;
      rows.push({
        date: due,
        kind: 'EXPENSE',
        amount: round2(sub.amount),
        categoryId: sub.categoryId,
        method: sub.method,
        note: `${sub.name} subscription (auto)`,
        tagsJson: JSON.stringify(['subscription', 'auto']),
        source: 'SUB_AUTO',
        subscriptionId: sub.id,
        periodKey: period,
      });
    }
  }

  if (rows.length > 0) await prisma.entry.createMany({ data: rows });
  return { created: rows.length, emis: emiCount, subscriptions: rows.length - emiCount };
}

/**
 * Log a real EMI payment for a loan against the current month, tagged with the
 * loan + period so the auto-sync dedup guard recognises it and never adds its
 * own duplicate row. Use this (rather than a plain manual entry) when an EMI is
 * paid early — before its due date or before the sync would materialize it.
 */
export async function logEmiPayment(
  opts: { loanId: string; date?: string; amount?: number; method?: string; note?: string },
  today = new Date(),
): Promise<LedgerEntry> {
  const loan = await prisma.loan.findUnique({ where: { id: opts.loanId } });
  if (!loan) throw Object.assign(new Error('Unknown loan'), { statusCode: 422 });
  const emiCategory = await prisma.category.findUnique({
    where: { name_kind: { name: 'EMI', kind: 'EXPENSE' } },
  });
  if (!emiCategory) throw Object.assign(new Error('EMI category missing'), { statusCode: 500 });

  const period = monthKey(today);
  const existing = await prisma.entry.findFirst({ where: { loanId: loan.id, periodKey: period } });
  if (existing)
    throw Object.assign(new Error(`${loan.name}'s EMI for ${period} is already logged.`), {
      statusCode: 409,
    });

  const row = await prisma.entry.create({
    data: {
      date: parseDay(opts.date ?? dateKey(today)),
      kind: 'EXPENSE',
      amount: round2(opts.amount ?? loan.emi),
      categoryId: emiCategory.id,
      method: opts.method ?? 'BANK',
      note: opts.note?.trim() || `${loan.name} EMI`,
      tagsJson: JSON.stringify(['emi']),
      source: 'MANUAL',
      loanId: loan.id,
      periodKey: period,
    },
    include: {
      category: true,
      attachments: { select: { id: true, filename: true, size: true, mimeType: true } },
    },
  });
  return {
    id: row.id,
    date: dateKey(row.date),
    kind: row.kind as EntryKind,
    amount: row.amount,
    categoryId: row.categoryId,
    categoryName: row.category.name,
    method: row.method,
    note: row.note,
    tags: JSON.parse(row.tagsJson) as string[],
    source: row.source as 'MANUAL' | 'EMI_AUTO' | 'SUB_AUTO',
    loanId: row.loanId,
    attachments: row.attachments,
  };
}

export async function listEntries(opts: {
  from: Date;
  to: Date;
  kind?: EntryKind;
  categoryId?: string;
}): Promise<LedgerEntry[]> {
  const rows = await prisma.entry.findMany({
    where: {
      date: { gte: opts.from, lte: opts.to },
      ...(opts.kind ? { kind: opts.kind } : {}),
      ...(opts.categoryId ? { categoryId: opts.categoryId } : {}),
    },
    include: {
      category: true,
      attachments: { select: { id: true, filename: true, size: true, mimeType: true } },
    },
    orderBy: { date: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id,
    date: dateKey(r.date),
    kind: r.kind as EntryKind,
    amount: r.amount,
    categoryId: r.categoryId,
    categoryName: r.category.name,
    method: r.method,
    note: r.note,
    tags: JSON.parse(r.tagsJson) as string[],
    source: r.source as 'MANUAL' | 'EMI_AUTO' | 'SUB_AUTO',
    loanId: r.loanId,
    attachments: r.attachments,
  }));
}

export interface SummaryBucket {
  key: string;
  income: number;
  expense: number;
  net: number;
  savingsRate: number | null;
}

export async function buildSummary(granularity: Granularity, from: Date, to: Date) {
  const entries = await listEntries({ from, to });

  const buckets = new Map<string, { income: number; expense: number }>();
  const byCat = new Map<string, { name: string; kind: EntryKind; amount: number }>();
  for (const e of entries) {
    const key = bucketKey(parseDay(e.date), granularity);
    const b = buckets.get(key) ?? { income: 0, expense: 0 };
    b[e.kind === 'INCOME' ? 'income' : 'expense'] += e.amount;
    buckets.set(key, b);
    const c = byCat.get(e.categoryId) ?? { name: e.categoryName, kind: e.kind, amount: 0 };
    c.amount += e.amount;
    byCat.set(e.categoryId, c);
  }

  const bucketList: SummaryBucket[] = [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, b]) => ({
      key,
      income: round2(b.income),
      expense: round2(b.expense),
      net: round2(b.income - b.expense),
      savingsRate: b.income > 0 ? round2(((b.income - b.expense) / b.income) * 100) : null,
    }));

  const totalIncome = bucketList.reduce((s, b) => s + b.income, 0);
  const totalExpense = bucketList.reduce((s, b) => s + b.expense, 0);

  const expenseTotal = [...byCat.values()]
    .filter((c) => c.kind === 'EXPENSE')
    .reduce((s, c) => s + c.amount, 0);
  const byCategory = [...byCat.entries()]
    .map(([categoryId, c]) => ({
      categoryId,
      name: c.name,
      kind: c.kind,
      amount: round2(c.amount),
      share: c.kind === 'EXPENSE' && expenseTotal > 0 ? round2((c.amount / expenseTotal) * 100) : null,
    }))
    .sort((a, b) => b.amount - a.amount);

  return {
    granularity,
    from: dateKey(from),
    to: dateKey(to),
    buckets: bucketList,
    byCategory,
    budget: await currentMonthBudget(),
    totals: {
      income: round2(totalIncome),
      expense: round2(totalExpense),
      net: round2(totalIncome - totalExpense),
      savingsRate: totalIncome > 0 ? round2(((totalIncome - totalExpense) / totalIncome) * 100) : null,
    },
    suggestedExtraMonthly: await suggestedExtraMonthly(),
  };
}

/** Income, expenditure and balance for the current calendar month so far. */
export async function currentMonthStats(today = new Date()) {
  const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const entries = await listEntries({ from, to: today });
  const income = entries.filter((e) => e.kind === 'INCOME').reduce((s, e) => s + e.amount, 0);
  const expense = entries.filter((e) => e.kind === 'EXPENSE').reduce((s, e) => s + e.amount, 0);
  return {
    month: monthKey(today),
    income: round2(income),
    expense: round2(expense),
    net: round2(income - expense),
  };
}

/**
 * This month's debt obligations: which loans' EMIs are due this calendar
 * month, and how much is still pending (no ledger entry for the loan+month
 * yet — paying or syncing clears it).
 */
export async function emiDueThisMonth(today = new Date()) {
  const period = monthKey(today);
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

  const loans = await prisma.loan.findMany();
  const logged = await prisma.entry.findMany({
    where: { loanId: { not: null }, periodKey: period },
    select: { loanId: true },
  });
  const loggedSet = new Set(logged.map((l) => l.loanId));

  let dueTotal = 0;
  let pendingAmount = 0;
  let pendingCount = 0;
  let dueCount = 0;
  const pending: { loanId: string; name: string; emi: number; dueDate: string }[] = [];

  for (const loan of loans) {
    const idx =
      (y - loan.startDate.getUTCFullYear()) * 12 + (m - loan.startDate.getUTCMonth());
    const withinTenure = idx >= 0 && (loan.tenureMonths === 0 || idx < loan.tenureMonths);
    if (!withinTenure || loan.outstandingAmount <= 0) continue;
    dueTotal = round2(dueTotal + loan.emi);
    dueCount += 1;
    if (!loggedSet.has(loan.id)) {
      pendingAmount = round2(pendingAmount + loan.emi);
      pendingCount += 1;
      const day = Math.min(loan.emiDay || loan.startDate.getUTCDate(), daysInMonth);
      pending.push({
        loanId: loan.id,
        name: loan.name,
        emi: loan.emi,
        dueDate: dateKey(new Date(Date.UTC(y, m, day))),
      });
    }
  }
  pending.sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  return { month: period, dueTotal, dueCount, pendingAmount, pendingCount, pending };
}

/**
 * This month's subscription charges: which are due this calendar month and
 * how much is still pending (no ledger entry for the subscription+month yet).
 */
export async function subscriptionsDueThisMonth(today = new Date()) {
  const period = monthKey(today);
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

  const subs = await prisma.subscription.findMany({ where: { active: true } });
  const logged = await prisma.entry.findMany({
    where: { subscriptionId: { not: null }, periodKey: period },
    select: { subscriptionId: true },
  });
  const loggedSet = new Set(logged.map((l) => l.subscriptionId));

  let dueTotal = 0;
  let pendingAmount = 0;
  let pendingCount = 0;
  let dueCount = 0;
  const pending: { subscriptionId: string; name: string; amount: number; dueDate: string }[] = [];

  for (const sub of subs) {
    if (sub.cadence === 'YEARLY' && (sub.billingMonth ?? sub.startDate.getUTCMonth() + 1) !== m + 1)
      continue;
    const due = new Date(Date.UTC(y, m, Math.min(sub.billingDay, daysInMonth)));
    if (due.getTime() < sub.startDate.getTime()) continue;
    if (sub.endDate && due.getTime() > sub.endDate.getTime()) continue;
    dueTotal = round2(dueTotal + sub.amount);
    dueCount += 1;
    if (!loggedSet.has(sub.id)) {
      pendingAmount = round2(pendingAmount + sub.amount);
      pendingCount += 1;
      pending.push({ subscriptionId: sub.id, name: sub.name, amount: sub.amount, dueDate: dateKey(due) });
    }
  }
  pending.sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  return { month: period, dueTotal, dueCount, pendingAmount, pendingCount, pending };
}

/** Budget targets vs actual spend for the current calendar month. */
export async function currentMonthBudget() {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  const entries = await listEntries({ from, to });
  const spent = new Map<string, number>();
  for (const e of entries) {
    if (e.kind !== 'EXPENSE') continue;
    spent.set(e.categoryId, (spent.get(e.categoryId) ?? 0) + e.amount);
  }
  const budgeted = await prisma.category.findMany({
    where: { kind: 'EXPENSE', budgetMonthly: { not: null } },
  });
  return budgeted.map((c) => {
    const used = round2(spent.get(c.id) ?? 0);
    const budget = c.budgetMonthly ?? 0;
    return {
      categoryId: c.id,
      name: c.name,
      budget,
      spent: used,
      remaining: round2(budget - used),
      over: used > budget,
    };
  });
}

/**
 * Monthly surplus available for debt prepayment: the average net (income −
 * expenses, EMIs included) of the last three full calendar months that have
 * manual entries; falls back to the current month-to-date net. Never negative.
 */
export async function suggestedExtraMonthly(today = new Date()): Promise<number> {
  const monthStart = (offset: number) =>
    new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset, 1));
  const nets: number[] = [];
  for (let back = 3; back >= 1; back--) {
    const from = monthStart(-back);
    const to = new Date(monthStart(-back + 1).getTime() - 86_400_000);
    const entries = await listEntries({ from, to });
    if (!entries.some((e) => e.source === 'MANUAL')) continue;
    const income = entries.filter((e) => e.kind === 'INCOME').reduce((s, e) => s + e.amount, 0);
    const expense = entries.filter((e) => e.kind === 'EXPENSE').reduce((s, e) => s + e.amount, 0);
    nets.push(income - expense);
  }
  if (nets.length === 0) {
    const entries = await listEntries({ from: monthStart(0), to: today });
    if (!entries.some((e) => e.source === 'MANUAL')) return 0;
    const income = entries.filter((e) => e.kind === 'INCOME').reduce((s, e) => s + e.amount, 0);
    const expense = entries.filter((e) => e.kind === 'EXPENSE').reduce((s, e) => s + e.amount, 0);
    return Math.max(0, Math.round(income - expense));
  }
  return Math.max(0, Math.round(nets.reduce((s, n) => s + n, 0) / nets.length));
}
