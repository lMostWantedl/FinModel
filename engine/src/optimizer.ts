import { Decimal, d } from './money.js';
import { remainingInterest, remainingMonths } from './amortization.js';
import { foreclosureFee } from './foreclosure.js';
import type { LoanInput } from './types.js';

/**
 * Score a loan as a prepayment target (docs/11: score = interestSaved -
 * foreclosureCost - opportunityCost). Higher score = better target.
 *
 * - interestSaved: future interest avoided if the balance were cleared now.
 * - foreclosureCost: fee charged on prepaying the full balance.
 * - opportunityCost: what the same cash could earn elsewhere (simple interest
 *   at opportunityRatePct over the loan's remaining life).
 */
export function scoreLoan(loan: LoanInput, balance: Decimal, opportunityRatePct: number): Decimal {
  if (balance.lte(0)) return d(-Infinity);
  const interestSaved = remainingInterest(balance, loan.annualRatePct, loan.emi);
  if (!interestSaved.isFinite()) return d(Infinity); // underwater loan: always the top target
  const fee = foreclosureFee(balance, loan.foreclosureFeePct);
  const months = remainingMonths(balance, loan.annualRatePct, loan.emi);
  const opportunityCost = balance.mul(d(opportunityRatePct).div(100).div(12)).mul(months);
  return interestSaved.sub(fee).sub(opportunityCost);
}
