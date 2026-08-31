import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell } from 'recharts';
import { Wind, Info } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { KpiCard, fmt } from '../components/UI';
import { PLANTS, VEHICLES, CO2_FACTORS } from '../data/sampleData';

const COLORS = ['#1a56a0','#0ea5e9','#16a34a','#d97706','#dc2626','#7c3aed'];

export default function CO2() {
  const { expenses, vehicles } = useApp();
  const { user } = useAuth();

  const fuelExpenses = expenses.filter(e => e.category === 'Fuel');

  // Per vehicle CO2
  const vehicleCO2 = VEHICLES.map(v => {
    const vfuel = fuelExpenses.filter(e => e.vehicleId === v.id);
    const totalFuel = vfuel.reduce((s, e) => s + (e.fuelQty || 0), 0);
    const factor = CO2_FACTORS[v.fuel] || 2.68;
    const co2 = Math.round(totalFuel * factor);
    const dist = totalFuel * (v.type === 'HCV' ? 4.5 : v.type === 'Bus' ? 5 : 8.5);
    return { ...v, totalFuel: Math.round(totalFuel), co2, co2PerKm: dist > 0 ? Math.round((co2 / dist) * 1000) / 1000 : 0 };
  }).filter(v => v.co2 > 0).sort((a, b) => b.co2 - a.co2);

  // Per plant CO2
  const plantCO2 = PLANTS.map(p => {
    const co2 = vehicleCO2.filter(v => v.plantId === p.id).reduce((s, v) => s + v.co2, 0);
    return { name: p.code, fullName: p.name, co2 };
  });

  // Per fuel type
  const fuelTypeCO2 = Object.entries(CO2_FACTORS).map(([fuel, factor]) => {
    const fuelExp = fuelExpenses.filter(e => {
      const v = vehicles.find(x => x.id === e.vehicleId);
      return v?.fuel === fuel;
    });
    const totalFuel = fuelExp.reduce((s, e) => s + (e.fuelQty || 0), 0);
    return { fuel, co2: Math.round(totalFuel * factor) };
  }).filter(d => d.co2 > 0);

  // Monthly CO2
  const monthlyCO2 = ['01','02','03','04','05','06','07','08'].map(m => {
    const mFuel = fuelExpenses.filter(e => e.date.startsWith(`2026-${m}`));
    const co2 = mFuel.reduce((s, e) => {
      const v = vehicles.find(x => x.id === e.vehicleId);
      const factor = CO2_FACTORS[v?.fuel] || 2.68;
      return s + (e.fuelQty || 0) * factor;
    }, 0);
    return { month: `M${m}`, co2: Math.round(co2) };
  });

  const totalCO2 = vehicleCO2.reduce((s, v) => s + v.co2, 0);
  const avgCO2PerVeh = vehicleCO2.length > 0 ? Math.round(totalCO2 / vehicleCO2.length) : 0;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">CO₂ Emissions Dashboard</h1>
          <p className="page-subtitle">Estimated emissions based on fuel consumption × emission factors</p>
        </div>
      </div>

      <div className="alert info mb-4">
        <Info size={15} />
        <span>CO₂ calculations are <b>estimates</b> based on configured fuel emission factors (Diesel: 2.68 kg/L, Petrol: 2.31 kg/L, CNG: 1.95 kg/kg). Actual emissions may vary based on driving conditions and vehicle condition.</span>
      </div>

      <div className="kpi-grid">
        <KpiCard label="Total CO₂ Generated" value={`${fmt(totalCO2)} kg`} sub="All vehicles" color="var(--danger)" icon={Wind} />
        <KpiCard label="CO₂ per Vehicle" value={`${fmt(avgCO2PerVeh)} kg`} sub="Average" color="#dc2626" />
        <KpiCard label="Highest Emission" value={vehicleCO2[0]?.regNo || '—'} sub={`${fmt(vehicleCO2[0]?.co2)} kg CO₂`} color="#d97706" />
        <KpiCard label="Fuel Emission Factor" value="2.68 kg/L" sub="Diesel (configurable)" color="#7c3aed" />
      </div>

      <div className="chart-grid">
        <div className="card">
          <div className="card-title">Monthly CO₂ Trend (kg)</div>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyCO2} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => (v / 1000).toFixed(1) + 'k'} />
                <Tooltip formatter={v => [fmt(v) + ' kg', 'CO₂']} />
                <Line type="monotone" dataKey="co2" stroke="#dc2626" strokeWidth={2.5} dot={{ fill: '#dc2626', r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div className="card-title">Plant-wise CO₂ (kg)</div>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={plantCO2} margin={{ top: 4, right: 40, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => (v / 1000).toFixed(0) + 'k'} />
                <Tooltip formatter={v => [fmt(v) + ' kg', 'CO₂']} />
                <Bar dataKey="co2" fill="#dc2626" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="chart-grid">
        <div className="card">
          <div className="card-title">CO₂ by Fuel Type</div>
          <div style={{ display: 'flex', height: 200, alignItems: 'center' }}>
            <PieChart width={140} height={190}>
              <Pie data={fuelTypeCO2} cx={65} cy={90} innerRadius={35} outerRadius={60} dataKey="co2" paddingAngle={3}>
                {fuelTypeCO2.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
              </Pie>
              <Tooltip formatter={v => [fmt(v) + ' kg', 'CO₂']} />
            </PieChart>
            <div style={{ flex: 1, paddingLeft: 16 }}>
              {fuelTypeCO2.map((d, i) => (
                <div key={d.fuel} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: COLORS[i], flexShrink: 0 }} />
                  <span style={{ fontSize: 13, flex: 1 }}>{d.fuel}</span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{fmt(d.co2)} kg</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--gray-200)', fontWeight: 600 }}>
            Top Emitting Vehicles
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Vehicle</th>
                  <th>Fuel</th>
                  <th>Fuel Used</th>
                  <th>CO₂ (kg)</th>
                  <th>kg/km</th>
                </tr>
              </thead>
              <tbody>
                {vehicleCO2.slice(0, 8).map(v => (
                  <tr key={v.id}>
                    <td style={{ fontWeight: 600 }}>{v.regNo}</td>
                    <td style={{ fontSize: 12 }}>{v.fuel}</td>
                    <td>{fmt(v.totalFuel)} L</td>
                    <td style={{ fontWeight: 600, color: v.co2 > 5000 ? 'var(--danger)' : 'var(--gray-800)' }}>{fmt(v.co2)}</td>
                    <td style={{ fontSize: 12 }}>{v.co2PerKm}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
