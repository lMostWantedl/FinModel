export type StrategyName = 'current' | 'avalanche' | 'snowball' | 'optimized';

export type LoanType = 'PERSONAL' | 'GOLD' | 'CREDIT_CARD';

export interface ForeclosurePolicy {
  allowed: boolean;
  lockInMonths: number;
  feePct: number;
}

export interface PartPaymentPolicy {
  allowed: boolean;
  lockInMonths: number;
  feePct: number;
  minAmount: number;
}

/** Wire shape of the Loan domain model (Decimal fields arrive as numbers, dates as ISO strings). */
export interface Loan {
  id: string;
  lender: string;
  name: string;
  type: LoanType;
  priority: number;
  loanAmount: number;
  disbursedAmount: number;
  outstandingAmount: number;
  annualInterestRate: number;
  apr: number;
  reducingBalance: boolean;
  emi: number;
  emiDay: number;
  tenureMonths: number;
  remainingMonths: number;
  startDate: string;
  endDate: string;
  processingFee: number;
  totalInterest: number;
  totalRepayment: number;
  foreclosure: ForeclosurePolicy;
  partPayment: PartPaymentPolicy;
}

/** What the user must supply to create a loan; the API derives the rest. */
export type LoanDraft = Partial<Omit<Loan, 'id'>> &
  Pick<Loan, 'name' | 'outstandingAmount' | 'annualInterestRate' | 'emi'>;

/** Slimmed loan shape used inside simulation payloads. */
export interface SimLoan {
  id: string;
  name: string;
  principal: number;
  annualRatePct: number;
  emi: number;
}

export interface MonthSummary {
  month: string;
  totalOpening: number;
  totalInterest: number;
  totalPrincipal: number;
  totalPaid: number;
  totalClosing: number;
}

export interface StrategyComparison {
  strategy: StrategyName;
  months: number;
  debtFreeMonth: string | null;
  totalInterest: number;
  totalPaid: number;
  interestSavedVsCurrent: number;
}

export interface ForeclosureEvaluation {
  loanId: string;
  fee: number;
  futureInterest: number;
  savings: number;
  recommendClosure: boolean;
}

export type EntryKind = 'INCOME' | 'EXPENSE';
export type PaymentMethod = 'CASH' | 'BANK' | 'UPI' | 'CREDIT_CARD' | 'OTHER';
export type Granularity = 'day' | 'week' | 'month';

export interface Category {
  id: string;
  name: string;
  kind: EntryKind;
  preset: boolean;
  budgetMonthly: number | null;
}

export interface AttachmentMeta {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
}

export interface LedgerEntry {
  id: string;
  date: string;
  kind: EntryKind;
  amount: number;
  categoryId: string;
  categoryName: string;
  method: string;
  note: string;
  description: string | null;
  tags: string[];
  source: 'MANUAL' | 'EMI_AUTO' | 'SUB_AUTO' | 'PENDING_EXCEL';
  loanId: string | null;
  attachments: AttachmentMeta[];
}

export interface Subscription {
  id: string;
  name: string;
  amount: number;
  categoryId: string;
  category: Category;
  method: string;
  cadence: 'MONTHLY' | 'YEARLY';
  billingDay: number;
  billingMonth: number | null;
  startDate: string;
  endDate: string | null;
  active: boolean;
  note: string;
}

export type SubscriptionDraft = {
  name: string;
  amount: number;
  categoryId: string;
  method: PaymentMethod;
  cadence: 'MONTHLY' | 'YEARLY';
  billingDay: number;
  billingMonth?: number | null;
  startDate?: string;
  endDate?: string | null;
  active: boolean;
  note: string;
};

export interface SummaryBucket {
  key: string;
  income: number;
  expense: number;
  net: number;
  savingsRate: number | null;
}

export interface Summary {
  granularity: Granularity;
  from: string;
  to: string;
  buckets: SummaryBucket[];
  byCategory: { categoryId: string; name: string; kind: EntryKind; amount: number; share: number | null }[];
  budget: { categoryId: string; name: string; budget: number; spent: number; remaining: number; over: boolean }[];
  totals: { income: number; expense: number; net: number; savingsRate: number | null };
  suggestedExtraMonthly: number;
}

export interface EmiDue {
  month: string;
  dueTotal: number;
  dueCount: number;
  pendingAmount: number;
  pendingCount: number;
  pending: { loanId: string; name: string; emi: number; dueDate: string }[];
}

export interface Dashboard {
  loans: SimLoan[];
  extraMonthlyPayment?: number;
  suggestedExtra?: number;
  month?: { month: string; income: number; expense: number; net: number };
  monthDue?: {
    month: string;
    dueTotal: number;
    dueCount: number;
    pendingAmount: number;
    pendingCount: number;
    pending: { loanId: string; name: string; emi: number; dueDate: string }[];
  };
  monthSubsDue?: {
    month: string;
    dueTotal: number;
    dueCount: number;
    pendingAmount: number;
    pendingCount: number;
    pending: { subscriptionId: string; name: string; amount: number; dueDate: string }[];
  };
  remainingDebt: number;
  nextTarget: { loanId: string; name: string } | null;
  debtFreeMonth: string | null;
  interestSaved?: number;
  comparison: StrategyComparison[];
  timeline: MonthSummary[];
  foreclosure: ForeclosureEvaluation[];
}

export interface LoanResult {
  loanId: string;
  name: string;
  totalInterest: number;
  totalForeclosureFees: number;
  payoffMonth: string | null;
}

export interface SimulationResult {
  strategy: StrategyName;
  months: number;
  debtFreeMonth: string | null;
  totalInterest: number;
  totalForeclosureFees: number;
  totalPaid: number;
  loans: LoanResult[];
  timeline: MonthSummary[];
}

export interface SimulationPayload {
  strategy: StrategyName;
  result: SimulationResult;
  comparison: StrategyComparison[];
}

export interface LoanAnalyticsItem {
  id: string;
  name: string;
  lender: string;
  type: string;
  priority: number;
  loanAmount: number;
  disbursedAmount: number;
  outstandingAmount: number;
  amountPaid: number;
  amountToBePaid: number;
  emi: number;
  emiDay: number;
  annualInterestRate: number;
  apr: number;
  tenureMonths: number;
  remainingMonths: number;
  elapsedMonths: number;
  totalRepayment: number;
  totalInterest: number;
  remainingInterest: number;
  interestPaidSoFar: number;
  principalPaidSoFar: number;
  percentPaid: number;
  ledgerPaid: number;
  ledgerTxnCount: number;
  lastPaymentDate: string | null;
}

export interface LoanAnalyticsResponse {
  summary: {
    totalLoanAmount: number;
    totalOutstanding: number;
    totalAmountPaid: number;
    totalAmountToBePaid: number;
    totalMonthlyEmi: number;
    totalOriginalInterest: number;
    totalRemainingInterest: number;
    weightedApr: number;
    overallProgressPct: number;
    loanCount: number;
  };
  loans: LoanAnalyticsItem[];
}

