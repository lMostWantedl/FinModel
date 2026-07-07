import {
  compareStrategies,
  evaluateForeclosure,
  prioritize,
  toSimulationLoan,
  d,
  toMoney,
  type BonusInput,
  type LoanInput,
  type SimulationResult,
  type StrategyComparison,
  type StrategyName,
} from '@debt/engine';
import { prisma } from '../lib/prisma.js';
import { rowToDomain } from './loanMapper.js';

export interface SimulateOptions {
  strategy: StrategyName;
  extraMonthlyPayment: number;
  bonuses: BonusInput[];
  opportunityRatePct: number;
  startMonth: string;
}

export const currentMonth = (): string => new Date().toISOString().slice(0, 7);

export async function loadLoans(asOf: Date = new Date()): Promise<LoanInput[]> {
  const rows = await prisma.loan.findMany({ orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] });
  return rows.map((r) => toSimulationLoan(rowToDomain(r), asOf));
}

export interface SimulationPayload {
  strategy: StrategyName;
  result: SimulationResult;
  comparison: StrategyComparison[];
}

export async function runSimulation(opts: SimulateOptions): Promise<SimulationPayload> {
  const loans = await loadLoans();
  if (loans.length === 0) throw Object.assign(new Error('No loans to simulate'), { statusCode: 422 });

  const { results, comparison } = compareStrategies({
    loans,
    extraMonthlyPayment: opts.extraMonthlyPayment,
    bonuses: opts.bonuses,
    opportunityRatePct: opts.opportunityRatePct,
    startMonth: opts.startMonth,
  });
  const result = results[opts.strategy];

  await prisma.simulationResult.create({
    data: {
      strategy: opts.strategy,
      inputJson: JSON.stringify({ ...opts, loans }),
      resultJson: JSON.stringify(result),
      comparisonJson: JSON.stringify(comparison),
    },
  });
  await prisma.snapshot.create({
    data: {
      totalDebt: toMoney(loans.reduce((acc, l) => acc.add(l.principal), d(0))),
      dataJson: JSON.stringify(loans),
    },
  });

  return { strategy: opts.strategy, result, comparison };
}

export async function latestSimulation(): Promise<SimulationPayload | null> {
  const row = await prisma.simulationResult.findFirst({ orderBy: { createdAt: 'desc' } });
  if (!row) return null;
  return {
    strategy: row.strategy as StrategyName,
    result: JSON.parse(row.resultJson) as SimulationResult,
    comparison: JSON.parse(row.comparisonJson) as StrategyComparison[],
  };
}

export async function buildDashboard(opts: Omit<SimulateOptions, 'strategy'>) {
  const loans = await loadLoans();
  if (loans.length === 0) {
    return { loans: [], remainingDebt: 0, nextTarget: null, debtFreeMonth: null, comparison: [], timeline: [], foreclosure: [] };
  }
  const { results, comparison } = compareStrategies({
    loans,
    extraMonthlyPayment: opts.extraMonthlyPayment,
    bonuses: opts.bonuses,
    opportunityRatePct: opts.opportunityRatePct,
    startMonth: opts.startMonth,
  });
  const optimized = results.optimized;
  const open = loans
    .map((loan) => ({ loan, balance: d(loan.principal) }))
    .filter((o) => o.balance.gt(0));
  const target = prioritize('optimized', open, opts.opportunityRatePct)[0] ?? null;
  return {
    loans,
    remainingDebt: toMoney(loans.reduce((acc, l) => acc.add(l.principal), d(0))),
    nextTarget: target ? { loanId: target.loan.id, name: target.loan.name } : null,
    debtFreeMonth: optimized.debtFreeMonth,
    interestSaved: comparison.find((c) => c.strategy === 'optimized')?.interestSavedVsCurrent ?? 0,
    comparison,
    timeline: optimized.timeline,
    foreclosure: loans.map((l) => evaluateForeclosure(l, d(l.principal))),
  };
}
