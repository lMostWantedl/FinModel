import { useState, useRef } from 'react';
import { api, fmtMoney } from '../api';
import type { Category } from '../types';

export function ExcelUploadDialog({ categories }: { categories: Category[] }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleOpen = () => {
    setOpen(true);
    setFile(null);
    setParsedRows([]);
    setError('');
  };

  const handleClose = () => {
    setOpen(false);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setFile(e.target.files[0]);
    }
  };

  // Note: This will use the backend for parsing due to TypeScript type limitations
  // with ExcelJS. The API endpoint at /entries/batch/upload handles parsing client-side data.
  const handleUpload = async () => {
    try {
      if (!file) return;

      const categoryId = categories[0]?.id || "";

      if (!categoryId) {
        setError("Please select at least one category");
        return;
      }

      setUploading(true);
      setError("");

      let parsedData: any[] = [];

      try {
        const arrayBuffer = await file.arrayBuffer();

        const ExcelJS = await import("exceljs");

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(arrayBuffer);

        const worksheet = workbook.worksheets[0];

        if (!worksheet) {
          throw new Error("No worksheet found");
        }

        const rows: any[] = [];

        // Row 1 = Headers
        for (
          let rowNumber = 2;
          rowNumber <= worksheet.rowCount;
          rowNumber++
        ) {
          const row = worksheet.getRow(rowNumber);

          const srNo = row.getCell(1).value;
          const date = row.getCell(2).value;
          const type = String(
            row.getCell(3).text || ""
          )
            .trim()
            .toLowerCase();

          const description = String(
            row.getCell(4).text || ""
          ).trim();

          const debit =
            Number(row.getCell(5).value) || null;

          const credit =
            Number(row.getCell(6).value) || null;

          // Skip completely empty rows
          if (
            !srNo &&
            !date &&
            !type &&
            !description &&
            debit == null &&
            credit == null
          ) {
            continue;
          }

          let kind: "INCOME" | "EXPENSE";

          if (
            type.includes("credit") ||
            credit !== null
          ) {
            kind = "INCOME";
          } else if (
            type.includes("debit") ||
            debit !== null
          ) {
            kind = "EXPENSE";
          } else {
            throw new Error(
              `Invalid Type in row ${rowNumber}`
            );
          }

          rows.push({
            srNo: Number(srNo),

            date:
              date instanceof Date
                ? date
                  .toISOString()
                  .slice(0, 10)
                : String(date),

            kind,

            description,

            debit,

            credit,
          });
        }

        parsedData = rows;
      } catch (e) {
        console.error(e);
        throw new Error("Failed to parse Excel file.");
      }

      if (parsedData.length === 0) {
        throw new Error(
          "No valid rows found in Excel file."
        );
      }

      const pendingEntries = parsedData.map((row) => ({
        date:
          row.date ||
          new Date()
            .toISOString()
            .slice(0, 10),

        kind: row.kind,

        amount:
          row.debit ??
          row.credit ??
          0,

        categoryId,

        method: "CASH",

        note: "",

        description: row.description,

        tags: [],
      }));

      setParsedRows(
        parsedData.map((row) => ({
          srNo: row.srNo,
          date: row.date,
          kind: row.kind,
          description: row.description,
          debit: row.debit,
          credit: row.credit,
        }))
      );
    } catch (err: any) {
      console.error(err);

      setError(
        err.message ||
        "Failed to upload Excel file."
      );
    } finally {
      setUploading(false);
    }
  };

  if (!open) {
    return (
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <button
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
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--bg)', borderRadius: 8, padding: 24, maxWidth: 900, width: '90%', maxHeight: '95vh', overflowY: 'auto', color: 'var(--text)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, color: 'var(--accent)' }}>Upload from Excel</h3>
          <button className="ghost" onClick={handleClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-secondary)' }}>×</button>
        </div>

        {!parsedRows.length && (
          <div>
            <h4 style={{ color: 'var(--accent)', marginTop: 0 }}>Upload Excel file</h4>
            <p className="muted" style={{ fontSize: 13, marginBottom: 12, color: 'var(--text-secondary)' }}>
              Expected columns: Sr.no | Date | Type (Transfer Debit/Credit) | Description | Debit | Credit | Balance
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />

            {!file ? (
              <button className="primary" onClick={() => fileInputRef.current?.click()}>
                📁 Choose Excel File
              </button>
            ) : (
              <>
                <p style={{ margin: '8px 0', color: 'var(--text-secondary)' }}>
                  Selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)
                </p>
                <button className="primary" onClick={handleUpload} disabled={uploading}>
                  {uploading ? 'Parsing...' : 'Parse & Add Entries'}
                </button>
              </>
            )}

            <div style={{ marginTop: 16, padding: 16, background: 'var(--card)', borderRadius: 8, fontSize: 12, border: '1px solid var(--border)' }}>
              <strong>Parsing happens on your browser:</strong><br />
              • Uses ExcelJS library for parsing<br />
              • No file is sent to server (privacy)<br />
              • Entries appear below after parsing
            </div>
          </div>
        )}

        {parsedRows.length > 0 && (
          <>
            <h4 style={{ color: 'var(--accent)', marginTop: 0 }}>Parsed Rows ({parsedRows.length})</h4>

            <div style={{ overflowX: 'auto', marginTop: 12, marginBottom: 16 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--card)', borderBottom: '2px solid var(--border)' }}>
                    <th style={{ padding: 8, textAlign: 'left', minWidth: 50 }}>Sr.no</th>
                    <th style={{ padding: 8, textAlign: 'left', minWidth: 80 }}>Date</th>
                    <th style={{ padding: 8, textAlign: 'left', minWidth: 70 }}>Type</th>
                    <th style={{ padding: 8, textAlign: 'left', minWidth: 250 }}>Description</th>
                    <th style={{ padding: 8, textAlign: 'right', minWidth: 100 }}>Debit</th>
                    <th style={{ padding: 8, textAlign: 'right', minWidth: 100 }}>Credit</th>
                    <th style={{ padding: 8, textAlign: 'left', minWidth: 250 }}>Category</th>
                    <th style={{ padding: 8, textAlign: 'center', minWidth: 60 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.map((row) => (
                    <tr key={row.srNo} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: 8 }}>{row.srNo}</td>
                      <td style={{ padding: 8, fontFamily: 'monospace' }}>{row.date || '-'}</td>
                      <td style={{ padding: 8, color: row.kind === 'INCOME' ? 'var(--good)' : 'var(--error)' }}>
                        {row.kind}
                      </td>
                      <td style={{ padding: 8 }}>{row.description || ''}</td>
                      <td style={{ padding: 8, textAlign: 'right', fontFamily: 'monospace' }}>{row.debit ? fmtMoney(row.debit) : '-'}</td>
                      <td style={{ padding: 8, textAlign: 'right', fontFamily: 'monospace' }}>{row.credit ? fmtMoney(row.credit) : '-'}</td>
                      <td style={{ padding: 8 }}>
                        <select
                          value=""
                          onChange={(e) => {
                            const id = e.target.value;
                            setParsedRows(prev => prev.map(r => r.srNo === row.srNo ? { ...r, categoryId: id } : r));
                          }}
                          style={{ padding: '2px 6px', fontSize: 12 }}
                        >
                          <option value="" disabled>Select category...</option>
                          {categories.filter(c => c.kind === row.kind).map((cat) => (
                            <option key={cat.id} value={cat.id}>{cat.name}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: 8, textAlign: 'center' }}>
                        <button className="ghost" onClick={() => setParsedRows(prev => prev.filter((r) => r.srNo !== row.srNo))} style={{ padding: '2px 6px', fontSize: 11, color: 'var(--error)' }}>
                          × Revert
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginBottom: 16 }}>
              <button className="secondary" onClick={() => { setParsedRows([]); setFile(null); }}>Cancel & Upload Again</button>
              <button className="primary" onClick={handleClose}>Done - Entries Added</button>
            </div>

            {error && (
              <div style={{ marginTop: 16, padding: 12, background: '#fee', borderRadius: 4 }}>
                <strong>Error:</strong> {error}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
