import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, addDoc, serverTimestamp, query, orderBy } from 'firebase/firestore';
import { useForm } from 'react-hook-form';
import { Plus, FileText, Copy, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { PageHeader, Table, Spinner, Modal, StatusBadge } from '@/components/ui';
import { formatDate } from '@/lib/utils';
import type { AuditTemplate } from '@/types';

export default function TemplatesPage() {
  const navigate = useNavigate();
  const { role, userProfile } = useAuth();
  const [templates, setTemplates] = useState<AuditTemplate[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [showNew,   setShowNew]   = useState(false);
  const [saving,    setSaving]    = useState(false);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<{ name: string; description: string }>();

  useEffect(() => { load(); }, []);

  const load = async () => {
    const snap = await getDocs(query(collection(db, 'auditTemplates'), orderBy('createdAt', 'desc')));
    setTemplates(snap.docs.map(d => ({ id: d.id, ...d.data() } as AuditTemplate)));
    setLoading(false);
  };

  const createTemplate = async (data: { name: string; description: string }) => {
    if (!userProfile) return;
    setSaving(true);
    try {
      // Default 5S template structure
      const defaultCategories = [
        { id: 's1', name: 'Sort (Seiri)', principle: 1, weightage: 20, items: [
          { id: 's1_1', description: 'Unnecessary items have been removed from the workplace', maxScore: 4, weightage: 25, guidance: 'Check for red-tagged items, obsolete tools, excess inventory' },
          { id: 's1_2', description: 'Only required tools and materials are present', maxScore: 4, weightage: 25, guidance: 'Verify minimum required quantity at point of use' },
          { id: 's1_3', description: 'Red tag area is maintained and reviewed regularly', maxScore: 4, weightage: 25, guidance: 'Red tag area should be designated and managed' },
          { id: 's1_4', description: 'Walkways and work areas are free from obstruction', maxScore: 4, weightage: 25, guidance: 'Check floor markings and access paths' },
        ]},
        { id: 's2', name: 'Set in Order (Seiton)', principle: 2, weightage: 20, items: [
          { id: 's2_1', description: 'Items have designated storage locations with clear labels', maxScore: 4, weightage: 25 },
          { id: 's2_2', description: 'Tools are stored at point of use within easy reach', maxScore: 4, weightage: 25 },
          { id: 's2_3', description: 'Visual controls (shadows, outlines) are in place', maxScore: 4, weightage: 25 },
          { id: 's2_4', description: 'Floor markings are clear, visible and maintained', maxScore: 4, weightage: 25 },
        ]},
        { id: 's3', name: 'Shine (Seiso)', principle: 3, weightage: 20, items: [
          { id: 's3_1', description: 'Work area and equipment are clean and free of dirt/debris', maxScore: 4, weightage: 34 },
          { id: 's3_2', description: 'Cleaning schedule is posted and followed', maxScore: 4, weightage: 33 },
          { id: 's3_3', description: 'Cleaning equipment is available and properly stored', maxScore: 4, weightage: 33 },
        ]},
        { id: 's4', name: 'Standardize (Seiketsu)', principle: 4, weightage: 20, items: [
          { id: 's4_1', description: '5S standards and procedures are documented and posted', maxScore: 4, weightage: 25 },
          { id: 's4_2', description: 'Visual management boards are updated and relevant', maxScore: 4, weightage: 25 },
          { id: 's4_3', description: 'Employees are aware of 5S standards for their area', maxScore: 4, weightage: 25 },
          { id: 's4_4', description: 'Checklists and audit schedules are maintained', maxScore: 4, weightage: 25 },
        ]},
        { id: 's5', name: 'Sustain (Shitsuke)', principle: 5, weightage: 20, items: [
          { id: 's5_1', description: 'Previous audit findings have been addressed', maxScore: 4, weightage: 25 },
          { id: 's5_2', description: 'Team actively participates in 5S activities', maxScore: 4, weightage: 25 },
          { id: 's5_3', description: 'Corrective actions are completed on time', maxScore: 4, weightage: 25 },
          { id: 's5_4', description: '5S improvement suggestions are encouraged and reviewed', maxScore: 4, weightage: 25 },
        ]},
      ];

      const ref = await addDoc(collection(db, 'auditTemplates'), {
        orgId: 'default',
        name: data.name,
        description: data.description,
        version: 1,
        categories: defaultCategories,
        scoringRules: { maxItemScore: 4, requireEvidence: false, requireObservation: false },
        isActive: true,
        createdBy: userProfile.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      toast.success('Template created');
      setShowNew(false); reset();
      navigate(`/app/templates/${ref.id}`);
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  const isAdmin = ['superadmin', 'plant_admin'].includes(role ?? '');

  return (
    <div>
      <PageHeader title="Audit Templates" subtitle={`${templates.length} templates`}
        actions={isAdmin ? (
          <button className="btn-primary" onClick={() => setShowNew(true)}>
            <Plus className="w-4 h-4" /> New Template
          </button>
        ) : undefined}
      />

      {loading ? <div className="flex justify-center py-12"><Spinner size="lg" /></div> : (
        <div className="card">
          <Table headers={['Template', 'Version', 'Categories', 'Max Score', 'Status', 'Created']}>
            {templates.map(t => (
              <tr key={t.id} className="cursor-pointer" onClick={() => navigate(`/app/templates/${t.id}`)}>
                <td>
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-primary-400" />
                    <div>
                      <div className="font-medium">{t.name}</div>
                      {t.description && <div className="text-xs text-gray-400">{t.description}</div>}
                    </div>
                  </div>
                </td>
                <td><span className="badge badge-blue">v{t.version}</span></td>
                <td>{t.categories?.length ?? 0} categories</td>
                <td>{t.categories?.reduce((s, c) => s + c.items.reduce((ss, i) => ss + i.maxScore, 0), 0) ?? 0} pts</td>
                <td><StatusBadge status={t.isActive ? 'active' : 'inactive'} /></td>
                <td className="text-gray-400">{formatDate(t.createdAt)}</td>
              </tr>
            ))}
            {!templates.length && (
              <tr><td colSpan={6} className="py-8 text-center text-gray-400">No templates yet. Create one to get started.</td></tr>
            )}
          </Table>
        </div>
      )}

      <Modal open={showNew} onClose={() => { setShowNew(false); reset(); }} title="New Audit Template" size="sm">
        <form onSubmit={handleSubmit(createTemplate)} className="p-5 space-y-4">
          <Alert>A default 5S template with all 5 principles will be created. You can customize it afterwards.</Alert>
          <div>
            <label className="form-label">Template Name *</label>
            <input className="form-input" placeholder="e.g. Standard 5S Audit" {...register('name', { required: 'Required' })} />
            {errors.name && <p className="form-error">{errors.name.message}</p>}
          </div>
          <div>
            <label className="form-label">Description</label>
            <input className="form-input" placeholder="Optional description" {...register('description')} />
          </div>
          <div className="flex gap-2 justify-end pt-2 border-t border-gray-100">
            <button type="button" className="btn-secondary" onClick={() => { setShowNew(false); reset(); }}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? <Spinner size="sm" /> : null} Create Template
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-sm text-blue-700">{children}</div>
  );
}
