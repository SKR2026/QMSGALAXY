import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { Search, ClipboardList } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { usePlant } from '@/context/PlantContext';
import { PageHeader, StatusBadge, Table, Spinner, EmptyState, Pagination, ScoreBar } from '@/components/ui';
import { formatDate } from '@/lib/utils';
import type { Audit } from '@/types';

const PER_PAGE = 20;

export default function AuditsPage() {
  const navigate  = useNavigate();
  const { userProfile, role } = useAuth();
  const { currentPlant, plants } = usePlant();
  const [audits,  setAudits]  = useState<Audit[]>([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');
  const [statusF, setStatusF] = useState('');
  const [page,    setPage]    = useState(1);

  useEffect(() => { load(); }, [currentPlant, userProfile]);

  const load = async () => {
    if (!userProfile) return;
    setLoading(true);
    try {
      const plantFilter = currentPlant ? [currentPlant.id]
        : role === 'superadmin' ? plants.map(p => p.id) : userProfile.plantIds;
      if (!plantFilter.length) { setLoading(false); return; }

      let q = query(
        collection(db, 'audits'),
        where('plantId', 'in', plantFilter.slice(0, 10)),
        orderBy('createdAt', 'desc'), limit(200)
      );

      // Auditors only see their own
      if (role === 'auditor') {
        q = query(
          collection(db, 'audits'),
          where('auditorId', '==', userProfile.id),
          orderBy('createdAt', 'desc'), limit(200)
        );
      }

      const snap = await getDocs(q);
      setAudits(snap.docs.map(d => ({ id: d.id, ...d.data() } as Audit)));
    } finally { setLoading(false); }
  };

  const filtered = audits.filter(a => {
    if (statusF && a.status !== statusF) return false;
    if (search) {
      const s = search.toLowerCase();
      if (![a.templateName, a.auditorName, a.areaName ?? '', a.plantName].join(' ').toLowerCase().includes(s)) return false;
    }
    return true;
  });

  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  return (
    <div>
      <PageHeader title="Audits" subtitle={`${audits.length} total`} />

      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input className="form-input pl-9" placeholder="Search audits…" value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <select className="form-select w-auto" value={statusF} onChange={e => { setStatusF(e.target.value); setPage(1); }}>
          <option value="">All Statuses</option>
          {['Draft','Submitted','UnderReview','Approved','Reopened'].map(s =>
            <option key={s} value={s}>{s}</option>
          )}
        </select>
      </div>

      {loading ? <div className="flex justify-center py-12"><Spinner size="lg" /></div> : (
        <div className="card">
          <Table headers={['Audit', 'Area', 'Auditor', 'Score', 'Date', 'Status', '']}>
            {paginated.map(a => (
              <tr key={a.id} className="cursor-pointer" onClick={() => navigate(`/app/audits/${a.id}`)}>
                <td>
                  <div className="font-medium">{a.templateName}</div>
                  <div className="text-xs text-gray-400">{a.plantName}</div>
                </td>
                <td className="text-gray-500">{a.areaName ?? a.deptName ?? '—'}</td>
                <td className="text-gray-500">{a.auditorName}</td>
                <td className="min-w-[120px]">
                  {a.scores?.overall?.percentage != null
                    ? <ScoreBar value={a.scores.overall.score} max={a.scores.overall.maxScore} size="sm" />
                    : <span className="text-gray-300 text-xs">Not scored</span>
                  }
                </td>
                <td className="text-gray-500 text-xs">{formatDate(a.createdAt)}</td>
                <td><StatusBadge status={a.status} /></td>
                <td>
                  {a.status === 'Draft' && (
                    <button className="btn-primary btn-sm" onClick={e => { e.stopPropagation(); navigate(`/app/audits/${a.id}/conduct`); }}>
                      Continue
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!paginated.length && (
              <tr><td colSpan={7}>
                <EmptyState icon={<ClipboardList className="w-12 h-12" />} title="No audits found" description="Audits appear here after being started from a schedule." />
              </td></tr>
            )}
          </Table>
          <Pagination page={page} total={filtered.length} perPage={PER_PAGE} onChange={setPage} />
        </div>
      )}
    </div>
  );
}
