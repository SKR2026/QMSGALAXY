/**
 * reports.js
 * Report generation (CSV/print), management review,
 * calendar, activity log, and settings.
 */

/* ══════════════════════════════════════════════════════════
   REPORTS
══════════════════════════════════════════════════════════ */
async function initReports() {
  // Reports view is mostly static — filters are already rendered in HTML
  await populatePlantOptions(document.getElementById('rptPlant'), true);
}

async function generateReport(type, format = 'csv') {
  requirePermission('view_reports');

  showLoading('Generating report…');

  const plantId   = document.getElementById('rptPlant')?.value || getActivePlantId();
  const dateFrom  = document.getElementById('rptDateFrom')?.value;
  const dateTo    = document.getElementById('rptDateTo')?.value;

  try {
    let data = [];
    let filename = `lpa_${type}_${todayISO()}`;

    switch (type) {
      case 'audit': {
        let q = col('audits');
        if (plantId) q = q.where('plantId', '==', plantId);
        else if (window.currentUser.role !== ROLES.SUPER_ADMIN) q = q.where('plantId', '==', window.currentUser.plantId);
        if (dateFrom) q = q.where('plannedDate', '>=', dateFrom);
        if (dateTo)   q = q.where('plannedDate', '<=', dateTo);
        const snap = await q.orderBy('plannedDate', 'desc').limit(1000).get();
        data = snap.docs.map(d => {
          const a = d.data();
          return { ID: a.id, Plant: a.plantName, Department: a.departmentName, Process: a.processName,
                   Level: a.levelNumber, Auditor: a.auditorName, PlannedDate: a.plannedDate,
                   ActualDate: a.actualDate||'', Score: a.score||'', Result: a.result||'', Status: a.status };
        });
        break;
      }
      case 'findings': {
        let q = col('findings');
        if (plantId) q = q.where('plantId', '==', plantId);
        else if (window.currentUser.role !== ROLES.SUPER_ADMIN) q = q.where('plantId', '==', window.currentUser.plantId);
        const snap = await q.orderBy('createdAt', 'desc').limit(1000).get();
        data = snap.docs.map(d => {
          const f = d.data();
          return { ID: f.id, AuditID: f.auditId, Plant: f.plantName, Department: f.departmentName,
                   Criticality: f.criticality, Description: f.description, Responsible: f.responsible,
                   TargetDate: f.targetDate, Status: f.status };
        });
        break;
      }
      case 'actions': {
        let q = col('correctiveActions');
        if (plantId) q = q.where('plantId', '==', plantId);
        else if (window.currentUser.role !== ROLES.SUPER_ADMIN) q = q.where('plantId', '==', window.currentUser.plantId);
        const snap = await q.orderBy('createdAt', 'desc').limit(1000).get();
        data = snap.docs.map(d => {
          const a = d.data();
          return { ID: a.id, FindingID: a.findingId, Plant: a.plantName, Process: a.processName,
                   Description: a.description, Responsible: a.responsible,
                   TargetDate: a.targetDate, Priority: a.priority, Status: a.status,
                   RootCause: a.rootCause, CorrectiveAction: a.correctiveAction };
        });
        break;
      }
      case 'overdue': {
        let q = col('correctiveActions').where('status', 'not-in', ['Closed','Verified']);
        if (plantId) q = q.where('plantId', '==', plantId);
        const snap = await q.get();
        data = snap.docs
          .filter(d => isOverdue(d.data().targetDate))
          .map(d => {
            const a = d.data();
            const days = Math.abs(daysUntil(a.targetDate) || 0);
            return { ID: a.id, Plant: a.plantName, Responsible: a.responsible,
                     TargetDate: a.targetDate, DaysOverdue: days, Priority: a.priority, Status: a.status };
          });
        break;
      }
    }

    hideLoading();

    if (data.length === 0) {
      showToast('No data found for the selected filters.', 'warning');
      return;
    }

    if (format === 'csv') {
      downloadCSV(data, filename + '.csv');
      showToast(`${data.length} records exported to CSV`, 'success');
    } else if (format === 'pdf') {
      printTableReport(type, data);
    }

  } catch (e) {
    hideLoading();
    showToast(friendlyFirebaseError(e), 'error');
  }
}

function downloadCSV(rows, filename) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csvContent = [
    headers.join(','),
    ...rows.map(row => headers.map(h => {
      const val = String(row[h] ?? '').replace(/"/g, '""');
      return val.includes(',') || val.includes('"') || val.includes('\n') ? `"${val}"` : val;
    }).join(','))
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function printTableReport(type, data) {
  const title = { audit: 'Audit Report', findings: 'Findings Report', actions: 'Corrective Action Report', overdue: 'Overdue Actions Report' }[type] || 'Report';
  const headers = data.length ? Object.keys(data[0]) : [];

  const html = `
<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title>
<style>body{font-family:Arial,sans-serif;font-size:11px}h2{color:#0f1f3d}
table{width:100%;border-collapse:collapse}th{background:#0f1f3d;color:#fff;padding:6px;text-align:left;font-size:10px}
td{padding:5px 6px;border-bottom:1px solid #eee;font-size:11px}
p.meta{color:#666;font-size:10px}@media print{body{margin:0}}</style>
</head><body>
<h2>${title}</h2>
<p class="meta">Generated: ${new Date().toLocaleString('en-IN')} | LPA Management System | Records: ${data.length}</p>
<table>
<thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead>
<tbody>${data.map(row=>`<tr>${headers.map(h=>`<td>${escapeHtml(String(row[h]??''))}</td>`).join('')}</tr>`).join('')}</tbody>
</table>
</body></html>`;

  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
  win.print();
}

/* ══════════════════════════════════════════════════════════
   MANAGEMENT REVIEW
══════════════════════════════════════════════════════════ */
async function loadMgmtReview() {
  const period = document.getElementById('mgmtPeriod')?.value || 'month';
  const now    = new Date();
  let fromDate;

  switch (period) {
    case 'month':   fromDate = new Date(now.getFullYear(), now.getMonth(), 1); break;
    case 'quarter': fromDate = new Date(now.getFullYear(), Math.floor(now.getMonth()/3)*3, 1); break;
    case 'year':    fromDate = new Date(now.getFullYear(), 0, 1); break;
    default:        fromDate = new Date(now.setMonth(now.getMonth() - 1));
  }

  const fromTs  = firebase.firestore.Timestamp.fromDate(fromDate);
  const plantId = getActivePlantId();
  const user    = window.currentUser;

  try {
    let auditQuery = col('audits').where('createdAt', '>=', fromTs);
    if (plantId) auditQuery = auditQuery.where('plantId', '==', plantId);
    else if (user.role !== ROLES.SUPER_ADMIN) auditQuery = auditQuery.where('plantId', '==', user.plantId);

    const auditSnap = await auditQuery.get();
    const audits    = auditSnap.docs.map(d => d.data());

    const total     = audits.length;
    const completed = audits.filter(a => !['Planned','Assigned'].includes(a.status)).length;
    const compPct   = total ? ((completed / total) * 100).toFixed(1) : 0;
    const scores    = audits.filter(a => a.score != null).map(a => a.score);
    const avgScore  = scores.length ? (scores.reduce((s,v)=>s+v,0)/scores.length).toFixed(1) : '—';

    let findQuery = col('findings').where('createdAt', '>=', fromTs);
    if (plantId) findQuery = findQuery.where('plantId', '==', plantId);
    else if (user.role !== ROLES.SUPER_ADMIN) findQuery = findQuery.where('plantId', '==', user.plantId);
    const findSnap   = await findQuery.get();
    const findings   = findSnap.docs.map(d => d.data());
    const criticalF  = findings.filter(f => f.criticality === 'Critical').length;
    const closedF    = findings.filter(f => ['Closed','Verified'].includes(f.status)).length;
    const closureRate= findings.length ? ((closedF/findings.length)*100).toFixed(1) : 0;

    const kpiGrid = document.getElementById('mgmtKpiGrid');
    if (kpiGrid) {
      kpiGrid.innerHTML = `
        <div class="kpi-card"><div class="kpi-icon kpi-blue"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/></svg></div>
          <div class="kpi-body"><div class="kpi-value">${compPct}%</div><div class="kpi-label">Audit Compliance</div></div></div>
        <div class="kpi-card"><div class="kpi-icon kpi-green"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></div>
          <div class="kpi-body"><div class="kpi-value">${avgScore}%</div><div class="kpi-label">Average Score</div></div></div>
        <div class="kpi-card"><div class="kpi-icon kpi-red"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/></svg></div>
          <div class="kpi-body"><div class="kpi-value">${criticalF}</div><div class="kpi-label">Critical Findings</div></div></div>
        <div class="kpi-card"><div class="kpi-icon kpi-teal"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.21 15.89A10 10 0 118 2.83"/></svg></div>
          <div class="kpi-body"><div class="kpi-value">${closureRate}%</div><div class="kpi-label">Finding Closure Rate</div></div></div>
      `;
    }

  } catch (e) {
    showToast(friendlyFirebaseError(e), 'error');
  }
}

/* ══════════════════════════════════════════════════════════
   ACTIVITY LOG
══════════════════════════════════════════════════════════ */
async function loadActivityLog() {
  requirePermission('view_activity_log');

  const tbody   = document.getElementById('activityLogBody');
  const countEl = document.getElementById('logCount');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Loading…</td></tr>';

  try {
    let query = col('activityLogs');

    const typeF = document.getElementById('logTypeFilter')?.value;
    if (typeF) query = query.where('type', '==', typeF);

    const dateF = document.getElementById('logDateFilter')?.value;
    if (dateF) {
      const start = firebase.firestore.Timestamp.fromDate(new Date(dateF));
      const end   = firebase.firestore.Timestamp.fromDate(new Date(dateF + 'T23:59:59'));
      query = query.where('timestamp', '>=', start).where('timestamp', '<=', end);
    }

    query = query.orderBy('timestamp', 'desc').limit(200);

    const snap = await query.get();
    const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    countEl.textContent = `${logs.length} entries`;

    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="table-empty">No activity logs found.</td></tr>';
      return;
    }

    tbody.innerHTML = logs.map(l => `
      <tr>
        <td class="text-sm" style="font-family:var(--font-mono)">${formatDateTime(l.timestamp)}</td>
        <td>${escapeHtml(l.userName || '—')}</td>
        <td>${getRoleBadge ? getRoleBadge(l.userRole) : escapeHtml(l.userRole || '—')}</td>
        <td>${escapeHtml(l.plantId || 'System')}</td>
        <td>${escapeHtml(l.action || '—')}</td>
        <td class="text-sm" style="font-family:var(--font-mono)">${escapeHtml(l.recordId || '—')}</td>
        <td class="text-sm text-muted">${l.newValue ? JSON.stringify(l.newValue).substring(0,60) : '—'}</td>
      </tr>
    `).join('');

  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty">${friendlyFirebaseError(e)}</td></tr>`;
  }
}

/* ══════════════════════════════════════════════════════════
   SETTINGS
══════════════════════════════════════════════════════════ */
async function initSettings() {
  await switchSettingsTab('general');
}

async function switchSettingsTab(tab, btnEl) {
  document.querySelectorAll('#view-settings .tab-btn').forEach(b => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
  else {
    const btn = document.querySelector(`[onclick="switchSettingsTab('${tab}',this)"]`);
    if (btn) btn.classList.add('active');
  }

  const content = document.getElementById('settingsTabContent');
  if (!content) return;

  switch (tab) {
    case 'general':      await renderGeneralSettings(content);      break;
    case 'scoring':      await renderScoringSettings(content);      break;
    case 'escalation':   await renderEscalationSettings(content);   break;
    case 'notifications':await renderNotifSettings(content);        break;
    case 'functionlogs': await renderFunctionLogs(content);         break;
  }
}

async function renderGeneralSettings(container) {
  let settings = {};
  try {
    const doc = await col('settings').doc('appSettings').get();
    if (doc.exists) settings = doc.data();
  } catch (e) { /* use defaults */ }

  container.innerHTML = `
    <div style="padding:20px">
      <h4 style="margin-bottom:16px">General Configuration</h4>
      <div class="form-grid-2">
        <div class="form-group"><label class="form-label">Company Name</label>
          <input type="text" id="sCompany" class="form-input" value="${escapeHtml(settings.companyName||'')}" /></div>
        <div class="form-group"><label class="form-label">Time Zone</label>
          <select id="sTZ" class="form-select">
            <option value="Asia/Kolkata" ${settings.timezone==='Asia/Kolkata'?'selected':''}>Asia/Kolkata (IST)</option>
            <option value="UTC" ${settings.timezone==='UTC'?'selected':''}>UTC</option>
            <option value="America/New_York" ${settings.timezone==='America/New_York'?'selected':''}>America/New_York (EST)</option>
          </select></div>
        <div class="form-group"><label class="form-label">Date Format</label>
          <select id="sDateFmt" class="form-select">
            <option value="DD-MMM-YYYY" ${settings.dateFormat==='DD-MMM-YYYY'?'selected':''}>DD-MMM-YYYY</option>
            <option value="DD/MM/YYYY" ${settings.dateFormat==='DD/MM/YYYY'?'selected':''}>DD/MM/YYYY</option>
            <option value="YYYY-MM-DD" ${settings.dateFormat==='YYYY-MM-DD'?'selected':''}>YYYY-MM-DD</option>
          </select></div>
      </div>
      <button class="btn btn-primary" style="margin-top:16px" onclick="saveGeneralSettings()">Save Settings</button>
    </div>
  `;
}

async function saveGeneralSettings() {
  const data = {
    companyName: document.getElementById('sCompany')?.value.trim(),
    timezone:    document.getElementById('sTZ')?.value,
    dateFormat:  document.getElementById('sDateFmt')?.value,
    updatedAt:   firebase.firestore.FieldValue.serverTimestamp()
  };
  try {
    await col('settings').doc('appSettings').set(data, { merge: true });
    await logActivity('system', 'General settings updated', null, null);
    showToast('Settings saved', 'success');
  } catch (e) { showToast(friendlyFirebaseError(e), 'error'); }
}

async function renderScoringSettings(container) {
  let s = {};
  try { const doc = await col('settings').doc('scoring').get(); if (doc.exists) s = doc.data(); } catch (e) {}

  container.innerHTML = `
    <div style="padding:20px">
      <h4 style="margin-bottom:4px">Scoring Thresholds</h4>
      <p class="form-hint" style="margin-bottom:16px">Configure score classification thresholds for Green / Yellow / Red.</p>
      <div class="form-grid-3">
        <div class="form-group">
          <label class="form-label">Green (≥)</label>
          <input type="number" id="sGreen" class="form-input" value="${s.greenThreshold||95}" min="0" max="100" />
          <p class="form-hint">Score ≥ this value = GREEN</p>
        </div>
        <div class="form-group">
          <label class="form-label">Yellow (≥)</label>
          <input type="number" id="sYellow" class="form-input" value="${s.yellowThreshold||90}" min="0" max="100" />
          <p class="form-hint">Score ≥ this value = YELLOW</p>
        </div>
        <div class="form-group">
          <label class="form-label">Red (&lt;)</label>
          <input type="number" id="sRed" class="form-input" value="${s.redThreshold||90}" min="0" max="100" disabled />
          <p class="form-hint">Score below Yellow = RED</p>
        </div>
      </div>
      <div class="form-group" style="margin-top:12px">
        <label class="checkbox-label">
          <input type="checkbox" id="sCritAuto" ${s.criticalAutoRed?'checked':''} />
          Critical question failure automatically classifies audit as RED/CRITICAL
        </label>
      </div>
      <button class="btn btn-primary" style="margin-top:16px" onclick="saveScoringSettings()">Save Scoring</button>
    </div>
  `;
}

async function saveScoringSettings() {
  const data = {
    greenThreshold:  parseInt(document.getElementById('sGreen')?.value)||95,
    yellowThreshold: parseInt(document.getElementById('sYellow')?.value)||90,
    criticalAutoRed: document.getElementById('sCritAuto')?.checked || false,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  try {
    await col('settings').doc('scoring').set(data, { merge: true });
    showToast('Scoring settings saved', 'success');
  } catch (e) { showToast(friendlyFirebaseError(e), 'error'); }
}

async function renderEscalationSettings(container) {
  let s = {};
  try { const doc = await col('settings').doc('reminderConfiguration').get(); if (doc.exists) s = doc.data(); } catch (e) {}

  container.innerHTML = `
    <div style="padding:20px">
      <h4 style="margin-bottom:4px">Escalation & Reminder Configuration</h4>
      <p class="form-hint" style="margin-bottom:16px">These settings are also used by Cloud Functions for automated escalations.</p>
      <h5 style="margin:12px 0 8px;font-size:13px">Audit Reminders (days before due date)</h5>
      <div class="form-grid-3">
        <div class="form-group"><label class="form-label">First Reminder</label>
          <input type="number" id="aR1" class="form-input" value="${s.auditReminder1||7}" /></div>
        <div class="form-group"><label class="form-label">Second Reminder</label>
          <input type="number" id="aR2" class="form-input" value="${s.auditReminder2||3}" /></div>
        <div class="form-group"><label class="form-label">Final Reminder</label>
          <input type="number" id="aR3" class="form-input" value="${s.auditReminder3||1}" /></div>
      </div>
      <h5 style="margin:16px 0 8px;font-size:13px">Action Escalation (days overdue)</h5>
      <div class="form-grid-3">
        <div class="form-group"><label class="form-label">Level 1 Escalation</label>
          <input type="number" id="eL1" class="form-input" value="${s.escalationLevel1||3}" /></div>
        <div class="form-group"><label class="form-label">Level 2 Escalation</label>
          <input type="number" id="eL2" class="form-input" value="${s.escalationLevel2||7}" /></div>
        <div class="form-group"><label class="form-label">Corporate Escalation</label>
          <input type="number" id="eL3" class="form-input" value="${s.escalationLevel3||15}" /></div>
      </div>
      <button class="btn btn-primary" style="margin-top:16px" onclick="saveEscalationSettings()">Save Escalation</button>
    </div>
  `;
}

async function saveEscalationSettings() {
  const data = {
    auditReminder1:   parseInt(document.getElementById('aR1')?.value)||7,
    auditReminder2:   parseInt(document.getElementById('aR2')?.value)||3,
    auditReminder3:   parseInt(document.getElementById('aR3')?.value)||1,
    escalationLevel1: parseInt(document.getElementById('eL1')?.value)||3,
    escalationLevel2: parseInt(document.getElementById('eL2')?.value)||7,
    escalationLevel3: parseInt(document.getElementById('eL3')?.value)||15,
    updatedAt:        firebase.firestore.FieldValue.serverTimestamp()
  };
  try {
    await col('settings').doc('reminderConfiguration').set(data, { merge: true });
    showToast('Escalation settings saved. Cloud Functions will pick up new values on next run.', 'success');
  } catch (e) { showToast(friendlyFirebaseError(e), 'error'); }
}

async function renderNotifSettings(container) {
  container.innerHTML = `
    <div style="padding:20px">
      <h4 style="margin-bottom:4px">Notification Settings</h4>
      <p class="form-hint" style="margin-bottom:16px">Email notifications are sent by Cloud Functions. Configure the email provider in Firebase Functions environment variables.</p>
      <div class="alert alert-info">
        <strong>Email Configuration:</strong> Set the following Firebase Functions environment variables:<br>
        <code>firebase functions:config:set email.provider="sendgrid" email.apikey="SG.xxx"</code>
      </div>
      <div class="form-group" style="margin-top:16px">
        <label class="form-label">Email Sender Name</label>
        <input type="text" id="nSender" class="form-input" value="LPA System" style="max-width:300px" />
      </div>
      <div class="form-group">
        <label class="form-label">Reply-To Email</label>
        <input type="email" id="nReplyTo" class="form-input" placeholder="noreply@company.com" style="max-width:300px" />
      </div>
      <button class="btn btn-primary" style="margin-top:12px" onclick="saveNotifSettings()">Save</button>
    </div>
  `;
}

async function saveNotifSettings() {
  const data = {
    emailSenderName: document.getElementById('nSender')?.value.trim(),
    replyToEmail:    document.getElementById('nReplyTo')?.value.trim(),
    updatedAt:       firebase.firestore.FieldValue.serverTimestamp()
  };
  try {
    await col('settings').doc('notificationSettings').set(data, { merge: true });
    showToast('Notification settings saved', 'success');
  } catch (e) { showToast(friendlyFirebaseError(e), 'error'); }
}

async function renderFunctionLogs(container) {
  container.innerHTML = `
    <div style="padding:20px">
      <h4 style="margin-bottom:4px">Cloud Function Monitoring</h4>
      <p class="form-hint" style="margin-bottom:16px">Last execution status of scheduled background functions.</p>
      <div id="fnLogsContent">Loading…</div>
    </div>
  `;

  try {
    const snap = await col('settings').doc('functionLogs').get();
    const logs = snap.exists ? snap.data() : {};

    const functions = [
      { key: 'processDailyReminders', label: 'Daily Reminder Processor' },
      { key: 'processEscalations',    label: 'Escalation Processor' },
      { key: 'processEmailQueue',     label: 'Email Queue Processor' }
    ];

    document.getElementById('fnLogsContent').innerHTML = `
      <table class="data-table">
        <thead><tr><th>Function</th><th>Last Run</th><th>Status</th><th>Processed</th><th>Notifications Created</th><th>Errors</th></tr></thead>
        <tbody>
          ${functions.map(fn => {
            const log = logs[fn.key] || {};
            return `<tr>
              <td class="fw-600">${fn.label}</td>
              <td>${log.lastRun ? formatDateTime(log.lastRun) : 'Never'}</td>
              <td>${log.status === 'success'
                    ? '<span class="badge badge-verified">Success</span>'
                    : log.status === 'error'
                    ? '<span class="badge badge-overdue">Error</span>'
                    : '<span class="badge badge-planned">Unknown</span>'}</td>
              <td>${log.recordsProcessed || 0}</td>
              <td>${log.notificationsCreated || 0}</td>
              <td class="text-sm text-muted">${log.lastError ? escapeHtml(log.lastError.substring(0,80)) : '—'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      <p class="form-hint" style="margin-top:12px">Functions run automatically on schedule. View detailed logs in Firebase Console → Functions → Logs.</p>
    `;
  } catch (e) {
    document.getElementById('fnLogsContent').innerHTML = '<p class="text-muted">Could not load function logs.</p>';
  }
}
