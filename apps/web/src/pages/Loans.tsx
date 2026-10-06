import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, fmtMoney } from '../api';
import { LoanCharts } from '../components/LoanCharts';
import type { Loan, LoanAnalyticsResponse, LoanType } from '../types';

const EMPTY = {
  lender: '',
  name: '',
  type: 'PERSONAL' as LoanType,
  priority: '0',
  outstandingAmount: '',
  annualInterestRate: '',
  apr: '',
  emi: '',
  emiDay: '',
  tenureMonths: '',
  startDate: '',
  fcFeePct: '0',
  fcLockMonths: '0',
  ppFeePct: '0',
  ppLockMonths: '0',
};

type FormState = typeof EMPTY;

const loanToForm = (l: Loan): FormState => ({
  lender: l.lender,
  name: l.name,
  type: l.type,
  priority: String(l.priority),
  outstandingAmount: String(l.outstandingAmount),
  annualInterestRate: String(l.annualInterestRate),
  apr: String(l.apr),
  emi: String(l.emi),
  emiDay: String(l.emiDay),
  tenureMonths: l.tenureMonths ? String(l.tenureMonths) : '',
  startDate: l.startDate.slice(0, 10),
  fcFeePct: String(l.foreclosure.feePct),
  fcLockMonths: String(l.foreclosure.lockInMonths),
  ppFeePct: String(l.partPayment.feePct),
  ppLockMonths: String(l.partPayment.lockInMonths),
});

const ordinal = (n: number): string => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? 'th'}`;
};

const EXAMPLE_JSON = `{
  "lender": "ACME Bank",
  "name": "Personal loan",
  "type": "PERSONAL",
  "outstandingAmount": "421350.75",
  "annualInterestRate": 13.5,
  "emi": "11500",
  "emiDay": 5,
  "tenureMonths": 60,
  "startDate": "2024-03-10",
  "foreclosure": { "allowed": true, "lockInMonths": 12, "feePct": 4 },
  "partPayment": { "allowed": true, "lockInMonths": 6, "feePct": 2, "minAmount": 10000 }
}`;

export function LoansPage() {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [analytics, setAnalytics] = useState<LoanAnalyticsResponse | null>(null);
  const [sectionView, setSectionView] = useState<'both' | 'charts' | 'table'>('both');
  const [form, setForm] = useState<FormState>(EMPTY);
  const [editing, setEditing] = useState<Loan | null>(null);
  const [importText, setImportText] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const refresh = () =>
    Promise.all([api.loans(), api.loanAnalytics()])
      .then(([l, a]) => {
        setLoans(l);
        setAnalytics(a);
      })
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void refresh();
  }, []);

  const set = (k: keyof FormState) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const startEdit = (loan: Loan) => {
    setEditing(loan);
    setForm(loanToForm(loan));
    setNotice(null);
    setError(null);
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const cancelEdit = () => {
    setEditing(null);
    setForm(EMPTY);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const payload = {
        lender: form.lender.trim(),
        name: form.name.trim(),
        type: form.type,
        priority: Number(form.priority) || 0,
        outstandingAmount: Number(form.outstandingAmount),
        annualInterestRate: Number(form.annualInterestRate),
        ...(form.apr !== '' ? { apr: Number(form.apr) } : {}),
        emi: Number(form.emi),
        ...(form.emiDay !== '' ? { emiDay: Number(form.emiDay) } : {}),
        ...(form.tenureMonths !== '' ? { tenureMonths: Number(form.tenureMonths) } : {}),
        ...(form.startDate !== '' ? { startDate: form.startDate } : {}),
        foreclosure: {
          allowed: editing?.foreclosure.allowed ?? true,
          lockInMonths: Number(form.fcLockMonths) || 0,
          feePct: Number(form.fcFeePct) || 0,
        },
        partPayment: {
          allowed: editing?.partPayment.allowed ?? true,
          lockInMonths: Number(form.ppLockMonths) || 0,
          feePct: Number(form.ppFeePct) || 0,
          minAmount: editing?.partPayment.minAmount ?? 0,
        },
        // Preserve contract facts the form does not expose.
        ...(editing
          ? {
              loanAmount: editing.loanAmount,
              disbursedAmount: editing.disbursedAmount,
              processingFee: editing.processingFee,
              totalInterest: editing.totalInterest,
              totalRepayment: editing.totalRepayment,
            }
          : {}),
      };
      if (editing) {
        await api.updateLoan(editing.id, payload);
        setNotice(`Updated ${payload.name}.`);
      } else {
        await api.createLoan(payload);
        setNotice(`Added ${payload.name}.`);
      }
      cancelEdit();
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const importJson = async (text: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const parsed = JSON.parse(text) as unknown;
      const res = await api.importLoans(parsed);
      setNotice(`Imported ${res.imported} loan${res.imported === 1 ? '' : 's'}.`);
      setImportText('');
      await refresh();
    } catch (err) {
      setError(err instanceof SyntaxError ? `Invalid JSON: ${err.message}` : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    await importJson(await file.text());
    if (fileRef.current) fileRef.current.value = '';
  };

  const remove = async (id: string) => {
    if (editing?.id === id) cancelEdit();
    await api.deleteLoan(id).catch((e: Error) => setError(e.message));
    await refresh();
  };

  return (
    <>
      {analytics && analytics.loans.length > 0 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 20,
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Loan Portfolio & Repayment Analytics</h1>
            <p className="muted" style={{ margin: '3px 0 0', fontSize: 13 }}>
              Current outstanding balances, amounts paid to date, and future obligations across all lenders.
            </p>
          </div>
          <nav className="tabs">
            <button
              className={sectionView === 'both' ? 'active' : ''}
              onClick={() => setSectionView('both')}
            >
              👁️ All Views
            </button>
            <button
              className={sectionView === 'charts' ? 'active' : ''}
              onClick={() => setSectionView('charts')}
            >
              📊 Charts Only
            </button>
            <button
              className={sectionView === 'table' ? 'active' : ''}
              onClick={() => setSectionView('table')}
            >
              📋 Manage Loans
            </button>
          </nav>
        </div>
      )}

      {/* Analytics & Charts Section */}
      {analytics && analytics.loans.length > 0 && (sectionView === 'both' || sectionView === 'charts') && (
        <div style={{ marginBottom: 24 }}>
          <LoanCharts data={analytics} />
        </div>
      )}

      {/* Loans Table & Form Management */}
      {(sectionView === 'both' || sectionView === 'table' || !analytics || analytics.loans.length === 0) && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ margin: 0 }}>Your loans</h2>
            {analytics && (
              <span className="muted" style={{ fontSize: 12.5 }}>
                {loans.length} active loan accounts
              </span>
            )}
          </div>
          {loans.length === 0 ? (
            <p className="muted">No loans yet — add one below or import JSON.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Lender</th>
                    <th>Name</th>
                    <th>Type</th>
                    <th className="num">Priority</th>
                    <th className="num">Outstanding</th>
                    <th className="num">Repaid (Contract)</th>
                    <th className="num">To be paid</th>
                    <th className="num">Progress</th>
                    <th className="num">2026 Stmt Paid</th>
                    <th className="num">Rate %</th>
                    <th className="num">APR %</th>
                    <th className="num">EMI</th>
                    <th>EMI date</th>
                    <th className="num">Months left</th>
                    <th className="num">FC fee %</th>
                    <th className="num">PP fee %</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {loans.map((l) => {
                    const aItem = analytics?.loans.find((a) => a.id === l.id);
                    return (
                      <tr key={l.id}>
                        <td>{l.lender || '—'}</td>
                        <td>
                          <strong>{l.name}</strong>
                        </td>
                        <td>{l.type.replace('_', ' ').toLowerCase()}</td>
                        <td className="num">{l.priority}</td>
                        <td className="num" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                          {fmtMoney(l.outstandingAmount)}
                        </td>
                        <td className="num" style={{ color: 'var(--good)', fontWeight: 600 }}>
                          {aItem ? fmtMoney(aItem.contractualPaid || aItem.principalPaidSoFar) : '—'}
                        </td>
                        <td className="num" style={{ color: '#c98500', fontWeight: 600 }}>
                          {aItem ? fmtMoney(aItem.amountToBePaid) : '—'}
                        </td>
                        <td className="num">
                          {aItem ? (
                            <span
                              className="badge"
                              style={{
                                background: (aItem.percentPaid || aItem.principalPercentPaid) >= 50 ? 'rgba(25, 158, 112, 0.15)' : 'var(--border)',
                                color: (aItem.percentPaid || aItem.principalPercentPaid) >= 50 ? 'var(--good)' : 'inherit',
                                fontSize: 11.5,
                              }}
                            >
                              {aItem.percentPaid || aItem.principalPercentPaid}%
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="num" style={{ color: 'var(--accent)', fontSize: 12 }}>
                          {aItem && aItem.statementPaid2026 > 0 ? (
                            <span>
                              {fmtMoney(aItem.statementPaid2026)}{' '}
                              <span className="muted" style={{ fontSize: 11 }}>
                                ({aItem.statementTxnCount2026})
                              </span>
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="num">{l.annualInterestRate}</td>
                        <td className="num">{l.apr}</td>
                        <td className="num">{fmtMoney(l.emi)}</td>
                        <td>{ordinal(l.emiDay)} of month</td>
                        <td className="num">{l.remainingMonths}</td>
                        <td className="num">{l.foreclosure.feePct}</td>
                        <td className="num">{l.partPayment.feePct}</td>
                        <td className="num" style={{ whiteSpace: 'nowrap' }}>
                          <button className="ghost" style={{ color: 'var(--accent)' }} onClick={() => startEdit(l)}>
                            Edit
                          </button>{' '}
                          <button className="ghost" onClick={() => remove(l.id)}>
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {notice && <p className="muted" style={{ color: 'var(--good)' }}>{notice}</p>}
        </div>
      )}

      <div className="card" ref={formRef}>
        <h2>{editing ? `Edit: ${editing.name}` : 'Add a loan'}</h2>
        <form className="grid" onSubmit={submit}>
          <label className="field">
            Lender
            <input value={form.lender} onChange={set('lender')} placeholder="ACME Bank" />
          </label>
          <label className="field">
            Name
            <input required value={form.name} onChange={set('name')} placeholder="Personal loan" />
          </label>
          <label className="field">
            Type
            <select value={form.type} onChange={set('type')}>
              <option value="PERSONAL">Personal</option>
              <option value="GOLD">Gold</option>
              <option value="CREDIT_CARD">Credit card</option>
            </select>
          </label>
          <label className="field">
            Priority
            <input type="number" step="1" value={form.priority} onChange={set('priority')} />
          </label>
          <label className="field">
            Outstanding balance
            <input required type="number" min="1" step="any" value={form.outstandingAmount} onChange={set('outstandingAmount')} />
          </label>
          <label className="field">
            Interest rate % p.a.
            <input required type="number" min="0" max="100" step="0.01" value={form.annualInterestRate} onChange={set('annualInterestRate')} />
          </label>
          <label className="field">
            APR % (optional)
            <input type="number" min="0" max="200" step="0.01" value={form.apr} onChange={set('apr')} />
          </label>
          <label className="field">
            Monthly EMI
            <input required type="number" min="1" step="any" value={form.emi} onChange={set('emi')} />
          </label>
          <label className="field">
            EMI day of month
            <input type="number" min="1" max="31" step="1" value={form.emiDay} onChange={set('emiDay')} placeholder="e.g. 5" />
          </label>
          <label className="field">
            Tenure (months, optional)
            <input type="number" min="1" step="1" value={form.tenureMonths} onChange={set('tenureMonths')} />
          </label>
          <label className="field">
            Start date (optional)
            <input type="date" value={form.startDate} onChange={set('startDate')} />
          </label>
          <label className="field">
            Foreclosure fee %
            <input type="number" min="0" max="100" step="0.1" value={form.fcFeePct} onChange={set('fcFeePct')} />
          </label>
          <label className="field">
            Foreclosure lock-in (months)
            <input type="number" min="0" step="1" value={form.fcLockMonths} onChange={set('fcLockMonths')} />
          </label>
          <label className="field">
            Part-payment fee %
            <input type="number" min="0" max="100" step="0.1" value={form.ppFeePct} onChange={set('ppFeePct')} />
          </label>
          <label className="field">
            Part-payment lock-in (months)
            <input type="number" min="0" step="1" value={form.ppLockMonths} onChange={set('ppLockMonths')} />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="primary" disabled={busy} type="submit">
              {editing ? 'Save changes' : 'Add loan'}
            </button>
            {editing && (
              <button type="button" className="ghost" style={{ color: 'var(--text-secondary)' }} onClick={cancelEdit}>
                Cancel
              </button>
            )}
          </div>
        </form>
        {error && <p className="error">{error}</p>}
      </div>

      <div className="card">
        <h2>Import loan JSON</h2>
        <p className="muted">
          Paste a single loan object or an array of them. Decimal fields may be numbers or strings;
          missing fields (outstanding, tenure, end date, totals, APR) are derived automatically.
        </p>
        <textarea
          rows={6}
          style={{ width: '100%', resize: 'vertical' }}
          placeholder={EXAMPLE_JSON}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
        />
        <div style={{ display: 'flex', gap: 12, marginTop: 10, alignItems: 'center' }}>
          <button
            className="primary"
            disabled={busy || importText.trim() === ''}
            onClick={() => importJson(importText)}
          >
            Import pasted JSON
          </button>
          <span className="muted">or</span>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </div>
      </div>
    </>
  );
}
