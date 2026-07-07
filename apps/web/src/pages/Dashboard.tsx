import { useEffect, useState } from 'react';
import { api, fmtMoney } from '../api';
import { DebtTimelineChart } from '../components/DebtTimelineChart';
import { StrategyBarChart } from '../components/StrategyBarChart';
import type { Dashboard } from '../types';

const nthSuffix = (n: number): string => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] ?? s[v] ?? 'th';
};

const dueSub = (
  due: { dueTotal: number; dueCount: number; pendingCount: number; pending: { name: string; dueDate: string }[] } | undefined,
  label: string,
): string => {
  if (!due || due.pendingCount === 0)
    return `all ${due?.dueCount ?? 0} ${label} logged (${fmtMoney(due?.dueTotal ?? 0)})`;
  const nextDate = due.pending[0]!.dueDate;
  const day = Number(nextDate.slice(8));
  const names = due.pending
    .filter((p) => p.dueDate === nextDate)
    .map((p) => p.name)
    .join(', ');
  return `${due.pendingCount} of ${due.dueCount} ${label} pending · on the ${day}${nthSuffix(day)}: ${names}`;
};

const monthLabel = (m: string | null) =>
  m
    ? new Date(`${m}-01T00:00:00`).toLocaleDateString('en', { month: 'short', year: 'numeric' })
    : '—';

export function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [extra, setExtra] = useState<number | null>(null); // null = ledger surplus
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .dashboard(extra ?? undefined)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [extra]);

  if (error) return <p className="error">{error} — is the API running on port 3001?</p>;
  if (!data) return <p className="muted">Loading…</p>;
  if (data.loans.length === 0) {
    return (
      <div className="card">
        <h2>No loans yet</h2>
        <p className="muted">Add your loans in the Loans tab to see the dashboard.</p>
      </div>
    );
  }

  const nameOf = (loanId: string) => data.loans.find((l) => l.id === loanId)?.name ?? loanId;

  return (
    <>
      <div className="card" style={{ display: 'flex', gap: 16, alignItems: 'end', flexWrap: 'wrap' }}>
        <label className="field" style={{ maxWidth: 220 }}>
          Extra payment per month
          <input
            type="number"
            min={0}
            step={100}
            value={extra ?? data.extraMonthlyPayment ?? 0}
            onChange={(e) => setExtra(Math.max(0, Number(e.target.value)))}
          />
        </label>
        <span className="muted">
          {extra === null
            ? `Using your ledger surplus (${fmtMoney(data.suggestedExtra ?? 0)}/month). Projections use the optimized strategy.`
            : 'Projections below use the optimized strategy.'}
          {extra !== null && data.suggestedExtra !== undefined && (
            <>
              {' '}
              <button className="ghost" style={{ color: 'var(--accent)' }} onClick={() => setExtra(null)}>
                Use ledger surplus ({fmtMoney(data.suggestedExtra)})
              </button>
            </>
          )}
        </span>
      </div>

      <div className="tiles">
        <div className="tile">
          <div className="label">Spent this month</div>
          <div className="value">{fmtMoney(data.month?.expense ?? 0)}</div>
          <div className="sub">income {fmtMoney(data.month?.income ?? 0)}</div>
        </div>
        <div className="tile">
          <div className="label">Balance this month</div>
          <div
            className="value"
            style={{ color: (data.month?.net ?? 0) >= 0 ? 'var(--good)' : 'var(--critical)' }}
          >
            {fmtMoney(data.month?.net ?? 0)}
          </div>
          <div className="sub">income − expenses, month to date</div>
        </div>
        <div className="tile">
          <div className="label">Debt due this month</div>
          <div className="value">{fmtMoney(data.monthDue?.pendingAmount ?? 0)}</div>
          <div className="sub">{dueSub(data.monthDue, 'EMIs')}</div>
        </div>
        <div className="tile">
          <div className="label">Subscriptions due this month</div>
          <div className="value">{fmtMoney(data.monthSubsDue?.pendingAmount ?? 0)}</div>
          <div className="sub">{dueSub(data.monthSubsDue, 'charges')}</div>
        </div>
        <div className="tile">
          <div className="label">Remaining debt</div>
          <div className="value">{fmtMoney(data.remainingDebt)}</div>
          <div className="sub">{data.loans.length} active loans</div>
        </div>
        <div className="tile">
          <div className="label">Debt-free date</div>
          <div className="value">{monthLabel(data.debtFreeMonth)}</div>
          <div className="sub">optimized strategy</div>
        </div>
        <div className="tile">
          <div className="label">Interest saved vs current</div>
          <div className="value good">{fmtMoney(data.interestSaved ?? 0)}</div>
          <div className="sub">over the life of the loans</div>
        </div>
        <div className="tile">
          <div className="label">Next target</div>
          <div className="value" style={{ fontSize: 22 }}>
            {data.nextTarget?.name ?? '—'}
          </div>
          <div className="sub">send extra payments here first</div>
        </div>
      </div>

      <div className="card">
        <h2>Remaining debt over time</h2>
        <DebtTimelineChart timeline={data.timeline} />
      </div>

      <div className="card">
        <h2>Total interest by strategy</h2>
        <StrategyBarChart comparison={data.comparison} />
      </div>

      <div className="card">
        <h2>Foreclosure check</h2>
        <table>
          <thead>
            <tr>
              <th>Loan</th>
              <th className="num">Fee to close now</th>
              <th className="num">Future interest on EMI</th>
              <th className="num">Net savings</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {data.foreclosure.map((f) => (
              <tr key={f.loanId}>
                <td>{nameOf(f.loanId)}</td>
                <td className="num">{fmtMoney(f.fee)}</td>
                <td className="num">
                  {Number.isFinite(f.futureInterest) ? fmtMoney(f.futureInterest) : 'never repays'}
                </td>
                <td className="num">
                  {Number.isFinite(f.savings) ? fmtMoney(f.savings) : '∞'}
                </td>
                <td>
                  {f.recommendClosure ? (
                    <span className="badge close">✓ worth closing early</span>
                  ) : (
                    <span className="badge keep">keep paying EMI</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
