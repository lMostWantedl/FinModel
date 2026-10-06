import type {
  AttachmentMeta,
  Category,
  Dashboard,
  EmiDue,
  EntryKind,
  Granularity,
  LedgerEntry,
  Loan,
  LoanDraft,
  PaymentMethod,
  SimulationPayload,
  StrategyName,
  Subscription,
  SubscriptionDraft,
  Summary,
} from './types';

export const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:3001';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message ?? `Request failed: ${res.status}`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  loans: () => request<Loan[]>('/loans'),
  createLoan: (loan: LoanDraft) =>
    request<Loan>('/loans', { method: 'POST', body: JSON.stringify(loan) }),
  updateLoan: (id: string, loan: LoanDraft) =>
    request<Loan>(`/loans/${id}`, { method: 'PUT', body: JSON.stringify(loan) }),
  importLoans: (json: unknown) =>
    request<{ imported: number; loans: Loan[] }>('/loans/import', {
      method: 'POST',
      body: JSON.stringify(json),
    }),
  deleteLoan: (id: string) => request<void>(`/loans/${id}`, { method: 'DELETE' }),
  dashboard: (extra?: number) =>
    request<Dashboard>(extra === undefined ? '/dashboard' : `/dashboard?extra=${extra}`),
  categories: () => request<Category[]>('/categories'),
  createCategory: (body: { name: string; kind: EntryKind; budgetMonthly?: number | null }) =>
    request<Category>('/categories', { method: 'POST', body: JSON.stringify(body) }),
  setBudget: (id: string, budgetMonthly: number | null) =>
    request<Category>(`/categories/${id}`, { method: 'PATCH', body: JSON.stringify({ budgetMonthly }) }),
  entries: (q: { from?: string; to?: string; kind?: EntryKind; categoryId?: string } = {}) => {
    const params = new URLSearchParams(
      Object.entries(q).filter(([, v]) => v !== undefined) as [string, string][],
    );
    const qs = params.toString();
    return request<LedgerEntry[]>(`/entries${qs ? `?${qs}` : ''}`);
  },
  createEntry: (body: {
    date: string;
    kind: EntryKind;
    amount: number;
    categoryId: string;
    method: PaymentMethod;
    note: string;
    tags: string[];
  }) => request<LedgerEntry>('/entries', { method: 'POST', body: JSON.stringify(body) }),
  updateEntry: (
    id: string,
    patch: Partial<{
      date: string;
      kind: EntryKind;
      amount: number;
      categoryId: string;
      method: PaymentMethod;
      note: string;
      tags: string[];
    }>,
  ) => request<LedgerEntry>(`/entries/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  emiDue: () => request<EmiDue>('/emi-due'),
  payEmi: (body: { loanId: string; date?: string; amount?: number; method?: PaymentMethod; note?: string }) =>
    request<LedgerEntry>('/entries/pay-emi', { method: 'POST', body: JSON.stringify(body) }),
  syncAuto: (from?: string) =>
    request<{ created: number; emis: number; subscriptions: number }>('/entries/sync-auto', {
      method: 'POST',
      body: JSON.stringify(from ? { from } : {}),
    }),
  subscriptions: () => request<Subscription[]>('/subscriptions'),
  createSubscription: (body: SubscriptionDraft) =>
    request<Subscription>('/subscriptions', { method: 'POST', body: JSON.stringify(body) }),
  updateSubscription: (id: string, body: SubscriptionDraft) =>
    request<Subscription>(`/subscriptions/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteSubscription: (id: string) => request<void>(`/subscriptions/${id}`, { method: 'DELETE' }),
  deleteEntry: (id: string) => request<void>(`/entries/${id}`, { method: 'DELETE' }),
  createEntries: async (entries: Array<Omit<LedgerEntry, 'id' | 'createdAt' | 'source'>>) => {
    const res = await fetch(`${API_BASE}/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entries),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.message ?? `Failed to create entries: ${res.status}`);
    }
  },
  uploadAttachment: async (entryId: string, file: File): Promise<AttachmentMeta> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API_BASE}/entries/${entryId}/attachments`, { method: 'POST', body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.message ?? `Upload failed: ${res.status}`);
    }
    return res.json();
  },
  deleteAttachment: (id: string) => request<void>(`/attachments/${id}`, { method: 'DELETE' }),
  attachmentUrl: (id: string) => `${API_BASE}/attachments/${id}`,
  summary: (granularity: Granularity, q: { from?: string; to?: string } = {}) => {
    const params = new URLSearchParams({ granularity, ...q });
    return request<Summary>(`/summary?${params.toString()}`);
  },
  simulate: (body: {
    strategy: StrategyName;
    extraMonthlyPayment: number;
    bonuses: { month: number; amount: number }[];
    opportunityRatePct: number;
  }) => request<SimulationPayload>('/simulate', { method: 'POST', body: JSON.stringify(body) }),
  excelUrl: `${API_BASE}/export/excel`,
  parseBatchExcel: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE}/entries/batch/parse`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.message ?? `Upload failed with status ${res.status}`);
    }
    return res.json() as Promise<{
      success: boolean;
      filename: string;
      count: number;
      totalDebits: number;
      totalCredits: number;
      duplicateCount: number;
      newCount: number;
      rows: Array<{
        srNo: number;
        date: string;
        kind: 'INCOME' | 'EXPENSE';
        amount: number;
        description: string;
        debit: number | null;
        credit: number | null;
        balance: number | null;
        suggestedCategory?: string;
        isDuplicate?: boolean;
      }>;
      message: string;
    }>;
  },
  importBatchEntries: (entries: Array<{
    date: string;
    kind: 'INCOME' | 'EXPENSE';
    amount: number;
    categoryId: string;
    method?: string;
    note?: string;
    description?: string;
    debit?: number | null;
    credit?: number | null;
    balance?: number | null;
    tags?: string[];
  }>) => request<{ success: boolean; imported: number; skippedDuplicates?: number; message: string }>('/entries/batch/import', {
    method: 'POST',
    body: JSON.stringify({ entries }),
  }),
  batchCategories: () => request<{ id: string; name: string; kind: 'INCOME' | 'EXPENSE' }[]>('/entries/batch/categories'),
  uploadBatchPreview: (file: File, categoryId: string) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('categoryId', categoryId);
    return request<{
      success: number;
      entries?: Array<{
        id: string;
        srNo: number;
        date: string | null;
        kind: 'INCOME' | 'EXPENSE';
        categoryId: string;
        description: string | null;
        debit: number | null;
        credit: number | null;
        method: string;
        note: string;
        status: 'PENDING' | 'APPROVED'
      }>;
      message?: string;
    }>('/entries/batch/upload', { method: 'POST', body: formData });
  },
  approvePendingEntries: (entryIds: string[]) =>
    request<{ status: 'success'; approved: number; failed: number; errors?: string[]; message?: string }>(`/entries/batch/approve?entryIds=${entryIds.join(',')}`),
  getPendingEntries: () => request<LedgerEntry[]>('/entries/batch/list'),
  deletePendingEntry: (id: string) => request<void>(`/entries/batch/${id}`, { method: 'DELETE' }),
};

export const fmt = new Intl.NumberFormat('en-SG', { maximumFractionDigits: 0 });
export const fmtMoney = (v: number): string => fmt.format(Math.round(v));
