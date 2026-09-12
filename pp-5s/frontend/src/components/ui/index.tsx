import React from 'react';
import { clsx } from 'clsx';
import { Loader2, AlertCircle, CheckCircle, Info, X } from 'lucide-react';

// ── Spinner ──────────────────────────────────────────────────────────────────
export function Spinner({ size = 'md', className = '' }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const sz = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-8 h-8' }[size];
  return <Loader2 className={clsx('animate-spin text-primary-600', sz, className)} />;
}

// ── Loading Screen ────────────────────────────────────────────────────────────
export function LoadingScreen({ message = 'Loading…' }: { message?: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-gray-50">
      <Spinner size="lg" />
      <p className="text-sm text-gray-500">{message}</p>
    </div>
  );
}

// ── Empty State ───────────────────────────────────────────────────────────────
export function EmptyState({ icon, title, description, action }: {
  icon?: React.ReactNode; title: string; description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      {icon && <div className="mb-3 text-gray-300">{icon}</div>}
      <h3 className="text-gray-700 font-semibold mb-1">{title}</h3>
      {description && <p className="text-sm text-gray-500 mb-4 max-w-sm">{description}</p>}
      {action}
    </div>
  );
}

// ── Alert ─────────────────────────────────────────────────────────────────────
type AlertType = 'info' | 'success' | 'warning' | 'error';
const alertStyles: Record<AlertType, { wrap: string; icon: React.ReactNode }> = {
  info:    { wrap: 'bg-blue-50 border-blue-200 text-blue-800',    icon: <Info className="w-4 h-4 text-blue-500" /> },
  success: { wrap: 'bg-green-50 border-green-200 text-green-800', icon: <CheckCircle className="w-4 h-4 text-green-500" /> },
  warning: { wrap: 'bg-yellow-50 border-yellow-200 text-yellow-800', icon: <AlertCircle className="w-4 h-4 text-yellow-500" /> },
  error:   { wrap: 'bg-red-50 border-red-200 text-red-800',       icon: <AlertCircle className="w-4 h-4 text-red-500" /> },
};
export function Alert({ type = 'info', title, children }: {
  type?: AlertType; title?: string; children: React.ReactNode;
}) {
  const s = alertStyles[type];
  return (
    <div className={clsx('flex gap-2.5 p-3.5 rounded-lg border text-sm', s.wrap)}>
      <span className="mt-0.5 flex-shrink-0">{s.icon}</span>
      <div>
        {title && <div className="font-semibold mb-0.5">{title}</div>}
        <div>{children}</div>
      </div>
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, size = 'md' }: {
  open: boolean; onClose: () => void; title?: string;
  children: React.ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const maxW = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size];
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className={clsx('relative bg-white rounded-xl shadow-xl w-full', maxW, 'max-h-[90vh] flex flex-col')}>
        {title && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">{title}</h3>
            <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg transition-colors">
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </div>
        )}
        <div className="overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
}

// ── Confirm Dialog ────────────────────────────────────────────────────────────
export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', variant = 'danger' }: {
  open: boolean; onClose: () => void; onConfirm: () => void;
  title: string; message: string; confirmLabel?: string; variant?: 'danger' | 'primary';
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <div className="p-5">
        <p className="text-sm text-gray-600 mb-5">{message}</p>
        <div className="flex gap-2 justify-end">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className={variant === 'danger' ? 'btn-danger' : 'btn-primary'}
            onClick={() => { onConfirm(); onClose(); }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Badge ─────────────────────────────────────────────────────────────────────
export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: 'badge-green', inactive: 'badge-gray', invited: 'badge-yellow',
    Draft: 'badge-gray', Submitted: 'badge-blue', UnderReview: 'badge-yellow',
    Approved: 'badge-green', Reopened: 'badge-purple',
    Open: 'badge-blue', InProgress: 'badge-yellow',
    SubmittedForVerification: 'badge-purple', Verified: 'badge-green',
    Rejected: 'badge-red', Overdue: 'badge-red', Cancelled: 'badge-gray',
    Scheduled: 'badge-blue', Completed: 'badge-green',
    Low: 'badge-gray', Medium: 'badge-yellow', High: 'badge-red', Critical: 'badge-red',
  };
  return <span className={clsx('badge', styles[status] || 'badge-gray')}>{status}</span>;
}

// ── Score Color ───────────────────────────────────────────────────────────────
export function scoreClass(pct: number) {
  if (pct >= 90) return 'score-excellent';
  if (pct >= 75) return 'score-good';
  if (pct >= 60) return 'score-fair';
  return 'score-poor';
}

export function ScoreBar({ value, max, size = 'md' }: { value: number; max: number; size?: 'sm' | 'md' }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const color = pct >= 90 ? 'bg-green-500' : pct >= 75 ? 'bg-blue-500' : pct >= 60 ? 'bg-yellow-500' : 'bg-red-500';
  const h = size === 'sm' ? 'h-1.5' : 'h-2';
  return (
    <div className="flex items-center gap-2">
      <div className={clsx('flex-1 bg-gray-100 rounded-full overflow-hidden', h)}>
        <div className={clsx('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className={clsx('text-xs font-semibold min-w-[2.5rem] text-right', scoreClass(pct))}>
        {pct}%
      </span>
    </div>
  );
}

// ── Table ─────────────────────────────────────────────────────────────────────
export function Table({ headers, children, className }: {
  headers: string[]; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={clsx('table-wrap', className)}>
      <table className="table">
        <thead>
          <tr>{headers.map(h => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

// ── Pagination ────────────────────────────────────────────────────────────────
export function Pagination({ page, total, perPage, onChange }: {
  page: number; total: number; perPage: number; onChange: (p: number) => void;
}) {
  const pages = Math.ceil(total / perPage);
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm text-gray-500">
      <span>Showing {((page - 1) * perPage) + 1}–{Math.min(page * perPage, total)} of {total}</span>
      <div className="flex gap-1">
        <button className="btn-ghost btn-sm" disabled={page === 1} onClick={() => onChange(page - 1)}>← Prev</button>
        {Array.from({ length: Math.min(pages, 7) }, (_, i) => i + 1).map(p => (
          <button key={p}
            className={clsx('btn-sm rounded-lg px-3 py-1.5 text-xs font-medium',
              p === page ? 'bg-primary-600 text-white' : 'btn-ghost')}
            onClick={() => onChange(p)}>{p}</button>
        ))}
        <button className="btn-ghost btn-sm" disabled={page === pages} onClick={() => onChange(page + 1)}>Next →</button>
      </div>
    </div>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────
export function StatCard({ label, value, sub, icon, color = 'blue', onClick }: {
  label: string; value: string | number; sub?: string;
  icon?: React.ReactNode; color?: 'blue' | 'green' | 'yellow' | 'red' | 'purple';
  onClick?: () => void;
}) {
  const colors = {
    blue:   'border-blue-500 bg-blue-50 text-blue-700',
    green:  'border-green-500 bg-green-50 text-green-700',
    yellow: 'border-yellow-500 bg-yellow-50 text-yellow-700',
    red:    'border-red-500 bg-red-50 text-red-700',
    purple: 'border-purple-500 bg-purple-50 text-purple-700',
  };
  return (
    <div
      className={clsx('card border-t-4 p-5 cursor-pointer hover:shadow-md transition-shadow',
        colors[color], onClick ? 'cursor-pointer' : '')}
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider opacity-70 mb-1">{label}</p>
          <p className="text-3xl font-bold">{value}</p>
          {sub && <p className="text-xs mt-1 opacity-70">{sub}</p>}
        </div>
        {icon && <div className="opacity-60">{icon}</div>}
      </div>
    </div>
  );
}

// ── Page Header ───────────────────────────────────────────────────────────────
export function PageHeader({ title, subtitle, actions, back }: {
  title: string; subtitle?: string; actions?: React.ReactNode; back?: () => void;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
      <div className="flex items-center gap-3">
        {back && (
          <button onClick={back} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        <div>
          <h1 className="text-xl font-bold text-gray-900">{title}</h1>
          {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
