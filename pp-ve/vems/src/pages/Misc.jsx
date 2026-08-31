import { useState } from 'react';
import { Copy, RefreshCw, Link, Shield, Eye, EyeOff, AlertTriangle, Wrench } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { fmtDate, Badge, toast } from '../components/UI';
import { PLANTS, VEHICLES, CO2_FACTORS } from '../data/sampleData';

// Audit Log page
export function AuditLog() {
  const { auditLog } = useApp();
  return (
    <div className="page">
      <div className="page-header">
        <div><h1 className="page-title">Audit Log</h1><p className="page-subtitle">{auditLog.length} audit entries</p></div>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Timestamp</th><th>Action</th><th>User</th><th>Detail</th></tr></thead>
            <tbody>
              {auditLog.map(entry => (
                <tr key={entry.id}>
                  <td style={{ fontSize: 12, color: 'var(--gray-500)', whiteSpace: 'nowrap' }}>
                    {new Date(entry.ts).toLocaleString('en-IN')}
                  </td>
                  <td>
                    <Badge type={
                      entry.action.includes('CREATE') ? 'green' :
                      entry.action.includes('UPDATE') ? 'blue' :
                      entry.action.includes('DELETE') ? 'red' :
                      entry.action.includes('UPLOAD') ? 'yellow' : 'gray'
                    }>
                      {entry.action}
                    </Badge>
                  </td>
                  <td style={{ fontWeight: 500 }}>{entry.user}</td>
                  <td style={{ fontSize: 13, color: 'var(--gray-600)' }}>{entry.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Settings page
export function Settings() {
  const { mgmtToken, setMgmtToken, regenerateMgmtToken } = useApp();
  const [showToken, setShowToken] = useState(false);
  const [co2Factors, setCo2Factors] = useState({ ...CO2_FACTORS });
  const [saved, setSaved] = useState(false);

  const mgmtUrl = `${window.location.origin}/management?token=${mgmtToken.token}`;

  const copy = (text) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  return (
    <div className="page">
      <div className="page-header"><h1 className="page-title">Settings</h1></div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Management View */}
        <div className="card">
          <div className="card-title"><Link size={16} /> Management View Access</div>
          <p style={{ fontSize: 13, color: 'var(--gray-600)', marginBottom: 16 }}>
            Generate a secure, read-only link for management to view dashboards without logging in.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <span style={{ fontSize: 13 }}>Status:</span>
            <Badge type={mgmtToken.active ? 'green' : 'red'}>{mgmtToken.active ? 'Active' : 'Inactive'}</Badge>
            <button className="btn btn-ghost btn-sm" onClick={() => setMgmtToken(t => ({ ...t, active: !t.active }))}>
              {mgmtToken.active ? 'Deactivate' : 'Activate'}
            </button>
          </div>

          <div style={{ background: 'var(--gray-50)', borderRadius: 8, padding: 12, marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: 'var(--gray-400)', marginBottom: 6 }}>Access URL</div>
            <div style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--gray-700)', wordBreak: 'break-all' }}>
              {showToken ? mgmtUrl : mgmtUrl.replace(mgmtToken.token, '••••••••••••••')}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowToken(t => !t)}>
              {showToken ? <EyeOff size={13} /> : <Eye size={13} />}
              {showToken ? 'Hide' : 'Show'} URL
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => copy(mgmtUrl)}>
              <Copy size={13} /> Copy Link
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => { regenerateMgmtToken(); toast.success('New token generated'); }}>
              <RefreshCw size={13} /> Regenerate
            </button>
          </div>

          <div style={{ marginTop: 16 }}>
            <div className="form-group">
              <label className="form-label">Expiry Date</label>
              <input type="date" className="form-input" value={mgmtToken.expiresAt} onChange={e => setMgmtToken(t => ({ ...t, expiresAt: e.target.value }))} />
            </div>
          </div>
        </div>

        {/* CO2 Factors */}
        <div className="card">
          <div className="card-title"><Shield size={16} /> CO₂ Emission Factors</div>
          <p style={{ fontSize: 13, color: 'var(--gray-600)', marginBottom: 16 }}>
            Configure kg CO₂ per litre (or per kg for CNG) for each fuel type. Used in all emission calculations.
          </p>
          {Object.entries(co2Factors).map(([fuel, factor]) => (
            <div key={fuel} className="form-group">
              <label className="form-label">{fuel} (kg CO₂ / {fuel === 'CNG' ? 'kg' : 'L'})</label>
              <input type="number" className="form-input" value={factor} step="0.01" min="0"
                onChange={e => setCo2Factors(f => ({ ...f, [fuel]: parseFloat(e.target.value) || 0 }))} />
            </div>
          ))}
          <button className="btn btn-primary" onClick={() => { setSaved(true); toast.success('CO₂ factors saved'); setTimeout(() => setSaved(false), 2000); }}>
            {saved ? '✓ Saved' : 'Save Factors'}
          </button>
        </div>

        {/* Notification Settings */}
        <div className="card">
          <div className="card-title">Notification Settings</div>
          {[
            { label: 'Document expiry alerts', days: 60 },
            { label: 'Low mileage alert threshold', days: null, suffix: 'km/L below average' },
            { label: 'Unusually high expense threshold', days: null, suffix: '₹ per record' },
          ].map(s => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <span style={{ fontSize: 13 }}>{s.label}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="number" defaultValue={s.days || 20} style={{ width: 70, padding: '4px 8px', border: '1px solid var(--gray-300)', borderRadius: 6, fontSize: 13 }} />
                <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>{s.days ? 'days' : s.suffix}</span>
              </div>
            </div>
          ))}
          <button className="btn btn-secondary" onClick={() => toast.success('Notification settings saved')}>Save</button>
        </div>
      </div>
    </div>
  );
}

// Maintenance page
export function Maintenance() {
  const { expenses, vehicles } = useApp();
  const { user } = useAuth();

  const maintExpenses = expenses.filter(e => ['Maintenance', 'Repairs', 'Spare Parts', 'Battery', 'Tyres'].includes(e.category));
  const myMaint = user?.role === 'superadmin' ? maintExpenses : maintExpenses.filter(e => {
    const v = vehicles.find(x => x.id === e.vehicleId);
    return v?.plantId === user?.plantId;
  });

  const maintVehicles = vehicles.filter(v => v.status === 'maintenance' || (user?.role !== 'superadmin' ? v.plantId === user?.plantId : true));
  const totalMaint = myMaint.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="page">
      <div className="page-header">
        <div><h1 className="page-title">Maintenance</h1><p className="page-subtitle">Service and repair tracking</p></div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card" style={{ '--kpi-color': 'var(--warning)' }}>
          <span className="kpi-label">Under Maintenance</span>
          <div className="kpi-value">{vehicles.filter(v => v.status === 'maintenance').length}</div>
          <span className="kpi-sub">Vehicles</span>
        </div>
        <div className="kpi-card" style={{ '--kpi-color': 'var(--primary)' }}>
          <span className="kpi-label">Maintenance Records</span>
          <div className="kpi-value">{myMaint.length}</div>
        </div>
        <div className="kpi-card" style={{ '--kpi-color': '#7c3aed' }}>
          <span className="kpi-label">Total Maintenance Cost</span>
          <div className="kpi-value" style={{ fontSize: 20 }}>₹{Math.round(totalMaint / 1000)}K</div>
        </div>
        <div className="kpi-card" style={{ '--kpi-color': '#dc2626' }}>
          <span className="kpi-label">Avg per Vehicle</span>
          <div className="kpi-value" style={{ fontSize: 20 }}>₹{Math.round(totalMaint / Math.max(vehicles.length, 1) / 1000)}K</div>
        </div>
      </div>

      <div className="chart-grid">
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '16px 20px', fontWeight: 600, fontSize: 15, borderBottom: '1px solid var(--gray-100)' }}>
            Vehicles Under Maintenance
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Vehicle</th><th>Plant</th><th>Type</th><th>Driver</th></tr></thead>
              <tbody>
                {vehicles.filter(v => v.status === 'maintenance').map(v => (
                  <tr key={v.id}>
                    <td style={{ fontWeight: 700 }}>{v.regNo}</td>
                    <td style={{ fontSize: 12, color: 'var(--gray-500)' }}>{PLANTS.find(p => p.id === v.plantId)?.code}</td>
                    <td><Badge type="yellow">{v.type}</Badge></td>
                    <td style={{ fontSize: 12 }}>{v.driver || '—'}</td>
                  </tr>
                ))}
                {!vehicles.filter(v => v.status === 'maintenance').length && (
                  <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--gray-400)', padding: 24 }}>No vehicles under maintenance</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '16px 20px', fontWeight: 600, fontSize: 15, borderBottom: '1px solid var(--gray-100)' }}>
            Recent Maintenance Expenses
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Vehicle</th><th>Category</th><th>Vendor</th><th>Amount</th><th>Date</th></tr></thead>
              <tbody>
                {myMaint.slice(0, 10).map(e => {
                  const v = vehicles.find(x => x.id === e.vehicleId);
                  return (
                    <tr key={e.id}>
                      <td style={{ fontWeight: 600, fontSize: 13 }}>{v?.regNo}</td>
                      <td><Badge type="yellow">{e.category}</Badge></td>
                      <td style={{ fontSize: 12 }}>{e.vendor}</td>
                      <td style={{ fontWeight: 600 }}>₹{Math.round(e.amount / 1000)}K</td>
                      <td style={{ fontSize: 12, color: 'var(--gray-500)' }}>{e.date}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
