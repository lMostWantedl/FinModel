import { useEffect, useState, type FormEvent } from 'react';
import { api, fmtMoney } from '../api';
import type { Category, PaymentMethod, Subscription } from '../types';

const METHODS: PaymentMethod[] = ['CASH', 'BANK', 'UPI', 'CREDIT_CARD', 'OTHER'];
const MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Date(2026, i, 1).toLocaleDateString('en', { month: 'long' }),
);
const today = () => new Date().toISOString().slice(0, 10);

const EMPTY = {
  name: '',
  amount: '',
  categoryId: '',
  method: 'UPI' as PaymentMethod,
  cadence: 'MONTHLY' as 'MONTHLY' | 'YEARLY',
  billingDay: '1',
  billingMonth: '1',
  startDate: today(),
};

const ordinal = (n: number): string => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? 'th'}`;
};

export function SubscriptionsCard({
  categories,
  onChanged,
}: {
  categories: Category[];
  onChanged: () => void;
}) {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const expenseCategories = categories.filter((c) => c.kind === 'EXPENSE');
  const defaultCategory = expenseCategories.find((c) => c.name === 'Subscriptions');

  const load = () => api.subscriptions().then(setSubs).catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);

  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const startEdit = (s: Subscription) => {
    setEditing(s);
    setForm({
      name: s.name,
      amount: String(s.amount),
      categoryId: s.categoryId,
      method: s.method as PaymentMethod,
      cadence: s.cadence,
      billingDay: String(s.billingDay),
      billingMonth: String(s.billingMonth ?? 1),
      startDate: s.startDate.slice(0, 10),
    });
  };

  const cancel = () => {
    setEditing(null);
    setForm(EMPTY);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: form.name.trim(),
        amount: Number(form.amount),
        categoryId: form.categoryId || defaultCategory?.id || '',
        method: form.method,
        cadence: form.cadence,
        billingDay: Number(form.billingDay) || 1,
        ...(form.cadence === 'YEARLY' ? { billingMonth: Number(form.billingMonth) || 1 } : {}),
        startDate: form.startDate,
        active: editing?.active ?? true,
        note: '',
      };
      if (editing) await api.updateSubscription(editing.id, payload);
      else await api.createSubscription(payload);
      cancel();
      await load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (s: Subscription) => {
    try {
      await api.updateSubscription(s.id, {
        name: s.name,
        amount: s.amount,
        categoryId: s.categoryId,
        method: s.method as PaymentMethod,
        cadence: s.cadence,
        billingDay: s.billingDay,
        billingMonth: s.billingMonth,
        startDate: s.startDate.slice(0, 10),
        endDate: s.active ? today() : null, // pausing stamps the end date
        active: !s.active,
        note: s.note,
      });
      await load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (id: string) => {
    if (editing?.id === id) cancel();
    try {
      await api.deleteSubscription(id);
      await load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="card">
      <h2>Subscriptions</h2>
      <p className="muted">
        Recurring charges (OTT, gym, insurance…). Sync materializes each billing period into the
        ledger automatically, just like EMIs. Past charges keep their audit trail even if you
        cancel or delete a subscription.
      </p>
      {subs.length > 0 && (
        <div style={{ overflowX: 'auto', marginBottom: 14 }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th className="num">Amount</th>
                <th>Category</th>
                <th>Billing</th>
                <th>Method</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s.id} style={{ opacity: s.active ? 1 : 0.55 }}>
                  <td>{s.name}</td>
                  <td className="num">{fmtMoney(s.amount)}</td>
                  <td>{s.category.name}</td>
                  <td>
                    {s.cadence === 'MONTHLY'
                      ? `${ordinal(s.billingDay)} of every month`
                      : `${ordinal(s.billingDay)} ${MONTHS[(s.billingMonth ?? 1) - 1]}, yearly`}
                  </td>
                  <td>{s.method.replace('_', ' ').toLowerCase()}</td>
                  <td>
                    {s.active ? (
                      <span className="badge close">active</span>
                    ) : (
                      <span className="badge keep">paused</span>
                    )}
                  </td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>
                    <button className="ghost" style={{ color: 'var(--accent)' }} onClick={() => startEdit(s)}>
                      Edit
                    </button>{' '}
                    <button className="ghost" style={{ color: 'var(--text-secondary)' }} onClick={() => void toggleActive(s)}>
                      {s.active ? 'Pause' : 'Resume'}
                    </button>{' '}
                    <button className="ghost" onClick={() => remove(s.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form className="grid" onSubmit={submit}>
        <label className="field">
          Name
          <input required value={form.name} onChange={set('name')} placeholder="Netflix" />
        </label>
        <label className="field">
          Amount
          <input required type="number" min="0.01" step="any" value={form.amount} onChange={set('amount')} />
        </label>
        <label className="field">
          Category
          <select required value={form.categoryId || defaultCategory?.id || ''} onChange={set('categoryId')}>
            <option value="" disabled>
              Select…
            </option>
            {expenseCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Method
          <select value={form.method} onChange={set('method')}>
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {m.replace('_', ' ').toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Cadence
          <select value={form.cadence} onChange={set('cadence')}>
            <option value="MONTHLY">Monthly</option>
            <option value="YEARLY">Yearly</option>
          </select>
        </label>
        <label className="field">
          Billing day
          <input type="number" min="1" max="31" value={form.billingDay} onChange={set('billingDay')} />
        </label>
        {form.cadence === 'YEARLY' && (
          <label className="field">
            Billing month
            <select value={form.billingMonth} onChange={set('billingMonth')}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          Started on
          <input type="date" value={form.startDate} onChange={set('startDate')} />
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="primary" disabled={busy} type="submit">
            {editing ? 'Save changes' : 'Add subscription'}
          </button>
          {editing && (
            <button type="button" className="ghost" style={{ color: 'var(--text-secondary)' }} onClick={cancel}>
              Cancel
            </button>
          )}
        </div>
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
