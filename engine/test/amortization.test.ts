import { describe, expect, it } from 'vitest';
import { amortizeMonth, remainingInterest, remainingMonths } from '../src/amortization.js';
import { d, toMoney, addMonths } from '../src/money.js';
import { evaluateForeclosure } from '../src/foreclosure.js';

describe('amortizeMonth', () => {
  it('splits a payment into interest and principal', () => {
    // 120,000 at 12% -> 1% monthly -> 1,200 interest on the first month
    const row = amortizeMonth(d(120_000), 12, d(2_000));
    expect(toMoney(row.interest)).toBe(1_200);
    expect(toMoney(row.principal)).toBe(800);
    expect(toMoney(row.closing)).toBe(119_200);
  });

  it('never overpays the final month', () => {
    const row = amortizeMonth(d(500), 12, d(2_000));
    expect(toMoney(row.closing)).toBe(0);
    expect(toMoney(row.principal)).toBe(500);
  });

  it('zero-rate loans amortize principal only', () => {
    const row = amortizeMonth(d(1_000), 0, d(100));
    expect(toMoney(row.interest)).toBe(0);
    expect(toMoney(row.closing)).toBe(900);
  });
});

describe('remainingInterest / remainingMonths', () => {
  it('matches a hand-computed short schedule', () => {
    // 1,000 at 12%: m1 interest 10, m2 interest ~4.6 with EMI 550
    const interest = remainingInterest(d(1_000), 12, 550);
    expect(toMoney(interest)).toBeCloseTo(14.6, 1);
    expect(remainingMonths(d(1_000), 12, 550)).toBe(2);
  });

  it('returns Infinity when the EMI cannot cover interest', () => {
    expect(remainingInterest(d(100_000), 12, 500).isFinite()).toBe(false);
    expect(remainingMonths(d(100_000), 12, 500)).toBe(Infinity);
  });
});

describe('evaluateForeclosure', () => {
  const loan = { id: 'a', name: 'A', principal: 100_000, annualRatePct: 10, emi: 2_500 };

  it('recommends closure when future interest exceeds the fee', () => {
    const res = evaluateForeclosure({ ...loan, foreclosureFeePct: 2 }, d(100_000));
    expect(res.fee).toBe(2_000);
    expect(res.futureInterest).toBeGreaterThan(res.fee);
    expect(res.recommendClosure).toBe(true);
  });

  it('rejects closure when the fee exceeds remaining interest', () => {
    // tiny balance, one month of interest left, 10% fee
    const res = evaluateForeclosure({ ...loan, foreclosureFeePct: 10 }, d(2_000));
    expect(res.recommendClosure).toBe(false);
  });
});

describe('addMonths', () => {
  it('rolls over years', () => {
    expect(addMonths('2026-11', 2)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });
});
