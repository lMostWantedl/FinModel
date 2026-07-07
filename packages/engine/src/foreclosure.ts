import { Decimal, d, toMoney } from './money.js';
import { remainingInterest } from './amortization.js';
import type { ForeclosureEvaluation, LoanInput } from './types.js';

export const foreclosureFee = (balance: Decimal, feePct: number | undefined): Decimal =>
  balance.mul(d(feePct ?? 0).div(100));

/**
 * Evaluate closing a loan today: fee charged now vs interest avoided over the
 * remaining schedule. Closure is only recommended when it saves money.
 */
export function evaluateForeclosure(loan: LoanInput, balance: Decimal): ForeclosureEvaluation {
  const fee = foreclosureFee(balance, loan.foreclosureFeePct);
  const futureInterest = remainingInterest(balance, loan.annualRatePct, loan.emi);
  const savings = futureInterest.sub(fee);
  return {
    loanId: loan.id,
    fee: toMoney(fee),
    futureInterest: futureInterest.isFinite() ? toMoney(futureInterest) : Number.POSITIVE_INFINITY,
    savings: savings.isFinite() ? toMoney(savings) : Number.POSITIVE_INFINITY,
    recommendClosure: savings.gt(0),
  };
}
