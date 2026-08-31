import { AlertTriangle, Bell, CheckCircle, FileText } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { StatusBadge, fmtDate } from '../components/UI';
import { getExpiringDocuments, PLANTS } from '../data/sampleData';

export default function Alerts() {
  const { expenses, vehicles } = useApp();
  const { user } = useAuth();

  const allAlerts = getExpiringDocuments(90);
  const alerts = user?.role === 'superadmin' ? allAlerts : allAlerts.filter(a => {
    const v = vehicles.find(x => x.id === a.vehicleId);
    return v?.plantId === user?.plantId;
  });

  const expired = alerts.filter(a => a.severity === 'expired');
  const critical = alerts.filter(a => a.severity === 'critical');
  const warning = alerts.filter(a => a.severity === 'warning');
  const notice = alerts.filter(a => a.severity === 'notice');

  const SeverityBlock = ({ title, items, color, icon: Icon }) => (
    items.length > 0 && (
      <div className="card mb-4">
        <div className="card-title" style={{ color }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon size={18} />
            {title} ({items.length})
          </span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Vehicle</th><th>Plant</th><th>Document</th><th>Expiry Date</th><th>Days</th><th>Status</th></tr>
            </thead>
            <tbody>
              {items.map((a, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{a.regNo}</td>
                  <td style={{ fontSize: 12, color: 'var(--gray-500)' }}>{PLANTS.find(p => p.id === a.plantId)?.code}</td>
                  <td>{a.docType}</td>
                  <td>{fmtDate(a.expiryDate)}</td>
                  <td style={{ color, fontWeight: 600 }}>
                    {a.daysLeft < 0 ? `${Math.abs(a.daysLeft)} days overdue` : `${a.daysLeft} days left`}
                  </td>
                  <td><StatusBadge status={a.severity} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  );

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Alerts</h1>
          <p className="page-subtitle">{alerts.length} document alerts requiring attention</p>
        </div>
      </div>

      {alerts.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 60 }}>
          <CheckCircle size={48} color="var(--success)" style={{ margin: '0 auto 16px' }} />
          <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--success)' }}>All documents are up to date</p>
          <p style={{ fontSize: 13, color: 'var(--gray-400)', marginTop: 6 }}>No alerts within the next 90 days</p>
        </div>
      ) : (
        <>
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 24 }}>
            <div className="kpi-card" style={{ '--kpi-color': 'var(--danger)' }}>
              <span className="kpi-label">Expired</span>
              <div className="kpi-value" style={{ color: 'var(--danger)' }}>{expired.length}</div>
              <span className="kpi-sub">Action required</span>
            </div>
            <div className="kpi-card" style={{ '--kpi-color': 'var(--danger)' }}>
              <span className="kpi-label">Critical (&lt;15 days)</span>
              <div className="kpi-value" style={{ color: 'var(--danger)' }}>{critical.length}</div>
              <span className="kpi-sub">Urgent renewal</span>
            </div>
            <div className="kpi-card" style={{ '--kpi-color': 'var(--warning)' }}>
              <span className="kpi-label">Warning (&lt;30 days)</span>
              <div className="kpi-value" style={{ color: 'var(--warning)' }}>{warning.length}</div>
              <span className="kpi-sub">Schedule renewal</span>
            </div>
            <div className="kpi-card" style={{ '--kpi-color': '#0ea5e9' }}>
              <span className="kpi-label">Notice (&lt;90 days)</span>
              <div className="kpi-value" style={{ color: '#0ea5e9' }}>{notice.length}</div>
              <span className="kpi-sub">Plan ahead</span>
            </div>
          </div>

          <SeverityBlock title="Expired Documents" items={expired} color="var(--danger)" icon={AlertTriangle} />
          <SeverityBlock title="Critical — Expires within 15 days" items={critical} color="var(--danger)" icon={AlertTriangle} />
          <SeverityBlock title="Warning — Expires within 30 days" items={warning} color="var(--warning)" icon={Bell} />
          <SeverityBlock title="Notice — Expires within 90 days" items={notice} color="#0ea5e9" icon={FileText} />
        </>
      )}
    </div>
  );
}
