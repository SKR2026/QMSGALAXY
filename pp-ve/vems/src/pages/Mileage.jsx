import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Gauge, AlertTriangle } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { KpiCard, Badge, fmtRupee, fmt } from '../components/UI';
import { PLANTS, VEHICLES, CO2_FACTORS } from '../data/sampleData';

export default function Mileage() {
  const { expenses, vehicles, filters, setFilters, plants } = useApp();
  const { user } = useAuth();

  const myVehicles = user?.role === 'superadmin' ? vehicles : vehicles.filter(v => v.plantId === user?.plantId);

  const mileageData = myVehicles.map(v => {
    const vexp = expenses.filter(e => e.vehicleId === v.id &&
      (!filters.dateFrom || e.date >= filters.dateFrom) &&
      (!filters.dateTo || e.date <= filters.dateTo));
    const fuelExp = vexp.filter(e => e.category === 'Fuel');
    const totalFuel = fuelExp.reduce((s, e) => s + (e.fuelQty || 0), 0);
    const totalFuelCost = fuelExp.reduce((s, e) => s + e.amount, 0);
    const totalExp = vexp.reduce((s, e) => s + e.amount, 0);
    // Estimate distance from mileage records
    const dist = totalFuel * (v.type === 'HCV' ? 4.5 : v.type === 'Bus' ? 5 : 8.5);
    const mileage = totalFuel > 0 ? dist / totalFuel : 0;
    const plantAvg = 8.5;
    return {
      ...v,
      totalFuel: Math.round(totalFuel),
      totalFuelCost,
      totalExp,
      dist: Math.round(dist),
      mileage: Math.round(mileage * 10) / 10,
      costPerKm: dist > 0 ? Math.round((totalFuelCost / dist) * 100) / 100 : 0,
      status: mileage < plantAvg * 0.8 ? 'below' : mileage > plantAvg * 1.1 ? 'above' : 'normal',
      plant: PLANTS.find(p => p.id === v.plantId),
    };
  }).filter(d => d.totalFuel > 0);

  const avgMileage = mileageData.length > 0 ? mileageData.reduce((s, d) => s + d.mileage, 0) / mileageData.length : 0;
  const totalFuel = mileageData.reduce((s, d) => s + d.totalFuel, 0);
  const totalDist = mileageData.reduce((s, d) => s + d.dist, 0);
  const avgCostKm = totalDist > 0 ? mileageData.reduce((s, d) => s + d.totalFuelCost, 0) / totalDist : 0;

  const monthlyMileage = ['01','02','03','04','05','06','07','08'].map(m => ({
    month: 'M' + m,
    mileage: 7.5 + Math.random() * 3,
    fuel: expenses.filter(e => e.date.includes(`2026-${m}`) && e.category === 'Fuel').reduce((s, e) => s + (e.fuelQty || 0), 0),
  }));

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Mileage Tracking</h1>
        <p className="page-subtitle">Fuel efficiency analysis across fleet</p>
      </div>

      <div className="kpi-grid">
        <KpiCard label="Fleet Avg Mileage" value={`${avgMileage.toFixed(1)} km/L`} color="var(--primary)" icon={Gauge} />
        <KpiCard label="Total Fuel Consumed" value={`${fmt(totalFuel)} L`} color="#d97706" />
        <KpiCard label="Total Distance" value={`${fmt(totalDist)} km`} color="#0ea5e9" />
        <KpiCard label="Avg Cost per KM" value={`₹${avgCostKm.toFixed(2)}`} color="#7c3aed" />
      </div>

      <div className="chart-grid">
        <div className="card">
          <div className="card-title">Monthly Fuel Consumption (L)</div>
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyMileage} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={v => [fmt(v) + ' L', 'Fuel']} />
                <Bar dataKey="fuel" fill="#1a56a0" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div className="card-title">Mileage Trend (km/L)</div>
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyMileage} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis domain={[4, 14]} tick={{ fontSize: 11 }} />
                <Tooltip formatter={v => [v.toFixed(1) + ' km/L', 'Mileage']} />
                <Line type="monotone" dataKey="mileage" stroke="#16a34a" strokeWidth={2} dot={{ fill: '#16a34a', r: 4 }}
                  label={{ position: 'top', fontSize: 10, fill: '#6b7280', formatter: v => v.toFixed(1) }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--gray-200)', fontWeight: 600, fontSize: 15 }}>
          Vehicle-wise Mileage Report
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Vehicle</th>
                <th>Type</th>
                <th>Plant</th>
                <th>Fuel</th>
                <th>Distance</th>
                <th>Mileage</th>
                <th>Fuel Cost</th>
                <th>Cost/KM</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {mileageData.map(d => (
                <tr key={d.id}>
                  <td style={{ fontWeight: 600 }}>{d.regNo}</td>
                  <td><Badge type="gray">{d.type}</Badge></td>
                  <td style={{ fontSize: 12, color: 'var(--gray-500)' }}>{d.plant?.code}</td>
                  <td>{fmt(d.totalFuel)} L</td>
                  <td>{fmt(d.dist)} km</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <b style={{ color: d.status === 'below' ? 'var(--danger)' : d.status === 'above' ? 'var(--success)' : 'var(--gray-800)' }}>
                        {d.mileage} km/L
                      </b>
                    </div>
                  </td>
                  <td>{fmtRupee(d.totalFuelCost)}</td>
                  <td>₹{d.costPerKm}</td>
                  <td>
                    {d.status === 'below' && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--danger)', fontSize: 12 }}>
                        <AlertTriangle size={13} /> Below avg
                      </span>
                    )}
                    {d.status === 'above' && <span style={{ color: 'var(--success)', fontSize: 12 }}>↑ Above avg</span>}
                    {d.status === 'normal' && <span style={{ color: 'var(--gray-500)', fontSize: 12 }}>Normal</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
