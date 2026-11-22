import React, { useEffect, useState } from 'react';
import { collection, getDocs, query, orderBy, where, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useForm } from 'react-hook-form';
import { Plus, Search, Shield, Edit2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { db, fns } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { usePlant } from '@/context/PlantContext';
import { PageHeader, StatusBadge, Table, Spinner, Modal, Alert } from '@/components/ui';
import type { User, UserRole, Plant } from '@/types';

interface InviteFormData {
  name: string; email: string; role: UserRole;
  plantIds: string[]; tempPassword: string;
}

export default function UsersPage() {
  const { role: myRole } = useAuth();
  const { plants }       = usePlant();
  const [users,    setUsers]    = useState<User[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [error,    setError]    = useState('');

  const { register, handleSubmit, reset, formState: { errors } } = useForm<InviteFormData>();

  useEffect(() => { load(); }, []);

  const load = async () => {
    const snap = await getDocs(query(collection(db, 'users'), orderBy('name')));
    setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() } as User)));
    setLoading(false);
  };

  const invite = async (data: InviteFormData) => {
    setInviting(true); setError('');
    try {
      const fn = httpsCallable(fns, 'sendInvitation');
      await fn({ ...data, plantIds: Array.isArray(data.plantIds) ? data.plantIds : [data.plantIds] });
      toast.success(`Invitation sent to ${data.email}`);
      setShowInvite(false); reset(); load();
    } catch (e) { setError((e as Error).message); }
    finally { setInviting(false); }
  };

  const toggleStatus = async (u: User) => {
    const next = u.status === 'active' ? 'inactive' : 'active';
    await updateDoc(doc(db, 'users', u.id), { status: next, updatedAt: serverTimestamp() });
    toast.success(`User ${next}`); load();
  };

  const filtered = users.filter(u =>
    !search || [u.name, u.email, u.role].join(' ').toLowerCase().includes(search.toLowerCase())
  );

  const ROLES: UserRole[] = ['superadmin', 'plant_admin', 'auditor', 'area_owner', 'action_owner', 'viewer'];

  return (
    <div>
      <PageHeader title="Users" subtitle={`${users.length} users`}
        actions={<button className="btn-primary" onClick={() => setShowInvite(true)}><Plus className="w-4 h-4" /> Invite User</button>} />

      <div className="flex gap-2 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input className="form-input pl-9" placeholder="Search users…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {loading ? <div className="flex justify-center py-12"><Spinner size="lg" /></div> : (
        <div className="card">
          <Table headers={['Name', 'Email', 'Role', 'Plants', 'Status', 'Actions']}>
            {filtered.map(u => (
              <tr key={u.id}>
                <td>
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 bg-primary-100 rounded-full flex items-center justify-center text-xs font-bold text-primary-700">
                      {u.name?.charAt(0).toUpperCase()}
                    </div>
                    <span className="font-medium">{u.name}</span>
                  </div>
                </td>
                <td className="text-gray-500">{u.email}</td>
                <td>
                  <span className="flex items-center gap-1 text-xs">
                    {u.role === 'superadmin' && <Shield className="w-3 h-3 text-yellow-500" />}
                    <span className="capitalize">{u.role?.replace('_', ' ')}</span>
                  </span>
                </td>
                <td>
                  <span className="text-xs text-gray-500">
                    {u.plantIds?.length > 0
                      ? plants.filter(p => u.plantIds.includes(p.id)).map(p => p.code || p.name).join(', ') || `${u.plantIds.length} plant(s)`
                      : u.role === 'superadmin' ? 'All' : '—'
                    }
                  </span>
                </td>
                <td><StatusBadge status={u.status} /></td>
                <td>
                  {myRole === 'superadmin' && u.role !== 'superadmin' && (
                    <button className="btn-ghost btn-sm text-xs" onClick={() => toggleStatus(u)}>
                      {u.status === 'active' ? 'Deactivate' : 'Activate'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </div>
      )}

      <Modal open={showInvite} onClose={() => { setShowInvite(false); reset(); setError(''); }} title="Invite User" size="md">
        <form onSubmit={handleSubmit(invite)} className="p-5 space-y-4">
          {error && <Alert type="error">{error}</Alert>}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Full Name *</label>
              <input className="form-input" {...register('name', { required: 'Required' })} />
              {errors.name && <p className="form-error">{errors.name.message}</p>}
            </div>
            <div>
              <label className="form-label">Email *</label>
              <input type="email" className="form-input" {...register('email', { required: 'Required' })} />
              {errors.email && <p className="form-error">{errors.email.message}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Role *</label>
              <select className="form-select" {...register('role', { required: 'Required' })}>
                <option value="">Select role</option>
                {ROLES.filter(r => myRole === 'superadmin' || r !== 'superadmin').map(r => (
                  <option key={r} value={r}>{r.replace('_', ' ')}</option>
                ))}
              </select>
              {errors.role && <p className="form-error">{errors.role.message}</p>}
            </div>
            <div>
              <label className="form-label">Temp Password *</label>
              <input className="form-input" {...register('tempPassword', { required: 'Required', minLength: { value: 8, message: 'Min 8 chars' } })} placeholder="Min 8 characters" />
              {errors.tempPassword && <p className="form-error">{errors.tempPassword.message}</p>}
            </div>
          </div>
          <div>
            <label className="form-label">Assign Plants</label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {plants.map(p => (
                <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" value={p.id} {...register('plantIds')} className="rounded" />
                  {p.name}
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-2 border-t border-gray-100">
            <button type="button" className="btn-secondary" onClick={() => { setShowInvite(false); reset(); }}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={inviting}>
              {inviting ? <Spinner size="sm" /> : null} Send Invitation
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
