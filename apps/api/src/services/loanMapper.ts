import { loanFromJson, loanToJson, toMoney, type Loan as DomainLoan, type LoanJson } from '@debt/engine';
import type { Loan as LoanRow } from '@prisma/client';
import type { z } from 'zod';
import type { loanJsonSchema as sc } from '../schemas.js';
import { loanJsonSchema } from '../schemas.js';
import { prisma } from '../lib/prisma.js';

type ParsedLoan = z.infer<typeof sc>;

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

function getMonthDifference(start: Date, end: Date): number {
  return (
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth())
  );
}

/** Rehydrate the domain Loan from its DB row. */
export async function rowToDomain(row: LoanRow): Promise<DomainLoan> {
  const body = {
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
    remainingMonths: getMonthDifference(row.startDate, new Date()) || row.remainingMonths,
    startDate: row.startDate.toISOString(),
    endDate: row.endDate.toISOString(),
    processingFee: row.processingFee,
    totalInterest: row.totalInterest,
    totalRepayment: row.totalRepayment,
    foreclosure: JSON.parse(row.foreclosureJson),
    partPayment: JSON.parse(row.partPaymentJson),
  }
  if (getMonthDifference(row.startDate, new Date()) !== row.remainingMonths) {
    const { id } = row;
    const parseBody = loanJsonSchema.parse(body);
    const loan = await prisma.loan
      .update({ where: { id }, data: parsedToDbData(parseBody) })
      .catch(() => {
        console.error(`Failed to update loan ${id} with recalculated remainingMonths`);
      });
  }
  return loanFromJson(body);
}

export const rowToJson = async (row: LoanRow): Promise<LoanJson> => loanToJson(await rowToDomain(row));
