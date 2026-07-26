/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  POLYPLASTICS — Legal Compliance  |  CLOUD FUNCTIONS v2     ║
 * ║  Office 365 SMTP via Nodemailer  +  Firebase Scheduled Fns  ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * EMAIL PROVIDER: Office 365 / smtp.office365.com:587 (STARTTLS)
 * Credentials are stored in Firestore (legalcomp_settings) — set them
 * in the app's Admin → Settings → Cloud Reminders panel.
 *
 * FALLBACK: firebase functions:config for email credentials if
 * Firestore settings are not yet configured.
 *
 * DEPLOY:
 *   cd backend/functions
 *   npm install
 *   firebase functions:config:set \
 *     email.o365_user="compliance@polyplasticsindia.com" \
 *     email.o365_pass="YOUR_APP_PASSWORD" \
 *     email.o365_from_name="Polyplastics Legal Compliance" \
 *     email.digest_recipients="admin@co.com,ceo@co.com" \
 *     email.overdue_recipients="admin@co.com,md@co.com" \
 *     app.internal_secret="YOUR_RANDOM_SECRET"
 *   firebase deploy --only functions
 *
 * HTTP TRIGGER (manual / from SPA):
 *   POST <region>-skr-task.cloudfunctions.net/triggerEmailNow
 *   Header: x-internal-secret: <secret>
 *   Body:   { "type": "digest" | "reminders" | "overdue" | "weekly" | "monthly" }
 */

'use strict';

const functions  = require('firebase-functions');
const admin      = require('firebase-admin');
const nodemailer = require('nodemailer');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

/* ─────────────────────────────────────────
   CONFIG — reads from Firestore first,
   falls back to functions:config
───────────────────────────────────────── */
const COLLECTIONS = {
  REQS:     'legalcomp_requirements',
  PLANTS:   'legalcomp_plants',
  USERS:    'legalcomp_users',
  SETTINGS: 'legalcomp_settings',
  LOGS:     'reminderLogs',
};

async function getEmailConfig() {
  // Try Firestore (set via Admin → Settings → Cloud Reminders in the SPA)
  try {
    const snap = await db.collection(COLLECTIONS.SETTINGS).doc('data').get();
    if (snap.exists) {
      const items = snap.data().items || [];
      const s = items[0];
      if (s && s.o365User && s.o365Pass) {
        return {
          host:             'smtp.office365.com',
          port:             587,
          secure:           false,           // STARTTLS
          user:             s.o365User,
          pass:             s.o365Pass,
          fromName:         s.o365FromName  || 'Polyplastics Legal Compliance',
          digestRecipients: (s.digestRecipients  || '').split(',').map(e=>e.trim()).filter(Boolean),
          overdueRecipients:(s.overdueRecipients || '').split(',').map(e=>e.trim()).filter(Boolean),
          reminderLeadDays: (s.reminderLeadDays  || '1,3,7,14').split(',').map(n=>parseInt(n,10)).filter(n=>!isNaN(n)),
          weeklyEnabled:    !!s.weeklyEnabled,
          monthlyEnabled:   !!s.monthlyEnabled,
          dailyDigestEnabled: s.dailyDigestEnabled !== false,
          overdueAlertEnabled:s.overdueAlert !== false,
          _source:          'firestore',
        };
      }
    }
  } catch(e) {
    functions.logger.warn('getEmailConfig: Firestore read failed', e.message);
  }

  // Fallback to functions:config
  const fc = functions.config();
  const em = fc.email || {};
  return {
    host:             'smtp.office365.com',
    port:             587,
    secure:           false,
    user:             em.o365_user             || '',
    pass:             em.o365_pass             || '',
    fromName:         em.o365_from_name        || 'Polyplastics Legal Compliance',
    digestRecipients: (em.digest_recipients    || '').split(',').map(e=>e.trim()).filter(Boolean),
    overdueRecipients:(em.overdue_recipients   || '').split(',').map(e=>e.trim()).filter(Boolean),
    reminderLeadDays: [1,3,7,14],
    weeklyEnabled:    true,
    monthlyEnabled:   false,
    dailyDigestEnabled: true,
    overdueAlertEnabled:true,
    _source:          'functions-config',
  };
}

function buildTransport(cfg) {
  return nodemailer.createTransport({
    host:   cfg.host,
    port:   cfg.port,
    secure: cfg.secure,
    auth:   { user: cfg.user, pass: cfg.pass },
    tls:    { ciphers: 'SSLv3' },   // Office 365 compatibility
  });
}

/* ─────────────────────────────────────────
   DATA HELPERS
───────────────────────────────────────── */
async function loadDoc(col) {
  try {
    const snap = await db.collection(col).doc('data').get();
    return snap.exists ? (snap.data().items || []) : [];
  } catch(e) { functions.logger.warn('loadDoc failed', col, e.message); return []; }
}

async function fetchAllData() {
  const [requirements, plants, users] = await Promise.all([
    loadDoc(COLLECTIONS.REQS),
    loadDoc(COLLECTIONS.PLANTS),
    loadDoc(COLLECTIONS.USERS),
  ]);
  return { requirements, plants, users };
}

const getPlantName = (plants, pid)  => plants.find(p=>p.id===pid)?.name || pid || '—';
const getUserName  = (users,  uid)  => {
  if (!uid) return '—';
  const ids = Array.isArray(uid) ? uid : [uid];
  return ids.map(i => users.find(u=>u.id===i)?.name || i).filter(Boolean).join(', ') || '—';
};
const getUserEmail = (users,  uid)  => {
  if (!uid) return null;
  const ids = Array.isArray(uid) ? uid : [uid];
  return ids.map(i => users.find(u=>u.id===i)?.email).filter(Boolean);
};
const daysLeft = d => Math.ceil((new Date(d) - Date.now()) / 86400000);
const isOverdue = r => r.status !== 'Completed' && r.dueDate && daysLeft(r.dueDate) < 0;

async function logSent({ type, recipients, subject, requirementId }) {
  try {
    await db.collection(COLLECTIONS.LOGS).add({
      type, recipients, subject,
      requirementId: requirementId || null,
      sentAt: new Date().toISOString(),
    });
  } catch(e) { functions.logger.warn('logSent failed', e.message); }
}

/* ─────────────────────────────────────────
   HTML EMAIL TEMPLATE
───────────────────────────────────────── */
function buildEmailHTML({ heading, subheading, bodyHTML, footer }) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<style>
  body{margin:0;padding:0;font-family:'Segoe UI',Arial,sans-serif;background:#f1f5f9}
  .wrap{max-width:640px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10)}
  .hdr{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;padding:32px}
  .hdr h1{margin:0 0 4px;font-size:22px;font-weight:700}
  .hdr p{margin:0;font-size:13px;opacity:.85}
  .body{padding:28px 32px}
  table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px}
  th{background:#f8fafc;color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:.08em;padding:8px 12px;text-align:left;border-bottom:1px solid #e2e8f0}
  td{padding:9px 12px;border-bottom:1px solid #f1f5f9;color:#374151;vertical-align:top}
  tr:last-child td{border:none}
  .badge{display:inline-block;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600}
  .red{background:#fee2e2;color:#dc2626}
  .amber{background:#fef3c7;color:#d97706}
  .green{background:#dcfce7;color:#16a34a}
  .stat-grid{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px}
  .stat{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px;flex:1;min-width:100px;text-align:center}
  .stat .val{font-size:24px;font-weight:700}
  .stat .lbl{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#6b7280;margin-top:2px}
  h3{font-size:14px;font-weight:600;color:#1e293b;margin:20px 0 8px}
  .footer{background:#f8fafc;padding:14px 32px;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0}
</style></head><body>
<div class="wrap">
  <div class="hdr"><h1>${heading}</h1><p>${subheading}</p></div>
  <div class="body">${bodyHTML}</div>
  <div class="footer">${footer || 'Polyplastics Legal Compliance — automated alert via Office 365'}</div>
</div>
</body></html>`;
}

/* ─────────────────────────────────────────
   CORE SEND
───────────────────────────────────────── */
async function sendMail(cfg, { to, subject, html }) {
  const transport = buildTransport(cfg);
  const from = `"${cfg.fromName}" <${cfg.user}>`;
  const info = await transport.sendMail({
    from,
    to: Array.isArray(to) ? to.join(', ') : to,
    subject,
    html,
  });
  return info.messageId;
}

/* ─────────────────────────────────────────
   FUNCTION 1 — Daily Digest
   Every day 07:00 IST (01:30 UTC)
───────────────────────────────────────── */
exports.sendDailyDigest = functions
  .region('asia-south1')
  .pubsub.schedule('30 1 * * *').timeZone('Asia/Kolkata')
  .onRun(async () => {
    functions.logger.info('▶ sendDailyDigest');
    const cfg = await getEmailConfig();
    functions.logger.info('Email config source:', cfg._source, 'user:', cfg.user);
    if (!cfg.dailyDigestEnabled || !cfg.user || !cfg.pass) { functions.logger.info('Digest disabled or unconfigured'); return null; }
    if (!cfg.digestRecipients.length) { functions.logger.warn('No digest recipients'); return null; }

    const { requirements, plants, users } = await fetchAllData();
    const overdue   = requirements.filter(r => isOverdue(r));
    const dueSoon   = requirements.filter(r => !isOverdue(r) && r.status !== 'Completed' && r.dueDate && daysLeft(r.dueDate) >= 0 && daysLeft(r.dueDate) <= 7);
    const pending   = requirements.filter(r => r.status === 'Pending' && !isOverdue(r));
    const completed = requirements.filter(r => r.status === 'Completed').length;
    const total     = requirements.length;

    const row = r => {
      const dl = r.dueDate ? daysLeft(r.dueDate) : null;
      const badge = isOverdue(r) ? '<span class="badge red">OVERDUE</span>' : dl !== null && dl <= 3 ? `<span class="badge amber">${dl}d</span>` : `<span class="badge green">${dl !== null ? dl+'d' : r.status}</span>`;
      return `<tr><td>${r.title}</td><td>${getPlantName(plants, r.plantId)}</td><td>${r.category||'—'}</td><td>${r.priority||'—'}</td><td>${r.dueDate||'—'}</td><td>${badge}</td><td>${getUserName(users, r.assignedTo)}</td></tr>`;
    };
    const tbl = (title, rows, empty) => rows.length
      ? `<h3>${title} (${rows.length})</h3><table><tr><th>Requirement</th><th>Plant</th><th>Category</th><th>Priority</th><th>Due Date</th><th>Status</th><th>Assignee</th></tr>${rows.map(row).join('')}</table>`
      : `<h3>${title}</h3><p style="color:#94a3b8;font-size:13px">${empty}</p>`;

    const today = new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
    const bodyHTML = `
      <div class="stat-grid">
        ${[['Total',total,'#6366f1'],['Overdue',overdue.length,'#dc2626'],['Due Soon',dueSoon.length,'#d97706'],['Completed',completed,'#16a34a']]
          .map(([l,v,c])=>`<div class="stat"><div class="val" style="color:${c}">${v}</div><div class="lbl">${l}</div></div>`).join('')}
      </div>
      ${tbl('🚨 Overdue', overdue, '✅ No overdue items!')}
      ${tbl('⚠️ Due Within 7 Days', dueSoon, '✅ Nothing urgently due!')}
      ${tbl('🕐 Pending', pending, '✅ No pending items!')}`;

    const subject = `📋 Compliance Daily Digest — ${today}`;
    const html = buildEmailHTML({ heading: 'Daily Compliance Digest', subheading: `Summary for ${today} · Polyplastics`, bodyHTML });
    const msgId = await sendMail(cfg, { to: cfg.digestRecipients, subject, html });
    await logSent({ type: 'daily_digest', recipients: cfg.digestRecipients, subject });
    functions.logger.info('✅ Daily digest sent', { msgId, recipients: cfg.digestRecipients });
    return null;
  });

/* ─────────────────────────────────────────
   FUNCTION 2 — Lead-Day Reminders
   Every day 08:00 IST (02:30 UTC)
───────────────────────────────────────── */
exports.sendLeadDayReminders = functions
  .region('asia-south1')
  .pubsub.schedule('30 2 * * *').timeZone('Asia/Kolkata')
  .onRun(async () => {
    functions.logger.info('▶ sendLeadDayReminders');
    const cfg = await getEmailConfig();
    if (!cfg.user || !cfg.pass) { functions.logger.info('Reminders unconfigured'); return null; }
    const { requirements, plants, users } = await fetchAllData();
    let sent = 0;

    for (const req of requirements) {
      if (req.status === 'Completed' || !req.dueDate) continue;
      const dl = daysLeft(req.dueDate);
      if (!cfg.reminderLeadDays.includes(dl)) continue;

      const plantName    = getPlantName(plants, req.plantId);
      const assigneeName = getUserName(users, req.assignedTo);
      const emails       = getUserEmail(users, req.assignedTo) || [];
      const plantHead    = users.find(u => u.role === 'plant_head' && u.plantId === req.plantId);
      if (plantHead?.email && !emails.includes(plantHead.email)) emails.push(plantHead.email);
      if (!emails.length) continue;

      const badge = dl <= 1 ? '<span class="badge red">Due TOMORROW</span>' : `<span class="badge amber">${dl} days remaining</span>`;
      const bodyHTML = `
        <p style="color:#374151;font-size:14px;margin-top:0">This compliance requirement is due in <strong>${dl} day(s)</strong>. Please take action.</p>
        <table>
          <tr><th>Field</th><th>Details</th></tr>
          <tr><td>Requirement</td><td>${req.title}</td></tr>
          <tr><td>Plant</td><td>${plantName}</td></tr>
          <tr><td>Category</td><td>${req.category||'—'}</td></tr>
          <tr><td>Priority</td><td>${req.priority||'—'}</td></tr>
          <tr><td>Due Date</td><td>${req.dueDate}</td></tr>
          <tr><td>Status</td><td>${badge}</td></tr>
          <tr><td>Assigned To</td><td>${assigneeName}</td></tr>
          ${req.legalClause ? `<tr><td>Legal Clause</td><td style="font-size:12px;color:#6b7280">${req.legalClause}</td></tr>` : ''}
        </table>`;

      const subject = `⏰ Compliance Due in ${dl}d: ${req.title} — ${plantName}`;
      const html = buildEmailHTML({ heading: `Due in ${dl} Day(s)`, subheading: `${req.title} · ${plantName}`, bodyHTML });
      try {
        await sendMail(cfg, { to: emails, subject, html });
        await logSent({ type: 'lead_day_reminder', recipients: emails, subject, requirementId: req.id });
        sent++;
      } catch(e) {
        functions.logger.error('Reminder send failed for', req.id, e.message);
      }
    }
    functions.logger.info(`✅ Lead-day reminders sent: ${sent}`);
    return null;
  });

/* ─────────────────────────────────────────
   FUNCTION 3 — Overdue Alerts
   Every day 09:00 IST (03:30 UTC)
───────────────────────────────────────── */
exports.sendOverdueAlerts = functions
  .region('asia-south1')
  .pubsub.schedule('30 3 * * *').timeZone('Asia/Kolkata')
  .onRun(async () => {
    functions.logger.info('▶ sendOverdueAlerts');
    const cfg = await getEmailConfig();
    if (!cfg.overdueAlertEnabled || !cfg.user || !cfg.pass) return null;
    if (!cfg.overdueRecipients.length) { functions.logger.warn('No overdue recipients'); return null; }

    const { requirements, plants, users } = await fetchAllData();
    const overdueReqs = requirements.filter(r => isOverdue(r));
    if (!overdueReqs.length) { functions.logger.info('No overdue items'); return null; }

    const rows = overdueReqs.map(r => {
      const over = Math.abs(daysLeft(r.dueDate));
      return `<tr><td>${r.title}</td><td>${getPlantName(plants,r.plantId)}</td><td>${r.category||'—'}</td><td>${r.priority||'—'}</td><td><span class="badge red">${over}d overdue</span></td><td>${getUserName(users,r.assignedTo)}</td></tr>`;
    }).join('');

    const bodyHTML = `
      <p style="color:#dc2626;font-weight:600;font-size:14px">⚠️ ${overdueReqs.length} requirement(s) are overdue and need immediate action.</p>
      <table><tr><th>Requirement</th><th>Plant</th><th>Category</th><th>Priority</th><th>Overdue By</th><th>Assignee</th></tr>${rows}</table>`;

    const subject = `🚨 URGENT: ${overdueReqs.length} Overdue Compliance Requirement(s)`;
    const html = buildEmailHTML({ heading: 'Overdue Compliance Alert', subheading: 'Immediate action required · Polyplastics', bodyHTML });
    const msgId = await sendMail(cfg, { to: cfg.overdueRecipients, subject, html });
    await logSent({ type: 'overdue_alert', recipients: cfg.overdueRecipients, subject });
    functions.logger.info('✅ Overdue alert sent', { msgId, count: overdueReqs.length });
    return null;
  });

/* ─────────────────────────────────────────
   FUNCTION 4 — Weekly Summary
   Every Monday 07:30 IST (02:00 UTC)
───────────────────────────────────────── */
exports.sendWeeklySummary = functions
  .region('asia-south1')
  .pubsub.schedule('0 2 * * 1').timeZone('Asia/Kolkata')
  .onRun(async () => {
    functions.logger.info('▶ sendWeeklySummary');
    const cfg = await getEmailConfig();
    if (!cfg.weeklyEnabled || !cfg.user || !cfg.pass) return null;
    if (!cfg.digestRecipients.length) return null;

    const { requirements, plants, users } = await fetchAllData();
    const total     = requirements.length;
    const completed = requirements.filter(r=>r.status==='Completed').length;
    const overdue   = requirements.filter(r=>isOverdue(r)).length;
    const weekStr   = new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });

    const plantRows = plants.map(p => {
      const pr = requirements.filter(r=>r.plantId===p.id);
      const pc = pr.filter(r=>r.status==='Completed').length;
      const po = pr.filter(r=>isOverdue(r)).length;
      return `<tr><td><strong>${p.name}</strong></td><td>${p.state}</td><td>${pr.length}</td><td>${pc}</td><td>${po > 0 ? `<span class="badge red">${po}</span>` : '<span class="badge green">0</span>'}</td><td>${pr.length?Math.round(pc/pr.length*100):0}%</td></tr>`;
    }).join('');

    const bodyHTML = `
      <div class="stat-grid">
        ${[['Total',total,'#6366f1'],['Completed',completed,'#16a34a'],['Overdue',overdue,'#dc2626'],['Rate',`${total?Math.round(completed/total*100):0}%`,'#0d9488']]
          .map(([l,v,c])=>`<div class="stat"><div class="val" style="color:${c}">${v}</div><div class="lbl">${l}</div></div>`).join('')}
      </div>
      <h3>Plant-Wise Breakdown</h3>
      <table><tr><th>Plant</th><th>State</th><th>Total</th><th>Done</th><th>Overdue</th><th>Rate</th></tr>${plantRows}</table>`;

    const subject = `📊 Weekly Compliance Report — Week of ${weekStr}`;
    const html = buildEmailHTML({ heading: 'Weekly Compliance Report', subheading: `Polyplastics — Week ending ${weekStr}`, bodyHTML });
    await sendMail(cfg, { to: cfg.digestRecipients, subject, html });
    await logSent({ type: 'weekly_summary', recipients: cfg.digestRecipients, subject });
    functions.logger.info('✅ Weekly summary sent');
    return null;
  });

/* ─────────────────────────────────────────
   FUNCTION 5 — Monthly Report
   1st of every month 08:00 IST (02:30 UTC)
───────────────────────────────────────── */
exports.sendMonthlyReport = functions
  .region('asia-south1')
  .pubsub.schedule('30 2 1 * *').timeZone('Asia/Kolkata')
  .onRun(async () => {
    functions.logger.info('▶ sendMonthlyReport');
    const cfg = await getEmailConfig();
    if (!cfg.monthlyEnabled || !cfg.user || !cfg.pass) return null;
    if (!cfg.digestRecipients.length) return null;

    const { requirements } = await fetchAllData();
    const total     = requirements.length;
    const completed = requirements.filter(r=>r.status==='Completed').length;
    const overdue   = requirements.filter(r=>isOverdue(r)).length;
    const pending   = requirements.filter(r=>r.status==='Pending').length;
    const inProg    = requirements.filter(r=>r.status==='In Progress').length;
    const monthName = new Date().toLocaleDateString('en-IN', { month:'long', year:'numeric' });

    const catMap = {};
    requirements.forEach(r => { catMap[r.category||'Other'] = (catMap[r.category||'Other']||0)+1; });
    const catRows = Object.entries(catMap).sort((a,b)=>b[1]-a[1])
      .map(([c,n])=>`<tr><td>${c}</td><td>${n}</td><td>${total?Math.round(n/total*100):0}%</td></tr>`).join('');

    const bodyHTML = `
      <div class="stat-grid">
        ${[['Total',total,'#6366f1'],['Completed',completed,'#16a34a'],['In Progress',inProg,'#6366f1'],['Pending',pending,'#d97706'],['Overdue',overdue,'#dc2626'],['Rate',`${total?Math.round(completed/total*100):0}%`,'#0d9488']]
          .map(([l,v,c])=>`<div class="stat"><div class="val" style="color:${c};font-size:18px">${v}</div><div class="lbl">${l}</div></div>`).join('')}
      </div>
      <h3>Breakdown by Category</h3>
      <table><tr><th>Category</th><th>Count</th><th>Share</th></tr>${catRows}</table>`;

    const subject = `📅 Monthly Compliance Report — ${monthName}`;
    const html = buildEmailHTML({ heading: 'Monthly Compliance Report', subheading: `Polyplastics — ${monthName}`, bodyHTML });
    await sendMail(cfg, { to: cfg.digestRecipients, subject, html });
    await logSent({ type: 'monthly_report', recipients: cfg.digestRecipients, subject });
    functions.logger.info('✅ Monthly report sent');
    return null;
  });

/* ─────────────────────────────────────────
   FUNCTION 6 — HTTP Trigger (manual / SPA)
   Called by the SPA's "Test Cloud Function"
   buttons and by triggerCloudReminder()
───────────────────────────────────────── */
exports.triggerEmailNow = functions
  .region('asia-south1')
  .https.onRequest(async (req, res) => {
    // CORS preflight
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, x-internal-secret');
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST')    { res.status(405).json({ error: 'Method not allowed' }); return; }

    // Auth
    const appCfg = functions.config().app || {};
    const secret = req.headers['x-internal-secret'] || '';
    if (!appCfg.internal_secret || secret !== appCfg.internal_secret) {
      functions.logger.warn('triggerEmailNow: unauthorized attempt');
      res.status(403).json({ error: 'Forbidden — invalid secret' });
      return;
    }

    const { type } = req.body || {};
    functions.logger.info(`triggerEmailNow called: type=${type}`);

    try {
      switch (type) {
        case 'digest':    await exports.sendDailyDigest.run({});    break;
        case 'reminders': await exports.sendLeadDayReminders.run({}); break;
        case 'overdue':   await exports.sendOverdueAlerts.run({});  break;
        case 'weekly':    await exports.sendWeeklySummary.run({});  break;
        case 'monthly':   await exports.sendMonthlyReport.run({});  break;
        default:
          res.status(400).json({ error: 'Unknown type. Use: digest | reminders | overdue | weekly | monthly' });
          return;
      }
      res.json({ success: true, type, triggeredAt: new Date().toISOString() });
    } catch(e) {
      functions.logger.error('triggerEmailNow error:', e);
      res.status(500).json({ error: e.message });
    }
  });
