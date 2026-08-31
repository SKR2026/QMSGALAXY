import { useState } from 'react';
import { Download, FileText, BarChart2, Fuel, Gauge, Wind, Wrench, Car } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { fmtRupee, fmt, fmtDate, Tabs } from '../components/UI';
import { PLANTS, VEHICLES, EXPENSE_CATEGORIES } from '../data/sampleData';

function exportPDF(title, data, columns) {
  // In production, use jsPDF + autoTable. Demo shows alert.
  alert(`PDF Export: "${title}"\n${data.length} records would be exported to PDF with headers:\n${columns.join(', ')}\n\nIn production: jsPDF + autoTable generates a professional PDF with org logo, filters, and charts.`);
}

const REPORTS = [
  { id: 'vehicle-expense', label: 'Vehicle Expense Report', icon: Car, desc: 'All expenses per vehicle with category breakdown' },
  { id: 'plant-expense', label: 'Plant Expense Report', icon: BarChart2, desc: 'Plant-wise expense summary and comparison' },
  { id: 'fuel', label: 'Fuel Consumption Report', icon: Fuel, desc: 'Fuel fill-ups, quantity, rates, and vendor analysis' },
  { id: 'mileage', label: 'Mileage Report', icon: Gauge, desc: 'Fuel efficiency and cost-per-km analysis' },
  { id: 'co2', label: 'CO₂ Emission Report', icon: Wind, desc: 'Estimated emissions by vehicle, plant, fuel type' },
  { id: 'maintenance', label: 'Maintenance Report', icon: Wrench, desc: 'Service history and repair costs' },
  { id: 'vendor', label: 'Vendor Expense Report', icon: FileText, desc: 'Total spend by vendor/supplier' },
  { id: 'category', label: 'Category-wise Report', icon: BarChart2, desc: 'All expense categories with percentages' },
];

export default function Reports() {
  const { filteredExpenses, vehicles, plants, filters, setFilters } = useApp();
  const { user } = useAuth();
  const [activeReport, setActiveReport] = useState('vehicle-expense');
  const [plantFilter, setPlantFilter] = useState(user?.plantId || '');

  const all = filteredExpenses();

  const renderReport = () => {
    switch (activeReport) {
      case 'vehicle-expense': {
        const vData = VEHICLES.map(v => {
          const vexp = all.filter(e => e.vehicleId === v.id);
          const total = vexp.reduce((s, e) => s + e.amount, 0);
          const fuel = vexp.filter(e => e.category === 'Fuel').reduce((s, e) => s + e.amount, 0);
          const maint = vexp.filter(e => e.category !== 'Fuel').reduce((s, e) => s + e.amount, 0);
          return { ...v, total, fuel, maint, count: vexp.length };
        }).filter(v => v.count > 0 && (!plantFilter || v.plantId === plantFilter));
        const grandTotal = vData.reduce((s, v) => s + v.total, 0);
        return (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontSize: 13, color: 'var(--gray-500)' }}>{vData.length} vehicles · Total: {fmtRupee(grandTotal)}</span>
              <button className="btn btn-primary btn-sm" onClick={() => exportPDF('Vehicle Expense Report', vData, ['Reg No', 'Make/Model', 'Plant', 'Fuel Exp', 'Other Exp', 'Total'])}>
                <Download size={13} /> Export PDF
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Vehicle</th><th>Make/Model</th><th>Plant</th><th>Records</th><th>Fuel Exp</th><th>Other Exp</th><th>Total</th></tr></thead>
                <tbody>
                  {vData.sort((a, b) => b.total - a.total).map(v => (
                    <tr key={v.id}>
                      <td style={{ fontWeight: 600 }}>{v.regNo}</td>
                      <td>{v.make} {v.model}</td>
                      <td style={{ fontSize: 12, color: 'var(--gray-500)' }}>{PLANTS.find(p => p.id === v.plantId)?.code}</td>
                      <td>{v.count}</td>
                      <td>{fmtRupee(v.fuel)}</td>
                      <td>{fmtRupee(v.maint)}</td>
                      <td style={{ fontWeight: 700 }}>{fmtRupee(v.total)}</td>
                    </tr>
                  ))}
                  <tr style={{ background: 'var(--gray-50)', fontWeight: 700 }}>
                    <td colSpan={4}>Grand Total</td>
                    <td>{fmtRupee(vData.reduce((s, v) => s + v.fuel, 0))}</td>
                    <td>{fmtRupee(vData.reduce((s, v) => s + v.maint, 0))}</td>
                    <td>{fmtRupee(grandTotal)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        );
      }
      case 'plant-expense': {
        const pData = PLANTS.map(p => {
          const pexp = all.filter(e => e.plantId === p.id);
          const total = pexp.reduce((s, e) => s + e.amount, 0);
          const vCount = VEHICLES.filter(v => v.plantId === p.id).length;
          return { ...p, total, count: pexp.length, vCount, perVeh: vCount > 0 ? Math.round(total / vCount) : 0 };
        });
        return (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
              <button className="btn btn-primary btn-sm" onClick={() => exportPDF('Plant Expense Report', pData, ['Plant', 'Vehicles', 'Records', 'Per Vehicle', 'Total'])}>
                <Download size={13} /> Export PDF
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Plant</th><th>Location</th><th>Vehicles</th><th>Expense Records</th><th>Per Vehicle</th><th>Total</th></tr></thead>
                <tbody>
                  {pData.sort((a, b) => b.total - a.total).map(p => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600 }}>{p.name}</td>
                      <td style={{ fontSize: 12, color: 'var(--gray-500)' }}>{p.location}</td>
                      <td>{p.vCount}</td>
                      <td>{p.count}</td>
                      <td>{fmtRupee(p.perVeh)}</td>
                      <td style={{ fontWeight: 700 }}>{fmtRupee(p.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      }
      case 'category': {
        const catData = EXPENSE_CATEGORIES.map(cat => {
          const cexp = all.filter(e => e.category === cat);
          const total = cexp.reduce((s, e) => s + e.amount, 0);
          return { cat, total, count: cexp.length };
        }).filter(c => c.count > 0).sort((a, b) => b.total - a.total);
        const grand = catData.reduce((s, c) => s + c.total, 0);
        return (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
              <button className="btn btn-primary btn-sm" onClick={() => exportPDF('Category Report', catData, ['Category', 'Records', 'Amount', '%'])}>
                <Download size={13} /> Export PDF
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Category</th><th>Records</th><th>Amount</th><th>% of Total</th></tr></thead>
                <tbody>
                  {catData.map(c => (
                    <tr key={c.cat}>
                      <td style={{ fontWeight: 600 }}>{c.cat}</td>
                      <td>{c.count}</td>
                      <td>{fmtRupee(c.total)}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ height: 6, width: 80, background: 'var(--gray-100)', borderRadius: 3 }}>
                            <div style={{ height: '100%', width: `${(c.total / grand * 100).toFixed(0)}%`, background: 'var(--primary)', borderRadius: 3 }} />
                          </div>
                          <span style={{ fontSize: 12 }}>{(c.total / grand * 100).toFixed(1)}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      }
      default:
        return (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--gray-400)' }}>
            <FileText size={40} strokeWidth={1.2} style={{ margin: '0 auto 12px' }} />
            <p>Select a report from the left panel</p>
          </div>
        );
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Reports</h1>
        <div className="page-actions">
          {user?.role === 'superadmin' && (
            <select className="form-select" style={{ width: 160 }} value={plantFilter} onChange={e => setPlantFilter(e.target.value)}>
              <option value="">All Plants</option>
              {PLANTS.map(p => <option key={p.id} value={p.id}>{p.code}</option>)}
            </select>
          )}
          <input type="date" className="form-input" style={{ width: 150 }} value={filters.dateFrom} onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))} />
          <input type="date" className="form-input" style={{ width: 150 }} value={filters.dateTo} onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 20, alignItems: 'start' }}>
        <div className="card" style={{ padding: 8 }}>
          {REPORTS.map(r => {
            const Icon = r.icon;
            return (
              <button key={r.id} onClick={() => setActiveReport(r.id)}
                className={`nav-item ${activeReport === r.id ? 'active' : ''}`}
                style={{ width: '100%', flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '10px 12px', color: activeReport === r.id ? 'var(--primary)' : 'var(--gray-700)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon size={14} />
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{r.label}</span>
                </div>
                <span style={{ fontSize: 11, color: 'var(--gray-400)', paddingLeft: 22 }}>{r.desc}</span>
              </button>
            );
          })}
        </div>

        <div className="card">
          <div className="card-title">
            {REPORTS.find(r => r.id === activeReport)?.label}
          </div>
          {renderReport()}
        </div>
      </div>
    </div>
  );
}
