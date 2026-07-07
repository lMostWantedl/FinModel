import { describe, expect, it } from 'vitest';
import { compareStrategies, simulate } from '../src/simulate.js';
import type { LoanInput } from '../src/types.js';

const loans: LoanInput[] = [
  { id: 'car', name: 'Car', principal: 300_000, annualRatePct: 9.5, emi: 9_500, foreclosureFeePct: 0 },
  { id: 'personal', name: 'Personal', principal: 150_000, annualRatePct: 14, emi: 5_200, foreclosureFeePct: 3 },
  { id: 'home', name: 'Home', principal: 2_000_000, annualRatePct: 8.2, emi: 18_000, foreclosureFeePct: 0 },
];

const base = { loans, startMonth: '2026-07', extraMonthlyPayment: 10_000, opportunityRatePct: 6 };

describe('simulate', () => {
  it('runs to zero and is deterministic', () => {
    const a = simulate({ ...base, strategy: 'avalanche' });
    const b = simulate({ ...base, strategy: 'avalanche' });
    expect(a).toEqual(b);
    expect(a.debtFreeMonth).not.toBeNull();
    expect(a.timeline.at(-1)?.totalClosing).toBe(0);
    expect(a.loans.every((l) => l.payoffMonth !== null)).toBe(true);
  });

  it('conserves money: totalPaid = principal + interest + fees', () => {
    const r = simulate({ ...base, strategy: 'optimized' });
    const principal = loans.reduce((s, l) => s + l.principal, 0);
    expect(r.totalPaid).toBeCloseTo(principal + r.totalInterest + r.totalForeclosureFees, 0);
  });

  it('avalanche prioritizes the highest rate (personal loan closes first)', () => {
    const r = simulate({ ...base, strategy: 'avalanche' });
    const payoffs = Object.fromEntries(r.loans.map((l) => [l.loanId, l.payoffMonth!]));
    expect(payoffs.personal < payoffs.car).toBe(true);
    expect(payoffs.personal < payoffs.home).toBe(true);
  });

  it('snowball prioritizes the smallest balance', () => {
    const r = simulate({ ...base, strategy: 'snowball' });
    const first = r.schedule.find((row) => row.extraPrincipal > 0);
    expect(first?.loanId).toBe('personal'); // smallest opening balance
  });

  it('November bonus is applied as extra principal in November', () => {
    const r = simulate({
      loans,
      startMonth: '2026-07',
      strategy: 'avalanche',
      bonuses: [{ month: 11, amount: 50_000 }],
    });
    const nov = r.schedule.filter((row) => row.month === '2026-11');
    const extraInNov = nov.reduce((s, row) => s + row.extraPrincipal + row.foreclosureFee, 0);
    expect(extraInNov).toBeCloseTo(50_000, 0);
    const oct = r.schedule.filter((row) => row.month === '2026-10');
    expect(oct.reduce((s, row) => s + row.extraPrincipal, 0)).toBe(0);
  });

  it('foreclosure fee is charged on prepaid principal', () => {
    const r = simulate({
      loans: [loans[1]!],
      startMonth: '2026-07',
      strategy: 'avalanche',
      extraMonthlyPayment: 5_000,
    });
    expect(r.totalForeclosureFees).toBeGreaterThan(0);
  });

  it('caps runaway loans instead of looping forever', () => {
    const r = simulate({
      loans: [{ id: 'x', name: 'X', principal: 1_000_000, annualRatePct: 24, emi: 1_000 }],
      startMonth: '2026-01',
      strategy: 'current',
    });
    expect(r.months).toBe(1200);
    expect(r.debtFreeMonth).toBeNull();
  });
});

describe('compareStrategies', () => {
  it('every prepayment strategy beats doing nothing', () => {
    const { comparison } = compareStrategies(base);
    const current = comparison.find((c) => c.strategy === 'current')!;
    for (const c of comparison) {
      if (c.strategy === 'current') continue;
      expect(c.totalInterest).toBeLessThan(current.totalInterest);
      expect(c.interestSavedVsCurrent).toBeGreaterThan(0);
    }
  });
});
