import { Decimal, d, toMoney } from './money.js';
import { amortizeMonth, presentValue, remainingMonths } from './amortization.js';
import type { ForeclosurePolicy, Loan, LoanJson, LoanInput, PartPaymentPolicy } from './types.js';

export const DEFAULT_FORECLOSURE: ForeclosurePolicy = { allowed: true, lockInMonths: 0, feePct: 0 };
export const DEFAULT_PART_PAYMENT: PartPaymentPolicy = {
  allowed: true,
  lockInMonths: 0,
  feePct: 0,
  minAmount: 0,
};

/** Whole months elapsed between two dates (clamped at 0). */
export function monthsBetween(from: Date, to: Date): number {
  const months =
    (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  return Math.max(0, months);
}

export type LoanJsonInput = Partial<LoanJson> &
  Pick<LoanJson, 'name' | 'annualInterestRate' | 'emi'>;

/**
 * Hydrate a Loan from its JSON wire shape, filling derivable fields that the
 * source omitted. At least one of outstandingAmount / loanAmount is required;
 * a missing outstanding balance is derived, in order of preference, from
 * remainingMonths (annuity present value), from startDate (amortizing the
 * loan amount forward to asOf), or falls back to the loan amount.
 */
export function loanFromJson(json: LoanJsonInput, asOf: Date = new Date()): Loan {
  const emi = d(json.emi);
  const rate = json.annualInterestRate;
  const processingFee = d(json.processingFee ?? 0);
  const startDate = json.startDate ? new Date(json.startDate) : asOf;

  const givenOutstanding = json.outstandingAmount != null ? d(json.outstandingAmount) : undefined;
  const loanAmount = json.loanAmount != null ? d(json.loanAmount) : givenOutstanding;
  if (!loanAmount) {
    throw new Error(`Loan ${json.name}: needs outstandingAmount or loanAmount`);
  }
  let outstanding = givenOutstanding;
  if (!outstanding && json.remainingMonths != null) {
    outstanding = Decimal.min(presentValue(rate, Number(emi), json.remainingMonths), loanAmount);
  }
  if (!outstanding && json.startDate) {
    let bal = loanAmount;
    for (let m = monthsBetween(startDate, asOf); m > 0 && bal.gt(0); m--) {
      bal = amortizeMonth(bal, rate, emi).closing;
    }
    outstanding = bal;
  }
  outstanding ??= loanAmount;

  const monthsLeft = remainingMonths(outstanding, rate, Number(emi));
  const remaining = json.remainingMonths ?? (Number.isFinite(monthsLeft) ? monthsLeft : 0);
  const tenure = json.tenureMonths ?? remaining;

  const endDate = json.endDate
    ? new Date(json.endDate)
    : new Date(startDate.getFullYear(), startDate.getMonth() + tenure, startDate.getDate());

  const totalRepayment = d(json.totalRepayment ?? toMoney(emi.mul(tenure)));
  const totalInterest = d(
    json.totalInterest ?? toMoney(Decimal.max(totalRepayment.sub(loanAmount), 0)),
  );

  return {
    id: json.id ?? '',
    lender: json.lender ?? '',
    name: json.name,
    type: json.type ?? 'PERSONAL',
    priority: json.priority ?? 0,
    loanAmount,
    disbursedAmount: d(json.disbursedAmount ?? toMoney(loanAmount.sub(processingFee))),
    outstandingAmount: outstanding,
    annualInterestRate: json.annualInterestRate,
    apr: json.apr ?? json.annualInterestRate,
    reducingBalance: json.reducingBalance ?? true,
    emi,
    emiDay: json.emiDay ?? startDate.getUTCDate(),
    tenureMonths: tenure,
    remainingMonths: remaining,
    startDate,
    endDate,
    processingFee,
    totalInterest,
    totalRepayment,
    foreclosure: { ...DEFAULT_FORECLOSURE, ...json.foreclosure },
    partPayment: { ...DEFAULT_PART_PAYMENT, ...json.partPayment },
  };
}

export function loanToJson(loan: Loan): LoanJson {
  return {
    ...loan,
    loanAmount: toMoney(loan.loanAmount),
    disbursedAmount: toMoney(loan.disbursedAmount),
    outstandingAmount: toMoney(loan.outstandingAmount),
    emi: toMoney(loan.emi),
    processingFee: toMoney(loan.processingFee),
    totalInterest: toMoney(loan.totalInterest),
    totalRepayment: toMoney(loan.totalRepayment),
    startDate: loan.startDate.toISOString(),
    endDate: loan.endDate.toISOString(),
  };
}

/**
 * Project a Loan onto the simulator's input, translating each policy's
 * lock-in (relative to loan start) into months relative to `asOf`.
 */
export function toSimulationLoan(loan: Loan, asOf: Date = loan.startDate): LoanInput {
  const elapsed = monthsBetween(loan.startDate, asOf);
  return {
    id: loan.id,
    name: loan.name,
    principal: toMoney(loan.outstandingAmount),
    annualRatePct: loan.annualInterestRate,
    emi: toMoney(loan.emi),
    foreclosureFeePct: loan.foreclosure.feePct,
    partPaymentFeePct: loan.partPayment.feePct,
    partPaymentAllowed: loan.partPayment.allowed,
    partPaymentLockMonths: Math.max(0, loan.partPayment.lockInMonths - elapsed),
    foreclosureAllowed: loan.foreclosure.allowed,
    foreclosureLockMonths: Math.max(0, loan.foreclosure.lockInMonths - elapsed),
  };
}
