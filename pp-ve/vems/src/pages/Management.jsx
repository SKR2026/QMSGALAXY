import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell } from 'recharts';
import { Truck, Wind, Gauge, DollarSign, Car, Factory, Shield } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { KpiCard, fmtRupee, fmt } from '../components/UI';
import { PLANTS, VEHICLES, getOrgStats, getMonthlyExpenses, getPlantExpenses, getCategoryExpenses, EXPENSES } from '../data/sampleData';

const COLORS = ['#1a56a0','#0ea5e9','#16a34a','#d97706','#dc2626','#7c3aed'];

export default function Management() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const { checkMgmtToken } = useAuth();
  const [authed, setAuthed] = useState(false);
  const [input, setInput] = useState('');
  const [err, setErr] = useState('');

  if (!authed) {
    // Auto-check token from URL
    if (token && !authed) {
      const ok = checkMgmtToken(token);
      if (ok) { setAuthed(true); }
    }
    if (!authed) {
      return (
        <div className="login-page">
          <div className="login-card" style={{ maxWidth: 380 }}>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ width: 48, height: 48, background: '#0f1724', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                <Shield size={24} color="white" />
              </div>
              <h2 style={{ fontWeight: 700, fontSize: 20 }}>Management View</h2>
              <p style={{ fontSize: 13, color: 'var(--gray-500)', marginTop: 4 }}>Enter your access token</p>
            </div>
            {err && <div className="alert danger" style={{ marginBottom: 12 }}>{err}</div>}
            <div className="form-group">
              <input className="form-input" value={input} onChange={e => setInput(e.target.value)}
                placeholder="mgmt-view-token" style={{ fontFamily: 'monospace', fontSize: 13 }} />
            </div>
            <button className="btn btn-primary w-full" style={{ width: '100%', justifyContent: 'center' }}
              onClick={() => {
                if (checkMgmtToken(input)) setAuthed(true);
                else setErr('Invalid or expired access token');
              }}>
              Access Dashboard
            </button>
            <p style={{ fontSize: 11, color: 'var(--gray-400)', textAlign: 'center', marginTop: 12 }}>
              Demo token: <code style={{ background: 'var(--gray-100)', padding: '1px 6px', borderRadius: 4 }}>mgmt-view-2026-secure-abc123</code>
            </p>
          </div>
        </div>
      );
    }
  }

  const stats = getOrgStats();
  const monthly = getMonthlyExpenses();
  const plantExp = getPlantExpenses();
  const catExp = getCategoryExpenses().slice(0, 6);
  const topVehicles = [...VEHICLES].map(v => ({
    ...v,
    total: EXPENSES.filter(e => e.vehicleId === v.id).reduce((s, e) => s + e.amount, 0)
  })).sort((a, b) => b.total - a.total).slice(0, 5);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--gray-50)' }}>
      {/* Read-only banner */}
      <div style={{ background: '#0f1724', color: 'white', padding: '10px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Truck size={18} />
          <span style={{ fontWeight: 700, fontSize: 15 }}>VEMS — Management Dashboard</span>
          <span style={{ fontSize: 11, background: 'rgba(255,255,255,0.1)', borderRadius: 4, padding: '2px 8px', color: '#94a3b8' }}>READ ONLY</span>
        </div>
        <span style={{ fontSize: 12, color: '#64748b' }}>
          {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
        </span>
      </div>

      <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--gray-900)' }}>Fleet Executive Summary</h1>
          <p style={{ fontSize: 13, color: 'var(--gray-500)' }}>Organization-wide vehicle expense intelligence</p>
        </div>

        <div className="kpi-grid">
          <KpiCard label="Total Plants" value={stats.totalPlants} color="#1a56a0" icon={Factory} />
          <KpiCard label="Active Vehicles" value={stats.activeVehicles} sub={`of ${stats.totalVehicles} total`} color="#0ea5e9" icon={Car} />
          <KpiCard label="Total Expenditure" value={fmtRupee(stats.totalExpenses)} color="#7c3aed" icon={DollarSign} />
          <KpiCard label="Fuel Consumed" value={`${fmt(stats.totalFuel)} L`} color="#d97706" />
          <KpiCard label="Avg Fleet Mileage" value={`${stats.avgMileage} km/L`} color="#16a34a" icon={Gauge} />
          <KpiCard label="Total CO₂ (est.)" value={`${fmt(stats.co2)} kg`} color="#dc2626" icon={Wind} />
          <KpiCard label="Total Distance" value={`${fmt(stats.totalDist)} km`} color="#0891b2" />
          <KpiCard label="Cost per KM" value={`₹${stats.costPerKm}`} color="#ea580c" />
        </div>

        <div className="chart-grid">
          <div className="card">
            <div className="card-title">Monthly Expense Trend</div>
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthly} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => '₹' + (v / 100000).toFixed(1) + 'L'} />
                  <Tooltip formatter={v => ['₹' + fmt(v), 'Expenses']} />
                  <Line type="monotone" dataKey="amount" stroke="#1a56a0" strokeWidth={2.5} dot={{ fill: '#1a56a0', r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card">
            <div className="card-title">Plant-wise Performance</div>
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={plantExp} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => '₹' + (v / 100000).toFixed(0) + 'L'} />
                  <Tooltip formatter={v => ['₹' + fmt(v), 'Total']} />
                  <Bar dataKey="amount" fill="#1a56a0" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="chart-grid">
          <div className="card">
            <div className="card-title">Expense by Category</div>
            <div style={{ display: 'flex', height: 200, alignItems: 'center' }}>
              <PieChart width={140} height={190}>
                <Pie data={catExp} cx={65} cy={90} innerRadius={35} outerRadius={60} dataKey="amount" paddingAngle={3}>
                  {catExp.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                </Pie>
                <Tooltip formatter={v => fmtRupee(v)} />
              </PieChart>
              <div style={{ flex: 1, paddingLeft: 16 }}>
                {catExp.map((c, i) => (
                  <div key={c.cat} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: COLORS[i] }} />
                    <span style={{ fontSize: 12, flex: 1 }}>{c.cat}</span>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{fmtRupee(c.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 0 }}>
            <div style={{ padding: '14px 18px', fontWeight: 600, borderBottom: '1px solid var(--gray-100)' }}>
              Highest-cost Vehicles
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--gray-50)' }}>
                  <th style={{ padding: '9px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--gray-500)' }}>Vehicle</th>
                  <th style={{ padding: '9px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--gray-500)' }}>Plant</th>
                  <th style={{ padding: '9px 16px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: 'var(--gray-500)' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {topVehicles.map(v => (
                  <tr key={v.id} style={{ borderBottom: '1px solid var(--gray-100)' }}>
                    <td style={{ padding: '10px 16px', fontWeight: 600 }}>{v.regNo}</td>
                    <td style={{ padding: '10px 16px', color: 'var(--gray-500)', fontSize: 12 }}>
                      {PLANTS.find(p => p.id === v.plantId)?.code}
                    </td>
                    <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 700 }}>{fmtRupee(v.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ textAlign: 'center', padding: '20px 0', borderTop: '1px solid var(--gray-200)', marginTop: 16, color: 'var(--gray-400)', fontSize: 12 }}>
          VEMS Management View · Read-only · Generated {new Date().toLocaleString('en-IN')} · Data as of August 2026
        </div>
      </div>
    </div>
  );
}
