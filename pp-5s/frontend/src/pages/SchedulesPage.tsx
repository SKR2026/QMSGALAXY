import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, addDoc, query, where, orderBy, serverTimestamp, Timestamp, limit } from 'firebase/firestore';
import { useForm } from 'react-hook-form';
import { Plus, Calendar, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { usePlant } from '@/context/PlantContext';
import { PageHeader, StatusBadge, Table, Spinner, Modal, EmptyState } from '@/components/ui';
import { formatDate, isOverdue } from '@/lib/utils';
import type { AuditSchedule, AuditTemplate, Area, User } from '@/types';

interface ScheduleFormData {
  title: string; templateId: string; auditorId: string;
  areaId: string; dueDate: string; frequency: string;
}

export default function SchedulesPage() {
  const navigate  = useNavigate();
  const { role, userProfile } = useAuth();
  const { currentPlant, plants } = usePlant();
  const [schedules,  setSchedules]  = useState<AuditSchedule[]>([]);
  const [templates,  setTemplates]  = useState<AuditTemplate[]>([]);
  const [areas,      setAreas]      = useState<Area[]>([]);
  const [auditors,   setAuditors]   = useState<User[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [showForm,   setShowForm]   = useState(false);
  const [creating,   setCreating]   = useState(false);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<ScheduleFormData>();
  const isAdmin = ['superadmin', 'plant_admin'].includes(role ?? '');

  useEffect(() => { load(); }, [currentPlant]);

  const load = async () => {
    if (!userProfile) return;
    setLoading(true);
    try {
      const plantFilter = currentPlant ? [currentPlant.id] : plants.map(p => p.id);
      if (!plantFilter.length) { setLoading(false); return; }

      const snap = await getDocs(query(
        collection(db, 'auditSchedules'),
        where('plantId', 'in', plantFilter.slice(0, 10)),
        orderBy('dueDate', 'asc'), limit(100)
      ));
      setSchedules(snap.docs.map(d => ({ id: d.id, ...d.data() } as AuditSchedule)));

      const tmpl = await getDocs(query(collection(db, 'auditTemplates'), where('isActive', '==', true)));
      setTemplates(tmpl.docs.map(d => ({ id: d.id, ...d.data() } as AuditTemplate)));

      const areasSnap = await getDocs(query(collection(db, 'areas'), where('plantId', 'in', plantFilter.slice(0, 10))));
      setAreas(areasSnap.docs.map(d => ({ id: d.id, ...d.data() } as Area)));

      const usersSnap = await getDocs(query(collection(db, 'users'), where('plantIds', 'array-contains-any', plantFilter.slice(0, 10))));
      setAuditors(usersSnap.docs.map(d => ({ id: d.id, ...d.data() } as User)).filter(u => ['auditor', 'plant_admin', 'superadmin'].includes(u.role)));
    } finally { setLoading(false); }
  };

  const create = async (data: ScheduleFormData) => {
    if (!userProfile) return;
    const plantId = currentPlant?.id ?? userProfile.plantIds[0];
    if (!plantId) { toast.error('Select a plant first'); return; }
    setCreating(true);
    try {
      const tmpl = templates.find(t => t.id === data.templateId);
      const area = areas.find(a => a.id === data.areaId);
      await addDoc(collection(db, 'auditSchedules'), {
        plantId, templateId: data.templateId, templateName: tmpl?.name ?? '',
        title: data.title, auditorIds: [data.auditorId],
        areaId: data.areaId || null, areaName: area?.name ?? '',
        dueDate: Timestamp.fromDate(new Date(data.dueDate)),
        frequency: data.frequency, status: 'Scheduled',
        createdBy: userProfile.id, createdAt: serverTimestamp()
      });
      toast.success('Schedule created'); reset(); setShowForm(false); load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setCreating(false); }
  };

  const startAudit = async (s: AuditSchedule) => {
    if (!userProfile) return;
    try {
      const ref = await addDoc(collection(db, 'audits'), {
        scheduleId: s.id, plantId: s.plantId, plantName: plants.find(p => p.id === s.plantId)?.name ?? '',
        templateId: s.templateId, templateName: s.templateName,
        areaId: s.areaId ?? null, areaName: s.areaName ?? '',
        auditorId: userProfile.id, auditorName: userProfile.name,
        status: 'Draft', scores: {},
        createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
      toast.success('Audit started');
      navigate(`/app/audits/${ref.id}/conduct`);
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div>
      <PageHeader title="Audit Schedules" subtitle={`${schedules.length} scheduled`}
        actions={isAdmin ? <button className="btn-primary" onClick={() => setShowForm(true)}><Plus className="w-4 h-4" /> Schedule Audit</button> : undefined}
      />

      {loading ? <div className="flex justify-center py-12"><Spinner size="lg" /></div> : (
        <div className="card">
          <Table headers={['Title', 'Template', 'Area', 'Due Date', 'Status', 'Actions']}>
            {schedules.map(s => (
              <tr key={s.id}>
                <td className="font-medium">{s.title}</td>
                <td className="text-gray-500">{s.templateName}</td>
                <td className="text-gray-500">{s.areaName || '—'}</td>
                <td>
                  <span className={isOverdue(s.dueDate) && s.status !== 'Completed' ? 'text-red-600 font-medium flex items-center gap-1' : ''}>
                    {isOverdue(s.dueDate) && s.status !== 'Completed' && <Clock className="w-3.5 h-3.5" />}
                    {formatDate(s.dueDate)}
                  </span>
                </td>
                <td><StatusBadge status={s.status} /></td>
                <td>
                  {s.status === 'Scheduled' && s.auditorIds.includes(userProfile?.id ?? '') && (
                    <button className="btn-primary btn-sm" onClick={() => startAudit(s)}>
                      Start Audit
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!schedules.length && (
              <tr><td colSpan={6}><EmptyState title="No schedules" description="Schedule an audit to get started." /></td></tr>
            )}
          </Table>
        </div>
      )}

      <Modal open={showForm} onClose={() => { setShowForm(false); reset(); }} title="Schedule Audit" size="md">
        <form onSubmit={handleSubmit(create)} className="p-5 space-y-4">
          <div>
            <label className="form-label">Title *</label>
            <input className="form-input" {...register('title', { required: 'Required' })} placeholder="e.g. Monthly Production Floor Audit" />
            {errors.title && <p className="form-error">{errors.title.message}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Template *</label>
              <select className="form-select" {...register('templateId', { required: 'Required' })}>
                <option value="">Select template</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              {errors.templateId && <p className="form-error">{errors.templateId.message}</p>}
            </div>
            <div>
              <label className="form-label">Auditor *</label>
              <select className="form-select" {...register('auditorId', { required: 'Required' })}>
                <option value="">Select auditor</option>
                {auditors.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              {errors.auditorId && <p className="form-error">{errors.auditorId.message}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Area</label>
              <select className="form-select" {...register('areaId')}>
                <option value="">Select area (optional)</option>
                {areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Due Date *</label>
              <input type="date" className="form-input" min={new Date().toISOString().split('T')[0]} {...register('dueDate', { required: 'Required' })} />
              {errors.dueDate && <p className="form-error">{errors.dueDate.message}</p>}
            </div>
          </div>
          <div>
            <label className="form-label">Frequency</label>
            <select className="form-select" {...register('frequency')}>
              <option value="once">One-time</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
            </select>
          </div>
          <div className="flex gap-2 justify-end pt-2 border-t border-gray-100">
            <button type="button" className="btn-secondary" onClick={() => { setShowForm(false); reset(); }}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={creating}>
              {creating ? <Spinner size="sm" /> : null} Schedule
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
