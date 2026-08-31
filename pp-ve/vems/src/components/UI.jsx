import { useState, useEffect } from 'react';
import { X, CheckCircle, AlertTriangle, Info, XCircle } from 'lucide-react';

// Toast system
const toastListeners = [];
let toastId = 0;

export function toast(msg, type = 'default') {
  const id = ++toastId;
  toastListeners.forEach(fn => fn({ id, msg, type }));
  return id;
}
toast.success = (msg) => toast(msg, 'success');
toast.error = (msg) => toast(msg, 'error');
toast.warning = (msg) => toast(msg, 'warning');

export function ToastContainer() {
  const [toasts, setToasts] = useState([]);
  useEffect(() => {
    const handler = (t) => {
      setToasts(prev => [...prev, t]);
      setTimeout(() => setToasts(prev => prev.filter(x => x.id !== t.id)), 3500);
    };
    toastListeners.push(handler);
    return () => { const i = toastListeners.indexOf(handler); if (i >= 0) toastListeners.splice(i, 1); };
  }, []);
  if (!toasts.length) return null;
  return (
    <div className="toast-wrap">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.type}`}>
          {t.type === 'success' && <CheckCircle size={16} />}
          {t.type === 'error' && <XCircle size={16} />}
          {t.type === 'warning' && <AlertTriangle size={16} />}
          {t.msg}
          <button onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: '0 0 0 8px' }}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, size = '' }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${size}`}>
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, message, onConfirm, onCancel, confirmLabel = 'Confirm', danger = false }) {
  return (
    <div className="modal-overlay">
      <div className="modal modal-sm">
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <p style={{ color: 'var(--gray-600)', lineHeight: 1.6 }}>{message}</p>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export function KpiCard({ label, value, sub, color = 'var(--primary)', icon: Icon, delta, deltaLabel }) {
  return (
    <div className="kpi-card" style={{ '--kpi-color': color }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <span className="kpi-label">{label}</span>
        {Icon && <div style={{ padding: '6px', borderRadius: '8px', background: color + '15' }}><Icon size={16} style={{ color }} /></div>}
      </div>
      <div className="kpi-value">{value}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {sub && <span className="kpi-sub">{sub}</span>}
        {delta !== undefined && <span className={`kpi-delta ${delta >= 0 ? 'up' : 'down'}`}>{delta >= 0 ? '↑' : '↓'} {Math.abs(delta)}%</span>}
        {deltaLabel && <span className="kpi-sub">{deltaLabel}</span>}
      </div>
    </div>
  );
}

export function Badge({ type = 'gray', children }) {
  return <span className={`badge ${type}`}>{children}</span>;
}

export function StatusBadge({ status }) {
  const map = {
    active: ['green', 'Active'],
    maintenance: ['yellow', 'Maintenance'],
    inactive: ['gray', 'Inactive'],
    sold: ['red', 'Sold/Disposed'],
    expired: ['red', 'Expired'],
    critical: ['red', 'Critical'],
    warning: ['yellow', 'Due Soon'],
    notice: ['blue', 'Notice'],
  };
  const [type, label] = map[status] || ['gray', status];
  return <Badge type={type}>{label}</Badge>;
}

export function EmptyState({ icon: Icon, title, desc, action }) {
  return (
    <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--gray-400)' }}>
      {Icon && <Icon size={48} strokeWidth={1.2} style={{ marginBottom: 16 }} />}
      <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--gray-600)', marginBottom: 6 }}>{title}</p>
      {desc && <p style={{ fontSize: 13, marginBottom: 16 }}>{desc}</p>}
      {action}
    </div>
  );
}

export function Spinner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <div style={{
        width: 32, height: 32, border: '3px solid var(--gray-200)',
        borderTopColor: 'var(--primary)', borderRadius: '50%',
        animation: 'spin 0.7s linear infinite'
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs">
      {tabs.map(t => (
        <button key={t.id} className={`tab ${active === t.id ? 'active' : ''}`} onClick={() => onChange(t.id)}>
          {t.label}
          {t.count !== undefined && <span style={{ marginLeft: 6, background: active === t.id ? 'var(--primary)' : 'var(--gray-200)', color: active === t.id ? 'white' : 'var(--gray-600)', borderRadius: 10, padding: '1px 7px', fontSize: 11 }}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…' }) {
  return (
    <div className="search-box">
      <svg className="icon" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

export function fmt(n) {
  if (n === undefined || n === null) return '—';
  return new Intl.NumberFormat('en-IN').format(Math.round(n));
}

export function fmtRupee(n) {
  if (n === undefined || n === null) return '—';
  return '₹' + new Intl.NumberFormat('en-IN').format(Math.round(n));
}

export function fmtDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
