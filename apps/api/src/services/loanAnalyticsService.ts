import { toMoney } from '@debt/engine';
import { prisma } from '../lib/prisma.js';
import { rowToDomain } from './loanMapper.js';

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

export async function getLoansAnalytics(): Promise<LoanAnalyticsResponse> {
  const rows = await prisma.loan.findMany({ orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] });

  // Fetch all ledger expenses linked to any loan
  const ledgerEntries = await prisma.entry.findMany({
    where: {
      loanId: { not: null },
      kind: 'EXPENSE',
    },
    select: {
      loanId: true,
      amount: true,
      date: true,
    },
  });

  const ledgerByLoan = new Map<string, { total: number; count: number; lastDate: Date | null }>();
  for (const e of ledgerEntries) {
    if (!e.loanId) continue;
    const cur = ledgerByLoan.get(e.loanId) ?? { total: 0, count: 0, lastDate: null };
    cur.total = Math.round((cur.total + e.amount) * 100) / 100;
    cur.count += 1;
    if (!cur.lastDate || e.date > cur.lastDate) cur.lastDate = e.date;
    ledgerByLoan.set(e.loanId, cur);
  }

  const loans: LoanAnalyticsItem[] = await Promise.all(
    rows.map(async (row) => {
      const domain = await rowToDomain(row);
      const tenure = domain.tenureMonths;
      const remaining = domain.remainingMonths;
      const emi = toMoney(domain.emi);
      const outstanding = toMoney(domain.outstandingAmount);
      const loanAmount = toMoney(domain.loanAmount);
      const totalRepayment = toMoney(domain.totalRepayment);
      const totalInterest = toMoney(domain.totalInterest);

      const elapsed = Math.max(0, tenure - remaining);
      const contractualPaid = Math.round(elapsed * emi * 100) / 100;

      const ledgerInfo = ledgerByLoan.get(row.id) ?? { total: 0, count: 0, lastDate: null };

      // Amount paid: use max of contractual calculation and ledger recorded payments
      const amountPaid = Math.max(contractualPaid, ledgerInfo.total);

      // Amount to be paid: remaining EMIs to be paid
      const amountToBePaid = Math.round(remaining * emi * 100) / 100;

      // Future interest remaining
      const remainingInterest = Math.max(0, Math.round((amountToBePaid - outstanding) * 100) / 100);

      // Interest and principal paid so far
      const interestPaidSoFar = Math.max(0, Math.round((totalInterest - remainingInterest) * 100) / 100);
      const principalPaidSoFar = Math.max(0, Math.round((loanAmount - outstanding) * 100) / 100);

      const totalObligation = amountPaid + amountToBePaid;
      const percentPaid = totalObligation > 0 ? Math.round((amountPaid / totalObligation) * 1000) / 10 : 0;

      return {
        id: row.id,
        name: row.name,
        lender: row.lender || '—',
        type: row.type,
        priority: row.priority,
        loanAmount,
        disbursedAmount: toMoney(domain.disbursedAmount),
        outstandingAmount: outstanding,
        amountPaid,
        amountToBePaid,
        emi,
        emiDay: domain.emiDay,
        annualInterestRate: domain.annualInterestRate,
        apr: domain.apr,
        tenureMonths: tenure,
        remainingMonths: remaining,
        elapsedMonths: elapsed,
        totalRepayment,
        totalInterest,
        remainingInterest,
        interestPaidSoFar,
        principalPaidSoFar,
        percentPaid,
        ledgerPaid: ledgerInfo.total,
        ledgerTxnCount: ledgerInfo.count,
        lastPaymentDate: ledgerInfo.lastDate ? ledgerInfo.lastDate.toISOString().slice(0, 10) : null,
      };
    })
  );

  const totalOutstanding = loans.reduce((sum, l) => sum + l.outstandingAmount, 0);
  const totalAmountPaid = loans.reduce((sum, l) => sum + l.amountPaid, 0);
  const totalAmountToBePaid = loans.reduce((sum, l) => sum + l.amountToBePaid, 0);
  const totalMonthlyEmi = loans.reduce((sum, l) => sum + l.emi, 0);
  const totalOriginalInterest = loans.reduce((sum, l) => sum + l.totalInterest, 0);
  const totalRemainingInterest = loans.reduce((sum, l) => sum + l.remainingInterest, 0);

  const weightedApr =
    totalOutstanding > 0
      ? Math.round(
          (loans.reduce((sum, l) => sum + l.outstandingAmount * (l.apr || l.annualInterestRate), 0) /
            totalOutstanding) *
            10
        ) / 10
      : 0;

  const totalAll = totalAmountPaid + totalAmountToBePaid;
  const overallProgressPct = totalAll > 0 ? Math.round((totalAmountPaid / totalAll) * 1000) / 10 : 0;

  return {
    summary: {
      totalLoanAmount: Math.round(loans.reduce((sum, l) => sum + l.loanAmount, 0) * 100) / 100,
      totalOutstanding: Math.round(totalOutstanding * 100) / 100,
      totalAmountPaid: Math.round(totalAmountPaid * 100) / 100,
      totalAmountToBePaid: Math.round(totalAmountToBePaid * 100) / 100,
      totalMonthlyEmi: Math.round(totalMonthlyEmi * 100) / 100,
      totalOriginalInterest: Math.round(totalOriginalInterest * 100) / 100,
      totalRemainingInterest: Math.round(totalRemainingInterest * 100) / 100,
      weightedApr,
      overallProgressPct,
      loanCount: loans.length,
    },
    loans,
  };
}
