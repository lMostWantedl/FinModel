import { useState, type FormEvent } from 'react';
import { api, fmtMoney } from '../api';
import { DebtTimelineChart } from '../components/DebtTimelineChart';
import { StrategyBarChart } from '../components/StrategyBarChart';
import type { SimulationPayload, StrategyName } from '../types';

const STRATEGIES: { value: StrategyName; label: string; hint: string }[] = [
  { value: 'current', label: 'Current', hint: 'EMIs only, no prepayments' },
  { value: 'avalanche', label: 'Avalanche', hint: 'highest interest rate first' },
  { value: 'snowball', label: 'Snowball', hint: 'smallest balance first' },
  { value: 'optimized', label: 'Optimized', hint: 'interest saved − fees − opportunity cost' },
];

export function ScenariosPage() {
  const [strategy, setStrategy] = useState<StrategyName>('optimized');
  const [extra, setExtra] = useState('10000');
  const [bonusAmount, setBonusAmount] = useState('0');
  const [bonusMonth, setBonusMonth] = useState('11');
  const [oppRate, setOppRate] = useState('6');
  const [payload, setPayload] = useState<SimulationPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const bonuses =
        Number(bonusAmount) > 0
          ? [{ month: Number(bonusMonth), amount: Number(bonusAmount) }]
          : [];
      setPayload(
        await api.simulate({
          strategy,
          extraMonthlyPayment: Number(extra) || 0,
          bonuses,
          opportunityRatePct: Number(oppRate) || 0,
        }),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="card">
        <h2>Run a scenario</h2>
        <form className="grid" onSubmit={run}>
          <label className="field">
            Strategy
            <select value={strategy} onChange={(e) => setStrategy(e.target.value as StrategyName)}>
              {STRATEGIES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label} — {s.hint}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Extra per month
            <input type="number" min="0" step="100" value={extra} onChange={(e) => setExtra(e.target.value)} />
          </label>
          <label className="field">
            Annual bonus
            <input type="number" min="0" step="1000" value={bonusAmount} onChange={(e) => setBonusAmount(e.target.value)} />
          </label>
          <label className="field">
            Bonus month
            <select value={bonusMonth} onChange={(e) => setBonusMonth(e.target.value)}>
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {new Date(2026, i, 1).toLocaleDateString('en', { month: 'long' })}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Opportunity rate % p.a.
            <input type="number" min="0" max="100" step="0.5" value={oppRate} onChange={(e) => setOppRate(e.target.value)} />
          </label>
          <button className="primary" disabled={busy} type="submit">
            {busy ? 'Simulating…' : 'Simulate'}
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </div>

      {payload && (
        <>
          <div className="card">
            <h2>Strategy comparison</h2>
            <StrategyBarChart comparison={payload.comparison} />
            <table>
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th className="num">Months</th>
                  <th>Debt-free</th>
                  <th className="num">Total interest</th>
                  <th className="num">Total paid</th>
                  <th className="num">Saved vs current</th>
                </tr>
              </thead>
              <tbody>
                {payload.comparison.map((c) => (
                  <tr key={c.strategy} style={{ fontWeight: c.strategy === payload.strategy ? 600 : 400 }}>
                    <td>{c.strategy}</td>
                    <td className="num">{c.months}</td>
                    <td>{c.debtFreeMonth ?? 'never'}</td>
                    <td className="num">{fmtMoney(c.totalInterest)}</td>
                    <td className="num">{fmtMoney(c.totalPaid)}</td>
                    <td className="num">{fmtMoney(c.interestSavedVsCurrent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2>Debt timeline — {payload.strategy}</h2>
            <DebtTimelineChart timeline={payload.result.timeline} />
          </div>

          <div className="card">
            <h2>Per-loan payoff — {payload.strategy}</h2>
            <table>
              <thead>
                <tr>
                  <th>Loan</th>
                  <th className="num">Total interest</th>
                  <th className="num">Foreclosure fees</th>
                  <th>Paid off</th>
                </tr>
              </thead>
              <tbody>
                {payload.result.loans.map((l) => (
                  <tr key={l.loanId}>
                    <td>{l.name}</td>
                    <td className="num">{fmtMoney(l.totalInterest)}</td>
                    <td className="num">{fmtMoney(l.totalForeclosureFees)}</td>
                    <td>{l.payoffMonth ?? 'never'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ marginBottom: 0 }}>
              <a className="download" href={api.excelUrl}>
                ⬇ Download Excel report
              </a>
            </p>
          </div>
        </>
      )}
    </>
  );
}
