import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api, fmtMoney } from '../api';
import { SubscriptionsCard } from '../components/SubscriptionsCard';
import type { Category, EmiDue, EntryKind, LedgerEntry, PaymentMethod } from '../types';

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const monthStart = () => `${new Date().toISOString().slice(0, 7)}-01`;

const METHODS: PaymentMethod[] = ['CASH', 'BANK', 'UPI', 'CREDIT_CARD', 'OTHER'];

const EMPTY = {
  date: today(),
  kind: 'EXPENSE' as EntryKind,
  amount: '',
  categoryId: '',
  method: 'UPI' as PaymentMethod,
  tags: '',
  note: '',
};

export function LedgerPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [emiDue, setEmiDue] = useState<EmiDue | null>(null);
  const [payDates, setPayDates] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<LedgerEntry | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState(EMPTY);
  const [filters, setFilters] = useState({ from: daysAgo(30), to: today(), kind: '' as '' | EntryKind });
  const [syncFrom, setSyncFrom] = useState(monthStart());

  const kindCategories = useMemo(
    () => categories.filter((c) => c.kind === form.kind),
    [categories, form.kind],
  );

  const loadCategories = () => api.categories().then(setCategories).catch((e: Error) => setError(e.message));
  const loadEmiDue = () => api.emiDue().then(setEmiDue).catch((e: Error) => setError(e.message));
  const loadEntries = () =>
    api
      .entries({ from: filters.from, to: filters.to, ...(filters.kind ? { kind: filters.kind } : {}) })
      .then(setEntries)
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    void loadCategories();
    void loadEmiDue();
  }, []);
  useEffect(() => {
    void loadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const startEdit = (entry: LedgerEntry) => {
    setEditing(entry);
    setForm({
      date: entry.date,
      kind: entry.kind,
      amount: String(entry.amount),
      categoryId: entry.categoryId,
      method: entry.method as PaymentMethod,
      tags: entry.tags.join(', '),
      note: entry.note,
    });
    setNotice(null);
    setError(null);
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const cancelEdit = () => {
    setEditing(null);
    setForm(EMPTY);
  };

  const addCategory = async () => {
    const name = window.prompt(`New ${form.kind.toLowerCase()} category name:`)?.trim();
    if (!name) return;
    try {
      const c = await api.createCategory({ name, kind: form.kind });
      await loadCategories();
      setForm((f) => ({ ...f, categoryId: c.id }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const payload = {
        date: form.date,
        kind: form.kind,
        amount: Number(form.amount),
        categoryId: form.categoryId,
        method: form.method,
        note: form.note.trim(),
        tags: form.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      };
      if (editing) {
        await api.updateEntry(editing.id, payload);
        setNotice('Entry updated.');
        cancelEdit();
      } else {
        await api.createEntry(payload);
        setForm((f) => ({ ...f, amount: '', tags: '', note: '' }));
      }
      // Keep the just-saved entry visible: the Entries list is filtered (last 30
      // days by default, plus an optional Type filter), so an entry dated outside
      // that window — or of a different kind — would silently vanish. Widen the
      // filter to cover it instead of leaving the user staring at an empty list.
      const outOfRange =
        payload.date < filters.from ||
        payload.date > filters.to ||
        (filters.kind !== '' && filters.kind !== payload.kind);
      if (outOfRange) {
        setFilters((f) => ({
          from: payload.date < f.from ? payload.date : f.from,
          to: payload.date > f.to ? payload.date : f.to,
          kind: f.kind !== '' && f.kind !== payload.kind ? '' : f.kind,
        }));
        setNotice(`Saved — adjusted the Entries filter to show the ${payload.date} entry.`);
        // The filters change triggers a reload via the effect below.
      } else {
        await loadEntries();
      }
      void loadEmiDue();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const syncAuto = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.syncAuto(syncFrom || undefined);
      setNotice(
        res.created === 0
          ? 'Auto entries are up to date — nothing to add.'
          : `Added ${res.created} entr${res.created === 1 ? 'y' : 'ies'}: ${res.emis} EMI, ${res.subscriptions} subscription.`,
      );
      await Promise.all([loadEntries(), loadEmiDue()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const payEmi = async (loanId: string, name: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const entry = await api.payEmi({ loanId, date: payDates[loanId] || today() });
      setNotice(`Logged ${name} EMI for ${entry.date}. Sync won't duplicate it.`);
      // Widen the filter if the payment date falls outside the current window.
      setFilters((f) => ({
        ...f,
        from: entry.date < f.from ? entry.date : f.from,
        to: entry.date > f.to ? entry.date : f.to,
      }));
      await Promise.all([loadEntries(), loadEmiDue()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (editing?.id === id) cancelEdit();
    try {
      await api.deleteEntry(id);
      await Promise.all([loadEntries(), loadEmiDue()]);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const attach = async (entryId: string, file: File | undefined) => {
    if (!file) return;
    try {
      await api.uploadAttachment(entryId, file);
      await loadEntries();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const removeAttachment = async (id: string) => {
    try {
      await api.deleteAttachment(id);
      await loadEntries();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <div className="card" ref={formRef}>
        <h2>{editing ? `Edit entry — ${editing.date} ${editing.categoryName}` : 'Log income / expense'}</h2>
        {editing && editing.source !== 'MANUAL' && (
          <p className="muted">
            This is an auto-logged {editing.source === 'EMI_AUTO' ? 'EMI' : 'subscription'} entry.
            Your edits stick; the next sync will not overwrite it.
          </p>
        )}
        <form className="grid" onSubmit={submit}>
          <label className="field">
            Date
            <input required type="date" value={form.date} onChange={set('date')} />
          </label>
          <label className="field">
            Type
            <select
              value={form.kind}
              onChange={(e) =>
                setForm((f) => ({ ...f, kind: e.target.value as EntryKind, categoryId: '' }))
              }
            >
              <option value="EXPENSE">Expense</option>
              <option value="INCOME">Income</option>
            </select>
          </label>
          <label className="field">
            Amount
            <input required type="number" min="0.01" step="any" value={form.amount} onChange={set('amount')} />
          </label>
          <label className="field">
            Category
            <select
              required
              value={form.categoryId}
              onChange={(e) =>
                e.target.value === '__new__' ? void addCategory() : set('categoryId')(e)
              }
            >
              <option value="" disabled>
                Select…
              </option>
              {kindCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value="__new__">+ New category…</option>
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
            Tags (comma separated)
            <input value={form.tags} onChange={set('tags')} placeholder="office, reimbursable" />
          </label>
          <label className="field">
            Note
            <input value={form.note} onChange={set('note')} placeholder="optional" />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="primary" disabled={busy} type="submit">
              {editing ? 'Save changes' : 'Add entry'}
            </button>
            {editing && (
              <button type="button" className="ghost" style={{ color: 'var(--text-secondary)' }} onClick={cancelEdit}>
                Cancel
              </button>
            )}
          </div>
        </form>
        {notice && <p className="muted" style={{ color: 'var(--good)' }}>{notice}</p>}
        {error && <p className="error">{error}</p>}
      </div>

      <SubscriptionsCard categories={categories} onChanged={() => void loadEntries()} />

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'end', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ marginRight: 'auto' }}>Entries</h2>
          <label className="field">
            Sync from (leave blank for full history)
            <input type="date" value={syncFrom} onChange={(e) => setSyncFrom(e.target.value)} />
          </label>
          <button className="primary" disabled={busy} onClick={() => void syncAuto()}>
            ⟳ Sync EMIs &amp; subscriptions
          </button>
        </div>
        <p className="muted">
          Sync adds one expense per loan EMI and per subscription charge for each billing period,
          but only from the date above onward — periods before it are left exactly as they are,
          including ones you deleted. Edited entries are never overwritten.
        </p>
        {emiDue && emiDue.pendingCount > 0 && (
          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: 12,
              marginBottom: 12,
            }}
          >
            <strong>EMIs due this month — {emiDue.pendingCount} pending</strong>
            <p className="muted" style={{ marginTop: 4 }}>
              Paid one early? Log it here (not the form above) so the sync links it to the loan and
              never adds a duplicate.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {emiDue.pending.map((p) => (
                <div key={p.loanId} style={{ display: 'flex', alignItems: 'end', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ minWidth: 160 }}>
                    {p.name} · <span className="muted">due {p.dueDate}</span>
                  </span>
                  <span className="num" style={{ minWidth: 90 }}>
                    {fmtMoney(p.emi)}
                  </span>
                  <label className="field" style={{ marginBottom: 0 }}>
                    Paid on
                    <input
                      type="date"
                      value={payDates[p.loanId] ?? today()}
                      onChange={(e) => setPayDates((d) => ({ ...d, [p.loanId]: e.target.value }))}
                    />
                  </label>
                  <button className="primary" disabled={busy} onClick={() => void payEmi(p.loanId, p.name)}>
                    Log payment
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="grid" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <label className="field">
            From
            <input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
          </label>
          <label className="field">
            To
            <input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
          </label>
          <label className="field">
            Type
            <select value={filters.kind} onChange={(e) => setFilters((f) => ({ ...f, kind: e.target.value as '' | EntryKind }))}>
              <option value="">All</option>
              <option value="INCOME">Income</option>
              <option value="EXPENSE">Expense</option>
            </select>
          </label>
        </div>
        {entries.length === 0 ? (
          <p className="muted">No entries in this range. Log one above or sync EMIs from your loans.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Category</th>
                  <th className="num">Amount</th>
                  <th>Method</th>
                  <th>Tags</th>
                  <th>Note</th>
                  <th>Files</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td>{e.date}</td>
                    <td>
                      {e.categoryName}
                      {e.source !== 'MANUAL' && (
                        <span className="badge keep" style={{ marginLeft: 6 }}>
                          auto
                        </span>
                      )}
                    </td>
                    <td className="num" style={{ color: e.kind === 'INCOME' ? 'var(--good)' : undefined }}>
                      {e.kind === 'INCOME' ? '+' : '−'}
                      {fmtMoney(e.amount)}
                    </td>
                    <td>{e.method.replace('_', ' ').toLowerCase()}</td>
                    <td>{e.tags.join(', ')}</td>
                    <td className="muted">{e.note}</td>
                    <td>
                      {e.attachments.map((a) => (
                        <span key={a.id} style={{ whiteSpace: 'nowrap' }}>
                          <a className="download" href={api.attachmentUrl(a.id)}>
                            📎 {a.filename}
                          </a>{' '}
                          <button className="ghost" style={{ padding: '0 6px' }} onClick={() => removeAttachment(a.id)}>
                            ×
                          </button>{' '}
                        </span>
                      ))}
                      <label className="muted" style={{ cursor: 'pointer' }}>
                        + attach
                        <input
                          type="file"
                          style={{ display: 'none' }}
                          onChange={(ev) => void attach(e.id, ev.target.files?.[0])}
                        />
                      </label>
                    </td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>
                      <button className="ghost" style={{ color: 'var(--accent)' }} onClick={() => startEdit(e)}>
                        Edit
                      </button>{' '}
                      <button className="ghost" onClick={() => remove(e.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
