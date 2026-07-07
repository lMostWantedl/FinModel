import { z } from 'zod';

const foreclosurePolicySchema = z.object({
  allowed: z.boolean().default(true),
  lockInMonths: z.number().int().min(0).default(0),
  feePct: z.number().min(0).max(100).default(0),
});

const partPaymentPolicySchema = z.object({
  allowed: z.boolean().default(true),
  lockInMonths: z.number().int().min(0).default(0),
  feePct: z.number().min(0).max(100).default(0),
  minAmount: z.coerce.number().min(0).default(0),
});

/** Drop keys whose value is null: importers use null for "unknown, derive it". */
const stripNulls = (o: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null));

/**
 * Normalize common variations of the wire format before validation:
 * null values are treated as absent, `currentOutstanding` is an alias for
 * `outstandingAmount`, and `feePercent` an alias for `feePct` in policies.
 */
const normalizeLoanJson = (raw: unknown): unknown => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  const o = stripNulls(raw as Record<string, unknown>);
  o.outstandingAmount ??= o.currentOutstanding;
  delete o.currentOutstanding;
  if (o.outstandingAmount === undefined) delete o.outstandingAmount;
  for (const key of ['foreclosure', 'partPayment']) {
    const policy = o[key];
    if (typeof policy !== 'object' || policy === null) continue;
    const p = stripNulls(policy as Record<string, unknown>);
    p.feePct ??= p.feePercent;
    delete p.feePercent;
    if (p.feePct === undefined) delete p.feePct;
    o[key] = p;
  }
  return o;
};

/**
 * Wire shape of a Loan. Decimal fields accept numbers or numeric strings
 * (Decimal.js serializes to strings); every derivable field is optional and
 * filled in by the engine's loanFromJson.
 */
export const loanJsonSchema = z.preprocess(
  normalizeLoanJson,
  z
    .object({
      id: z.string().optional(),
      lender: z.string().max(100).default(''),
      name: z.string().min(1).max(100),
      type: z.enum(['PERSONAL', 'GOLD', 'CREDIT_CARD']).default('PERSONAL'),
      priority: z.number().int().default(0),
      loanAmount: z.coerce.number().positive().optional(),
      disbursedAmount: z.coerce.number().min(0).optional(),
      outstandingAmount: z.coerce.number().positive().optional(),
      annualInterestRate: z.coerce.number().min(0).max(100),
      apr: z.coerce.number().min(0).max(200).optional(),
      reducingBalance: z.boolean().default(true),
      emi: z.coerce.number().positive(),
      emiDay: z.coerce.number().int().min(1).max(31).optional(),
      tenureMonths: z.coerce.number().int().min(0).optional(),
      remainingMonths: z.coerce.number().int().min(0).optional(),
      startDate: z.coerce.date().optional(),
      endDate: z.coerce.date().optional(),
      processingFee: z.coerce.number().min(0).default(0),
      totalInterest: z.coerce.number().min(0).optional(),
      totalRepayment: z.coerce.number().min(0).optional(),
      foreclosure: foreclosurePolicySchema.default({}),
      partPayment: partPaymentPolicySchema.default({}),
    })
    .refine((l) => l.outstandingAmount !== undefined || l.loanAmount !== undefined, {
      message: 'Provide outstandingAmount (or currentOutstanding) or loanAmount',
      path: ['outstandingAmount'],
    }),
);

/** POST /loans/import accepts one loan object or an array of them. */
export const loanImportSchema = z.union([loanJsonSchema, z.array(loanJsonSchema).min(1)]);

export const categoryBodySchema = z.object({
  name: z.string().min(1).max(60),
  kind: z.enum(['INCOME', 'EXPENSE']),
  budgetMonthly: z.number().positive().nullish(),
});

export const entryBodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(['INCOME', 'EXPENSE']),
  amount: z.coerce.number().positive(),
  categoryId: z.string().min(1),
  method: z.enum(['CASH', 'BANK', 'UPI', 'CREDIT_CARD', 'OTHER']).default('CASH'),
  note: z.string().max(500).default(''),
  tags: z.array(z.string().min(1).max(40)).max(10).default([]),
});

export const subscriptionBodySchema = z
  .object({
    name: z.string().min(1).max(80),
    amount: z.coerce.number().positive(),
    categoryId: z.string().min(1),
    method: z.enum(['CASH', 'BANK', 'UPI', 'CREDIT_CARD', 'OTHER']).default('UPI'),
    cadence: z.enum(['MONTHLY', 'YEARLY']).default('MONTHLY'),
    billingDay: z.coerce.number().int().min(1).max(31).default(1),
    billingMonth: z.coerce.number().int().min(1).max(12).nullish(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    active: z.boolean().default(true),
    note: z.string().max(200).default(''),
  })
  .refine((s) => s.cadence !== 'YEARLY' || s.billingMonth != null, {
    message: 'billingMonth is required for yearly subscriptions',
    path: ['billingMonth'],
  });

export const entryPatchSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    kind: z.enum(['INCOME', 'EXPENSE']),
    amount: z.coerce.number().positive(),
    categoryId: z.string().min(1),
    method: z.enum(['CASH', 'BANK', 'UPI', 'CREDIT_CARD', 'OTHER']),
    note: z.string().max(500),
    tags: z.array(z.string().min(1).max(40)).max(10),
  })
  .partial();

export const emiPaymentSchema = z.object({
  loanId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  amount: z.coerce.number().positive().optional(),
  method: z.enum(['CASH', 'BANK', 'UPI', 'CREDIT_CARD', 'OTHER']).optional(),
  note: z.string().max(500).optional(),
});

export const entriesQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  kind: z.enum(['INCOME', 'EXPENSE']).optional(),
  categoryId: z.string().optional(),
});

export const summaryQuerySchema = z.object({
  granularity: z.enum(['day', 'week', 'month']).default('month'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const simulateBodySchema = z.object({
  strategy: z.enum(['current', 'avalanche', 'snowball', 'optimized']).default('optimized'),
  extraMonthlyPayment: z.number().min(0).default(0),
  bonuses: z
    .array(z.object({ month: z.number().int().min(1).max(12), amount: z.number().positive() }))
    .default([]),
  opportunityRatePct: z.number().min(0).max(100).default(6),
  startMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});
