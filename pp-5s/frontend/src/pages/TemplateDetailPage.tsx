import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { Plus, Save, Trash2, GripVertical } from 'lucide-react';
import toast from 'react-hot-toast';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { PageHeader, Alert, Spinner, ScoreBar } from '@/components/ui';
import { PRINCIPLE_NAMES } from '@/types';
import type { AuditTemplate, AuditCategory, ChecklistItem, Principle } from '@/types';

export default function TemplateDetailPage() {
  const { id }    = useParams<{ id: string }>();
  const navigate  = useNavigate();
  const { role }  = useAuth();
  const [template, setTemplate] = useState<AuditTemplate | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [cats,     setCats]     = useState<AuditCategory[]>([]);

  const isAdmin = ['superadmin', 'plant_admin'].includes(role ?? '');

  useEffect(() => { load(); }, [id]);

  const load = async () => {
    if (!id) return;
    const snap = await getDoc(doc(db, 'auditTemplates', id));
    if (!snap.exists()) { toast.error('Not found'); navigate(-1); return; }
    const t = { id: snap.id, ...snap.data() } as AuditTemplate;
    setTemplate(t);
    setCats(JSON.parse(JSON.stringify(t.categories ?? [])));
    setLoading(false);
  };

  const save = async () => {
    if (!id) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'auditTemplates', id), {
        categories: cats, updatedAt: serverTimestamp()
      });
      toast.success('Template saved');
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  const addItem = (catIdx: number) => {
    const newItem: ChecklistItem = {
      id: `item_${Date.now()}`,
      description: 'New checklist item',
      maxScore: 4, weightage: 25
    };
    setCats(prev => prev.map((c, i) => i === catIdx ? { ...c, items: [...c.items, newItem] } : c));
  };

  const updateItem = (catIdx: number, itemIdx: number, field: keyof ChecklistItem, value: unknown) => {
    setCats(prev => prev.map((c, ci) => ci !== catIdx ? c : {
      ...c,
      items: c.items.map((item, ii) => ii !== itemIdx ? item : { ...item, [field]: value })
    }));
  };

  const removeItem = (catIdx: number, itemIdx: number) => {
    setCats(prev => prev.map((c, ci) => ci !== catIdx ? c : {
      ...c, items: c.items.filter((_, ii) => ii !== itemIdx)
    }));
  };

  const totalMax = cats.reduce((s, c) => s + c.items.reduce((ss, i) => ss + (Number(i.maxScore) || 0), 0), 0);

  if (loading) return <div className="flex justify-center py-12"><Spinner size="lg" /></div>;
  if (!template) return <Alert type="error">Template not found.</Alert>;

  return (
    <div className="max-w-4xl">
      <PageHeader
        title={template.name}
        subtitle={`v${template.version} · ${totalMax} max points · ${cats.reduce((s,c)=>s+c.items.length,0)} items`}
        back={() => navigate('/app/templates')}
        actions={isAdmin ? (
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? <Spinner size="sm" /> : <Save className="w-4 h-4" />}
            Save Template
          </button>
        ) : undefined}
      />

      {!isAdmin && <Alert type="info" className="mb-4">You have read-only access to this template.</Alert>}

      {cats.map((cat, catIdx) => {
        const catMax = cat.items.reduce((s, i) => s + (Number(i.maxScore) || 0), 0);
        const COLORS: Record<number, string> = {
          1: 'border-yellow-400', 2: 'border-green-400', 3: 'border-blue-400',
          4: 'border-purple-400', 5: 'border-pink-400'
        };
        return (
          <div key={cat.id} className={`card mb-4 border-l-4 ${COLORS[cat.principle]}`}>
            <div className="card-header">
              <div>
                <h3 className="font-semibold">{cat.name}</h3>
                <p className="text-xs text-gray-400">{PRINCIPLE_NAMES[cat.principle as Principle]?.long} · {cat.items.length} items · {catMax} max pts</p>
              </div>
              {isAdmin && (
                <button className="btn-secondary btn-sm" onClick={() => addItem(catIdx)}>
                  <Plus className="w-3.5 h-3.5" /> Add Item
                </button>
              )}
            </div>

            <div className="divide-y divide-gray-100">
              {cat.items.map((item, itemIdx) => (
                <div key={item.id} className="flex gap-3 p-4 items-start">
                  <GripVertical className="w-4 h-4 text-gray-300 mt-2 flex-shrink-0 cursor-grab" />
                  <div className="flex-1 space-y-2">
                    {isAdmin ? (
                      <textarea
                        className="form-textarea text-sm py-1.5"
                        rows={2}
                        value={item.description}
                        onChange={e => updateItem(catIdx, itemIdx, 'description', e.target.value)}
                      />
                    ) : (
                      <p className="text-sm text-gray-700">{item.description}</p>
                    )}
                    {item.guidance && !isAdmin && (
                      <p className="text-xs text-gray-400 italic">{item.guidance}</p>
                    )}
                    {isAdmin && (
                      <input
                        className="form-input text-xs py-1"
                        placeholder="Guidance / hint (optional)"
                        value={item.guidance ?? ''}
                        onChange={e => updateItem(catIdx, itemIdx, 'guidance', e.target.value)}
                      />
                    )}
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {isAdmin ? (
                      <div>
                        <label className="text-xs text-gray-400 block mb-0.5">Max Score</label>
                        <input
                          type="number" min={1} max={10}
                          className="form-input w-16 text-center text-sm py-1"
                          value={item.maxScore}
                          onChange={e => updateItem(catIdx, itemIdx, 'maxScore', parseInt(e.target.value) || 4)}
                        />
                      </div>
                    ) : (
                      <div className="text-sm text-gray-500">Max: {item.maxScore}</div>
                    )}
                    {isAdmin && (
                      <button className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors mt-4"
                        onClick={() => removeItem(catIdx, itemIdx)}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {!cat.items.length && (
                <div className="py-6 text-center text-sm text-gray-400">No items yet. Click "Add Item".</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
