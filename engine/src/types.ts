import type { Decimal } from 'decimal.js';

export type StrategyName = 'current' | 'avalanche' | 'snowball' | 'optimized';

export type LoanType = 'PERSONAL' | 'GOLD' | 'CREDIT_CARD';

export interface ForeclosurePolicy {
  allowed: boolean;
  /** Months from loan start before the loan may be closed early. */
  lockInMonths: number;
  /** Fee in percent of the balance cleared at closure. */
  feePct: number;
}

export interface PartPaymentPolicy {
  allowed: boolean;
  /** Months from loan start before part payments are accepted. */
  lockInMonths: number;
  /** Fee in percent of each prepaid amount. */
  feePct: number;
  /** Minimum accepted part payment. */
  minAmount: number;
}

/** Full loan domain model. Money fields are Decimal; see LoanJson for the wire shape. */
export interface Loan {
  id: string;
  lender: string;
  name: string;
  type: LoanType;
  priority: number;
  loanAmount: Decimal;
  disbursedAmount: Decimal;
  outstandingAmount: Decimal;
  annualInterestRate: number;
  apr: number;
  reducingBalance: boolean;
  emi: Decimal;
  /** Day of the month (1-31) the EMI is debited; clamped to month length. */
  emiDay: number;
  tenureMonths: number;
  remainingMonths: number;
  startDate: Date;
  endDate: Date;
  processingFee: Decimal;
  totalInterest: Decimal;
  totalRepayment: Decimal;
  foreclosure: ForeclosurePolicy;
  partPayment: PartPaymentPolicy;
}

/** JSON-serializable Loan: Decimal fields as number|string, dates as ISO strings. */
export interface LoanJson {
  id: string;
  lender: string;
  name: string;
  type: LoanType;
  priority: number;
  loanAmount: number | string;
  disbursedAmount: number | string;
  outstandingAmount: number | string;
  annualInterestRate: number;
  apr: number;
  reducingBalance: boolean;
  emi: number | string;
  emiDay: number;
  tenureMonths: number;
  remainingMonths: number;
  startDate: string;
  endDate: string;
  processingFee: number | string;
  totalInterest: number | string;
  totalRepayment: number | string;
  foreclosure: ForeclosurePolicy;
  partPayment: PartPaymentPolicy;
}

/** Minimal, policy-aware input the simulator works on. Lock windows are
 * expressed in months relative to the simulation start. */
export interface LoanInput {
  id: string;
  name: string;
  /** Current outstanding principal. */
  principal: number;
  /** Annual interest rate in percent, e.g. 8.5. */
  annualRatePct: number;
  /** Contractual monthly payment (EMI). */
  emi: number;
  /** Fee in percent charged when a prepayment clears the loan. */
  foreclosureFeePct?: number;
  /** Fee in percent on part payments; defaults to foreclosureFeePct. */
  partPaymentFeePct?: number;
  /** false = the loan never receives prepayments. */
  partPaymentAllowed?: boolean;
  /** Months from simulation start before part payments are accepted. */
  partPaymentLockMonths?: number;
  /** false = the loan cannot be cleared early (EMIs only reach zero). */
  foreclosureAllowed?: boolean;
  /** Months from simulation start before early closure is permitted. */
  foreclosureLockMonths?: number;
}

export interface BonusInput {
  /** Calendar month the bonus lands in, 1-12. Spec: November bonus. */
  month: number;
  amount: number;
}

export interface SimulationInput {
  loans: LoanInput[];
  strategy: StrategyName;
  /** Extra cash available every month on top of contractual EMIs. */
  extraMonthlyPayment?: number;
  /** Annual bonuses applied to the highest scoring loan in their month. */
  bonuses?: BonusInput[];
  /** Annual return (percent) achievable elsewhere; used as opportunity cost by the optimizer. */
  opportunityRatePct?: number;
  /** First simulated month, "YYYY-MM". Defaults handled by caller for determinism. */
  startMonth: string;
}

export interface AmortizationRow {
  loanId: string;
  /** "YYYY-MM" */
  month: string;
  opening: number;
  interest: number;
  principal: number;
  /** Extra principal paid beyond the scheduled EMI (prepayments, bonuses). */
  extraPrincipal: number;
  foreclosureFee: number;
  closing: number;
}

export interface MonthSummary {
  month: string;
  totalOpening: number;
  totalInterest: number;
  totalPrincipal: number;
  totalPaid: number;
  totalClosing: number;
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
  schedule: AmortizationRow[];
  timeline: MonthSummary[];
}

export interface ForeclosureEvaluation {
  loanId: string;
  fee: number;
  futureInterest: number;
  savings: number;
  recommendClosure: boolean;
}

export interface StrategyComparison {
  strategy: StrategyName;
  months: number;
  debtFreeMonth: string | null;
  totalInterest: number;
  totalPaid: number;
  interestSavedVsCurrent: number;
}
