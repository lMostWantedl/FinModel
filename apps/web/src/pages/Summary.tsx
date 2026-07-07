import { useEffect, useState } from 'react';
import { api, fmtMoney } from '../api';
import { CategoryChart } from '../components/CategoryChart';
import { TrendChart } from '../components/TrendChart';
import type { Category, Granularity, Summary } from '../types';

const SPANS: { granularity: Granularity; label: string }[] = [
  { granularity: 'day', label: 'Daily (14d)' },
  { granularity: 'week', label: 'Weekly (12w)' },
  { granularity: 'month', label: 'Monthly (12m)' },
];

export function SummaryPage() {
  const [granularity, setGranularity] = useState<Granularity>('month');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    Promise.all([api.summary(granularity), api.categories()])
      .then(([s, c]) => {
        setSummary(s);
        setCategories(c);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granularity]);

  const setBudget = async (id: string, current: number | null) => {
    const input = window.prompt('Monthly budget for this category (blank to clear):', current ? String(current) : '');
    if (input === null) return;
    try {
      await api.setBudget(id, input.trim() === '' ? null : Number(input));
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (error) return <p className="error">{error}</p>;
  if (!summary) return <p className="muted">Loading…</p>;

  const expenseCategories = summary.byCategory.filter((c) => c.kind === 'EXPENSE');
  const budgetable = categories.filter((c) => c.kind === 'EXPENSE');

  return (
    <>
      <div className="card" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <nav className="tabs">
          {SPANS.map((s) => (
            <button
              key={s.granularity}
              className={s.granularity === granularity ? 'active' : ''}
              onClick={() => setGranularity(s.granularity)}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <span className="muted">
          {summary.from} → {summary.to} · EMIs auto-included
        </span>
      </div>

      <div className="tiles">
        <div className="tile">
          <div className="label">Income</div>
          <div className="value good">{fmtMoney(summary.totals.income)}</div>
        </div>
        <div className="tile">
          <div className="label">Expenses</div>
          <div className="value">{fmtMoney(summary.totals.expense)}</div>
        </div>
        <div className="tile">
          <div className="label">Net</div>
          <div className="value" style={{ color: summary.totals.net >= 0 ? 'var(--good)' : 'var(--critical)' }}>
            {fmtMoney(summary.totals.net)}
          </div>
          <div className="sub">
            savings rate {summary.totals.savingsRate === null ? '—' : `${summary.totals.savingsRate}%`}
          </div>
        </div>
        <div className="tile">
          <div className="label">Available for debt</div>
          <div className="value">{fmtMoney(summary.suggestedExtraMonthly)}</div>
          <div className="sub">avg monthly surplus → optimizer</div>
        </div>
      </div>

      <div className="card">
        <h2>Income vs expenses</h2>
        {summary.buckets.length === 0 ? (
          <p className="muted">No entries yet — log some in the Ledger tab.</p>
        ) : (
          <TrendChart buckets={summary.buckets} />
        )}
      </div>

      <div className="card">
        <h2>Where the money went</h2>
        {expenseCategories.length === 0 ? (
          <p className="muted">No expenses in this range.</p>
        ) : (
          <>
            <CategoryChart data={expenseCategories.map((c) => ({ name: c.name, amount: c.amount }))} />
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="num">Spent</th>
                  <th className="num">Share</th>
                </tr>
              </thead>
              <tbody>
                {expenseCategories.map((c) => (
                  <tr key={c.categoryId}>
                    <td>{c.name}</td>
                    <td className="num">{fmtMoney(c.amount)}</td>
                    <td className="num">{c.share === null ? '—' : `${c.share}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="card">
        <h2>Budgets — current month</h2>
        {summary.budget.length > 0 && (
          <table style={{ marginBottom: 14 }}>
            <thead>
              <tr>
                <th>Category</th>
                <th className="num">Budget</th>
                <th className="num">Spent</th>
                <th className="num">Remaining</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {summary.budget.map((b) => (
                <tr key={b.categoryId}>
                  <td>{b.name}</td>
                  <td className="num">{fmtMoney(b.budget)}</td>
                  <td className="num">{fmtMoney(b.spent)}</td>
                  <td className="num" style={{ color: b.over ? 'var(--critical)' : undefined }}>
                    {fmtMoney(b.remaining)}
                  </td>
                  <td>
                    {b.over ? (
                      <span className="badge" style={{ color: 'var(--critical)' }}>
                        ⚠ over budget
                      </span>
                    ) : (
                      <span className="badge keep">on track</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted" style={{ marginBottom: 8 }}>
          Set a monthly target per category:
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {budgetable.map((c) => (
            <button key={c.id} className="ghost" style={{ color: 'var(--text-secondary)' }} onClick={() => setBudget(c.id, c.budgetMonthly)}>
              {c.name}
              {c.budgetMonthly ? `: ${fmtMoney(c.budgetMonthly)}` : ''}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
