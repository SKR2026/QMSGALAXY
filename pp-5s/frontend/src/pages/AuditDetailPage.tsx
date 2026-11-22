import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, updateDoc, serverTimestamp, collection, getDocs } from 'firebase/firestore';
import { CheckCircle, XCircle, RotateCcw, Edit3, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import {
  PageHeader, StatusBadge, ScoreBar, Spinner,
  Alert, Modal, ConfirmDialog
} from '@/components/ui';
import { formatDateTime } from '@/lib/utils';
import { PRINCIPLE_NAMES } from '@/types';
import type { Audit, AuditResponse, Principle } from '@/types';

export default function AuditDetailPage() {
  const { id }    = useParams<{ id: string }>();
  const navigate  = useNavigate();
  const { userProfile, role } = useAuth();

  const [audit,     setAudit]     = useState<Audit | null>(null);
  const [responses, setResponses] = useState<AuditResponse[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [comment,   setComment]   = useState('');
  const [confirm,   setConfirm]   = useState<null | 'approve' | 'reject' | 'reopen'>(null);
  const [acting,    setActing]    = useState(false);

  useEffect(() => { load(); }, [id]);

  const load = async () => {
    if (!id) return;
    try {
      const snap = await getDoc(doc(db, 'audits', id));
      if (!snap.exists()) { toast.error('Not found'); navigate(-1); return; }
      setAudit({ id: snap.id, ...snap.data() } as Audit);

      const respSnap = await getDocs(collection(db, 'audits', id, 'responses'));
      setResponses(respSnap.docs.map(d => ({ id: d.id, ...d.data() } as AuditResponse)));
    } finally { setLoading(false); }
  };

  const act = async (action: 'approve' | 'reject' | 'reopen') => {
    if (!id || !userProfile) return;
    setActing(true);
    try {
      const updates: Record<string, unknown> = { updatedAt: serverTimestamp() };
      if (action === 'approve') {
        updates.status = 'Approved';
        updates.approvedAt = serverTimestamp();
        updates.approverId = userProfile.id;
      } else if (action === 'reject') {
        updates.status = 'Draft';
        updates.reviewedAt = serverTimestamp();
        updates.reviewerId = userProfile.id;
        updates.rejectionComment = comment;
      } else {
        updates.status = 'Reopened';
        updates.reopenComment = comment;
      }
      await updateDoc(doc(db, 'audits', id), updates);
      toast.success(action === 'approve' ? 'Audit approved' : action === 'reject' ? 'Audit returned' : 'Audit reopened');
      setConfirm(null); setComment(''); load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setActing(false); }
  };

  const isAdmin  = ['superadmin', 'plant_admin'].includes(role ?? '');
  const canEdit  = audit?.status === 'Draft' || audit?.status === 'Reopened';
  const canApprove = isAdmin && audit?.status === 'Submitted';
  const canReopen  = isAdmin && audit?.status === 'Approved';

  if (loading) return <div className="flex justify-center py-12"><Spinner size="lg" /></div>;
  if (!audit)  return <Alert type="error">Audit not found.</Alert>;

  return (
    <div className="max-w-4xl">
      <PageHeader
        title={audit.templateName}
        subtitle={`${audit.areaName ?? audit.deptName ?? audit.plantName} · ${audit.auditorName}`}
        back={() => navigate('/app/audits')}
        actions={
          <div className="flex gap-2">
            <StatusBadge status={audit.status} />
            {canEdit && (
              <button className="btn-primary btn-sm" onClick={() => navigate(`/app/audits/${id}/conduct`)}>
                <Edit3 className="w-3.5 h-3.5" /> {audit.status === 'Draft' ? 'Continue' : 'Edit'}
              </button>
            )}
            {canApprove && (
              <>
                <button className="btn-danger btn-sm" onClick={() => setConfirm('reject')}>
                  <XCircle className="w-3.5 h-3.5" /> Return
                </button>
                <button className="btn-success btn-sm bg-green-600 text-white hover:bg-green-700" onClick={() => setConfirm('approve')}>
                  <CheckCircle className="w-3.5 h-3.5" /> Approve
                </button>
              </>
            )}
            {canReopen && (
              <button className="btn-secondary btn-sm" onClick={() => setConfirm('reopen')}>
                <RotateCcw className="w-3.5 h-3.5" /> Reopen
              </button>
            )}
          </div>
        }
      />

      {/* Score summary */}
      <div className="card mb-4">
        <div className="card-header">
          <h3 className="text-sm font-semibold">Overall Score</h3>
          <span className={`text-2xl font-bold ${
            (audit.scores?.overall?.percentage ?? 0) >= 90 ? 'text-green-600'
            : (audit.scores?.overall?.percentage ?? 0) >= 75 ? 'text-blue-600'
            : (audit.scores?.overall?.percentage ?? 0) >= 60 ? 'text-yellow-600' : 'text-red-600'
          }`}>
            {audit.scores?.overall?.percentage ?? 0}%
          </span>
        </div>
        <div className="p-5 space-y-3">
          {([1, 2, 3, 4, 5] as Principle[]).map(p => {
            const ps = audit.scores?.byPrinciple?.[p];
            return (
              <div key={p} className="grid grid-cols-[150px_1fr] items-center gap-4">
                <span className="text-sm font-medium text-gray-700">{PRINCIPLE_NAMES[p].long}</span>
                <ScoreBar value={ps?.score ?? 0} max={ps?.maxScore ?? 20} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Metadata */}
      <div className="card mb-4">
        <div className="card-body">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><div className="text-gray-400 text-xs mb-1">Auditor</div><div className="font-medium">{audit.auditorName}</div></div>
            <div><div className="text-gray-400 text-xs mb-1">Plant</div><div className="font-medium">{audit.plantName}</div></div>
            <div><div className="text-gray-400 text-xs mb-1">Submitted</div><div className="font-medium">{formatDateTime(audit.submittedAt) || '—'}</div></div>
            <div><div className="text-gray-400 text-xs mb-1">Approved</div><div className="font-medium">{formatDateTime(audit.approvedAt) || '—'}</div></div>
          </div>
        </div>
      </div>

      {/* Responses by category */}
      <div className="card">
        <div className="card-header"><h3 className="text-sm font-semibold">Responses ({responses.length} items)</h3></div>
        <div className="divide-y divide-gray-100">
          {responses.map(r => (
            <div key={r.id} className="px-5 py-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="text-sm text-gray-700">{r.itemId}</div>
                  {r.observation && <div className="text-xs text-gray-500 mt-1 italic">"{r.observation}"</div>}
                  {r.evidenceUrls?.length > 0 && (
                    <div className="flex gap-1.5 mt-1.5">
                      {r.evidenceUrls.map((url, i) => (
                        <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                          <img src={url} alt="Evidence" className="w-10 h-10 object-cover rounded border border-gray-200" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex-shrink-0 text-right">
                  <div className={`text-lg font-bold ${r.score === 0 ? 'text-red-500' : r.score >= r.maxScore * 0.8 ? 'text-green-600' : 'text-yellow-600'}`}>
                    {r.score}/{r.maxScore}
                  </div>
                  <div className="text-xs text-gray-400">{Math.round((r.score / r.maxScore) * 100)}%</div>
                </div>
              </div>
            </div>
          ))}
          {!responses.length && <div className="py-8 text-center text-gray-400 text-sm">No responses recorded yet</div>}
        </div>
      </div>

      {/* Action modals */}
      <Modal open={confirm === 'reject' || confirm === 'reopen'}
        onClose={() => { setConfirm(null); setComment(''); }}
        title={confirm === 'reject' ? 'Return Audit for Correction' : 'Reopen Audit'} size="sm">
        <div className="p-5 space-y-4">
          <div>
            <label className="form-label">Comment {confirm === 'reject' ? '(required)' : '(optional)'}</label>
            <textarea className="form-textarea" value={comment} onChange={e => setComment(e.target.value)}
              placeholder="Explain the reason…" rows={3} />
          </div>
          <div className="flex gap-2 justify-end">
            <button className="btn-secondary" onClick={() => { setConfirm(null); setComment(''); }}>Cancel</button>
            <button className="btn-danger" onClick={() => confirm && act(confirm)} disabled={acting || (confirm === 'reject' && !comment)}>
              {acting ? <Spinner size="sm" /> : null}
              {confirm === 'reject' ? 'Return' : 'Reopen'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirm === 'approve'}
        onClose={() => setConfirm(null)}
        onConfirm={() => act('approve')}
        title="Approve Audit?"
        message={`This will mark the audit as Approved. Score: ${audit.scores?.overall?.percentage ?? 0}%`}
        confirmLabel="Approve"
        variant="primary"
      />
    </div>
  );
}
