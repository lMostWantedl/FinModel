import { monthsBetween, presentValue, toMoney } from '@debt/engine';
import { prisma } from '../lib/prisma.js';
import { rowToDomain } from './loanMapper.js';
import { reconcileLoanEmis } from './ledgerService.js';

export interface LoanAnalyticsItem {
  id: string;
  name: string;
  lender: string;
  type: string;
  priority: number;
  loanAmount: number;
  disbursedAmount: number;
  outstandingAmount: number;
  principalPaidSoFar: number;
  principalPercentPaid: number;
  amountPaid: number;
  contractualPaid: number;
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
  percentPaid: number;
  // 2026 Bank Statement verified payments
  statementPaid2026: number;
  statementTxnCount2026: number;
  lastPaymentDate: string | null;
  // Backward compatibility aliases
  ledgerPaid: number;
  ledgerTxnCount: number;
}

export interface LoanAnalyticsResponse {
  summary: {
    totalLoanAmount: number;
    totalOutstanding: number;
    totalPrincipalPaid: number;
    totalAmountPaid: number;
    totalAmountToBePaid: number;
    totalMonthlyEmi: number;
    totalOriginalInterest: number;
    totalRemainingInterest: number;
    weightedApr: number;
    overallProgressPct: number;
    loanCount: number;
    // 2026 Bank Statement Summary
    totalStatementPaid2026: number;
    totalStatementTxnCount2026: number;
    statementStartDate: string | null;
    statementEndDate: string | null;
  };
  loans: LoanAnalyticsItem[];
}

export async function getLoansAnalytics(): Promise<LoanAnalyticsResponse> {
  const rows = await prisma.loan.findMany({ orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] });

  // Fetch all ledger expenses linked to any loan (2026 bank statement debits)
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
    orderBy: { date: 'asc' },
  });

  let statementStartDate: Date | null = null;
  let statementEndDate: Date | null = null;

  const ledgerByLoan = new Map<string, { total: number; count: number; lastDate: Date | null }>();
  for (const e of ledgerEntries) {
    if (!e.loanId) continue;
    if (!statementStartDate || e.date < statementStartDate) statementStartDate = e.date;
    if (!statementEndDate || e.date > statementEndDate) statementEndDate = e.date;

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
      const emi = toMoney(domain.emi);
      const loanAmount = toMoney(domain.loanAmount);
      const totalRepayment = toMoney(domain.totalRepayment);
      const totalInterest = toMoney(domain.totalInterest);

      // Reconciled statement transactions
      const ledgerInfo = ledgerByLoan.get(row.id) ?? { total: 0, count: 0, lastDate: null };
      const verifiedDebits = ledgerInfo.count;

      // Determine true elapsed and remaining EMIs:
      // Primary ground truth: loan contract schedule from database
      const rawRemaining = domain.remainingMonths ?? row.remainingMonths ?? 0;
      let elapsedFromLoan = Math.max(0, tenure - rawRemaining);

      // Inversion safeguard: if the stored remainingMonths accidentally equaled the verified paid count
      // (and was smaller than the elapsed tenure), untangle them:
      if (
        verifiedDebits > 0 &&
        rawRemaining === verifiedDebits &&
        rawRemaining < tenure - rawRemaining
      ) {
        elapsedFromLoan = verifiedDebits;
      }

      // Check if statement verifications show more elapsed payments than recorded in loan data:
      const statementBoundary = new Date('2026-01-01');
      const priorMonthsBefore2026 =
        row.startDate && row.startDate < statementBoundary
          ? monthsBetween(row.startDate, statementBoundary)
          : 0;
      const statementElapsed = priorMonthsBefore2026 + verifiedDebits;

      const elapsed = Math.min(tenure, Math.max(elapsedFromLoan, statementElapsed));
      const remaining = Math.max(0, tenure - elapsed);

      // Current outstanding balance: amortized remaining principal balance
      const outstanding =
        remaining > 0
          ? Math.round(Number(presentValue(domain.annualInterestRate, emi, remaining)) * 100) / 100
          : 0;

      const principalPaidSoFar = Math.max(0, Math.round((loanAmount - outstanding) * 100) / 100);
      const principalPercentPaid = loanAmount > 0 ? Math.round((principalPaidSoFar / loanAmount) * 1000) / 10 : 0;

      // Amount to be paid: scheduled future EMIs under loan contract
      const amountToBePaid = Math.round(remaining * emi * 100) / 100;

      // Contractual amount repaid since loan inception:
      const contractualPaid = Math.round(elapsed * emi * 100) / 100;
      const amountPaid = contractualPaid;

      // Progress % based on loan contract tenure
      const percentPaid =
        tenure > 0
          ? Math.round((elapsed / tenure) * 1000) / 10
          : principalPercentPaid;

      // Future interest remaining under contract
      const remainingInterest = Math.max(0, Math.round((amountToBePaid - outstanding) * 100) / 100);
      const interestPaidSoFar = Math.max(0, Math.round((contractualPaid - principalPaidSoFar) * 100) / 100);

      return {
        id: row.id,
        name: row.name,
        lender: row.lender || '—',
        type: row.type,
        priority: row.priority,
        loanAmount,
        disbursedAmount: toMoney(domain.disbursedAmount),
        outstandingAmount: outstanding,
        principalPaidSoFar,
        principalPercentPaid,
        amountPaid,
        contractualPaid,
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
        percentPaid,
        statementPaid2026: ledgerInfo.total,
        statementTxnCount2026: ledgerInfo.count,
        lastPaymentDate: ledgerInfo.lastDate ? ledgerInfo.lastDate.toISOString().slice(0, 10) : null,
        ledgerPaid: ledgerInfo.total,
        ledgerTxnCount: ledgerInfo.count,
      };
    })
  );

  const totalOutstanding = loans.reduce((sum, l) => sum + l.outstandingAmount, 0);
  const totalLoanAmount = loans.reduce((sum, l) => sum + l.loanAmount, 0);
  const totalPrincipalPaid = Math.max(0, totalLoanAmount - totalOutstanding);
  const totalAmountPaid = loans.reduce((sum, l) => sum + l.amountPaid, 0);
  const totalAmountToBePaid = loans.reduce((sum, l) => sum + l.amountToBePaid, 0);
  const totalMonthlyEmi = loans.reduce((sum, l) => sum + l.emi, 0);
  const totalOriginalInterest = loans.reduce((sum, l) => sum + l.totalInterest, 0);
  const totalRemainingInterest = loans.reduce((sum, l) => sum + l.remainingInterest, 0);

  const totalStatementPaid2026 = loans.reduce((sum, l) => sum + l.statementPaid2026, 0);
  const totalStatementTxnCount2026 = loans.reduce((sum, l) => sum + l.statementTxnCount2026, 0);

  const weightedApr =
    totalOutstanding > 0
      ? Math.round(
          (loans.reduce((sum, l) => sum + l.outstandingAmount * (l.apr || l.annualInterestRate), 0) /
            totalOutstanding) *
            10
        ) / 10
      : 0;

  const totalAllObligation = totalAmountPaid + totalAmountToBePaid;
  const overallProgressPct =
    totalAllObligation > 0 ? Math.round((totalAmountPaid / totalAllObligation) * 1000) / 10 : 0;

  return {
    summary: {
      totalLoanAmount: Math.round(totalLoanAmount * 100) / 100,
      totalOutstanding: Math.round(totalOutstanding * 100) / 100,
      totalPrincipalPaid: Math.round(totalPrincipalPaid * 100) / 100,
      totalAmountPaid: Math.round(totalAmountPaid * 100) / 100,
      totalAmountToBePaid: Math.round(totalAmountToBePaid * 100) / 100,
      totalMonthlyEmi: Math.round(totalMonthlyEmi * 100) / 100,
      totalOriginalInterest: Math.round(totalOriginalInterest * 100) / 100,
      totalRemainingInterest: Math.round(totalRemainingInterest * 100) / 100,
      weightedApr,
      overallProgressPct,
      loanCount: loans.length,
      totalStatementPaid2026: Math.round(totalStatementPaid2026 * 100) / 100,
      totalStatementTxnCount2026,
      statementStartDate: statementStartDate ? statementStartDate.toISOString().slice(0, 10) : null,
      statementEndDate: statementEndDate ? statementEndDate.toISOString().slice(0, 10) : null,
    },
    loans,
  };
}

/** Recalculate and synchronize all loan schedules with bank statement reconciled payments. */
export async function recalculateLoans(): Promise<LoanAnalyticsResponse> {
  // 1. Reconcile any unlinked statement entries with loans
  await reconcileLoanEmis();

  // 2. Fetch all loans and verified entries
  const rows = await prisma.loan.findMany();
  const ledgerEntries = await prisma.entry.findMany({
    where: { loanId: { not: null }, kind: 'EXPENSE' },
    select: { loanId: true, amount: true, date: true },
  });

  const ledgerByLoan = new Map<string, number>();
  for (const e of ledgerEntries) {
    if (!e.loanId) continue;
    ledgerByLoan.set(e.loanId, (ledgerByLoan.get(e.loanId) ?? 0) + 1);
  }

  // 3. For each loan, sync its database record (remainingMonths and outstandingAmount)
  for (const row of rows) {
    const verifiedDebits = ledgerByLoan.get(row.id) ?? 0;
    if (verifiedDebits === 0) continue;

    const domain = await rowToDomain(row);
    const tenure = domain.tenureMonths;
    const emi = toMoney(domain.emi);

    const rawRemaining = domain.remainingMonths ?? row.remainingMonths ?? 0;
    let elapsedFromLoan = Math.max(0, tenure - rawRemaining);

    if (
      verifiedDebits > 0 &&
      rawRemaining === verifiedDebits &&
      rawRemaining < tenure - rawRemaining
    ) {
      elapsedFromLoan = verifiedDebits;
    }

    const statementBoundary = new Date('2026-01-01');
    const priorMonthsBefore2026 =
      row.startDate && row.startDate < statementBoundary
        ? monthsBetween(row.startDate, statementBoundary)
        : 0;

    const statementElapsed = priorMonthsBefore2026 + verifiedDebits;
    const elapsed = Math.min(tenure, Math.max(elapsedFromLoan, statementElapsed));
    const remaining = Math.max(0, tenure - elapsed);

    const outstanding =
      remaining > 0
        ? Math.round(Number(presentValue(domain.annualInterestRate, emi, remaining)) * 100) / 100
        : 0;

    await prisma.loan.update({
      where: { id: row.id },
      data: {
        remainingMonths: remaining,
        outstandingAmount: outstanding,
      },
    });
  }

  // 4. Return the freshly recalculated analytics
  return getLoansAnalytics();
}
