import { useState, useRef } from 'react';
import { Upload, Download, CheckCircle, XCircle, AlertTriangle, File } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { toast } from '../components/UI';
import { EXPENSE_CATEGORIES, VEHICLES } from '../data/sampleData';

const TEMPLATE_COLS = ['Vehicle Number', 'Plant Code', 'Date (YYYY-MM-DD)', 'Category', 'Vendor', 'Invoice No', 'Amount', 'GST%', 'Payment Method', 'Odometer', 'Fuel Qty (if fuel)', 'Rate per Litre', 'Description'];

const SAMPLE_DATA = [
  ['HR26-BX-1234', 'MNS', '2026-08-20', 'Fuel', 'HP Petroleum', 'INV-F-9001', '4500', '0', 'Cash', '85200', '50', '90', 'Fuel fill-up'],
  ['MH12-AB-9876', 'PNE', '2026-08-18', 'Maintenance', 'Speed Motors', 'INV-M-8002', '8500', '18', 'NEFT', '54800', '', '', 'Periodic service'],
];

function downloadTemplate() {
  const rows = [TEMPLATE_COLS, ...SAMPLE_DATA];
  const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'vems_bulk_expense_template.csv';
  a.click();
}

function parseCSV(text) {
  const lines = text.trim().split('\n');
  const header = lines[0].split(',').map(c => c.replace(/"/g, '').trim());
  return lines.slice(1).map((line, i) => {
    const vals = line.split(',').map(c => c.replace(/"/g, '').trim());
    const obj = {};
    header.forEach((h, j) => obj[h] = vals[j] || '');
    return { _row: i + 2, ...obj };
  });
}

function validateRow(row, vehicles) {
  const errors = [];
  const veh = vehicles.find(v => v.regNo === row['Vehicle Number']);
  if (!veh) errors.push('Vehicle not found');
  if (!row['Date (YYYY-MM-DD)'] || !/^\d{4}-\d{2}-\d{2}$/.test(row['Date (YYYY-MM-DD)'])) errors.push('Invalid date');
  if (!EXPENSE_CATEGORIES.includes(row['Category'])) errors.push('Invalid category');
  if (!row['Vendor']) errors.push('Vendor required');
  if (!row['Invoice No']) errors.push('Invoice No required');
  if (!row['Amount'] || isNaN(parseFloat(row['Amount'])) || parseFloat(row['Amount']) <= 0) errors.push('Invalid amount');
  return errors;
}

export default function BulkUpload() {
  const { vehicles, addExpense, addAuditEntry } = useApp();
  const { user } = useAuth();
  const [drag, setDrag] = useState(false);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef();

  const handleFile = (f) => {
    if (!f) return;
    setFile(f);
    setResult(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const rows = parseCSV(e.target.result);
      const validated = rows.map(r => ({
        ...r,
        _errors: validateRow(r, vehicles),
        _valid: validateRow(r, vehicles).length === 0,
      }));
      setPreview(validated);
    };
    reader.readAsText(f);
  };

  const handleImport = async () => {
    if (!preview) return;
    setImporting(true);
    const valid = preview.filter(r => r._valid);
    const failed = preview.filter(r => !r._valid);

    // Check duplicates (same vehicle + invoice no)
    const invoicesSeen = new Set();
    const dupes = [];
    const toImport = valid.filter(r => {
      const key = `${r['Vehicle Number']}-${r['Invoice No']}`;
      if (invoicesSeen.has(key)) { dupes.push(r); return false; }
      invoicesSeen.add(key);
      return true;
    });

    await new Promise(r => setTimeout(r, 800)); // simulate processing

    toImport.forEach(r => {
      const veh = vehicles.find(v => v.regNo === r['Vehicle Number']);
      addExpense({
        vehicleId: veh?.id,
        plantId: veh?.plantId,
        date: r['Date (YYYY-MM-DD)'],
        category: r['Category'],
        vendor: r['Vendor'],
        invoiceNo: r['Invoice No'],
        amount: parseFloat(r['Amount']),
        gst: parseFloat(r['GST%'] || 0),
        paymentMethod: r['Payment Method'] || 'Cash',
        odometer: r['Odometer'] ? parseInt(r['Odometer']) : null,
        fuelQty: r['Fuel Qty (if fuel)'] ? parseFloat(r['Fuel Qty (if fuel)']) : null,
        ratePerLitre: r['Rate per Litre'] ? parseFloat(r['Rate per Litre']) : null,
        description: r['Description'],
        hasBill: false, // bulk — needs manual bill attachment
        createdBy: user?.name,
      });
    });

    addAuditEntry('BULK_UPLOAD', user?.name, `Bulk import: ${toImport.length} imported, ${failed.length} failed, ${dupes.length} duplicates`);
    setResult({ total: preview.length, valid: toImport.length, failed: failed.length, dupes: dupes.length, failedRows: failed });
    setImporting(false);
    toast.success(`${toImport.length} records imported successfully`);
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Bulk Expense Upload</h1>
          <p className="page-subtitle">Import expenses via CSV/Excel template</p>
        </div>
      </div>

      <div className="alert info mb-4">
        <AlertTriangle size={15} />
        <span>Note: Bulk-imported expenses require manual bill attachment after import. Records without bills should be updated with invoices before month-end.</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
        <div className="card">
          <div className="card-title">Step 1 — Download Template</div>
          <p style={{ fontSize: 13, color: 'var(--gray-600)', marginBottom: 16 }}>
            Download the CSV template with all required columns and fill your expense data. Refer to the sample rows included.
          </p>
          <p style={{ fontSize: 12, color: 'var(--gray-400)', marginBottom: 16 }}>
            <b>Required columns:</b> {TEMPLATE_COLS.slice(0, 7).join(', ')}, …
          </p>
          <button className="btn btn-secondary" onClick={downloadTemplate}>
            <Download size={15} /> Download Template (.csv)
          </button>
        </div>

        <div className="card">
          <div className="card-title">Step 2 — Upload Your File</div>
          <div
            className={`upload-zone ${drag ? 'drag-over' : ''}`}
            style={{ padding: 28 }}
            onDragOver={e => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]); }}
            onClick={() => fileRef.current?.click()}
          >
            <div className="icon"><Upload size={28} /></div>
            {file ? (
              <>
                <p style={{ color: 'var(--primary)', fontWeight: 600 }}>{file.name}</p>
                <span>{preview?.length} rows detected</span>
              </>
            ) : (
              <>
                <p>Drop CSV here or <b style={{ color: 'var(--primary)' }}>click to browse</b></p>
                <span>.csv or .xlsx files only</span>
              </>
            )}
          </div>
          <input ref={fileRef} type="file" accept=".csv,.xlsx" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
        </div>
      </div>

      {preview && !result && (
        <div className="card">
          <div className="card-title">
            Preview — {preview.length} rows
            <div style={{ display: 'flex', gap: 16, fontSize: 13, fontWeight: 400 }}>
              <span style={{ color: 'var(--success)' }}>✓ {preview.filter(r => r._valid).length} valid</span>
              <span style={{ color: 'var(--danger)' }}>✗ {preview.filter(r => !r._valid).length} invalid</span>
            </div>
          </div>
          <div className="table-wrap" style={{ marginBottom: 16 }}>
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Vehicle</th>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Vendor</th>
                  <th>Invoice</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 20).map(r => (
                  <tr key={r._row} style={{ background: r._valid ? '' : 'var(--danger-bg)' }}>
                    <td style={{ fontSize: 12, color: 'var(--gray-400)' }}>{r._row}</td>
                    <td style={{ fontSize: 12 }}>{r['Vehicle Number']}</td>
                    <td style={{ fontSize: 12 }}>{r['Date (YYYY-MM-DD)']}</td>
                    <td style={{ fontSize: 12 }}>{r['Category']}</td>
                    <td style={{ fontSize: 12 }}>{r['Vendor']}</td>
                    <td style={{ fontSize: 12, fontFamily: 'monospace' }}>{r['Invoice No']}</td>
                    <td style={{ fontSize: 12, fontWeight: 600 }}>₹{r['Amount']}</td>
                    <td>
                      {r._valid ? (
                        <CheckCircle size={14} color="var(--success)" />
                      ) : (
                        <span style={{ color: 'var(--danger)', fontSize: 11 }}>
                          <XCircle size={13} style={{ verticalAlign: -2 }} /> {r._errors[0]}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn btn-primary" onClick={handleImport} disabled={importing || !preview.some(r => r._valid)}>
            {importing ? 'Importing…' : `Import ${preview.filter(r => r._valid).length} valid records`}
          </button>
        </div>
      )}

      {result && (
        <div className="card">
          <div className="card-title">Import Summary</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20 }}>
            {[
              { label: 'Total Records', value: result.total, color: 'var(--gray-700)' },
              { label: 'Imported', value: result.valid, color: 'var(--success)' },
              { label: 'Failed', value: result.failed, color: 'var(--danger)' },
              { label: 'Duplicates', value: result.dupes, color: 'var(--warning)' },
            ].map(s => (
              <div key={s.label} className="kpi-card" style={{ '--kpi-color': s.color }}>
                <span className="kpi-label">{s.label}</span>
                <div className="kpi-value" style={{ color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>
          {result.failedRows.length > 0 && (
            <>
              <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: 'var(--danger)' }}>Failed Records:</p>
              {result.failedRows.map(r => (
                <div key={r._row} style={{ fontSize: 12, padding: '6px 12px', background: 'var(--danger-bg)', borderRadius: 6, marginBottom: 6 }}>
                  Row {r._row}: {r['Vehicle Number']} — {r._errors.join(', ')}
                </div>
              ))}
            </>
          )}
          <div style={{ marginTop: 16 }}>
            <button className="btn btn-secondary" onClick={() => { setFile(null); setPreview(null); setResult(null); }}>
              Upload Another File
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
