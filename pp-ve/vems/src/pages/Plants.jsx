import { useState } from 'react';
import { Plus, Factory, Car, DollarSign } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Modal, fmtRupee, fmt, toast } from '../components/UI';

export default function Plants() {
  const { plants, vehicles, expenses, users } = useApp();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', code: '', location: '' });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Plants / Sites</h1>
          <p className="page-subtitle">{plants.length} facilities configured</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
          <Plus size={15} /> Add Plant
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
        {plants.map(p => {
          const pVehicles = vehicles.filter(v => v.plantId === p.id);
          const pExpenses = expenses.filter(e => e.plantId === p.id);
          const total = pExpenses.reduce((s, e) => s + e.amount, 0);
          const admin = users.find(u => u.id === p.adminId);
          return (
            <div key={p.id} className="card" style={{ borderTop: '4px solid var(--primary)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Factory size={22} color="var(--primary)" />
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{p.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>{p.code} · {p.location}</div>
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div style={{ background: 'var(--gray-50)', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>Vehicles</div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{pVehicles.length}</div>
                  <div style={{ fontSize: 11, color: 'var(--success)' }}>{pVehicles.filter(v => v.status === 'active').length} active</div>
                </div>
                <div style={{ background: 'var(--gray-50)', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>Total Expense</div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{fmtRupee(total)}</div>
                  <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>{pExpenses.length} records</div>
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--gray-100)', paddingTop: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>Plant Admin</div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{admin?.name || '—'}</div>
                <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>{admin?.email}</div>
              </div>
            </div>
          );
        })}
      </div>

      {showAdd && (
        <Modal title="Add Plant" onClose={() => setShowAdd(false)} size="modal-sm">
          <div className="form-group">
            <label className="form-label required">Plant Name</label>
            <input className="form-input" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Plant E — Hosur" />
          </div>
          <div className="form-group">
            <label className="form-label required">Plant Code</label>
            <input className="form-input" value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value.toUpperCase() }))} placeholder="HSR" />
          </div>
          <div className="form-group">
            <label className="form-label">Location</label>
            <input className="form-input" value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))} placeholder="Hosur, Tamil Nadu" />
          </div>
          <div className="modal-footer" style={{ paddingLeft: 0, paddingRight: 0, paddingBottom: 0 }}>
            <button className="btn btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={() => { toast.success('Plant added'); setShowAdd(false); }}>Add Plant</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
