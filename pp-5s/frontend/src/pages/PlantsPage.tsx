import React, { useEffect, useState } from 'react';
import { collection, getDocs, addDoc, updateDoc, doc, serverTimestamp, query, orderBy } from 'firebase/firestore';
import { useForm } from 'react-hook-form';
import { Plus, Building2, Edit2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { db } from '@/lib/firebase';
import { PageHeader, StatusBadge, Table, Spinner, Modal } from '@/components/ui';
import type { Plant } from '@/types';

interface FormData { name: string; code: string; location: string; }

export default function PlantsPage() {
  const [plants,  setPlants]  = useState<Plant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm,setShowForm]= useState(false);
  const [editing, setEditing] = useState<Plant | null>(null);
  const [saving,  setSaving]  = useState(false);

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<FormData>();

  useEffect(() => { load(); }, []);

  const load = async () => {
    const snap = await getDocs(query(collection(db, 'plants'), orderBy('name')));
    setPlants(snap.docs.map(d => ({ id: d.id, ...d.data() } as Plant)));
    setLoading(false);
  };

  const openCreate = () => { setEditing(null); reset(); setShowForm(true); };
  const openEdit   = (p: Plant) => {
    setEditing(p);
    setValue('name', p.name); setValue('code', p.code); setValue('location', p.location);
    setShowForm(true);
  };

  const save = async (data: FormData) => {
    setSaving(true);
    try {
      if (editing) {
        await updateDoc(doc(db, 'plants', editing.id), { ...data, updatedAt: serverTimestamp() });
        toast.success('Plant updated');
      } else {
        await addDoc(collection(db, 'plants'), {
          ...data, orgId: 'default', adminIds: [], status: 'active',
          createdAt: serverTimestamp()
        });
        toast.success('Plant created');
      }
      setShowForm(false); reset(); load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  const toggleStatus = async (p: Plant) => {
    const next = p.status === 'active' ? 'inactive' : 'active';
    await updateDoc(doc(db, 'plants', p.id), { status: next, updatedAt: serverTimestamp() });
    toast.success(`Plant ${next}`);
    load();
  };

  return (
    <div>
      <PageHeader title="Plants" subtitle={`${plants.length} plants configured`}
        actions={<button className="btn-primary" onClick={openCreate}><Plus className="w-4 h-4" /> New Plant</button>} />

      {loading ? <div className="flex justify-center py-12"><Spinner size="lg" /></div> : (
        <div className="card">
          <Table headers={['Plant', 'Code', 'Location', 'Status', 'Actions']}>
            {plants.map(p => (
              <tr key={p.id}>
                <td><div className="flex items-center gap-2"><Building2 className="w-4 h-4 text-gray-400" /><span className="font-medium">{p.name}</span></div></td>
                <td><code className="text-xs bg-gray-100 px-2 py-0.5 rounded">{p.code}</code></td>
                <td>{p.location}</td>
                <td><StatusBadge status={p.status} /></td>
                <td>
                  <div className="flex gap-2">
                    <button className="btn-ghost btn-sm" onClick={() => openEdit(p)}><Edit2 className="w-3.5 h-3.5" /></button>
                    <button className="btn-ghost btn-sm text-xs" onClick={() => toggleStatus(p)}>
                      {p.status === 'active' ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        </div>
      )}

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editing ? 'Edit Plant' : 'New Plant'} size="sm">
        <form onSubmit={handleSubmit(save)} className="p-5 space-y-4">
          <div>
            <label className="form-label">Plant Name *</label>
            <input className="form-input" {...register('name', { required: 'Required' })} placeholder="e.g. Mumbai Plant" />
            {errors.name && <p className="form-error">{errors.name.message}</p>}
          </div>
          <div>
            <label className="form-label">Plant Code *</label>
            <input className="form-input" {...register('code', { required: 'Required' })} placeholder="e.g. MUM" />
            {errors.code && <p className="form-error">{errors.code.message}</p>}
          </div>
          <div>
            <label className="form-label">Location</label>
            <input className="form-input" {...register('location')} placeholder="City, State" />
          </div>
          <div className="flex gap-2 justify-end pt-2 border-t border-gray-100">
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? <Spinner size="sm" /> : null} {editing ? 'Save' : 'Create'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
