import React, { useEffect, useState } from 'react';
import {
  collection, query, where, getDocs, orderBy, limit, Timestamp
} from 'firebase/firestore';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  RadarChart, PolarGrid, PolarAngleAxis, Radar, LineChart, Line, Legend
} from 'recharts';
import {
  ClipboardList, AlertCircle, CheckCircle, Clock,
  TrendingUp, Building2, Users, Calendar
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { usePlant } from '@/context/PlantContext';
import { StatCard, ScoreBar, StatusBadge, Spinner, EmptyState } from '@/components/ui';
import { PRINCIPLE_NAMES } from '@/types';
import type { Audit, CorrectiveAction, Principle } from '@/types';
import { formatDate, scoreColor } from '@/lib/utils';

export default function DashboardPage() {
  const { role, userProfile } = useAuth();
  const { currentPlant, plants } = usePlant();
  const [audits,  setAudits]  = useState<Audit[]>([]);
  const [actions, setActions] = useState<CorrectiveAction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [currentPlant, userProfile]);

  const loadData = async () => {
    if (!userProfile) return;
    setLoading(true);
    try {
      // Build plant filter
      const plantFilter = currentPlant
        ? [currentPlant.id]
        : role === 'superadmin'
          ? plants.map(p => p.id)
          : userProfile.plantIds;

      if (!plantFilter.length) { setLoading(false); return; }

      // Audits (last 90 days)
      const since = new Date(); since.setDate(since.getDate() - 90);
      const auditQ = query(
        collection(db, 'audits'),
        where('plantId', 'in', plantFilter.slice(0, 10)),
        where('createdAt', '>=', Timestamp.fromDate(since)),
        orderBy('createdAt', 'desc'),
        limit(100)
      );
      const auditSnap = await getDocs(auditQ);
      setAudits(auditSnap.docs.map(d => ({ id: d.id, ...d.data() } as Audit)));

      // Actions
      const actionQ = query(
        collection(db, 'actions'),
        where('plantId', 'in', plantFilter.slice(0, 10)),
        where('status', 'in', ['Open', 'InProgress', 'SubmittedForVerification', 'Overdue']),
        limit(100)
      );
      const actionSnap = await getDocs(actionQ);
      setActions(actionSnap.docs.map(d => ({ id: d.id, ...d.data() } as CorrectiveAction)));
    } finally {
      setLoading(false);
    }
  };

  // ── Derived stats ───────────────────────────────────────────────────────────
  const completed  = audits.filter(a => a.status === 'Approved');
  const pending    = audits.filter(a => ['Draft', 'Submitted', 'UnderReview'].includes(a.status));
  const overdueDue = actions.filter(a => a.status === 'Overdue');
  const openActs   = actions.filter(a => ['Open', 'InProgress'].includes(a.status));

  const avgScore = completed.length
    ? Math.round(completed.reduce((s, a) => s + (a.scores?.overall?.percentage ?? 0), 0) / completed.length)
    : 0;

  // ── Principle radar data ────────────────────────────────────────────────────
  const radarData = ([1, 2, 3, 4, 5] as Principle[]).map(p => {
    const relevant = completed.filter(a => a.scores?.byPrinciple?.[p]);
    const avg = relevant.length
      ? Math.round(relevant.reduce((s, a) => s + (a.scores.byPrinciple[p]?.percentage ?? 0), 0) / relevant.length)
      : 0;
    return { subject: PRINCIPLE_NAMES[p].short, score: avg, fullMark: 100 };
  });

  // ── Trend data (weekly) ─────────────────────────────────────────────────────
  const trendMap: Record<string, { week: string; score: number; count: number }> = {};
  completed.forEach(a => {
    const d = a.approvedAt?.toDate() ?? a.createdAt?.toDate() ?? new Date();
    const wk = `W${getWeek(d)}`;
    if (!trendMap[wk]) trendMap[wk] = { week: wk, score: 0, count: 0 };
    trendMap[wk].score += a.scores?.overall?.percentage ?? 0;
    trendMap[wk].count += 1;
  });
  const trendData = Object.values(trendMap)
    .map(w => ({ ...w, score: Math.round(w.score / w.count) }))
    .slice(-8);

  // ── Plant comparison (superadmin) ───────────────────────────────────────────
  const plantScores = plants.map(pl => {
    const plAudits = completed.filter(a => a.plantId === pl.id);
    const avg = plAudits.length
      ? Math.round(plAudits.reduce((s, a) => s + (a.scores?.overall?.percentage ?? 0), 0) / plAudits.length)
      : 0;
    return { name: pl.code || pl.name.slice(0, 8), score: avg };
  });

  if (loading) return (
    <div className="flex items-center justify-center h-64"><Spinner size="lg" /></div>
  );

  return (
    <div className="space-y-6">
      {/* Page title */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">
          {currentPlant ? currentPlant.name : 'Organization'} Dashboard
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">Last 90 days · {completed.length} audits completed</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Overall Score" value={`${avgScore}%`}
          icon={<TrendingUp className="w-8 h-8" />}
          color={avgScore >= 90 ? 'green' : avgScore >= 75 ? 'blue' : avgScore >= 60 ? 'yellow' : 'red'}
        />
        <StatCard label="Audits Completed" value={completed.length}
          icon={<CheckCircle className="w-8 h-8" />} color="green"
        />
        <StatCard label="Pending Audits" value={pending.length}
          icon={<Clock className="w-8 h-8" />} color="yellow"
        />
        <StatCard label="Open Actions" value={openActs.length}
          sub={`${overdueDue.length} overdue`}
          icon={<AlertCircle className="w-8 h-8" />}
          color={overdueDue.length > 0 ? 'red' : 'blue'}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 5S Radar */}
        <div className="card">
          <div className="card-header"><h3 className="text-sm font-semibold">5S Scores</h3></div>
          <div className="p-4">
            {completed.length === 0 ? (
              <EmptyState title="No audits yet" description="Complete audits to see scores" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke="#e5e7eb" />
                  <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11 }} />
                  <Radar name="Score" dataKey="score" stroke="#2563eb" fill="#2563eb" fillOpacity={0.15} />
                </RadarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Trend */}
        <div className="card lg:col-span-2">
          <div className="card-header"><h3 className="text-sm font-semibold">Score Trend</h3></div>
          <div className="p-4">
            {trendData.length < 2 ? (
              <EmptyState title="Not enough data" description="Need audits across multiple weeks" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => [`${v}%`, 'Score']} />
                  <Line type="monotone" dataKey="score" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Plant comparison — superadmin only */}
      {role === 'superadmin' && plants.length > 1 && (
        <div className="card">
          <div className="card-header"><h3 className="text-sm font-semibold">Plant Comparison</h3></div>
          <div className="p-4">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={plantScores}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => [`${v}%`, 'Score']} />
                <Bar dataKey="score" fill="#2563eb" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Principle breakdown */}
      <div className="card">
        <div className="card-header"><h3 className="text-sm font-semibold">5S Principle Breakdown</h3></div>
        <div className="p-5 space-y-3">
          {([1, 2, 3, 4, 5] as Principle[]).map(p => {
            const d = radarData.find(r => r.subject === PRINCIPLE_NAMES[p].short);
            return (
              <div key={p} className="grid grid-cols-[140px_1fr] items-center gap-4">
                <span className="text-sm font-medium text-gray-700">{PRINCIPLE_NAMES[p].long}</span>
                <ScoreBar value={d?.score ?? 0} max={100} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent audits & actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent audits */}
        <div className="card">
          <div className="card-header">
            <h3 className="text-sm font-semibold">Recent Audits</h3>
          </div>
          <div className="divide-y divide-gray-50">
            {audits.slice(0, 5).map(a => (
              <div key={a.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <div className="text-sm font-medium text-gray-800">{a.templateName}</div>
                  <div className="text-xs text-gray-400">{a.areaName ?? a.deptName ?? a.plantName} · {formatDate(a.createdAt)}</div>
                </div>
                <div className="flex items-center gap-2">
                  {a.scores?.overall?.percentage != null && (
                    <span className={`text-sm font-semibold ${scoreColor(a.scores.overall.percentage)}`}>
                      {Math.round(a.scores.overall.percentage)}%
                    </span>
                  )}
                  <StatusBadge status={a.status} />
                </div>
              </div>
            ))}
            {!audits.length && (
              <div className="px-5 py-8 text-center text-sm text-gray-400">No audits found</div>
            )}
          </div>
        </div>

        {/* Open actions */}
        <div className="card">
          <div className="card-header">
            <h3 className="text-sm font-semibold">Open Actions</h3>
          </div>
          <div className="divide-y divide-gray-50">
            {actions.slice(0, 5).map(a => (
              <div key={a.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <div className="text-sm font-medium text-gray-800 truncate max-w-[200px]">
                    {a.findingDescription}
                  </div>
                  <div className="text-xs text-gray-400">{a.ownerName} · Due {formatDate(a.targetDate)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={a.priority} />
                  <StatusBadge status={a.status} />
                </div>
              </div>
            ))}
            {!actions.length && (
              <div className="px-5 py-8 text-center text-sm text-gray-400">No open actions</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function getWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function scoreColor(pct: number) {
  if (pct >= 90) return 'text-green-600';
  if (pct >= 75) return 'text-blue-600';
  if (pct >= 60) return 'text-yellow-600';
  return 'text-red-600';
}
