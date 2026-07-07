import { Decimal } from './money.js';
import { scoreLoan } from './optimizer.js';
import type { LoanInput, StrategyName } from './types.js';

export interface OpenLoan {
  loan: LoanInput;
  balance: Decimal;
}

/**
 * Order open loans by prepayment priority. The head of the list receives
 * extra payments and bonuses first (docs/13: bonus goes to the highest
 * scoring loan).
 */
export function prioritize(
  strategy: StrategyName,
  open: OpenLoan[],
  opportunityRatePct: number,
): OpenLoan[] {
  const sorted = [...open];
  switch (strategy) {
    case 'current':
      return sorted; // no prepayments; order is irrelevant
    case 'avalanche':
      return sorted.sort((a, b) => b.loan.annualRatePct - a.loan.annualRatePct);
    case 'snowball':
      return sorted.sort((a, b) => a.balance.cmp(b.balance));
    case 'optimized':
      return sorted
        .map((o) => ({ o, score: scoreLoan(o.loan, o.balance, opportunityRatePct) }))
        .sort((a, b) => b.score.cmp(a.score))
        .map(({ o }) => o);
  }
}
