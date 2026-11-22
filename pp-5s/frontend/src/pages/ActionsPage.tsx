import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  collection, query, where, getDocs, addDoc,
  orderBy, serverTimestamp, Timestamp, limit
} from 'firebase/firestore';
import { useForm } from 'react-hook-form';
import { Plus, Filter, Search, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { usePlant } from '@/context/PlantContext';
import {
  PageHeader, StatusBadge, Table, Spinner,
  EmptyState, Modal, Pagination
} from '@/components/ui';
import { formatDate, isOverdue } from '@/lib/utils';
import type { CorrectiveAction, ActionPriority, ActionStatus, User, Area } from '@/types';

const PER_PAGE = 20;

interface ActionFormData {
  findingDescription: string;
  ownerId: string;
  reviewerId: string;
  priority: ActionPriority;
  targetDate: string;
  areaId: string;
}

export default function ActionsPage() {
  const navigate = useNavigate();
  const { userProfile, role } = useAuth();
  const { currentPlant, plants } = usePlant();

  const [actions,  setActions]  = useState<CorrectiveAction[]>([]);
  const [users,    setUsers]    = useState<User[]>([]);
  const [areas,    setAreas]    = useState<Area[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [search,   setSearch]   = useState('');
  const [statusF,  setStatusF]  = useState('');
  const [priorityF,setPriorityF]= useState('');
  const [page,     setPage]     = useState(1);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<ActionFormData>();

  useEffect(() => { loadData(); }, [currentPlant, userProfile]);

  const loadData = async () => {
    if (!userProfile) return;
    setLoading(true);
    try {
      const plantFilter = currentPlant
        ? [currentPlant.id]
        : role === 'superadmin' ? plants.map(p => p.id) : userProfile.plantIds;
      if (!plantFilter.length) { setLoading(false); return; }

      const q = query(
        collection(db, 'actions'),
        where('plantId', 'in', plantFilter.slice(0, 10)),
        orderBy('createdAt', 'desc'),
        limit(200)
      );
      const snap = await getDocs(q);
      setActions(snap.docs.map(d => ({ id: d.id, ...d.data() } as CorrectiveAction)));

      // Load users for dropdown
      const usersSnap = await getDocs(query(
        collection(db, 'users'),
        where('plantIds', 'array-contains-any', plantFilter.slice(0, 10))
      ));
      setUsers(usersSnap.docs.map(d => ({ id: d.id, ...d.data() } as User)));

      // Load areas
      const areasSnap = await getDocs(query(
        collection(db, 'areas'),
        where('plantId', 'in', plantFilter.slice(0, 10))
      ));
      setAreas(areasSnap.docs.map(d => ({ id: d.id, ...d.data() } as Area)));
    } finally { setLoading(false); }
  };

  const createAction = async (data: ActionFormData) => {
    if (!userProfile) return;
    const plantId = currentPlant?.id ?? userProfile.plantIds[0];
    if (!plantId) { toast.error('Select a plant first'); return; }
    setCreating(true);
    try {
      const owner = users.find(u => u.id === data.ownerId);
      const reviewer = users.find(u => u.id === data.reviewerId);
      const area = areas.find(a => a.id === data.areaId);
      await addDoc(collection(db, 'actions'), {
        plantId,
        findingDescription: data.findingDescription,
        ownerId:     data.ownerId,
        ownerName:   owner?.name ?? '',
        reviewerId:  data.reviewerId || null,
        reviewerName:reviewer?.name ?? '',
        priority:    data.priority,
        targetDate:  Timestamp.fromDate(new Date(data.targetDate)),
        areaId:      data.areaId || null,
        areaName:    area?.name ?? '',
        status:      'Open' as ActionStatus,
        evidenceUrls:[],
        history: [{ status: 'Open', by: userProfile.id, byName: userProfile.name, at: serverTimestamp(), comment: 'Action created' }],
        createdBy:   userProfile.id,
        createdAt:   serverTimestamp(),
        updatedAt:   serverTimestamp(),
      });
      toast.success('Action created');
      reset(); setShowForm(false); loadData();
    } catch (e) { toast.error('Failed: ' + (e as Error).message); }
    finally { setCreating(false); }
  };

  // Filtered list
  const filtered = actions.filter(a => {
    if (statusF   && a.status !== statusF) return false;
    if (priorityF && a.priority !== priorityF) return false;
    if (search) {
      const s = search.toLowerCase();
      if (![a.findingDescription, a.ownerName, a.areaName ?? ''].join(' ').toLowerCase().includes(s)) return false;
    }
    return true;
  });

  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const overdueCount = actions.filter(a => isOverdue(a.targetDate) && !['Verified', 'Cancelled'].includes(a.status)).length;

  return (
    <div>
      <PageHeader
        title="Corrective Actions"
        subtitle={`${actions.length} total${overdueCount > 0 ? ` · ${overdueCount} overdue` : ''}`}
        actions={
          <button className="btn-primary" onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4" /> New Action
          </button>
        }
      />

      {overdueCount > 0 && (
        <div className="mb-4 flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4" />
          <strong>{overdueCount} overdue action{overdueCount > 1 ? 's' : ''}</strong> require immediate attention.
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search actions…" value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="form-input pl-9" />
        </div>
        <select value={statusF} onChange={e => { setStatusF(e.target.value); setPage(1); }} className="form-select w-auto">
          <option value="">All Statuses</option>
          {['Open','InProgress','SubmittedForVerification','Verified','Rejected','Overdue','Cancelled'].map(s =>
            <option key={s} value={s}>{s}</option>
          )}
        </select>
        <select value={priorityF} onChange={e => { setPriorityF(e.target.value); setPage(1); }} className="form-select w-auto">
          <option value="">All Priorities</option>
          {['Critical','High','Medium','Low'].map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : (
        <div className="card">
          <Table headers={['Finding', 'Area', 'Owner', 'Priority', 'Target Date', 'Status']}>
            {paginated.map(a => (
              <tr key={a.id} className="cursor-pointer hover:bg-gray-50" onClick={() => navigate(`/app/actions/${a.id}`)}>
                <td>
                  <div className="font-medium text-gray-800 max-w-xs truncate">{a.findingDescription}</div>
                </td>
                <td className="text-gray-500">{a.areaName ?? '—'}</td>
                <td className="text-gray-700">{a.ownerName}</td>
                <td><StatusBadge status={a.priority} /></td>
                <td>
                  <span className={isOverdue(a.targetDate) && !['Verified','Cancelled'].includes(a.status) ? 'text-red-600 font-medium' : 'text-gray-600'}>
                    {formatDate(a.targetDate)}
                  </span>
                </td>
                <td><StatusBadge status={a.status} /></td>
              </tr>
            ))}
            {!paginated.length && (
              <tr><td colSpan={6}>
                <EmptyState title="No actions found" description="Try adjusting filters or create a new action." />
              </td></tr>
            )}
          </Table>
          <Pagination page={page} total={filtered.length} perPage={PER_PAGE} onChange={setPage} />
        </div>
      )}

      {/* Create action modal */}
      <Modal open={showForm} onClose={() => { setShowForm(false); reset(); }} title="New Corrective Action" size="md">
        <form onSubmit={handleSubmit(createAction)} className="p-5 space-y-4">
          <div>
            <label className="form-label">Finding / Observation *</label>
            <textarea className="form-textarea"
              {...register('findingDescription', { required: 'Required' })}
              placeholder="Describe the finding or non-conformance" />
            {errors.findingDescription && <p className="form-error">{errors.findingDescription.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Action Owner *</label>
              <select className="form-select" {...register('ownerId', { required: 'Required' })}>
                <option value="">Select owner</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              {errors.ownerId && <p className="form-error">{errors.ownerId.message}</p>}
            </div>
            <div>
              <label className="form-label">Reviewer</label>
              <select className="form-select" {...register('reviewerId')}>
                <option value="">None</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Priority *</label>
              <select className="form-select" {...register('priority', { required: 'Required' })}>
                <option value="">Select</option>
                {['Critical','High','Medium','Low'].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              {errors.priority && <p className="form-error">{errors.priority.message}</p>}
            </div>
            <div>
              <label className="form-label">Target Date *</label>
              <input type="date" className="form-input"
                min={new Date().toISOString().split('T')[0]}
                {...register('targetDate', { required: 'Required' })} />
              {errors.targetDate && <p className="form-error">{errors.targetDate.message}</p>}
            </div>
          </div>

          <div>
            <label className="form-label">Area</label>
            <select className="form-select" {...register('areaId')}>
              <option value="">Select area (optional)</option>
              {areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>

          <div className="flex gap-2 justify-end pt-2 border-t border-gray-100">
            <button type="button" className="btn-secondary" onClick={() => { setShowForm(false); reset(); }}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={creating}>
              {creating ? <Spinner size="sm" /> : null}
              Create Action
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
