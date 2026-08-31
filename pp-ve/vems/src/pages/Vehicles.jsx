import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, Car, Search, Filter, FileText, Clock, Receipt, Gauge } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { Modal, KpiCard, StatusBadge, Badge, SearchInput, fmtRupee, fmt, fmtDate, toast } from '../components/UI';
import { PLANTS, VEHICLE_TYPES, FUEL_TYPES } from '../data/sampleData';

function VehicleForm({ onSave, onClose, initial }) {
  const { plants, vehicles } = useApp();
  const { user } = useAuth();
  const [form, setForm] = useState(initial || {
    regNo: '', make: '', model: '', type: 'LCV', fuel: 'Diesel',
    plantId: user?.plantId || plants[0]?.id || '', dept: '', driver: '',
    year: new Date().getFullYear(), odometer: 0, tankCapacity: 60, status: 'active',
    purchaseDate: '', insuranceExpiry: '', pollutionExpiry: '', fitnessExpiry: '',
  });
  const [err, setErr] = useState({});

  const validate = () => {
    const e = {};
    if (!form.regNo) e.regNo = 'Required';
    if (!form.make) e.make = 'Required';
    if (!form.model) e.model = 'Required';
    if (!form.plantId) e.plantId = 'Required';
    const dup = vehicles.find(v => v.regNo === form.regNo && v.id !== form.id);
    if (dup) e.regNo = 'Registration number already exists';
    setErr(e);
    return !Object.keys(e).length;
  };

  const f = (k) => e => setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <>
      <div className="form-grid">
        <div className="form-group">
          <label className="form-label required">Registration No</label>
          <input className="form-input" value={form.regNo} onChange={f('regNo')} placeholder="HR26-BX-1234" style={{ textTransform: 'uppercase' }} />
          {err.regNo && <p className="form-error">{err.regNo}</p>}
        </div>
        <div className="form-group">
          <label className="form-label required">Plant</label>
          <select className="form-select" value={form.plantId} onChange={f('plantId')} disabled={user?.role !== 'superadmin'}>
            {plants.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label required">Make</label>
          <input className="form-input" value={form.make} onChange={f('make')} placeholder="Tata" />
          {err.make && <p className="form-error">{err.make}</p>}
        </div>
        <div className="form-group">
          <label className="form-label required">Model</label>
          <input className="form-input" value={form.model} onChange={f('model')} placeholder="Ace" />
          {err.model && <p className="form-error">{err.model}</p>}
        </div>
        <div className="form-group">
          <label className="form-label">Vehicle Type</label>
          <select className="form-select" value={form.type} onChange={f('type')}>
            {VEHICLE_TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Fuel Type</label>
          <select className="form-select" value={form.fuel} onChange={f('fuel')}>
            {FUEL_TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Mfg Year</label>
          <input type="number" className="form-input" value={form.year} onChange={f('year')} min="2000" max="2026" />
        </div>
        <div className="form-group">
          <label className="form-label">Odometer (km)</label>
          <input type="number" className="form-input" value={form.odometer} onChange={f('odometer')} />
        </div>
        <div className="form-group">
          <label className="form-label">Department</label>
          <input className="form-input" value={form.dept} onChange={f('dept')} placeholder="Logistics" />
        </div>
        <div className="form-group">
          <label className="form-label">Assigned Driver</label>
          <input className="form-input" value={form.driver} onChange={f('driver')} placeholder="Driver name" />
        </div>
        <div className="form-group">
          <label className="form-label">Purchase Date</label>
          <input type="date" className="form-input" value={form.purchaseDate} onChange={f('purchaseDate')} />
        </div>
        <div className="form-group">
          <label className="form-label">Status</label>
          <select className="form-select" value={form.status} onChange={f('status')}>
            <option value="active">Active</option>
            <option value="maintenance">Under Maintenance</option>
            <option value="inactive">Inactive</option>
            <option value="sold">Sold/Disposed</option>
          </select>
        </div>
      </div>
      <div style={{ borderTop: '1px solid var(--gray-200)', paddingTop: 16, marginTop: 8 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--gray-700)', marginBottom: 12 }}>Document Expiry Dates</p>
        <div className="form-grid-3">
          <div className="form-group">
            <label className="form-label">Insurance Expiry</label>
            <input type="date" className="form-input" value={form.insuranceExpiry} onChange={f('insuranceExpiry')} />
          </div>
          <div className="form-group">
            <label className="form-label">Pollution Certificate</label>
            <input type="date" className="form-input" value={form.pollutionExpiry} onChange={f('pollutionExpiry')} />
          </div>
          <div className="form-group">
            <label className="form-label">Fitness Certificate</label>
            <input type="date" className="form-input" value={form.fitnessExpiry} onChange={f('fitnessExpiry')} />
          </div>
        </div>
      </div>
      <div className="modal-footer" style={{ paddingLeft: 0, paddingRight: 0, paddingBottom: 0 }}>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => validate() && onSave(form)}>
          {initial ? 'Save Changes' : 'Add Vehicle'}
        </button>
      </div>
    </>
  );
}

function VehicleDetail({ vehicle }) {
  const { expenses } = useApp();
  const vExp = expenses.filter(e => e.vehicleId === vehicle.id).sort((a, b) => b.date.localeCompare(a.date));
  const totalExp = vExp.reduce((s, e) => s + e.amount, 0);
  const fuelExp = vExp.filter(e => e.category === 'Fuel');
  const totalFuel = fuelExp.reduce((s, e) => s + (e.fuelQty || 0), 0);
  const plant = PLANTS.find(p => p.id === vehicle.plantId);

  const catColors = { Fuel: '#1a56a0', Maintenance: '#0ea5e9', Repairs: '#d97706', Toll: '#16a34a', default: '#9ca3af' };

  return (
    <div>
      <div style={{ display: 'flex', gap: 24, marginBottom: 24, flexWrap: 'wrap' }}>
        <div style={{ flex: '0 0 auto' }}>
          <div style={{ width: 80, height: 80, borderRadius: 16, background: 'var(--primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Car size={40} color="var(--primary)" />
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 22, fontWeight: 700 }}>{vehicle.regNo}</h2>
          <p style={{ color: 'var(--gray-500)', marginTop: 2 }}>{vehicle.make} {vehicle.model} · {vehicle.type} · {vehicle.fuel}</p>
          <div style={{ display: 'flex', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
            <StatusBadge status={vehicle.status} />
            <Badge type="blue">{plant?.code}</Badge>
            <Badge type="gray">{vehicle.dept}</Badge>
            <Badge type="gray">{vehicle.year}</Badge>
          </div>
        </div>
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}>
        <KpiCard label="Total Expense" value={fmtRupee(totalExp)} color="#7c3aed" />
        <KpiCard label="Fuel Consumed" value={`${fmt(totalFuel)} L`} color="#d97706" />
        <KpiCard label="Current Odometer" value={`${fmt(vehicle.odometer)} km`} color="#0ea5e9" />
        <KpiCard label="Mileage" value={`${totalFuel > 0 ? (15000 / totalFuel).toFixed(1) : '—'} km/L`} color="#16a34a" />
      </div>

      <div style={{ marginBottom: 16, fontSize: 14, fontWeight: 600, color: 'var(--gray-700)' }}>Expense Timeline</div>
      <div className="timeline">
        {vExp.slice(0, 15).map((e, i) => (
          <div key={e.id} className="timeline-item">
            <div className={`timeline-dot ${e.category === 'Fuel' ? '' : e.category === 'Repairs' ? 'red' : e.category === 'Maintenance' ? 'yellow' : 'green'}`} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div className="timeline-date">{fmtDate(e.date)}</div>
                <div className="timeline-label">{e.category}</div>
                <div className="timeline-detail">{e.vendor} · INV: {e.invoiceNo}</div>
                {e.odometer && <div className="timeline-detail">Odometer: {fmt(e.odometer)} km</div>}
              </div>
              <div className="timeline-amount">{fmtRupee(e.amount)}</div>
            </div>
          </div>
        ))}
        {!vExp.length && <p style={{ color: 'var(--gray-400)', fontSize: 13 }}>No expense history recorded</p>}
      </div>
    </div>
  );
}

export default function Vehicles() {
  const { vehicles, addVehicle, updateVehicle, plants, expenses, addAuditEntry } = useApp();
  const { user } = useAuth();
  const nav = useNavigate();
  const { id } = useParams();

  const [search, setSearch] = useState('');
  const [plantFilter, setPlantFilter] = useState(user?.plantId || '');
  const [statusFilter, setStatusFilter] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [detail, setDetail] = useState(null);

  const myPlants = user?.role === 'superadmin' ? plants : plants.filter(p => p.id === user?.plantId);

  const filtered = vehicles.filter(v => {
    if (plantFilter && v.plantId !== plantFilter) return false;
    if (user?.role !== 'superadmin' && v.plantId !== user?.plantId) return false;
    if (statusFilter && v.status !== statusFilter) return false;
    const s = search.toLowerCase();
    if (s && !v.regNo.toLowerCase().includes(s) && !v.make.toLowerCase().includes(s) && !v.model.toLowerCase().includes(s) && !v.driver?.toLowerCase().includes(s)) return false;
    return true;
  });

  const handleAdd = (form) => {
    addVehicle(form);
    addAuditEntry('VEHICLE_CREATE', user?.name, `Added vehicle ${form.regNo}`);
    toast.success(`Vehicle ${form.regNo} added`);
    setShowAdd(false);
  };

  const handleEdit = (form) => {
    updateVehicle(editing.id, form);
    addAuditEntry('VEHICLE_UPDATE', user?.name, `Updated vehicle ${form.regNo}`);
    toast.success('Vehicle updated');
    setEditing(null);
  };

  if (id && id !== 'list') {
    const v = vehicles.find(x => x.id === id);
    if (v) return (
      <div className="page">
        <div className="page-header">
          <div>
            <button className="btn btn-ghost btn-sm" onClick={() => nav('/vehicles')} style={{ marginBottom: 8 }}>← Back to vehicles</button>
            <h1 className="page-title">{v.regNo}</h1>
            <p className="page-subtitle">{v.make} {v.model} · {PLANTS.find(p => p.id === v.plantId)?.name}</p>
          </div>
          <div className="page-actions">
            <button className="btn btn-secondary" onClick={() => setEditing(v)}><FileText size={15} /> Edit</button>
          </div>
        </div>
        <div className="card"><VehicleDetail vehicle={v} /></div>
        {editing && (
          <Modal title="Edit Vehicle" onClose={() => setEditing(null)} size="modal-lg">
            <VehicleForm initial={editing} onSave={handleEdit} onClose={() => setEditing(null)} />
          </Modal>
        )}
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Vehicles</h1>
          <p className="page-subtitle">{filtered.length} vehicles across {myPlants.length} plant(s)</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
            <Plus size={15} /> Add Vehicle
          </button>
        </div>
      </div>

      <div className="filter-bar">
        <SearchInput value={search} onChange={setSearch} placeholder="Search vehicles…" />
        {user?.role === 'superadmin' && (
          <select className="form-select" style={{ width: 160 }} value={plantFilter} onChange={e => setPlantFilter(e.target.value)}>
            <option value="">All Plants</option>
            {plants.map(p => <option key={p.id} value={p.id}>{p.code}</option>)}
          </select>
        )}
        <select className="form-select" style={{ width: 160 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="maintenance">Maintenance</option>
          <option value="inactive">Inactive</option>
          <option value="sold">Sold/Disposed</option>
        </select>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Vehicle</th>
                <th>Make / Model</th>
                <th>Type</th>
                <th>Fuel</th>
                <th>Plant</th>
                <th>Driver</th>
                <th>Odometer</th>
                <th>Total Exp</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(v => {
                const totalExp = expenses.filter(e => e.vehicleId === v.id).reduce((s, e) => s + e.amount, 0);
                const plant = PLANTS.find(p => p.id === v.plantId);
                return (
                  <tr key={v.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/vehicles/${v.id}`)}>
                    <td>
                      <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{v.regNo}</span>
                    </td>
                    <td>{v.make} {v.model}</td>
                    <td><Badge type="gray">{v.type}</Badge></td>
                    <td><Badge type="blue">{v.fuel}</Badge></td>
                    <td style={{ fontSize: 12, color: 'var(--gray-500)' }}>{plant?.code}</td>
                    <td style={{ fontSize: 12 }}>{v.driver || '—'}</td>
                    <td>{fmt(v.odometer)} km</td>
                    <td style={{ fontWeight: 600 }}>{fmtRupee(totalExp)}</td>
                    <td><StatusBadge status={v.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!filtered.length && <div style={{ padding: 40, textAlign: 'center', color: 'var(--gray-400)' }}>No vehicles found</div>}
        </div>
      </div>

      {showAdd && (
        <Modal title="Add New Vehicle" onClose={() => setShowAdd(false)} size="modal-lg">
          <VehicleForm onSave={handleAdd} onClose={() => setShowAdd(false)} />
        </Modal>
      )}
    </div>
  );
}
