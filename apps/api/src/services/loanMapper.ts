import { loanFromJson, loanToJson, toMoney, type Loan as DomainLoan, type LoanJson } from '@debt/engine';
import type { Loan as LoanRow } from '@prisma/client';
import type { z } from 'zod';
import type { loanJsonSchema } from '../schemas.js';

type ParsedLoan = z.infer<typeof loanJsonSchema>;

/** Validate/derive via the engine's domain model, then flatten for Prisma. */
export function parsedToDbData(parsed: ParsedLoan) {
  const loan = loanFromJson({
    ...parsed,
    startDate: parsed.startDate?.toISOString(),
    endDate: parsed.endDate?.toISOString(),
  });
  return {
    lender: loan.lender,
    name: loan.name,
    type: loan.type,
    priority: loan.priority,
    loanAmount: toMoney(loan.loanAmount),
    disbursedAmount: toMoney(loan.disbursedAmount),
    outstandingAmount: toMoney(loan.outstandingAmount),
    annualInterestRate: loan.annualInterestRate,
    apr: loan.apr,
    reducingBalance: loan.reducingBalance,
    emi: toMoney(loan.emi),
    emiDay: loan.emiDay,
    tenureMonths: loan.tenureMonths,
    remainingMonths: loan.remainingMonths,
    startDate: loan.startDate,
    endDate: loan.endDate,
    processingFee: toMoney(loan.processingFee),
    totalInterest: toMoney(loan.totalInterest),
    totalRepayment: toMoney(loan.totalRepayment),
    foreclosureJson: JSON.stringify(loan.foreclosure),
    partPaymentJson: JSON.stringify(loan.partPayment),
  };
}

/** Rehydrate the domain Loan from its DB row. */
export function rowToDomain(row: LoanRow): DomainLoan {
  return loanFromJson({
    id: row.id,
    lender: row.lender,
    name: row.name,
    type: row.type as DomainLoan['type'],
    priority: row.priority,
    loanAmount: row.loanAmount,
    disbursedAmount: row.disbursedAmount,
    outstandingAmount: row.outstandingAmount,
    annualInterestRate: row.annualInterestRate,
    apr: row.apr,
    reducingBalance: row.reducingBalance,
    emi: row.emi,
    emiDay: row.emiDay,
    tenureMonths: row.tenureMonths,
    remainingMonths: row.remainingMonths,
    startDate: row.startDate.toISOString(),
    endDate: row.endDate.toISOString(),
    processingFee: row.processingFee,
    totalInterest: row.totalInterest,
    totalRepayment: row.totalRepayment,
    foreclosure: JSON.parse(row.foreclosureJson),
    partPayment: JSON.parse(row.partPaymentJson),
  });
}

export const rowToJson = (row: LoanRow): LoanJson => loanToJson(rowToDomain(row));
