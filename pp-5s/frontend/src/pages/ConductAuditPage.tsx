import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  doc, getDoc, collection, getDocs,
  setDoc, updateDoc, serverTimestamp, writeBatch
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Camera, Save, Send, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { db, storage } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { Spinner, Alert, ScoreBar, PageHeader, Modal } from '@/components/ui';
import { calculateScores } from '@/lib/utils';
import type { Audit, AuditTemplate, AuditCategory, ChecklistItem, AuditResponse, Principle } from '@/types';

interface ResponseMap { [itemId: string]: { score: number; observation: string; evidenceUrls: string[] } }

export default function ConductAuditPage() {
  const { id }    = useParams<{ id: string }>();
  const navigate  = useNavigate();
  const { userProfile } = useAuth();

  const [audit,      setAudit]      = useState<Audit | null>(null);
  const [template,   setTemplate]   = useState<AuditTemplate | null>(null);
  const [responses,  setResponses]  = useState<ResponseMap>({});
  const [collapsed,  setCollapsed]  = useState<Record<string, boolean>>({});
  const [saving,     setSaving]     = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploading,  setUploading]  = useState<string | null>(null);
  const [confirmOpen,setConfirmOpen]= useState(false);
  const [loading,    setLoading]    = useState(true);

  useEffect(() => { loadData(); }, [id]);

  const loadData = async () => {
    if (!id) return;
    try {
      const auditSnap = await getDoc(doc(db, 'audits', id));
      if (!auditSnap.exists()) { toast.error('Audit not found'); navigate(-1); return; }
      const a = { id: auditSnap.id, ...auditSnap.data() } as Audit;
      setAudit(a);

      const tmplSnap = await getDoc(doc(db, 'auditTemplates', a.templateId));
      if (tmplSnap.exists()) setTemplate({ id: tmplSnap.id, ...tmplSnap.data() } as AuditTemplate);

      // Load existing responses
      const respSnap = await getDocs(collection(db, 'audits', id, 'responses'));
      const map: ResponseMap = {};
      respSnap.docs.forEach(d => {
        const r = d.data() as AuditResponse;
        map[r.itemId] = { score: r.score, observation: r.observation ?? '', evidenceUrls: r.evidenceUrls ?? [] };
      });
      setResponses(map);
    } finally { setLoading(false); }
  };

  const updateResponse = useCallback((itemId: string, field: string, value: unknown) => {
    setResponses(prev => ({
      ...prev,
      [itemId]: { score: 0, observation: '', evidenceUrls: [], ...prev[itemId], [field]: value }
    }));
  }, []);

  const uploadPhoto = async (itemId: string, file: File) => {
    if (!id) return;
    setUploading(itemId);
    try {
      const path = `audits/${id}/${itemId}_${Date.now()}_${file.name}`;
      const r    = ref(storage, path);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      setResponses(prev => ({
        ...prev,
        [itemId]: {
          score: 0, observation: '', evidenceUrls: [],
          ...prev[itemId],
          evidenceUrls: [...(prev[itemId]?.evidenceUrls ?? []), url]
        }
      }));
      toast.success('Photo uploaded');
    } catch { toast.error('Upload failed'); }
    finally { setUploading(null); }
  };

  const saveDraft = async () => {
    if (!id || !audit || !template) return;
    setSaving(true);
    try {
      const respArray = buildResponseArray();
      const scores    = calculateScores(respArray, template.categories);

      const batch = writeBatch(db);
      // Save each response
      for (const resp of respArray) {
        const rRef = doc(collection(db, 'audits', id, 'responses'), resp.itemId);
        batch.set(rRef, { ...resp, auditId: id, updatedAt: serverTimestamp() });
      }
      // Update audit scores
      batch.update(doc(db, 'audits', id), {
        scores, status: 'Draft', updatedAt: serverTimestamp()
      });
      await batch.commit();
      toast.success('Draft saved');
    } catch (e) { toast.error('Save failed: ' + (e as Error).message); }
    finally { setSaving(false); }
  };

  const submitAudit = async () => {
    if (!id || !audit || !template) return;
    setSubmitting(true);
    try {
      const respArray = buildResponseArray();
      const scores    = calculateScores(respArray, template.categories);

      const batch = writeBatch(db);
      for (const resp of respArray) {
        const rRef = doc(collection(db, 'audits', id, 'responses'), resp.itemId);
        batch.set(rRef, { ...resp, auditId: id, updatedAt: serverTimestamp() });
      }
      batch.update(doc(db, 'audits', id), {
        scores, status: 'Submitted',
        submittedAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
      await batch.commit();
      toast.success('Audit submitted for review!');
      navigate(`/app/audits/${id}`);
    } catch (e) { toast.error('Submit failed: ' + (e as Error).message); }
    finally { setSubmitting(false); setConfirmOpen(false); }
  };

  const buildResponseArray = () => {
    if (!template) return [];
    return template.categories.flatMap(cat =>
      cat.items.map(item => ({
        itemId: item.id, categoryId: cat.id, principle: cat.principle as Principle,
        score: responses[item.id]?.score ?? 0,
        maxScore: item.maxScore,
        observation: responses[item.id]?.observation ?? '',
        evidenceUrls: responses[item.id]?.evidenceUrls ?? [],
        createdAt: serverTimestamp(),
      }))
    );
  };

  const currentScores = template
    ? calculateScores(buildResponseArray(), template.categories)
    : null;

  const totalAnswered = Object.keys(responses).length;
  const totalItems    = template?.categories.reduce((s, c) => s + c.items.length, 0) ?? 0;

  if (loading) return <div className="flex justify-center py-12"><Spinner size="lg" /></div>;
  if (!audit || !template) return <Alert type="error">Audit or template not found.</Alert>;

  const canConduct = audit.status === 'Draft' || audit.status === 'Reopened';
  if (!canConduct) return (
    <Alert type="warning">This audit is in <strong>{audit.status}</strong> status and cannot be edited.</Alert>
  );

  return (
    <div className="max-w-3xl mx-auto pb-24">
      <PageHeader
        title={template.name}
        subtitle={`${audit.areaName ?? audit.deptName ?? audit.plantName} · ${totalAnswered}/${totalItems} items completed`}
        back={() => navigate(`/app/audits/${id}`)}
      />

      {/* Live score */}
      {currentScores && (
        <div className="card mb-4 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-gray-700">Current Score</span>
            <span className="text-2xl font-bold text-primary-600">
              {currentScores.overall.percentage}%
            </span>
          </div>
          <ScoreBar value={currentScores.overall.score} max={currentScores.overall.maxScore} />
        </div>
      )}

      {/* Categories */}
      {template.categories.map(cat => (
        <CategorySection
          key={cat.id}
          category={cat}
          responses={responses}
          scores={currentScores?.byCategory[cat.id]}
          collapsed={collapsed[cat.id] ?? false}
          onToggle={() => setCollapsed(p => ({ ...p, [cat.id]: !p[cat.id] }))}
          onUpdate={updateResponse}
          onUpload={uploadPhoto}
          uploading={uploading}
        />
      ))}

      {/* Sticky action bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 flex gap-3 lg:left-60">
        <button
          onClick={saveDraft}
          disabled={saving}
          className="btn-secondary flex-1 justify-center"
        >
          {saving ? <Spinner size="sm" /> : <Save className="w-4 h-4" />}
          Save Draft
        </button>
        <button
          onClick={() => setConfirmOpen(true)}
          disabled={submitting || totalAnswered < totalItems}
          className="btn-primary flex-1 justify-center"
        >
          <Send className="w-4 h-4" />
          Submit Audit
        </button>
      </div>

      {/* Confirm submit */}
      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Submit Audit?" size="sm">
        <div className="p-5">
          <Alert type="info">
            Once submitted, the audit will go for review. Score: <strong>{currentScores?.overall.percentage ?? 0}%</strong>
          </Alert>
          <div className="flex gap-2 justify-end mt-4">
            <button className="btn-secondary" onClick={() => setConfirmOpen(false)}>Cancel</button>
            <button className="btn-primary" onClick={submitAudit} disabled={submitting}>
              {submitting ? <Spinner size="sm" /> : null}
              Confirm & Submit
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ── Category Section ──────────────────────────────────────────────────────────
function CategorySection({ category, responses, scores, collapsed, onToggle, onUpdate, onUpload, uploading }: {
  category: AuditCategory;
  responses: ResponseMap;
  scores?: { score: number; maxScore: number; percentage: number };
  collapsed: boolean;
  onToggle: () => void;
  onUpdate: (itemId: string, field: string, value: unknown) => void;
  onUpload: (itemId: string, file: File) => void;
  uploading: string | null;
}) {
  const PRINCIPLE_COLORS: Record<number, string> = {
    1: 'border-yellow-400 bg-yellow-50',
    2: 'border-green-400 bg-green-50',
    3: 'border-blue-400 bg-blue-50',
    4: 'border-purple-400 bg-purple-50',
    5: 'border-pink-400 bg-pink-50',
  };

  return (
    <div className={`card mb-3 border-l-4 ${PRINCIPLE_COLORS[category.principle]}`}>
      <button onClick={onToggle} className="w-full card-header text-left">
        <div>
          <div className="font-semibold text-gray-800">{category.name}</div>
          {scores && <div className="text-xs text-gray-500 mt-0.5">{scores.score}/{scores.maxScore} pts · {scores.percentage}%</div>}
        </div>
        {collapsed ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronUp className="w-4 h-4 text-gray-400" />}
      </button>
      {!collapsed && (
        <div className="divide-y divide-gray-100">
          {category.items.map(item => (
            <ItemRow
              key={item.id}
              item={item}
              response={responses[item.id]}
              onUpdate={(field, value) => onUpdate(item.id, field, value)}
              onUpload={(file) => onUpload(item.id, file)}
              uploading={uploading === item.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Item Row ──────────────────────────────────────────────────────────────────
function ItemRow({ item, response, onUpdate, onUpload, uploading }: {
  item: ChecklistItem;
  response?: { score: number; observation: string; evidenceUrls: string[] };
  onUpdate: (field: string, value: unknown) => void;
  onUpload: (file: File) => void;
  uploading: boolean;
}) {
  const score = response?.score ?? 0;
  const pct   = item.maxScore > 0 ? Math.round((score / item.maxScore) * 100) : 0;

  return (
    <div className="p-4">
      <div className="flex items-start gap-2 mb-3">
        {score === 0 && <AlertCircle className="w-4 h-4 text-gray-300 flex-shrink-0 mt-0.5" />}
        <p className="text-sm text-gray-800 flex-1">{item.description}</p>
        <span className="text-xs font-semibold text-gray-500 flex-shrink-0">Max: {item.maxScore}</span>
      </div>

      {item.guidance && (
        <p className="text-xs text-gray-500 italic mb-3 pl-6">{item.guidance}</p>
      )}

      {/* Score buttons */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {Array.from({ length: item.maxScore + 1 }, (_, i) => i).map(s => (
          <button
            key={s}
            onClick={() => onUpdate('score', s)}
            className={`w-9 h-9 rounded-lg text-sm font-bold transition-all ${
              s === score
                ? s === 0 ? 'bg-red-500 text-white' : s >= item.maxScore * 0.8 ? 'bg-green-500 text-white'
                  : s >= item.maxScore * 0.6 ? 'bg-blue-500 text-white' : 'bg-yellow-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >{s}</button>
        ))}
        <span className={`ml-2 text-sm font-semibold self-center ${
          pct >= 80 ? 'text-green-600' : pct >= 60 ? 'text-blue-600' : pct >= 40 ? 'text-yellow-600' : 'text-red-600'
        }`}>{pct}%</span>
      </div>

      {/* Observation */}
      <textarea
        value={response?.observation ?? ''}
        onChange={e => onUpdate('observation', e.target.value)}
        placeholder="Observation / finding (optional)"
        className="form-textarea text-sm mb-2"
        rows={2}
      />

      {/* Evidence photos */}
      <div className="flex items-center gap-2 flex-wrap">
        {response?.evidenceUrls?.map((url, i) => (
          <a key={i} href={url} target="_blank" rel="noopener noreferrer">
            <img src={url} alt="Evidence" className="w-14 h-14 object-cover rounded-lg border border-gray-200 hover:opacity-80 transition-opacity" />
          </a>
        ))}
        <label className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-gray-300 text-xs text-gray-500 cursor-pointer hover:border-primary-400 hover:text-primary-600 transition-colors ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}>
          {uploading ? <Spinner size="sm" /> : <Camera className="w-4 h-4" />}
          {uploading ? 'Uploading…' : 'Add Photo'}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={uploading}
            onChange={e => { if (e.target.files?.[0]) onUpload(e.target.files[0]); }}
          />
        </label>
      </div>
    </div>
  );
}
