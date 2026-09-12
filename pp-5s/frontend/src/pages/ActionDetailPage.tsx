import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, updateDoc, serverTimestamp, arrayUnion } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Camera, Clock, CheckCircle, XCircle, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { db, storage } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { PageHeader, StatusBadge, Spinner, Alert, Modal } from '@/components/ui';
import { formatDate, formatDateTime } from '@/lib/utils';
import { PRINCIPLE_NAMES } from '@/types';
import type { CorrectiveAction, ActionStatus } from '@/types';

const STATUS_FLOW: Record<ActionStatus, ActionStatus | null> = {
  Open: 'InProgress',
  InProgress: 'SubmittedForVerification',
  SubmittedForVerification: 'Verified',
  Verified: null,
  Rejected: 'InProgress',
  Overdue: 'InProgress',
  Cancelled: null,
};

export default function ActionDetailPage() {
  const { id }    = useParams<{ id: string }>();
  const navigate  = useNavigate();
  const { userProfile, role } = useAuth();

  const [action,   setAction]   = useState<CorrectiveAction | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [comment,  setComment]  = useState('');
  const [showVerify, setShowVerify] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({
    rootCause: '', correction: '', correctiveAction: '', preventiveAction: ''
  });

  useEffect(() => { load(); }, [id]);

  const load = async () => {
    if (!id) return;
    const snap = await getDoc(doc(db, 'actions', id));
    if (!snap.exists()) { toast.error('Not found'); navigate(-1); return; }
    const a = { id: snap.id, ...snap.data() } as CorrectiveAction;
    setAction(a);
    setForm({
      rootCause: a.rootCause ?? '', correction: a.correction ?? '',
      correctiveAction: a.correctiveAction ?? '', preventiveAction: a.preventiveAction ?? ''
    });
    setLoading(false);
  };

  const saveForm = async () => {
    if (!id || !userProfile) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'actions', id), { ...form, updatedAt: serverTimestamp() });
      toast.success('Saved');
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  const transition = async (toStatus: ActionStatus, statusComment?: string) => {
    if (!id || !userProfile) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'actions', id), {
        status: toStatus,
        updatedAt: serverTimestamp(),
        history: arrayUnion({
          status: toStatus, by: userProfile.id, byName: userProfile.name,
          at: new Date().toISOString(), comment: statusComment ?? ''
        })
      });
      toast.success(`Status updated to ${toStatus}`);
      setComment(''); setShowVerify(false); load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  const uploadEvidence = async (file: File) => {
    if (!id) return;
    setUploading(true);
    try {
      const r = ref(storage, `actions/${id}/${Date.now()}_${file.name}`);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      await updateDoc(doc(db, 'actions', id), {
        evidenceUrls: arrayUnion(url), updatedAt: serverTimestamp()
      });
      toast.success('Evidence uploaded'); load();
    } catch { toast.error('Upload failed'); }
    finally { setUploading(false); }
  };

  if (loading) return <div className="flex justify-center py-12"><Spinner size="lg" /></div>;
  if (!action) return <Alert type="error">Action not found.</Alert>;

  const isOwner    = userProfile?.id === action.ownerId;
  const isReviewer = userProfile?.id === action.reviewerId;
  const isAdmin    = ['superadmin', 'plant_admin'].includes(role ?? '');
  const canEdit    = isOwner && !['Verified', 'Cancelled'].includes(action.status);
  const nextStatus = STATUS_FLOW[action.status];

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Corrective Action"
        back={() => navigate('/app/actions')}
        actions={<StatusBadge status={action.status} />}
      />

      {/* Header card */}
      <div className="card mb-4">
        <div className="card-body">
          <p className="font-semibold text-gray-800 mb-3">{action.findingDescription}</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><div className="text-xs text-gray-400 mb-0.5">Owner</div><div className="font-medium">{action.ownerName}</div></div>
            <div><div className="text-xs text-gray-400 mb-0.5">Priority</div><StatusBadge status={action.priority} /></div>
            <div>
              <div className="text-xs text-gray-400 mb-0.5">Target Date</div>
              <div className={`font-medium flex items-center gap-1 ${new Date(action.targetDate?.toDate?.() ?? '') < new Date() && !['Verified','Cancelled'].includes(action.status) ? 'text-red-600' : ''}`}>
                <Clock className="w-3.5 h-3.5" />{formatDate(action.targetDate)}
              </div>
            </div>
            <div><div className="text-xs text-gray-400 mb-0.5">Area</div><div className="font-medium">{action.areaName || '—'}</div></div>
          </div>
          {action.principle && (
            <div className="mt-2 text-xs text-gray-500">5S Principle: {PRINCIPLE_NAMES[action.principle]?.long}</div>
          )}
        </div>
      </div>

      {/* RCA Form */}
      {canEdit && (
        <div className="card mb-4">
          <div className="card-header"><h3 className="text-sm font-semibold">Root Cause Analysis</h3></div>
          <div className="card-body space-y-3">
            {[
              { key: 'rootCause', label: 'Root Cause *' },
              { key: 'correction', label: 'Immediate Correction' },
              { key: 'correctiveAction', label: 'Corrective Action' },
              { key: 'preventiveAction', label: 'Preventive Action' },
            ].map(f => (
              <div key={f.key}>
                <label className="form-label">{f.label}</label>
                <textarea className="form-textarea" rows={2}
                  value={form[f.key as keyof typeof form]}
                  onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} />
              </div>
            ))}
            <div className="flex gap-2 justify-end">
              <button className="btn-primary btn-sm" onClick={saveForm} disabled={saving}>
                {saving ? <Spinner size="sm" /> : null} Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Evidence */}
      <div className="card mb-4">
        <div className="card-header"><h3 className="text-sm font-semibold">Evidence</h3></div>
        <div className="card-body">
          <div className="flex flex-wrap gap-2">
            {action.evidenceUrls?.map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                <img src={url} alt="Evidence" className="w-16 h-16 object-cover rounded-lg border border-gray-200 hover:opacity-80 transition" />
              </a>
            ))}
            {canEdit && (
              <label className={`flex items-center gap-1.5 px-3 py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-400 cursor-pointer hover:border-primary-400 hover:text-primary-500 transition ${uploading ? 'opacity-50' : ''}`}>
                {uploading ? <Spinner size="sm" /> : <Camera className="w-4 h-4" />}
                Add Photo
                <input type="file" accept="image/*" className="hidden" disabled={uploading}
                  onChange={e => { if (e.target.files?.[0]) uploadEvidence(e.target.files[0]); }} />
              </label>
            )}
          </div>
          {!action.evidenceUrls?.length && !canEdit && <div className="text-sm text-gray-400">No evidence attached</div>}
        </div>
      </div>

      {/* Status actions */}
      <div className="card mb-4">
        <div className="card-header"><h3 className="text-sm font-semibold">Status Actions</h3></div>
        <div className="card-body">
          <div className="flex flex-wrap gap-2">
            {canEdit && nextStatus && (
              <button className="btn-primary" onClick={() => {
                if (nextStatus === 'SubmittedForVerification' && !form.rootCause) {
                  toast.error('Please fill in the Root Cause before submitting for verification.');
                  return;
                }
                transition(nextStatus);
              }}>
                <ArrowRight className="w-4 h-4" />
                {nextStatus === 'InProgress' ? 'Start Working' : nextStatus === 'SubmittedForVerification' ? 'Submit for Verification' : nextStatus}
              </button>
            )}
            {(isReviewer || isAdmin) && action.status === 'SubmittedForVerification' && (
              <>
                <button className="btn-success bg-green-600 text-white hover:bg-green-700" onClick={() => transition('Verified', 'Verified by reviewer')}>
                  <CheckCircle className="w-4 h-4" /> Verify
                </button>
                <button className="btn-danger" onClick={() => setShowVerify(true)}>
                  <XCircle className="w-4 h-4" /> Reject
                </button>
              </>
            )}
            {(isAdmin) && !['Verified', 'Cancelled'].includes(action.status) && (
              <button className="btn-secondary btn-sm text-red-600" onClick={() => transition('Cancelled', 'Cancelled by admin')}>
                Cancel Action
              </button>
            )}
          </div>
        </div>
      </div>

      {/* History */}
      <div className="card">
        <div className="card-header"><h3 className="text-sm font-semibold">History</h3></div>
        <div className="divide-y divide-gray-100">
          {[...(action.history ?? [])].reverse().map((h, i) => (
            <div key={i} className="px-5 py-3 flex items-start gap-3">
              <div className="w-7 h-7 bg-gray-100 rounded-full flex items-center justify-center text-xs font-bold text-gray-500 flex-shrink-0 mt-0.5">
                {h.byName?.charAt(0) ?? '?'}
              </div>
              <div>
                <div className="text-sm">
                  <span className="font-medium">{h.byName}</span>
                  <span className="text-gray-400"> changed status to </span>
                  <StatusBadge status={h.status} />
                </div>
                {h.comment && <div className="text-xs text-gray-500 mt-0.5 italic">"{h.comment}"</div>}
                <div className="text-xs text-gray-400 mt-0.5">{typeof h.at === 'string' ? new Date(h.at).toLocaleString() : formatDateTime(h.at)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Reject modal */}
      <Modal open={showVerify} onClose={() => setShowVerify(false)} title="Reject Action" size="sm">
        <div className="p-5 space-y-4">
          <div>
            <label className="form-label">Rejection reason *</label>
            <textarea className="form-textarea" value={comment} onChange={e => setComment(e.target.value)}
              placeholder="Explain what needs to be corrected…" rows={3} />
          </div>
          <div className="flex gap-2 justify-end">
            <button className="btn-secondary" onClick={() => setShowVerify(false)}>Cancel</button>
            <button className="btn-danger" onClick={() => transition('Rejected', comment)} disabled={!comment || saving}>
              {saving ? <Spinner size="sm" /> : null} Reject
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
