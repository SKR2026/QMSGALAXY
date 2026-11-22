import { Timestamp } from 'firebase/firestore';
import { format } from 'date-fns';

export function formatDate(ts: Timestamp | Date | undefined | null, fmt = 'dd MMM yyyy'): string {
  if (!ts) return '—';
  const d = ts instanceof Timestamp ? ts.toDate() : ts;
  return format(d, fmt);
}

export function formatDateTime(ts: Timestamp | Date | undefined | null): string {
  return formatDate(ts, 'dd MMM yyyy, HH:mm');
}

export function isOverdue(ts: Timestamp | Date | undefined | null): boolean {
  if (!ts) return false;
  const d = ts instanceof Timestamp ? ts.toDate() : ts;
  return d < new Date();
}

export function scoreColor(pct: number): string {
  if (pct >= 90) return 'text-green-600';
  if (pct >= 75) return 'text-blue-600';
  if (pct >= 60) return 'text-yellow-600';
  return 'text-red-600';
}

export function scoreLabel(pct: number): string {
  if (pct >= 90) return 'Excellent';
  if (pct >= 75) return 'Good';
  if (pct >= 60) return 'Fair';
  return 'Poor';
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

export function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function truncate(s: string, len = 40): string {
  return s.length > len ? s.slice(0, len) + '…' : s;
}

/** Calculate audit scores from responses */
export function calculateScores(
  responses: Array<{ itemId: string; categoryId: string; principle: number; score: number; maxScore: number }>,
  categories: Array<{ id: string; principle: number; items: Array<{ id: string; maxScore: number; weightage: number }>; weightage: number }>
) {
  const byCategory: Record<string, { score: number; maxScore: number; percentage: number }> = {};
  const byPrinciple: Record<number, { score: number; maxScore: number; percentage: number }> = {};

  for (const cat of categories) {
    let catScore = 0; let catMax = 0;
    for (const item of cat.items) {
      const resp = responses.find(r => r.itemId === item.id);
      const s = resp?.score ?? 0;
      const m = item.maxScore;
      catScore += s; catMax += m;
    }
    byCategory[cat.id] = {
      score: catScore, maxScore: catMax,
      percentage: catMax > 0 ? Math.round((catScore / catMax) * 100) : 0
    };

    const p = cat.principle;
    if (!byPrinciple[p]) byPrinciple[p] = { score: 0, maxScore: 0, percentage: 0 };
    byPrinciple[p].score    += catScore;
    byPrinciple[p].maxScore += catMax;
  }

  for (const p of Object.keys(byPrinciple)) {
    const pp = byPrinciple[Number(p)];
    pp.percentage = pp.maxScore > 0 ? Math.round((pp.score / pp.maxScore) * 100) : 0;
  }

  const totalScore  = Object.values(byCategory).reduce((s, c) => s + c.score, 0);
  const totalMax    = Object.values(byCategory).reduce((s, c) => s + c.maxScore, 0);
  const overallPct  = totalMax > 0 ? Math.round((totalScore / totalMax) * 100) : 0;

  return {
    byCategory,
    byPrinciple: byPrinciple as Record<1 | 2 | 3 | 4 | 5, { score: number; maxScore: number; percentage: number }>,
    overall: { score: totalScore, maxScore: totalMax, percentage: overallPct }
  };
}

export function exportToCsv(filename: string, rows: string[][], headers: string[]) {
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename + '.csv'; a.click();
  URL.revokeObjectURL(url);
}
