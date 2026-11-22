import React, { useEffect, useState } from 'react';
import { collection, getDocs, addDoc, updateDoc, doc, serverTimestamp, query, where, orderBy } from 'firebase/firestore';
import { useForm } from 'react-hook-form';
import { Plus, MapPin, Edit2, Layers } from 'lucide-react';
import toast from 'react-hot-toast';
import { db } from '@/lib/firebase';
import { usePlant } from '@/context/PlantContext';
import { useAuth } from '@/context/AuthContext';
import { PageHeader, Table, Spinner, Modal, StatusBadge } from '@/components/ui';
import type { Department, Area } from '@/types';

export default function AreasPage() {
  const { currentPlant, plants } = usePlant();
  const { role } = useAuth();
  const [depts,    setDepts]    = useState<Department[]>([]);
  const [areas,    setAreas]    = useState<Area[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [tab,      setTab]      = useState<'dept' | 'area'>('dept');
  const [showForm, setShowForm] = useState(false);
  const [saving,   setSaving]   = useState(false);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<{
    name: string; code: string; deptId?: string; plantId: string;
  }>();

  const plantFilter = currentPlant ? [currentPlant.id] : plants.map(p => p.id);

  useEffect(() => { if (plantFilter.length) load(); }, [currentPlant]);

  const load = async () => {
    setLoading(true);
    try {
      const deptsSnap = await getDocs(query(
        collection(db, 'departments'),
        where('plantId', 'in', plantFilter.slice(0, 10)),
        orderBy('name')
      ));
      setDepts(deptsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Department)));

      const areasSnap = await getDocs(query(
        collection(db, 'areas'),
        where('plantId', 'in', plantFilter.slice(0, 10)),
        orderBy('name')
      ));
      setAreas(areasSnap.docs.map(d => ({ id: d.id, ...d.data() } as Area)));
    } finally { setLoading(false); }
  };

  const save = async (data: { name: string; code: string; deptId?: string; plantId: string }) => {
    setSaving(true);
    try {
      const col = tab === 'dept' ? 'departments' : 'areas';
      await addDoc(collection(db, col), {
        ...data,
        plantId: currentPlant?.id ?? data.plantId,
        status: 'active',
        createdAt: serverTimestamp()
      });
      toast.success(`${tab === 'dept' ? 'Department' : 'Area'} created`);
      setShowForm(false); reset(); load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  const isAdmin = ['superadmin', 'plant_admin'].includes(role ?? '');

  return (
    <div>
      <PageHeader
        title="Departments & Areas"
        actions={isAdmin ? <button className="btn-primary" onClick={() => setShowForm(true)}><Plus className="w-4 h-4" /> New {tab === 'dept' ? 'Department' : 'Area'}</button> : undefined}
      />

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {(['dept', 'area'] as const).map(t => (
          <button key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t ? 'border-primary-500 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'dept' ? <><Layers className="w-3.5 h-3.5 inline mr-1.5" />Departments ({depts.length})</> : <><MapPin className="w-3.5 h-3.5 inline mr-1.5" />Areas ({areas.length})</>}
          </button>
        ))}
      </div>

      {loading ? <div className="flex justify-center py-12"><Spinner size="lg" /></div> : (
        <div className="card">
          {tab === 'dept' ? (
            <Table headers={['Department', 'Code', 'Plant', 'Status']}>
              {depts.map(d => (
                <tr key={d.id}>
                  <td className="font-medium">{d.name}</td>
                  <td><code className="text-xs bg-gray-100 px-2 py-0.5 rounded">{d.code}</code></td>
                  <td className="text-gray-500">{plants.find(p => p.id === d.plantId)?.name ?? d.plantId}</td>
                  <td><StatusBadge status={d.status} /></td>
                </tr>
              ))}
              {!depts.length && <tr><td colSpan={4} className="py-8 text-center text-gray-400">No departments yet</td></tr>}
            </Table>
          ) : (
            <Table headers={['Area', 'Code', 'Department', 'Plant', 'Status']}>
              {areas.map(a => (
                <tr key={a.id}>
                  <td className="font-medium">{a.name}</td>
                  <td><code className="text-xs bg-gray-100 px-2 py-0.5 rounded">{a.code}</code></td>
                  <td className="text-gray-500">{depts.find(d => d.id === a.deptId)?.name ?? '—'}</td>
                  <td className="text-gray-500">{plants.find(p => p.id === a.plantId)?.name ?? a.plantId}</td>
                  <td><StatusBadge status={a.status} /></td>
                </tr>
              ))}
              {!areas.length && <tr><td colSpan={5} className="py-8 text-center text-gray-400">No areas yet</td></tr>}
            </Table>
          )}
        </div>
      )}

      <Modal open={showForm} onClose={() => { setShowForm(false); reset(); }}
        title={`New ${tab === 'dept' ? 'Department' : 'Area'}`} size="sm">
        <form onSubmit={handleSubmit(save)} className="p-5 space-y-4">
          {!currentPlant && (
            <div>
              <label className="form-label">Plant *</label>
              <select className="form-select" {...register('plantId', { required: 'Required' })}>
                <option value="">Select plant</option>
                {plants.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="form-label">Name *</label>
            <input className="form-input" {...register('name', { required: 'Required' })} />
            {errors.name && <p className="form-error">{errors.name.message}</p>}
          </div>
          <div>
            <label className="form-label">Code *</label>
            <input className="form-input" {...register('code', { required: 'Required' })} placeholder="e.g. PROD-A" />
            {errors.code && <p className="form-error">{errors.code.message}</p>}
          </div>
          {tab === 'area' && (
            <div>
              <label className="form-label">Department</label>
              <select className="form-select" {...register('deptId')}>
                <option value="">Select department</option>
                {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          )}
          <div className="flex gap-2 justify-end pt-2 border-t border-gray-100">
            <button type="button" className="btn-secondary" onClick={() => { setShowForm(false); reset(); }}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? <Spinner size="sm" /> : null} Create
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
