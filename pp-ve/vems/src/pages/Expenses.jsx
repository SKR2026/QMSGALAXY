import { useState, useCallback } from 'react';
import { Plus, Upload, AlertTriangle, Check, FileText, Download } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { Modal, SearchInput, Badge, fmtRupee, fmt, fmtDate, toast } from '../components/UI';
import { PLANTS, EXPENSE_CATEGORIES } from '../data/sampleData';

function UploadZone({ value, onChange }) {
  const [drag, setDrag] = useState(false);
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer.files[0];
    if (file) onChange(file);
  }, [onChange]);
  return (
    <div>
      <div
        className={`upload-zone ${drag ? 'drag-over' : ''} ${value ? 'active' : ''}`}
        style={{ padding: 24, ...(value ? { borderColor: 'var(--success)', background: 'var(--success-bg)' } : {}) }}
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={handleDrop}
        onClick={() => document.getElementById('bill-upload').click()}
      >
        {value ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center' }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Check size={20} color="white" />
            </div>
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--success)' }}>{value.name || 'Bill attached'}</p>
              <p style={{ fontSize: 11, color: 'var(--gray-400)' }}>Click to change</p>
            </div>
          </div>
        ) : (
          <>
            <div className="icon"><Upload size={32} /></div>
            <p>Drop bill/invoice here or <b style={{ color: 'var(--primary)' }}>click to upload</b></p>
            <span>PDF, JPG, JPEG, PNG accepted</span>
          </>
        )}
      </div>
      <input type="file" id="bill-upload" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }}
        onChange={e => onChange(e.target.files[0])} />
    </div>
  );
}

function ExpenseForm({ onSave, onClose }) {
  const { vehicles, plants, addAuditEntry } = useApp();
  const { user } = useAuth();
  const [form, setForm] = useState({
    vehicleId: '', plantId: user?.plantId || '', date: new Date().toISOString().slice(0, 10),
    category: 'Fuel', vendor: '', invoiceNo: '', amount: '', gst: 0,
    paymentMethod: 'Cash', odometer: '', quantity: '', fuelQty: '', ratePerLitre: '',
    description: '', hasBill: false,
  });
  const [bill, setBill] = useState(null);
  const [err, setErr] = useState({});

  const myVehicles = user?.role === 'superadmin' ? vehicles : vehicles.filter(v => v.plantId === user?.plantId);
  const filtVehicles = form.plantId ? myVehicles.filter(v => v.plantId === form.plantId) : myVehicles;

  const f = (k) => e => setForm(p => ({ ...p, [k]: e.target.value }));

  // Auto-calc amount from fuel
  const calcFuelAmount = () => {
    if (form.fuelQty && form.ratePerLitre) {
      setForm(p => ({ ...p, amount: (parseFloat(p.fuelQty) * parseFloat(p.ratePerLitre)).toFixed(2) }));
    }
  };

  const validate = () => {
    const e = {};
    if (!form.vehicleId) e.vehicleId = 'Select a vehicle';
    if (!form.date) e.date = 'Required';
    if (!form.vendor) e.vendor = 'Required';
    if (!form.invoiceNo) e.invoiceNo = 'Required';
    if (!form.amount || parseFloat(form.amount) <= 0) e.amount = 'Enter valid amount';
    if (!bill) e.bill = 'Bill/Invoice upload is mandatory before submitting this expense.';
    setErr(e);
    return !Object.keys(e).length;
  };

  const handleSave = () => {
    if (!validate()) return;
    onSave({ ...form, amount: parseFloat(form.amount), hasBill: true, billName: bill?.name });
  };

  return (
    <>
      <div className="form-grid">
        {user?.role === 'superadmin' && (
          <div className="form-group">
            <label className="form-label required">Plant</label>
            <select className="form-select" value={form.plantId} onChange={e => setForm(p => ({ ...p, plantId: e.target.value, vehicleId: '' }))}>
              <option value="">Select plant</option>
              {plants.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}
        <div className="form-group">
          <label className="form-label required">Vehicle</label>
          <select className="form-select" value={form.vehicleId} onChange={f('vehicleId')}>
            <option value="">Select vehicle</option>
            {filtVehicles.map(v => <option key={v.id} value={v.id}>{v.regNo} — {v.make} {v.model}</option>)}
          </select>
          {err.vehicleId && <p className="form-error">{err.vehicleId}</p>}
        </div>
        <div className="form-group">
          <label className="form-label required">Date</label>
          <input type="date" className="form-input" value={form.date} onChange={f('date')} />
        </div>
        <div className="form-group">
          <label className="form-label required">Category</label>
          <select className="form-select" value={form.category} onChange={f('category')}>
            {EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label required">Vendor</label>
          <input className="form-input" value={form.vendor} onChange={f('vendor')} placeholder="Vendor name" />
          {err.vendor && <p className="form-error">{err.vendor}</p>}
        </div>
        <div className="form-group">
          <label className="form-label required">Invoice / Bill No</label>
          <input className="form-input" value={form.invoiceNo} onChange={f('invoiceNo')} placeholder="INV-2026-XXXX" />
          {err.invoiceNo && <p className="form-error">{err.invoiceNo}</p>}
        </div>
        <div className="form-group">
          <label className="form-label required">Amount (₹)</label>
          <input type="number" className="form-input" value={form.amount} onChange={f('amount')} placeholder="0.00" min="0" />
          {err.amount && <p className="form-error">{err.amount}</p>}
        </div>
        <div className="form-group">
          <label className="form-label">GST (%)</label>
          <select className="form-select" value={form.gst} onChange={f('gst')}>
            <option value={0}>No GST</option>
            <option value={5}>5%</option>
            <option value={12}>12%</option>
            <option value={18}>18%</option>
            <option value={28}>28%</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Payment Method</label>
          <select className="form-select" value={form.paymentMethod} onChange={f('paymentMethod')}>
            <option>Cash</option>
            <option>NEFT</option>
            <option>RTGS</option>
            <option>UPI</option>
            <option>FASTag</option>
            <option>Cheque</option>
            <option>Card</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Odometer Reading (km)</label>
          <input type="number" className="form-input" value={form.odometer} onChange={f('odometer')} placeholder="Current odometer" />
        </div>

        {form.category === 'Fuel' && (
          <>
            <div className="form-group">
              <label className="form-label">Fuel Quantity (L)</label>
              <input type="number" className="form-input" value={form.fuelQty} onChange={f('fuelQty')} onBlur={calcFuelAmount} placeholder="Litres filled" />
            </div>
            <div className="form-group">
              <label className="form-label">Rate per Litre (₹)</label>
              <input type="number" className="form-input" value={form.ratePerLitre} onChange={f('ratePerLitre')} onBlur={calcFuelAmount} placeholder="₹/L" />
            </div>
          </>
        )}

        <div className="form-group span-2">
          <label className="form-label">Description / Remarks</label>
          <textarea className="form-textarea" value={form.description} onChange={f('description')} placeholder="Optional notes…" rows={2} />
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--gray-200)', paddingTop: 16, marginBottom: 16 }}>
        <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Upload size={14} /> Attach Bill / Invoice <span style={{ color: 'var(--danger)', fontSize: 11 }}>*Mandatory</span>
        </p>
        <UploadZone value={bill} onChange={setBill} />
        {err.bill && (
          <div className="alert warning" style={{ marginTop: 10 }}>
            <AlertTriangle size={15} />
            {err.bill}
          </div>
        )}
      </div>

      <div className="modal-footer" style={{ paddingLeft: 0, paddingRight: 0, paddingBottom: 0 }}>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={handleSave}>
          <Check size={15} /> Submit Expense
        </button>
      </div>
    </>
  );
}

export default function Expenses() {
  const { filteredExpenses, addExpense, addAuditEntry, plants, vehicles, expCategories, filters, setFilters } = useApp();
  const { user } = useAuth();
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const PER = 20;

  const all = filteredExpenses();
  const myExpenses = user?.role === 'superadmin' ? all : all.filter(e => e.plantId === user?.plantId);
  const searched = myExpenses.filter(e => {
    const s = search.toLowerCase();
    if (!s) return true;
    return e.invoiceNo?.toLowerCase().includes(s) || e.vendor?.toLowerCase().includes(s) || e.category?.toLowerCase().includes(s);
  });
  const paged = searched.slice((page - 1) * PER, page * PER);
  const totalPages = Math.ceil(searched.length / PER);

  const handleAdd = (form) => {
    addExpense({ ...form, createdBy: user?.name || 'admin' });
    addAuditEntry('EXPENSE_CREATE', user?.name, `Added ${form.category} expense ${fmtRupee(form.amount)} for vehicle`);
    toast.success('Expense recorded successfully');
    setShowAdd(false);
  };

  const totalAmt = searched.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Expenses</h1>
          <p className="page-subtitle">{searched.length} records · Total: {fmtRupee(totalAmt)}</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
            <Plus size={15} /> Add Expense
          </button>
        </div>
      </div>

      <div className="filter-bar">
        <SearchInput value={search} onChange={s => { setSearch(s); setPage(1); }} placeholder="Search invoice, vendor…" />
        {user?.role === 'superadmin' && (
          <select className="form-select" style={{ width: 160 }} value={filters.plantId} onChange={e => setFilters(f => ({ ...f, plantId: e.target.value }))}>
            <option value="">All Plants</option>
            {plants.map(p => <option key={p.id} value={p.id}>{p.code}</option>)}
          </select>
        )}
        <select className="form-select" style={{ width: 160 }} value={filters.category} onChange={e => setFilters(f => ({ ...f, category: e.target.value }))}>
          <option value="">All Categories</option>
          {expCategories.map(c => <option key={c}>{c}</option>)}
        </select>
        <input type="date" className="form-input" style={{ width: 150 }} value={filters.dateFrom} onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))} />
        <span style={{ color: 'var(--gray-400)', fontSize: 12 }}>to</span>
        <input type="date" className="form-input" style={{ width: 150 }} value={filters.dateTo} onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))} />
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Vehicle</th>
                <th>Plant</th>
                <th>Category</th>
                <th>Vendor</th>
                <th>Invoice No</th>
                <th className="text-right">Amount</th>
                <th>GST</th>
                <th>Payment</th>
                <th>Bill</th>
              </tr>
            </thead>
            <tbody>
              {paged.map(e => {
                const veh = vehicles.find(v => v.id === e.vehicleId);
                const plant = PLANTS.find(p => p.id === e.plantId);
                return (
                  <tr key={e.id}>
                    <td style={{ fontSize: 12 }}>{fmtDate(e.date)}</td>
                    <td>
                      <span style={{ fontWeight: 600, color: 'var(--primary)', fontSize: 13 }}>{veh?.regNo || '—'}</span>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--gray-500)' }}>{plant?.code}</td>
                    <td>
                      <Badge type={e.category === 'Fuel' ? 'blue' : e.category === 'Repairs' ? 'red' : e.category === 'Maintenance' ? 'yellow' : 'gray'}>
                        {e.category}
                      </Badge>
                    </td>
                    <td style={{ fontSize: 12 }}>{e.vendor}</td>
                    <td style={{ fontSize: 12, color: 'var(--gray-500)', fontFamily: 'monospace' }}>{e.invoiceNo}</td>
                    <td className="text-right" style={{ fontWeight: 600 }}>₹{fmt(e.amount)}</td>
                    <td style={{ fontSize: 12, color: 'var(--gray-500)' }}>{e.gst ? `${e.gst}%` : '—'}</td>
                    <td style={{ fontSize: 12 }}>{e.paymentMethod}</td>
                    <td>
                      {e.hasBill ? (
                        <span title="Bill attached" style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 3, fontSize: 12 }}>
                          <Check size={13} /> Bill
                        </span>
                      ) : (
                        <span style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 3, fontSize: 12 }}>
                          <AlertTriangle size={13} /> Missing
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!paged.length && <div style={{ padding: 40, textAlign: 'center', color: 'var(--gray-400)' }}>No expenses found</div>}
        </div>
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderTop: '1px solid var(--gray-100)', fontSize: 13 }}>
            <span style={{ color: 'var(--gray-500)' }}>Showing {(page - 1) * PER + 1}–{Math.min(page * PER, searched.length)} of {searched.length}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary btn-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Prev</button>
              <button className="btn btn-secondary btn-sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
            </div>
          </div>
        )}
      </div>

      {showAdd && (
        <Modal title="Record Expense" onClose={() => setShowAdd(false)} size="modal-lg">
          <ExpenseForm onSave={handleAdd} onClose={() => setShowAdd(false)} />
        </Modal>
      )}
    </div>
  );
}
