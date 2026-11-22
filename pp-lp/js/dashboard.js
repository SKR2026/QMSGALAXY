/**
 * dashboard.js
 * Dashboard KPI cards, charts, and plant overview table.
 */

let dashCharts = {};

async function loadDashboard() {
  const days    = parseInt(document.getElementById('dashDateFilter')?.value || 30);
  const plantId = getActivePlantId();
  const user    = window.currentUser;
  if (!user) return;

  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - days);
  const fromTs = firebase.firestore.Timestamp.fromDate(fromDate);

  try {
    // ── Audits KPIs ───────────────────────────────────────
    // NOTE: The compound query needs orderBy('createdAt','desc') so that Firestore uses
    // the existing [plantId ASC, createdAt DESC] composite index rather than the implicit
    // ASC direction that mismatches it and causes a missing-index / permission error.
    let auditQuery = col('audits').where('createdAt', '>=', fromTs).orderBy('createdAt', 'desc');
    if (plantId) auditQuery = auditQuery.where('plantId', '==', plantId);
    else if (user.role !== ROLES.SUPER_ADMIN) auditQuery = auditQuery.where('plantId', '==', user.plantId);

    const auditSnap = await auditQuery.get();
    const audits    = auditSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const total     = audits.length;
    const completed = audits.filter(a => ['Verified','Closed'].includes(a.status)).length;
    const pending   = audits.filter(a => ['Planned','Assigned','In Progress'].includes(a.status)).length;
    const overdue   = audits.filter(a => a.status === 'Overdue').length;
    const scores    = audits.filter(a => a.score !== null && a.score !== undefined).map(a => a.score);
    const avgScore  = scores.length ? (scores.reduce((s,v) => s+v, 0) / scores.length) : null;

    setKpi('kpiTotal',     total);
    setKpi('kpiCompleted', completed);
    setKpi('kpiPending',   pending);
    setKpi('kpiOverdue',   overdue);
    setKpi('kpiAvgScore',  avgScore !== null ? avgScore.toFixed(1) + '%' : '—');

    // ── Findings / Actions KPIs ───────────────────────────
    let findQuery = col('findings').where('createdAt', '>=', fromTs).orderBy('createdAt', 'desc');
    if (plantId) findQuery = findQuery.where('plantId', '==', plantId);
    else if (user.role !== ROLES.SUPER_ADMIN) findQuery = findQuery.where('plantId', '==', user.plantId);

    const findSnap     = await findQuery.get();
    const findings     = findSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const openFindings = findings.filter(f => !['Closed','Verified'].includes(f.status)).length;
    const closedFind   = findings.filter(f => ['Closed','Verified'].includes(f.status)).length;
    const closureRate  = findings.length ? ((closedFind / findings.length) * 100).toFixed(1) + '%' : '—';

    let actionQuery = col('correctiveActions').where('createdAt', '>=', fromTs).orderBy('createdAt', 'desc');
    if (plantId) actionQuery = actionQuery.where('plantId', '==', plantId);
    else if (user.role !== ROLES.SUPER_ADMIN) actionQuery = actionQuery.where('plantId', '==', user.plantId);

    const actionSnap    = await actionQuery.get();
    const actions       = actionSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const overdueActions = actions.filter(a => a.status === 'Overdue' || (a.status !== 'Closed' && a.status !== 'Verified' && isOverdue(a.targetDate))).length;

    setKpi('kpiOpenFindings',   openFindings);
    setKpi('kpiOverdueActions', overdueActions);
    setKpi('kpiClosureRate',    closureRate);

    // ── Plant Performance Table (Super Admin) ─────────────
    if (user.role === ROLES.SUPER_ADMIN && !plantId) {
      await loadPlantPerformanceTable(fromTs);
      document.getElementById('plantSummaryTable')?.classList.remove('hidden');
    } else {
      document.getElementById('plantSummaryTable')?.classList.add('hidden');
    }

    // ── Charts ────────────────────────────────────────────
    renderScoreTrendChart(audits);
    renderFindingsCritChart(findings);
    renderDeptPerfChart(audits);
    renderActionStatusChart(actions);

  } catch (e) {
    console.error('[Dashboard] Error:', e);
    showToast('Dashboard error: ' + friendlyFirebaseError(e), 'error');
  }
}

function setKpi(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? '—';
}

/* ── Plant Performance Table ─────────────────────────────── */
async function loadPlantPerformanceTable(fromTs) {
  const tbody = document.getElementById('plantPerfBody');
  if (!tbody) return;

  try {
    // Use fetchSorted to avoid orderBy-related index issues on the plants collection
    const plantDocs = await fetchSorted(col('plants').where('status', '==', 'active'), 'name');
    const plants = plantDocs.map(d => ({ id: d.id, ...d.data() }));

    if (plants.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="table-empty">No plants configured.</td></tr>';
      return;
    }

    // Load aggregate data for each plant in parallel.
    // IMPORTANT: avoid 'not-in' queries — they require a special composite index and
    // behave inconsistently with security-rule list checks. Instead, fetch all actions
    // for the plant and filter open/overdue client-side.
    const rows = await Promise.all(plants.map(async plant => {
      const [auditSnap, actionSnap] = await Promise.all([
        col('audits').where('plantId', '==', plant.id)
          .where('createdAt', '>=', fromTs).orderBy('createdAt', 'desc').get(),
        col('correctiveActions').where('plantId', '==', plant.id)
          .orderBy('createdAt', 'desc').get()
      ]);

      const audits   = auditSnap.docs.map(d => d.data());
      const planned  = audits.filter(a => a.status !== 'Cancelled').length;
      const completed= audits.filter(a => ['Verified','Closed','Submitted'].includes(a.status)).length;
      const compPct  = planned ? ((completed / planned) * 100).toFixed(0) + '%' : '—';
      const scores   = audits.filter(a => a.score != null).map(a => a.score);
      const avgScore = scores.length ? (scores.reduce((s,v) => s+v, 0) / scores.length).toFixed(1) + '%' : '—';
      // Filter open actions client-side — avoids the not-in query
      const allActions = actionSnap.docs.map(d => d.data());
      const openActs = allActions.filter(a => !['Closed','Verified'].includes(a.status)).length;
      const overdueA = allActions.filter(a => !['Closed','Verified'].includes(a.status) && isOverdue(a.targetDate)).length;

      return { plant, planned, completed, compPct, avgScore, openActs, overdueA };
    }));

    tbody.innerHTML = rows.map(r => `
      <tr>
        <td class="fw-600">${escapeHtml(r.plant.name)}</td>
        <td>${r.planned}</td>
        <td>${r.completed}</td>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            ${r.compPct}
            <div style="flex:1;height:4px;background:var(--color-border);border-radius:2px;min-width:60px">
              <div style="height:100%;background:var(--color-primary);border-radius:2px;width:${r.compPct === '—' ? '0%' : r.compPct}"></div>
            </div>
          </div>
        </td>
        <td>${r.avgScore === '—' ? '—' : getScoreBadge(parseFloat(r.avgScore))}</td>
        <td>${r.openActs}</td>
        <td>${r.overdueA > 0 ? `<span style="color:var(--color-danger);font-weight:600">${r.overdueA}</span>` : '0'}</td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick="onPlantSelectorChange('${r.plant.id}');navigate('dashboard')">
            View →
          </button>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="8" class="table-empty">Could not load plant data.</td></tr>';
    console.error('[Dashboard] Plant table error:', e);
  }
}

/* ── Charts ──────────────────────────────────────────────── */
function renderScoreTrendChart(audits) {
  const canvas = document.getElementById('scoreTrendChart');
  if (!canvas) return;

  if (dashCharts.scoreTrend) dashCharts.scoreTrend.destroy();

  // Group by week
  const weekMap = {};
  audits.forEach(a => {
    if (a.score == null) return;
    const d = a.actualDate || (a.plannedDate);
    if (!d) return;
    const week = getWeekLabel(d);
    if (!weekMap[week]) weekMap[week] = [];
    weekMap[week].push(a.score);
  });

  const labels = Object.keys(weekMap).sort();
  const data   = labels.map(w => {
    const arr = weekMap[w];
    return parseFloat((arr.reduce((s,v) => s+v, 0) / arr.length).toFixed(1));
  });

  dashCharts.scoreTrend = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Avg Score %',
        data,
        borderColor: '#1a56db',
        backgroundColor: 'rgba(26,86,219,.08)',
        tension: .4,
        fill: true,
        pointBackgroundColor: '#1a56db',
        pointRadius: 3
      }]
    },
    options: chartDefaults({ yMax: 100, yMin: 60, yLabel: 'Score %' })
  });
}

function renderFindingsCritChart(findings) {
  const canvas = document.getElementById('findingsCritChart');
  if (!canvas) return;

  if (dashCharts.findingsCrit) dashCharts.findingsCrit.destroy();

  const counts = { Critical: 0, Major: 0, Minor: 0 };
  findings.forEach(f => { if (counts[f.criticality] !== undefined) counts[f.criticality]++; });

  dashCharts.findingsCrit = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: Object.keys(counts),
      datasets: [{
        data: Object.values(counts),
        backgroundColor: ['#dc2626', '#ea580c', '#d97706'],
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
  });
}

function renderDeptPerfChart(audits) {
  const canvas = document.getElementById('deptPerfChart');
  if (!canvas) return;

  if (dashCharts.deptPerf) dashCharts.deptPerf.destroy();

  const deptMap = {};
  audits.forEach(a => {
    if (a.score == null) return;
    const dept = a.departmentName || 'Unknown';
    if (!deptMap[dept]) deptMap[dept] = [];
    deptMap[dept].push(a.score);
  });

  const labels = Object.keys(deptMap).slice(0, 8);
  const data   = labels.map(d => parseFloat((deptMap[d].reduce((s,v)=>s+v,0)/deptMap[d].length).toFixed(1)));

  dashCharts.deptPerf = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Avg Score %',
        data,
        backgroundColor: data.map(v => v >= 95 ? '#059669' : v >= 90 ? '#d97706' : '#dc2626'),
        borderRadius: 4
      }]
    },
    options: chartDefaults({ yMax: 100, yMin: 60, yLabel: 'Score %', indexAxis: 'y' })
  });
}

function renderActionStatusChart(actions) {
  const canvas = document.getElementById('actionStatusChart');
  if (!canvas) return;

  if (dashCharts.actionStatus) dashCharts.actionStatus.destroy();

  const counts = { Open: 0, 'In Progress': 0, Submitted: 0, Verified: 0, Closed: 0, Overdue: 0 };
  actions.forEach(a => { if (counts[a.status] !== undefined) counts[a.status]++; else counts.Open++; });

  dashCharts.actionStatus = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: Object.keys(counts),
      datasets: [{
        label: 'Actions',
        data: Object.values(counts),
        backgroundColor: ['#dc2626','#d97706','#1a56db','#059669','#6b7280','#991b1b'],
        borderRadius: 4
      }]
    },
    options: chartDefaults({ yLabel: 'Count' })
  });
}

function chartDefaults({ yMax, yMin, yLabel, indexAxis } = {}) {
  return {
    responsive: true,
    indexAxis: indexAxis || 'x',
    plugins: {
      legend: { display: false }
    },
    scales: {
      y: {
        max: yMax,
        min: yMin,
        title: { display: !!yLabel, text: yLabel, color: '#9ca3af', font: { size: 11 } },
        grid: { color: 'rgba(0,0,0,.05)' },
        ticks: { color: '#9ca3af', font: { size: 11 } }
      },
      x: {
        grid: { display: false },
        ticks: { color: '#9ca3af', font: { size: 11 } }
      }
    }
  };
}

function getWeekLabel(dateStr) {
  const d = new Date(dateStr);
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return `W${week}`;
}
