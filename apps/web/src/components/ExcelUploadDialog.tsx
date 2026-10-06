import { useState, useRef, useMemo } from 'react';
import { api, fmtMoney } from '../api';
import type { Category, EntryKind } from '../types';

interface ParsedRowState {
  id: string; // unique key for React
  srNo: number;
  date: string;
  kind: EntryKind;
  amount: number;
  description: string;
  debit: number | null;
  credit: number | null;
  balance: number | null;
  categoryId: string;
  selected: boolean;
  isDuplicate: boolean;
}

interface Props {
  categories: Category[];
  onSuccess?: () => void;
}

export function ExcelUploadDialog({ categories, onSuccess }: Props) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedRowState[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'EXPENSE' | 'INCOME'>('ALL');
  const [dupeFilter, setDupeFilter] = useState<'ALL' | 'NEW_ONLY' | 'DUPE_ONLY'>('ALL');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const expenseCategories = useMemo(() => categories.filter((c) => c.kind === 'EXPENSE'), [categories]);
  const incomeCategories = useMemo(() => categories.filter((c) => c.kind === 'INCOME'), [categories]);

  const defaultExpenseCatId = expenseCategories[0]?.id ?? '';
  const defaultIncomeCatId = incomeCategories[0]?.id ?? '';

  const handleOpen = () => {
    setOpen(true);
    setFile(null);
    setRows([]);
    setError(null);
    setSuccessMsg(null);
    setSearchQuery('');
    setTypeFilter('ALL');
    setDupeFilter('ALL');
  };

  const handleClose = () => {
    setOpen(false);
    setError(null);
    setSuccessMsg(null);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setFile(e.target.files[0]);
      setError(null);
    }
  };

  const handleParse = async () => {
    if (!file) return;
    setParsing(true);
    setError(null);

    try {
      const res = await api.parseBatchExcel(file);
      if (!res.rows || res.rows.length === 0) {
        throw new Error('No transaction rows could be found in this spreadsheet.');
      }

      // Map rows with intelligent category assignment and duplicate status
      const stateRows: ParsedRowState[] = res.rows.map((r, idx) => {
        let assignedCatId = '';
        if (r.kind === 'INCOME') {
          const match = incomeCategories.find(
            (c) => c.name.toLowerCase() === (r.suggestedCategory || '').toLowerCase(),
          );
          assignedCatId = match?.id ?? defaultIncomeCatId;
        } else {
          const match = expenseCategories.find(
            (c) => c.name.toLowerCase() === (r.suggestedCategory || '').toLowerCase(),
          );
          assignedCatId = match?.id ?? defaultExpenseCatId;
        }

        const isDup = Boolean(r.isDuplicate);

        return {
          id: `row-${idx}-${r.srNo}`,
          srNo: r.srNo,
          date: r.date,
          kind: r.kind,
          amount: r.amount,
          description: r.description,
          debit: r.debit,
          credit: r.credit,
          balance: r.balance,
          categoryId: assignedCatId,
          selected: !isDup, // New entries selected by default, duplicate entries deselected!
          isDuplicate: isDup,
        };
      });

      setRows(stateRows);
    } catch (err: any) {
      setError(err.message || 'Failed to parse Excel file.');
    } finally {
      setParsing(false);
    }
  };

  const handleImport = async () => {
    const selectedRows = rows.filter((r) => r.selected && !r.isDuplicate);
    if (selectedRows.length === 0) {
      setError('No new entries selected for import.');
      return;
    }

    setImporting(true);
    setError(null);

    try {
      const payload = selectedRows.map((r) => ({
        date: r.date,
        kind: r.kind,
        amount: r.amount,
        categoryId: r.categoryId,
        description: r.description,
        note: r.description,
        method: 'BANK',
        debit: r.debit,
        credit: r.credit,
        balance: r.balance,
      }));

      const res = await api.importBatchEntries(payload);
      setSuccessMsg(res.message || `Successfully imported ${res.imported} entries.`);
      setRows([]);
      setFile(null);
      if (onSuccess) {
        onSuccess();
      }
      setTimeout(() => {
        handleClose();
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Failed to import entries into ledger.');
    } finally {
      setImporting(false);
    }
  };

  const setCategoryForAll = (kind: EntryKind, catId: string) => {
    setRows((prev) =>
      prev.map((r) => (r.kind === kind ? { ...r, categoryId: catId } : r)),
    );
  };

  const toggleSelectAll = (checked: boolean) => {
    // Only toggle rows that are not duplicates
    setRows((prev) =>
      prev.map((r) => (r.isDuplicate ? r : { ...r, selected: checked })),
    );
  };

  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  const duplicateCount = useMemo(() => rows.filter((r) => r.isDuplicate).length, [rows]);
  const newCount = useMemo(() => rows.filter((r) => !r.isDuplicate).length, [rows]);
  const selectedCount = useMemo(() => rows.filter((r) => r.selected && !r.isDuplicate).length, [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (dupeFilter === 'NEW_ONLY' && r.isDuplicate) return false;
      if (dupeFilter === 'DUPE_ONLY' && !r.isDuplicate) return false;
      if (typeFilter !== 'ALL' && r.kind !== typeFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          r.description.toLowerCase().includes(q) ||
          r.date.includes(q) ||
          String(r.amount).includes(q)
        );
      }
      return true;
    });
  }, [rows, dupeFilter, typeFilter, searchQuery]);

  const totalDebits = useMemo(
    () => rows.filter((r) => r.kind === 'EXPENSE').reduce((s, r) => s + r.amount, 0),
    [rows],
  );
  const totalCredits = useMemo(
    () => rows.filter((r) => r.kind === 'INCOME').reduce((s, r) => s + r.amount, 0),
    [rows],
  );

  const allNewSelected = useMemo(
    () => newCount > 0 && rows.filter((r) => !r.isDuplicate).every((r) => r.selected),
    [rows, newCount],
  );

  if (!open) {
    return (
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <button
          type="button"
          className="secondary"
          onClick={handleOpen}
          style={{ marginLeft: 12 }}
        >
          📊 Upload from Excel
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.85)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        style={{
          background: 'var(--bg, #1a1e24)',
          borderRadius: 12,
          padding: 24,
          maxWidth: 1050,
          width: '95%',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
          border: '1px solid var(--border, #30363d)',
          color: 'var(--text, #c9d1d9)',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
            borderBottom: '1px solid var(--border, #30363d)',
            paddingBottom: 12,
          }}
        >
          <div>
            <h3 style={{ margin: 0, color: 'var(--accent, #58a6ff)' }}>
              Bank Statement Excel Batch Importer
            </h3>
            <span style={{ fontSize: 13, color: 'var(--muted, #8b949e)' }}>
              Upload and review bank transactions. Duplicate entries already in your ledger are automatically detected and protected.
            </span>
          </div>
          <button
            type="button"
            className="ghost"
            onClick={handleClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 24,
              cursor: 'pointer',
              color: 'var(--muted, #8b949e)',
            }}
          >
            ×
          </button>
        </div>

        {/* Success Alert */}
        {successMsg && (
          <div
            style={{
              padding: 12,
              marginBottom: 16,
              background: 'rgba(46, 160, 67, 0.2)',
              border: '1px solid var(--good, #3fb950)',
              borderRadius: 6,
              color: 'var(--good, #3fb950)',
              fontWeight: 500,
            }}
          >
            ✓ {successMsg}
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div
            style={{
              padding: 14,
              marginBottom: 16,
              background: 'rgba(248, 81, 73, 0.15)',
              border: '1px solid var(--critical, #f85149)',
              borderRadius: 8,
              color: 'var(--critical, #f85149)',
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>⚠️ Unable to parse or import spreadsheet</div>
            <div>{error}</div>
            {(error.toLowerCase().includes('password') || error.toLowerCase().includes('zip') || error.toLowerCase().includes('encrypted')) && (
              <div
                style={{
                  marginTop: 8,
                  padding: '8px 12px',
                  background: 'rgba(0,0,0,0.3)',
                  borderRadius: 6,
                  color: 'var(--text, #c9d1d9)',
                  fontSize: 12,
                }}
              >
                <strong>💡 How to fix:</strong>
                <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                  <li>If your bank statement is password-protected, open it in Microsoft Excel, enter the password, and click <em>File → Save As</em> as an unprotected <strong>.xlsx</strong> workbook.</li>
                  <li>If you already have an unlocked copy (such as <strong>Statements2.xlsx</strong>), select that file instead.</li>
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Step 1: File Upload */}
        {rows.length === 0 && !successMsg && (
          <div style={{ padding: '20px 0' }}>
            <div
              style={{
                border: '2px dashed var(--border, #30363d)',
                borderRadius: 8,
                padding: '40px 20px',
                textAlign: 'center',
                background: 'var(--card, #21262d)',
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />

              {!file ? (
                <>
                  <p style={{ fontSize: 16, margin: '0 0 12px 0' }}>
                    Select your bank statement spreadsheet (.xlsx or .xls)
                  </p>
                  <p
                    style={{
                      fontSize: 13,
                      color: 'var(--muted, #8b949e)',
                      margin: '0 0 16px 0',
                    }}
                  >
                    Works with bank statements (e.g. Statements2.xlsx), credit card statements, or custom tables.
                  </p>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    📁 Browse Excel File
                  </button>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 16, marginBottom: 8 }}>
                    Selected: <strong>{file.name}</strong> ({(file.size / 1024).toFixed(1)} KB)
                  </div>
                  <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                    <button
                      type="button"
                      className="primary"
                      onClick={handleParse}
                      disabled={parsing}
                    >
                      {parsing ? 'Parsing Statement…' : '⚡ Parse Transactions'}
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => setFile(null)}
                      disabled={parsing}
                    >
                      Choose Different File
                    </button>
                  </div>
                </>
              )}
            </div>

            <div
              style={{
                marginTop: 20,
                fontSize: 12,
                color: 'var(--muted, #8b949e)',
                lineHeight: 1.6,
              }}
            >
              <strong>Automatic statement detection & safety:</strong>
              <br />
              • Automatically detects table headers (Date, Description, Debit, Credit, Balance) even if preceded by account info.
              <br />
              • <strong>Duplicate Prevention:</strong> Scans existing ledger records to prevent re-importing the same statement or transactions twice.
              <br />
              • Suggests categories automatically based on transaction narrations (Swiggy, UPI, Salary, etc.).
            </div>
          </div>
        )}

        {/* Step 2: Review and Category Mapping */}
        {rows.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            {/* Duplicate Notice Banner */}
            {newCount === 0 ? (
              <div
                style={{
                  padding: '12px 16px',
                  marginBottom: 16,
                  background: 'rgba(210, 153, 34, 0.15)',
                  border: '1px solid #d29922',
                  borderRadius: 8,
                  color: '#e3b341',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                }}
              >
                <span style={{ fontSize: 22, lineHeight: 1 }}>⚠️</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>All Transactions Already Uploaded</div>
                  <div style={{ fontSize: 13, marginTop: 3, color: 'var(--text, #c9d1d9)', lineHeight: 1.4 }}>
                    All <strong>{rows.length} transactions</strong> in this statement already exist in your ledger. Re-importing is blocked to prevent creating duplicate records.
                  </div>
                </div>
              </div>
            ) : duplicateCount > 0 ? (
              <div
                style={{
                  padding: '10px 14px',
                  marginBottom: 14,
                  background: 'rgba(56, 139, 253, 0.12)',
                  border: '1px solid rgba(56, 139, 253, 0.4)',
                  borderRadius: 8,
                  color: '#79c0ff',
                  fontSize: 13,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <span style={{ fontSize: 18 }}>ℹ️</span>
                <div>
                  Found <strong>{newCount} new transaction(s)</strong> ready for import. <strong>{duplicateCount} duplicate transaction(s)</strong> already in your ledger were automatically deselected and will be skipped.
                </div>
              </div>
            ) : null}

            {/* KPI Summary Tiles */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: 10,
                marginBottom: 14,
              }}
            >
              <div
                style={{
                  padding: 10,
                  background: 'var(--card, #21262d)',
                  borderRadius: 6,
                  border: '1px solid var(--border, #30363d)',
                }}
              >
                <div style={{ fontSize: 11, color: 'var(--muted, #8b949e)' }}>TOTAL IN FILE</div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>{rows.length} rows</div>
                <div style={{ fontSize: 11, color: 'var(--muted, #8b949e)' }}>Parsed statement</div>
              </div>

              <div
                style={{
                  padding: 10,
                  background: 'var(--card, #21262d)',
                  borderRadius: 6,
                  border: newCount > 0 ? '1px solid rgba(56, 139, 253, 0.5)' : '1px solid var(--border, #30363d)',
                }}
              >
                <div style={{ fontSize: 11, color: newCount > 0 ? 'var(--accent, #58a6ff)' : 'var(--muted, #8b949e)' }}>
                  NEW TO IMPORT
                </div>
                <div style={{ fontSize: 18, fontWeight: 600, color: newCount > 0 ? 'var(--accent, #58a6ff)' : 'inherit' }}>
                  {newCount} rows
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted, #8b949e)' }}>
                  {selectedCount} selected
                </div>
              </div>

              <div
                style={{
                  padding: 10,
                  background: 'var(--card, #21262d)',
                  borderRadius: 6,
                  border: duplicateCount > 0 ? '1px solid rgba(210, 153, 34, 0.4)' : '1px solid var(--border, #30363d)',
                }}
              >
                <div style={{ fontSize: 11, color: duplicateCount > 0 ? '#e3b341' : 'var(--muted, #8b949e)' }}>
                  ALREADY IN LEDGER
                </div>
                <div style={{ fontSize: 18, fontWeight: 600, color: duplicateCount > 0 ? '#e3b341' : 'inherit' }}>
                  {duplicateCount} skipped
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted, #8b949e)' }}>Duplicates protected</div>
              </div>

              <div
                style={{
                  padding: 10,
                  background: 'var(--card, #21262d)',
                  borderRadius: 6,
                  border: '1px solid var(--border, #30363d)',
                }}
              >
                <div style={{ fontSize: 11, color: 'var(--critical, #f85149)' }}>TOTAL EXPENSES</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--critical, #f85149)' }}>
                  {fmtMoney(totalDebits)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted, #8b949e)' }}>
                  {rows.filter((r) => r.kind === 'EXPENSE').length} debits
                </div>
              </div>

              <div
                style={{
                  padding: 10,
                  background: 'var(--card, #21262d)',
                  borderRadius: 6,
                  border: '1px solid var(--border, #30363d)',
                }}
              >
                <div style={{ fontSize: 11, color: 'var(--good, #3fb950)' }}>TOTAL INCOME</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--good, #3fb950)' }}>
                  {fmtMoney(totalCredits)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted, #8b949e)' }}>
                  {rows.filter((r) => r.kind === 'INCOME').length} credits
                </div>
              </div>
            </div>

            {/* Bulk Controls & Filters */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 10,
                alignItems: 'center',
                marginBottom: 12,
                padding: '8px 12px',
                background: 'var(--card, #21262d)',
                borderRadius: 6,
                fontSize: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: 'var(--muted, #8b949e)' }}>All Expenses:</span>
                <select
                  style={{ padding: '3px 8px', fontSize: 12 }}
                  onChange={(e) => setCategoryForAll('EXPENSE', e.target.value)}
                  defaultValue=""
                  disabled={newCount === 0}
                >
                  <option value="" disabled>
                    Set all expenses to…
                  </option>
                  {expenseCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: 'var(--muted, #8b949e)' }}>All Income:</span>
                <select
                  style={{ padding: '3px 8px', fontSize: 12 }}
                  onChange={(e) => setCategoryForAll('INCOME', e.target.value)}
                  defaultValue=""
                  disabled={newCount === 0}
                >
                  <option value="" disabled>
                    Set all income to…
                  </option>
                  {incomeCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                {/* Duplicate / New filter */}
                <select
                  value={dupeFilter}
                  onChange={(e) => setDupeFilter(e.target.value as any)}
                  style={{ padding: '3px 8px', fontSize: 12 }}
                >
                  <option value="ALL">Show all ({rows.length})</option>
                  <option value="NEW_ONLY">New only ({newCount})</option>
                  <option value="DUPE_ONLY">Already in ledger ({duplicateCount})</option>
                </select>

                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value as any)}
                  style={{ padding: '3px 8px', fontSize: 12 }}
                >
                  <option value="ALL">All types</option>
                  <option value="EXPENSE">Expenses only</option>
                  <option value="INCOME">Income only</option>
                </select>

                <input
                  type="text"
                  placeholder="Filter description…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ padding: '3px 8px', fontSize: 12, width: 140 }}
                />
              </div>
            </div>

            {/* Table */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                border: '1px solid var(--border, #30363d)',
                borderRadius: 6,
                marginBottom: 16,
              }}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--card, #21262d)', zIndex: 1 }}>
                  <tr style={{ borderBottom: '2px solid var(--border, #30363d)' }}>
                    <th style={{ padding: '8px 10px', textAlign: 'center', width: 36 }}>
                      <input
                        type="checkbox"
                        checked={allNewSelected}
                        disabled={newCount === 0}
                        onChange={(e) => toggleSelectAll(e.target.checked)}
                        title={newCount === 0 ? 'No new rows to select' : 'Select all new rows'}
                      />
                    </th>
                    <th style={{ padding: '8px 6px', textAlign: 'left', width: 40 }}>#</th>
                    <th style={{ padding: '8px 8px', textAlign: 'left', width: 85 }}>Date</th>
                    <th style={{ padding: '8px 8px', textAlign: 'left', width: 155 }}>Type & Status</th>
                    <th style={{ padding: '8px 8px', textAlign: 'left' }}>Description</th>
                    <th style={{ padding: '8px 8px', textAlign: 'right', width: 95 }}>Amount</th>
                    <th style={{ padding: '8px 8px', textAlign: 'left', width: 170 }}>Category</th>
                    <th style={{ padding: '8px 6px', textAlign: 'center', width: 36 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr
                      key={row.id}
                      style={{
                        borderBottom: '1px solid var(--border, #30363d)',
                        background: row.isDuplicate
                          ? 'rgba(0,0,0,0.35)'
                          : row.selected
                            ? 'transparent'
                            : 'rgba(0,0,0,0.15)',
                        opacity: row.isDuplicate ? 0.65 : row.selected ? 1 : 0.6,
                      }}
                    >
                      <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={row.selected && !row.isDuplicate}
                          disabled={row.isDuplicate}
                          title={row.isDuplicate ? 'Already imported in ledger' : 'Select for import'}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setRows((prev) =>
                              prev.map((r) => (r.id === row.id ? { ...r, selected: checked } : r)),
                            );
                          }}
                        />
                      </td>
                      <td style={{ padding: '6px 6px', color: 'var(--muted, #8b949e)' }}>
                        {row.srNo}
                      </td>
                      <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>
                        {row.date}
                      </td>
                      <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '1px 6px',
                            borderRadius: 4,
                            fontSize: 10,
                            fontWeight: 600,
                            background:
                              row.kind === 'INCOME'
                                ? 'rgba(46, 160, 67, 0.2)'
                                : 'rgba(248, 81, 73, 0.2)',
                            color:
                              row.kind === 'INCOME'
                                ? 'var(--good, #3fb950)'
                                : 'var(--critical, #f85149)',
                          }}
                        >
                          {row.kind}
                        </span>

                        {row.isDuplicate ? (
                          <span
                            style={{
                              display: 'inline-block',
                              marginLeft: 6,
                              padding: '1px 6px',
                              borderRadius: 4,
                              fontSize: 10,
                              fontWeight: 600,
                              background: 'rgba(110, 118, 129, 0.2)',
                              color: '#8b949e',
                              border: '1px solid rgba(110, 118, 129, 0.4)',
                            }}
                            title="This transaction already exists in your ledger."
                          >
                            Already in Ledger
                          </span>
                        ) : (
                          <span
                            style={{
                              display: 'inline-block',
                              marginLeft: 6,
                              padding: '1px 6px',
                              borderRadius: 4,
                              fontSize: 10,
                              fontWeight: 600,
                              background: 'rgba(56, 139, 253, 0.2)',
                              color: '#58a6ff',
                              border: '1px solid rgba(56, 139, 253, 0.4)',
                            }}
                          >
                            New
                          </span>
                        )}
                      </td>
                      <td
                        style={{
                          padding: '6px 8px',
                          maxWidth: 300,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={row.description}
                      >
                        {row.description}
                      </td>
                      <td
                        style={{
                          padding: '6px 8px',
                          textAlign: 'right',
                          fontFamily: 'monospace',
                          fontWeight: 600,
                        }}
                      >
                        {fmtMoney(row.amount)}
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        <select
                          value={row.categoryId}
                          disabled={row.isDuplicate}
                          onChange={(e) => {
                            const newId = e.target.value;
                            setRows((prev) =>
                              prev.map((r) => (r.id === row.id ? { ...r, categoryId: newId } : r)),
                            );
                          }}
                          style={{ width: '100%', padding: '2px 4px', fontSize: 11 }}
                        >
                          {(row.kind === 'INCOME' ? incomeCategories : expenseCategories).map(
                            (c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ),
                          )}
                        </select>
                      </td>
                      <td style={{ padding: '6px 6px', textAlign: 'center' }}>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => removeRow(row.id)}
                          style={{
                            padding: '1px 5px',
                            fontSize: 14,
                            lineHeight: 1,
                            color: 'var(--muted, #8b949e)',
                          }}
                          title="Exclude row"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredRows.length === 0 && (
                    <tr>
                      <td colSpan={8} style={{ padding: 24, textAlign: 'center', color: 'var(--muted, #8b949e)' }}>
                        No rows match your filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Bottom Actions */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingTop: 8,
                borderTop: '1px solid var(--border, #30363d)',
              }}
            >
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setRows([]);
                  setFile(null);
                  setError(null);
                }}
                disabled={importing}
              >
                ← Upload Different File
              </button>

              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                {newCount === 0 ? (
                  <button
                    type="button"
                    className="primary"
                    disabled={true}
                    style={{ minWidth: 230, opacity: 0.55, cursor: 'not-allowed' }}
                    title="All transactions in this file are already in your ledger."
                  >
                    ⛔ No New Entries to Import
                  </button>
                ) : (
                  <>
                    <span style={{ fontSize: 13, color: 'var(--muted, #8b949e)' }}>
                      Ready to import <strong>{selectedCount}</strong> new entries
                      {duplicateCount > 0 ? ` (${duplicateCount} duplicates skipped)` : ''}
                    </span>
                    <button
                      type="button"
                      className="primary"
                      onClick={handleImport}
                      disabled={selectedCount === 0 || importing}
                      style={{ minWidth: 230 }}
                    >
                      {importing
                        ? 'Importing…'
                        : duplicateCount > 0
                          ? `✓ Import ${selectedCount} New Entries`
                          : `✓ Import ${selectedCount} Entries`}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
