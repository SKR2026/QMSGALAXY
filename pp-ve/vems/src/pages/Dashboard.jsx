import { useState } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid, Legend } from 'recharts';
import { TrendingUp, Car, Factory, DollarSign, Fuel, Wind, Activity, AlertTriangle, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { KpiCard, fmtRupee, fmt, fmtDate, StatusBadge } from '../components/UI';
import { PLANTS, VEHICLES, CO2_FACTORS, getExpiringDocuments } from '../data/sampleData';

const COLORS = ['#1a56a0', '#0ea5e9', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#ea580c'];

const CustomTooltip = ({ active, payload, label, prefix = '₹' }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'white', border: '1px solid var(--gray-200)', borderRadius: 8, padding: '10px 14px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontSize: 13 }}>
      <p style={{ fontWeight: 600, marginBottom: 6, color: 'var(--gray-700)' }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>
          {p.name}: <b>{prefix}{fmt(p.value)}</b>
        </p>
      ))}
    </div>
  );
};

export default function Dashboard() {
  const { orgStats, monthlyExpenses, plantExpenses, categoryExpenses, vehicles, expenses, filters, setFilters, notifications } = useApp();
  const { user } = useAuth();
  const nav = useNavigate();
  const alerts = getExpiringDocuments(45);

  const topVehicles = [...VEHICLES]
    .map(v => ({
      ...v,
      totalExp: expenses.filter(e => e.vehicleId === v.id).reduce((s, e) => s + e.amount, 0)
    }))
    .sort((a, b) => b.totalExp - a.totalExp)
    .slice(0, 5);

  const fuelTrend = monthlyExpenses.map(m => ({
    month: m.month,
    fuel: expenses.filter(e => e.date.startsWith(m.fullMonth) && e.category === 'Fuel').reduce((s, e) => s + e.amount, 0),
    other: expenses.filter(e => e.date.startsWith(m.fullMonth) && e.category !== 'Fuel').reduce((s, e) => s + e.amount, 0),
  }));

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">
            {user?.role === 'superadmin' ? 'Organization Overview' : `${PLANTS.find(p => p.id === user?.plantId)?.name} Dashboard`}
          </h1>
          <p className="page-subtitle">Fleet performance across all plants — {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <div className="page-actions">
          <select className="form-select" style={{ width: 160 }} value={filters.dateFrom.slice(0, 7)} onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value + '-01' }))}>
            {['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07','2026-08'].map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      </div>

      {alerts.filter(a => a.severity === 'expired' || a.severity === 'critical').length > 0 && (
        <div className="alert danger mb-4">
          <AlertTriangle size={16} />
          <span>
            <b>{alerts.filter(a => a.severity === 'expired' || a.severity === 'critical').length} documents</b> require immediate attention — expired or critical.{' '}
            <button onClick={() => nav('/alerts')} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontWeight: 600, textDecoration: 'underline' }}>View alerts</button>
          </span>
        </div>
      )}

      {/* KPIs */}
      <div className="kpi-grid">
        <KpiCard label="Total Plants" value={fmt(orgStats.totalPlants)} sub="Active facilities" color="#1a56a0" icon={Factory} />
        <KpiCard label="Total Vehicles" value={fmt(orgStats.totalVehicles)} sub={`${orgStats.activeVehicles} active`} color="#0ea5e9" icon={Car} />
        <KpiCard label="Total Expenses" value={fmtRupee(orgStats.totalExpenses)} sub="All categories" color="#7c3aed" icon={DollarSign} delta={8.4} />
        <KpiCard label="Fuel Consumed" value={`${fmt(orgStats.totalFuel)} L`} sub="All vehicles" color="#d97706" icon={Fuel} />
        <KpiCard label="Avg Mileage" value={`${orgStats.avgMileage} km/L`} sub="Fleet average" color="#16a34a" icon={Activity} delta={-1.2} />
        <KpiCard label="Total CO₂" value={`${fmt(orgStats.co2)} kg`} sub="Estimated emissions" color="#dc2626" icon={Wind} />
        <KpiCard label="Total Distance" value={`${fmt(orgStats.totalDist)} km`} sub="Odometer based" color="#0891b2" icon={TrendingUp} />
        <KpiCard label="Cost per KM" value={`₹${orgStats.costPerKm}`} sub="Avg all vehicles" color="#ea580c" icon={TrendingUp} />
      </div>

      {/* Charts Row 1 */}
      <div className="chart-grid">
        <div className="card">
          <div className="card-title">
            Monthly Expense Trend
            <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--gray-500)' }}>Jan — Aug 2026</span>
          </div>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={fuelTrend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#9ca3af' }} />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={v => '₹' + (v / 1000).toFixed(0) + 'k'} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="fuel" name="Fuel" fill="#1a56a0" stackId="a" radius={[0, 0, 0, 0]} />
                <Bar dataKey="other" name="Other" fill="#0ea5e9" stackId="a" radius={[4, 4, 0, 0]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div className="card-title">Plant-wise Expenses</div>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={plantExpenses} layout="vertical" margin={{ top: 4, right: 40, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={v => '₹' + (v / 100000).toFixed(1) + 'L'} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: '#374151' }} width={40} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="amount" name="Expenses" fill="#1a56a0" radius={[0, 4, 4, 0]}
                  label={{ position: 'right', fontSize: 11, fill: '#6b7280', formatter: v => '₹' + (v / 100000).toFixed(1) + 'L' }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="chart-grid">
        <div className="card">
          <div className="card-title">Expense by Category</div>
          <div style={{ display: 'flex', height: 220, alignItems: 'center' }}>
            <PieChart width={140} height={200}>
              <Pie data={categoryExpenses.slice(0, 6)} cx={65} cy={95} innerRadius={40} outerRadius={65} dataKey="amount" paddingAngle={3}>
                {categoryExpenses.slice(0, 6).map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
              </Pie>
              <Tooltip formatter={v => fmtRupee(v)} />
            </PieChart>
            <div style={{ flex: 1, paddingLeft: 16 }}>
              {categoryExpenses.slice(0, 6).map((c, i) => (
                <div key={c.cat} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: COLORS[i], flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: 'var(--gray-600)', flex: 1 }}>{c.cat}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-800)' }}>{fmtRupee(c.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            Top Expense Vehicles
            <button className="btn btn-ghost btn-sm" onClick={() => nav('/vehicles')}>View all <ArrowRight size={13} /></button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Vehicle</th>
                  <th>Plant</th>
                  <th className="text-right">Total Expense</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {topVehicles.map(v => (
                  <tr key={v.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/vehicles/${v.id}`)}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{v.regNo}</div>
                      <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>{v.make} {v.model}</div>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--gray-500)' }}>{PLANTS.find(p => p.id === v.plantId)?.code}</td>
                    <td className="text-right font-semibold">{fmtRupee(v.totalExp)}</td>
                    <td><StatusBadge status={v.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Document Alerts */}
      {alerts.length > 0 && (
        <div className="card">
          <div className="card-title">
            Document Expiry Alerts
            <button className="btn btn-ghost btn-sm" onClick={() => nav('/alerts')}>View all <ArrowRight size={13} /></button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Vehicle</th>
                  <th>Document</th>
                  <th>Expiry Date</th>
                  <th>Days Left</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {alerts.slice(0, 6).map((a, i) => (
                  <tr key={i}>
                    <td><span style={{ fontWeight: 600 }}>{a.regNo}</span></td>
                    <td>{a.docType}</td>
                    <td>{fmtDate(a.expiryDate)}</td>
                    <td style={{ color: a.daysLeft < 0 ? 'var(--danger)' : a.daysLeft <= 15 ? 'var(--warning)' : 'var(--gray-600)' }}>
                      {a.daysLeft < 0 ? `${Math.abs(a.daysLeft)} days ago` : `${a.daysLeft} days`}
                    </td>
                    <td><StatusBadge status={a.severity} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
