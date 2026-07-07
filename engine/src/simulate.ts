import { Decimal, d, toMoney, addMonths, calendarMonth } from './money.js';
import { amortizeMonth } from './amortization.js';
import { prioritize, type OpenLoan } from './strategies.js';
import type {
  AmortizationRow,
  LoanResult,
  MonthSummary,
  SimulationInput,
  SimulationResult,
  StrategyComparison,
  StrategyName,
} from './types.js';

const MAX_MONTHS = 1200; // 100 years: hard stop for loans whose EMI never amortizes

const DEFAULT_OPPORTUNITY_RATE = 6;

/**
 * Iterate month-by-month until every balance reaches zero (docs/09).
 * Pure and deterministic: same input, same output.
 */
export function simulate(input: SimulationInput): SimulationResult {
  const opportunityRate = input.opportunityRatePct ?? DEFAULT_OPPORTUNITY_RATE;
  const extraMonthly = d(input.extraMonthlyPayment ?? 0);
  const bonuses = input.bonuses ?? [];

  const state = new Map<string, { balance: Decimal; interest: Decimal; fees: Decimal; payoff: string | null }>();
  for (const loan of input.loans) {
    if (loan.principal < 0 || loan.emi < 0 || loan.annualRatePct < 0) {
      throw new Error(`Loan ${loan.name}: principal, EMI and rate must be non-negative`);
    }
    state.set(loan.id, { balance: d(loan.principal), interest: d(0), fees: d(0), payoff: null });
  }

  const schedule: AmortizationRow[] = [];
  const timeline: MonthSummary[] = [];
  let month = input.startMonth;
  let monthsRun = 0;

  const openLoans = (): OpenLoan[] =>
    input.loans
      .map((loan) => ({ loan, balance: state.get(loan.id)!.balance }))
      .filter((o) => o.balance.gt(0));

  while (openLoans().length > 0 && monthsRun < MAX_MONTHS) {
    const rows = new Map<string, AmortizationRow>();
    let totalOpening = d(0);

    // 1) Scheduled EMI on every open loan.
    for (const { loan, balance } of openLoans()) {
      const s = state.get(loan.id)!;
      const { opening, interest, principal, closing } = amortizeMonth(balance, loan.annualRatePct, d(loan.emi));
      s.balance = closing;
      s.interest = s.interest.add(interest);
      totalOpening = totalOpening.add(opening);
      rows.set(loan.id, {
        loanId: loan.id,
        month,
        opening: toMoney(opening),
        interest: toMoney(interest),
        principal: toMoney(principal),
        extraPrincipal: 0,
        foreclosureFee: 0,
        closing: toMoney(closing),
      });
    }

    // 2) Extra cash pool: monthly surplus plus any bonus landing this calendar
    //    month (docs/13: November bonus to the highest scoring loan). The
    //    'current' strategy makes no prepayments at all.
    let pool =
      input.strategy === 'current'
        ? d(0)
        : bonuses
            .filter((b) => b.month === calendarMonth(month))
            .reduce((acc, b) => acc.add(b.amount), extraMonthly);

    // 3) Allocate the pool in priority order, cascading to the next loan when
    //    one is paid off. Policies apply: a loan only receives part payments
    //    when its part-payment policy allows and the lock-in has elapsed;
    //    clearing a loan early requires the foreclosure policy too. Fees make
    //    each pool unit buy 1/(1+fee%) of principal.
    while (pool.gt(0.005)) {
      const eligible = openLoans().filter(
        (o) => (o.loan.partPaymentAllowed ?? true) && monthsRun >= (o.loan.partPaymentLockMonths ?? 0),
      );
      const targets = prioritize(input.strategy, eligible, opportunityRate);
      let allocated = false;
      for (const target of targets) {
        const s = state.get(target.loan.id)!;
        const fFeeRate = d(target.loan.foreclosureFeePct ?? 0).div(100);
        const pFeeRate = d(target.loan.partPaymentFeePct ?? target.loan.foreclosureFeePct ?? 0).div(100);
        const canClose =
          (target.loan.foreclosureAllowed ?? true) && monthsRun >= (target.loan.foreclosureLockMonths ?? 0);

        let principalPaid: Decimal;
        let fee: Decimal;
        if (canClose && pool.gte(s.balance.mul(fFeeRate.add(1)))) {
          // Full early closure at the foreclosure fee.
          principalPaid = s.balance;
          fee = s.balance.mul(fFeeRate);
        } else {
          // Part payment at the part-payment fee. When closure is not (yet)
          // permitted, keep the loan open by leaving one EMI outstanding.
          const cap = canClose ? s.balance : Decimal.max(s.balance.sub(target.loan.emi), 0);
          principalPaid = Decimal.min(pool.div(pFeeRate.add(1)), cap);
          fee = principalPaid.mul(pFeeRate);
        }
        if (principalPaid.lte(0.005)) continue;

        s.balance = s.balance.sub(principalPaid);
        s.fees = s.fees.add(fee);
        pool = pool.sub(principalPaid).sub(fee);
        const row = rows.get(target.loan.id);
        if (row) {
          row.extraPrincipal = toMoney(d(row.extraPrincipal).add(principalPaid));
          row.foreclosureFee = toMoney(d(row.foreclosureFee).add(fee));
          row.closing = toMoney(s.balance);
        }
        allocated = true;
        break;
      }
      if (!allocated) break; // nothing eligible can absorb the pool this month
    }

    // 4) Mark payoffs and summarize the month.
    let totalInterest = d(0);
    let totalPrincipal = d(0);
    let totalFees = d(0);
    let totalClosing = d(0);
    for (const row of rows.values()) {
      const s = state.get(row.loanId)!;
      if (s.balance.lte(0.005) && s.payoff === null) {
        s.balance = d(0);
        s.payoff = month;
        row.closing = 0;
      }
      schedule.push(row);
      totalInterest = totalInterest.add(row.interest);
      totalPrincipal = totalPrincipal.add(row.principal).add(row.extraPrincipal);
      totalFees = totalFees.add(row.foreclosureFee);
      totalClosing = totalClosing.add(row.closing);
    }
    timeline.push({
      month,
      totalOpening: toMoney(totalOpening),
      totalInterest: toMoney(totalInterest),
      totalPrincipal: toMoney(totalPrincipal),
      totalPaid: toMoney(totalInterest.add(totalPrincipal).add(totalFees)),
      totalClosing: toMoney(totalClosing),
    });

    month = addMonths(month, 1);
    monthsRun += 1;
  }

  const loans: LoanResult[] = input.loans.map((loan) => {
    const s = state.get(loan.id)!;
    return {
      loanId: loan.id,
      name: loan.name,
      totalInterest: toMoney(s.interest),
      totalForeclosureFees: toMoney(s.fees),
      payoffMonth: s.payoff,
    };
  });

  const debtFree = openLoans().length === 0;
  const totalInterest = loans.reduce((acc, l) => acc.add(l.totalInterest), d(0));
  const totalFees = loans.reduce((acc, l) => acc.add(l.totalForeclosureFees), d(0));
  const totalPrincipalPaid = input.loans.reduce((acc, l) => acc.add(l.principal), d(0));

  return {
    strategy: input.strategy,
    months: monthsRun,
    debtFreeMonth: debtFree && monthsRun > 0 ? addMonths(month, -1) : debtFree ? input.startMonth : null,
    totalInterest: toMoney(totalInterest),
    totalForeclosureFees: toMoney(totalFees),
    totalPaid: toMoney(totalInterest.add(totalFees).add(totalPrincipalPaid)),
    loans,
    schedule,
    timeline,
  };
}

const ALL_STRATEGIES: StrategyName[] = ['current', 'avalanche', 'snowball', 'optimized'];

/** Run every strategy on the same input (docs/14). */
export function compareStrategies(
  input: Omit<SimulationInput, 'strategy'>,
): { results: Record<StrategyName, SimulationResult>; comparison: StrategyComparison[] } {
  const results = Object.fromEntries(
    ALL_STRATEGIES.map((strategy) => [strategy, simulate({ ...input, strategy })]),
  ) as Record<StrategyName, SimulationResult>;
  const baseline = results.current;
  const comparison = ALL_STRATEGIES.map((strategy) => {
    const r = results[strategy];
    return {
      strategy,
      months: r.months,
      debtFreeMonth: r.debtFreeMonth,
      totalInterest: r.totalInterest,
      totalPaid: r.totalPaid,
      interestSavedVsCurrent: toMoney(d(baseline.totalInterest).sub(r.totalInterest)),
    };
  });
  return { results, comparison };
}
