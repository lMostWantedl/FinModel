import { describe, expect, it } from 'vitest';
import { loanFromJson, loanToJson, monthsBetween, toSimulationLoan } from '../src/domain.js';
import { simulate } from '../src/simulate.js';
import { toMoney } from '../src/money.js';

const minimalJson = {
  name: 'Gold loan',
  outstandingAmount: 200_000,
  annualInterestRate: 11,
  emi: 9_000,
};

describe('loanFromJson', () => {
  it('hydrates a minimal object and derives the rest', () => {
    const loan = loanFromJson(minimalJson);
    expect(loan.type).toBe('PERSONAL');
    expect(toMoney(loan.loanAmount)).toBe(200_000);
    expect(loan.remainingMonths).toBe(25); // 200k @ 11% with 9k EMI
    expect(loan.tenureMonths).toBe(25);
    expect(loan.apr).toBe(11);
    expect(loan.endDate.getTime()).toBeGreaterThan(loan.startDate.getTime());
    expect(loan.foreclosure).toEqual({ allowed: true, lockInMonths: 0, feePct: 0 });
    expect(loan.partPayment).toEqual({ allowed: true, lockInMonths: 0, feePct: 0, minAmount: 0 });
  });

  it('accepts Decimal fields serialized as strings and full policies', () => {
    const loan = loanFromJson({
      ...minimalJson,
      id: 'x1',
      lender: 'ACME Bank',
      type: 'GOLD',
      priority: 2,
      outstandingAmount: '199999.50',
      emi: '9000.25',
      startDate: '2025-01-15T00:00:00.000Z',
      foreclosure: { allowed: true, lockInMonths: 12, feePct: 4 },
      partPayment: { allowed: true, lockInMonths: 6, feePct: 2, minAmount: 10_000 },
    });
    expect(toMoney(loan.outstandingAmount)).toBe(199_999.5);
    expect(loan.foreclosure.feePct).toBe(4);
    expect(loan.partPayment.minAmount).toBe(10_000);
    const json = loanToJson(loan);
    expect(json.emi).toBe(9_000.25);
    expect(json.startDate).toBe('2025-01-15T00:00:00.000Z');
  });
});

describe('loanFromJson outstanding derivation', () => {
  it('derives the balance from remainingMonths via present value', () => {
    // 17 payments of 7,252 at 15.25% -> PV ≈ 111.4k
    const loan = loanFromJson({
      name: 'YES Bank',
      loanAmount: 303_168,
      annualInterestRate: 15.25,
      emi: 7_252,
      remainingMonths: 17,
    });
    expect(toMoney(loan.outstandingAmount)).toBeGreaterThan(110_000);
    expect(toMoney(loan.outstandingAmount)).toBeLessThan(113_000);
    expect(loan.remainingMonths).toBe(17);
  });

  it('derives the balance by amortizing forward from startDate', () => {
    const loan = loanFromJson(
      { name: 'Navi', loanAmount: 130_000, annualInterestRate: 21.91, emi: 8_600, tenureMonths: 18, startDate: '2025-10-04' },
      new Date('2026-07-03'),
    );
    // 9 EMIs paid: balance well below the loan amount but far from zero
    expect(toMoney(loan.outstandingAmount)).toBeLessThan(130_000 - 8_600 * 4);
    expect(toMoney(loan.outstandingAmount)).toBeGreaterThan(50_000);
  });

  it('falls back to the loan amount when nothing else is known', () => {
    const loan = loanFromJson({ name: 'X', loanAmount: 65_486, annualInterestRate: 31.08, emi: 6_419 });
    expect(toMoney(loan.outstandingAmount)).toBe(65_486);
  });

  it('throws when neither outstanding nor loan amount is given', () => {
    expect(() => loanFromJson({ name: 'X', annualInterestRate: 10, emi: 100 })).toThrow(/outstandingAmount or loanAmount/);
  });
});

describe('toSimulationLoan', () => {
  it('translates lock-ins relative to the as-of date', () => {
    const loan = loanFromJson({
      ...minimalJson,
      startDate: '2026-01-01',
      foreclosure: { allowed: true, lockInMonths: 12, feePct: 4 },
      partPayment: { allowed: false, lockInMonths: 6, feePct: 2, minAmount: 0 },
    });
    const sim = toSimulationLoan(loan, new Date('2026-07-01'));
    expect(sim.foreclosureLockMonths).toBe(6); // 12 - 6 elapsed
    expect(sim.partPaymentLockMonths).toBe(0);
    expect(sim.partPaymentAllowed).toBe(false);
    expect(sim.partPaymentFeePct).toBe(2);
  });

  it('monthsBetween clamps at zero', () => {
    expect(monthsBetween(new Date('2026-07-01'), new Date('2026-01-01'))).toBe(0);
  });
});

describe('policy-aware simulation', () => {
  const base = {
    id: 'a',
    name: 'A',
    principal: 100_000,
    annualRatePct: 12,
    emi: 5_000,
  };

  it('a loan with part payments disallowed never receives extra principal', () => {
    const r = simulate({
      loans: [{ ...base, partPaymentAllowed: false }],
      startMonth: '2026-01',
      strategy: 'avalanche',
      extraMonthlyPayment: 10_000,
    });
    expect(r.schedule.every((row) => row.extraPrincipal === 0)).toBe(true);
  });

  it('part-payment lock-in delays prepayments', () => {
    const r = simulate({
      loans: [{ ...base, partPaymentLockMonths: 3 }],
      startMonth: '2026-01',
      strategy: 'avalanche',
      extraMonthlyPayment: 10_000,
    });
    const byMonth = Object.fromEntries(r.schedule.map((row) => [row.month, row.extraPrincipal]));
    expect(byMonth['2026-01']).toBe(0);
    expect(byMonth['2026-03']).toBe(0);
    expect(byMonth['2026-04']).toBeGreaterThan(0);
  });

  it('foreclosure lock keeps the loan open (one EMI left) until EMIs finish it', () => {
    const r = simulate({
      loans: [{ ...base, foreclosureLockMonths: 120 }],
      startMonth: '2026-01',
      strategy: 'avalanche',
      extraMonthlyPayment: 50_000,
    });
    // Prepayments cap at balance - EMI, so the first month cannot close it...
    expect(r.schedule[0]!.closing).toBeGreaterThan(0);
    // ...and the scheduled EMIs clear the tail without an early closure.
    expect(r.debtFreeMonth).toBe('2026-04');
    expect(r.schedule.every((row) => row.closing > 0 || row.principal > 0 || row.extraPrincipal === 0)).toBe(true);
  });

  it('part-payment fee (not foreclosure fee) is charged on non-clearing prepayments', () => {
    const r = simulate({
      loans: [{ ...base, partPaymentFeePct: 2, foreclosureFeePct: 5, foreclosureAllowed: false }],
      startMonth: '2026-01',
      strategy: 'avalanche',
      extraMonthlyPayment: 10_000,
    });
    const first = r.schedule[0]!;
    // 10,000 pool at 2%: principal + fee = pool, fee = principal * 2%
    expect(first.foreclosureFee).toBeCloseTo(first.extraPrincipal * 0.02, 1);
  });
});
