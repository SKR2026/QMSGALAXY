import { useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Factory, Car, Receipt, Gauge, Wind, Wrench,
  FileText, Upload, Bell, ClipboardList, Users, Settings, LogOut,
  ChevronRight, Truck
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';

const NAV = [
  {
    section: 'Overview',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
      { id: 'plants', label: 'Plants', icon: Factory, path: '/plants', superOnly: true },
    ]
  },
  {
    section: 'Fleet',
    items: [
      { id: 'vehicles', label: 'Vehicles', icon: Truck, path: '/vehicles' },
      { id: 'expenses', label: 'Expenses', icon: Receipt, path: '/expenses' },
      { id: 'mileage', label: 'Mileage', icon: Gauge, path: '/mileage' },
      { id: 'co2', label: 'CO₂ Emissions', icon: Wind, path: '/co2' },
      { id: 'maintenance', label: 'Maintenance', icon: Wrench, path: '/maintenance' },
    ]
  },
  {
    section: 'Reports',
    items: [
      { id: 'reports', label: 'Reports', icon: FileText, path: '/reports' },
      { id: 'bulk', label: 'Bulk Upload', icon: Upload, path: '/bulk' },
    ]
  },
  {
    section: 'Admin',
    items: [
      { id: 'alerts', label: 'Alerts', icon: Bell, path: '/alerts', badge: true },
      { id: 'audit', label: 'Audit Log', icon: ClipboardList, path: '/audit', superOnly: true },
      { id: 'users', label: 'Users', icon: Users, path: '/users', superOnly: true },
      { id: 'settings', label: 'Settings', icon: Settings, path: '/settings', superOnly: true },
    ]
  }
];

export default function Sidebar({ mobile, onClose }) {
  const nav = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { notifications } = useApp();
  const alertCount = notifications.filter(n => n.severity === 'critical' || n.severity === 'expired').length;

  const go = (path) => {
    nav(path);
    if (onClose) onClose();
  };

  return (
    <nav className="sidebar">
      <div className="sidebar-logo">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, background: 'var(--primary)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Truck size={18} color="white" />
          </div>
          <div>
            <div className="logo-text">VEMS</div>
            <div className="logo-sub">Fleet Management</div>
          </div>
        </div>
      </div>

      <div style={{ padding: '12px', borderBottom: '1px solid rgba(255,255,255,0.06)', margin: '0 0 4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px', borderRadius: 8, background: 'rgba(255,255,255,0.04)' }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: 'white' }}>
            {user?.name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.name}</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>{user?.role === 'superadmin' ? 'Super Admin' : 'Plant Admin'}</div>
          </div>
        </div>
      </div>

      {NAV.map(section => {
        const visible = section.items.filter(item => {
          if (item.superOnly && user?.role !== 'superadmin') return false;
          return true;
        });
        if (!visible.length) return null;
        return (
          <div key={section.section} className="sidebar-section">
            <div className="sidebar-section-label">{section.section}</div>
            {visible.map(item => {
              const Icon = item.icon;
              const active = location.pathname.startsWith(item.path);
              return (
                <button key={item.id} className={`nav-item ${active ? 'active' : ''}`} onClick={() => go(item.path)}>
                  <Icon size={16} />
                  {item.label}
                  {item.badge && alertCount > 0 && <span className="nav-badge">{alertCount}</span>}
                </button>
              );
            })}
          </div>
        );
      })}

      <div style={{ marginTop: 'auto', padding: '12px' }}>
        <button className="nav-item" onClick={logout} style={{ color: '#ef4444' }}>
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </nav>
  );
}
