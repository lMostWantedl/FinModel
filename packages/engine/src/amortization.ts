import { Decimal, d, monthlyRate } from './money.js';

export interface MonthBreakdown {
  opening: Decimal;
  interest: Decimal;
  principal: Decimal;
  closing: Decimal;
}

/**
 * Amortize a single month. Pure: opening balance in, breakdown out.
 * The payment is capped so the balance never goes negative.
 */
export function amortizeMonth(
  opening: Decimal,
  annualRatePct: number,
  payment: Decimal,
): MonthBreakdown {
  const interest = opening.mul(monthlyRate(annualRatePct));
  const due = opening.add(interest);
  const paid = Decimal.min(payment, due);
  const principal = Decimal.max(paid.sub(interest), 0);
  const closing = opening.sub(principal);
  return { opening, interest, principal, closing };
}

/**
 * Total interest paid if the loan runs to zero on EMI alone.
 * Returns Infinity when the EMI does not cover the first month's interest.
 */
export function remainingInterest(
  balance: Decimal,
  annualRatePct: number,
  emi: number,
): Decimal {
  const rate = monthlyRate(annualRatePct);
  if (balance.lte(0)) return d(0);
  if (d(emi).lte(balance.mul(rate))) return d(Infinity);
  let bal = balance;
  let total = d(0);
  const payment = d(emi);
  // Bounded loop: the EMI check above guarantees the balance strictly decreases.
  while (bal.gt(0)) {
    const { interest, closing } = amortizeMonth(bal, annualRatePct, payment);
    total = total.add(interest);
    bal = closing;
  }
  return total;
}

/** Present value of an annuity: the balance that exactly n EMI payments clear. */
export function presentValue(annualRatePct: number, emi: number, months: number): Decimal {
  const rate = monthlyRate(annualRatePct);
  if (rate.isZero()) return d(emi).mul(months);
  const discount = d(1).sub(d(1).div(rate.add(1).pow(months)));
  return d(emi).mul(discount).div(rate);
}

/** Months left until payoff on EMI alone; Infinity if the EMI never amortizes. */
export function remainingMonths(balance: Decimal, annualRatePct: number, emi: number): number {
  const rate = monthlyRate(annualRatePct);
  if (balance.lte(0)) return 0;
  if (d(emi).lte(balance.mul(rate))) return Infinity;
  let bal = balance;
  let months = 0;
  const payment = d(emi);
  while (bal.gt(0)) {
    bal = amortizeMonth(bal, annualRatePct, payment).closing;
    months += 1;
  }
  return months;
}
