/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Cloud Functions — Group Audit Management System
 *  Runtime : Node 20
 *  Region  : asia-south1  (Mumbai — lowest latency for India)
 *  Memory  : 256 MiB (default) — bump to 512 MiB for heavy batch functions
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  EMAIL SETUP (read before deploying)
 *  ────────────────────────────────────
 *  Gmail OAuth2 credentials are read from Google Secret Manager.
 *  Secret name: "gmail-oauth-creds"
 *  Secret value (JSON):
 *  {
 *    "clientId":     "your-oauth-client-id.apps.googleusercontent.com",
 *    "clientSecret": "your-oauth-client-secret",
 *    "refreshToken": "your-refresh-token",
 *    "fromEmail":    "audits@yourcompany.com",
 *    "fromName":     "Group Audit System"
 *  }
 *
 *  How to get the refresh token:
 *  1. Go to console.cloud.google.com → APIs & Services → Credentials
 *  2. Create OAuth 2.0 Client ID → type: Web application
 *  3. Add Authorized redirect URI: https://developers.google.com/oauthplayground
 *  4. Go to https://developers.google.com/oauthplayground
 *  5. Gear icon → check "Use your own OAuth credentials" → paste client ID + secret
 *  6. Step 1: select scope "https://mail.google.com/"
 *  7. Step 2: Authorize → Exchange code → copy refresh_token
 *  8. Create secret: gcloud secrets create gmail-oauth-creds --data-file=creds.json
 *  9. Grant access:
 *     gcloud secrets add-iam-policy-binding gmail-oauth-creds \
 *       --member="serviceAccount:YOUR-PROJECT-ID@appspot.gserviceaccount.com" \
 *       --role="roles/secretmanager.secretAccessor"
 */

'use strict';

const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onSchedule }      = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin  = require('firebase-admin');
const { google } = require('googleapis');

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({ region: 'asia-south1', memory: '256MiB', timeoutSeconds: 120 });

// ─── Branding constants ───────────────────────────────────────────────────────
const BRAND = {
  name:    'Group Audit System',
  color:   '#2563EB',           // accent blue
  colorDark: '#1D4ED8',
  logoUrl: '',                   // set after uploading to Storage
  appUrl:  'https://YOUR-PROJECT-ID.web.app',
};

// ═══════════════════════════════════════════════════════════════════════════
//  GMAIL HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/** Load Gmail OAuth credentials from Secret Manager once per cold-start */
let _gmailCreds = null;
async function loadGmailCreds() {
  if (_gmailCreds) return _gmailCreds;
  const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
  const client = new SecretManagerServiceClient();
  const name = `projects/${process.env.GCLOUD_PROJECT}/secrets/gmail-oauth-creds/versions/latest`;
  const [version] = await client.accessSecretVersion({ name });
  _gmailCreds = JSON.parse(version.payload.data.toString());
  return _gmailCreds;
}

/** Build an authenticated Gmail API client */
async function getGmailClient() {
  const creds = await loadGmailCreds();
  const auth = new google.auth.OAuth2(creds.clientId, creds.clientSecret);
  auth.setCredentials({ refresh_token: creds.refreshToken });
  return { gmail: google.gmail({ version: 'v1', auth }), from: creds.fromEmail, fromName: creds.fromName || BRAND.name };
}

/**
 * Send an email via Gmail API.
 * @param {string|string[]} to   recipient(s)
 * @param {string}          subject
 * @param {string}          html  full HTML body
 */
async function sendEmail(to, subject, html) {
  const recipients = Array.isArray(to) ? to.join(',') : to;
  if (!recipients) return;
  try {
    const { gmail, from, fromName } = await getGmailClient();
    const message = [
      `From: ${fromName} <${from}>`,
      `To: ${recipients}`,
      `Subject: ${subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset=utf-8`,
      ``,
      html,
    ].join('\r\n');
    const raw = Buffer.from(message).toString('base64url');
    await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
    // Log success
    await db.collection('emailLogs').add({
      to: recipients, subject,
      status: 'sent',
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error('sendEmail failed:', err.message);
    await db.collection('emailLogs').add({
      to: recipients, subject,
      status: 'failed', error: err.message,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  EMAIL TEMPLATES
//  All return a complete HTML string ready to send.
// ═══════════════════════════════════════════════════════════════════════════

/** Shared wrapper — consistent header / footer for every email */
function emailWrapper(title, preheader, body) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#f0f4f8;font-family:Inter,'Segoe UI',sans-serif;font-size:14px;color:#0d1f33}
  .wrap{max-width:600px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)}
  .hdr{background:${BRAND.color};padding:24px 32px;display:flex;align-items:center;gap:14px}
  .hdr-icon{width:40px;height:40px;background:rgba(255,255,255,.18);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0}
  .hdr-title{color:#fff;font-size:18px;font-weight:700;line-height:1.2}
  .hdr-sub{color:rgba(255,255,255,.75);font-size:12px;margin-top:2px}
  .body{padding:28px 32px}
  .para{margin-bottom:14px;line-height:1.65;color:#3a5472}
  .kv{background:#f8fafc;border-radius:8px;padding:14px 18px;margin-bottom:16px}
  .kv-row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #e8f0f8}
  .kv-row:last-child{border-bottom:none}
  .kv-label{color:#7a96b0;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.5px}
  .kv-val{color:#0d1f33;font-weight:600;font-size:13px;text-align:right;max-width:60%}
  .badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600}
  .badge-red{background:#fee2e2;color:#991b1b}
  .badge-amber{background:#fef3c7;color:#92400e}
  .badge-blue{background:#dbeafe;color:#1e40af}
  .badge-green{background:#dcfce7;color:#166534}
  .badge-grey{background:#f1f5f9;color:#475569}
  .btn-wrap{text-align:center;margin:20px 0 8px}
  .btn{display:inline-block;padding:12px 28px;background:${BRAND.color};color:#fff;text-decoration:none;border-radius:7px;font-weight:600;font-size:14px}
  .btn-outline{background:#fff;color:${BRAND.color};border:2px solid ${BRAND.color}}
  .divider{border:none;border-top:1px solid #e8f0f8;margin:20px 0}
  .alert-box{border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:13px;border-left:4px solid}
  .alert-red{background:#fef2f2;border-color:#ef4444;color:#991b1b}
  .alert-amber{background:#fffbeb;border-color:#f59e0b;color:#92400e}
  .alert-blue{background:#eff6ff;border-color:#3b82f6;color:#1e40af}
  .alert-green{background:#f0fdf4;border-color:#22c55e;color:#166534}
  .ftr{background:#f8fafc;border-top:1px solid #e8f0f8;padding:16px 32px;font-size:11px;color:#94a3b8;text-align:center;line-height:1.6}
  .ftr a{color:#7a96b0}
</style></head>
<body>
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${preheader}</div>
<div class="wrap">
  <div class="hdr">
    <div class="hdr-icon">🛡️</div>
    <div><div class="hdr-title">${BRAND.name}</div><div class="hdr-sub">Internal Audit Management</div></div>
  </div>
  <div class="body">${body}</div>
  <div class="ftr">
    This is an automated message from <strong>${BRAND.name}</strong>.<br>
    Please do not reply to this email. <a href="${BRAND.appUrl}">Open Portal →</a>
  </div>
</div></body></html>`;
}

/** Finding raised → CAPA assigned */
function tplFindingRaised({ findingNo, auditName, plant, dept, severity, description, assigneeName, dueDate }) {
  const badge = severity === 'Critical' ? 'badge-red' : severity === 'Major' ? 'badge-amber' : 'badge-blue';
  return emailWrapper(
    `Finding Raised: ${findingNo}`,
    `A ${severity} finding has been raised in ${plant}.`,
    `<p class="para">Dear ${assigneeName || 'Team'},</p>
     <p class="para">A new audit finding has been raised and a Corrective Action (CAPA) has been automatically assigned to your department.</p>
     <div class="kv">
       <div class="kv-row"><span class="kv-label">Finding No.</span><span class="kv-val">${findingNo}</span></div>
       <div class="kv-row"><span class="kv-label">Audit</span><span class="kv-val">${auditName}</span></div>
       <div class="kv-row"><span class="kv-label">Plant</span><span class="kv-val">${plant}</span></div>
       <div class="kv-row"><span class="kv-label">Department</span><span class="kv-val">${dept}</span></div>
       <div class="kv-row"><span class="kv-label">Severity</span><span class="kv-val"><span class="badge ${badge}">${severity}</span></span></div>
       <div class="kv-row"><span class="kv-label">Due Date</span><span class="kv-val">${dueDate || 'To be set'}</span></div>
     </div>
     <div class="alert-box alert-amber">📋 <strong>Description:</strong> ${description || 'See portal for details.'}</div>
     <p class="para">Please log in to the portal to review and begin your corrective action.</p>
     <div class="btn-wrap"><a class="btn" href="${BRAND.appUrl}">Open CAPA →</a></div>`
  );
}

/** CAPA overdue warning */
function tplCAPAOverdue({ capaId, findingNo, plant, dept, assigneeName, dueDate, daysOverdue }) {
  return emailWrapper(
    `⚠️ CAPA Overdue: ${capaId}`,
    `CAPA ${capaId} is ${daysOverdue} day(s) overdue.`,
    `<p class="para">Dear ${assigneeName || 'Team'},</p>
     <div class="alert-box alert-red">🚨 <strong>CAPA OVERDUE</strong> — This corrective action was due on <strong>${dueDate}</strong> and is now <strong>${daysOverdue} day(s) overdue</strong>.</div>
     <div class="kv">
       <div class="kv-row"><span class="kv-label">CAPA ID</span><span class="kv-val">${capaId}</span></div>
       <div class="kv-row"><span class="kv-label">Finding Ref.</span><span class="kv-val">${findingNo || '—'}</span></div>
       <div class="kv-row"><span class="kv-label">Plant</span><span class="kv-val">${plant}</span></div>
       <div class="kv-row"><span class="kv-label">Department</span><span class="kv-val">${dept}</span></div>
       <div class="kv-row"><span class="kv-label">Due Date</span><span class="kv-val" style="color:#991b1b">${dueDate}</span></div>
     </div>
     <p class="para">Please complete and close this CAPA immediately or raise an extension request with your Plant Admin.</p>
     <div class="btn-wrap"><a class="btn" href="${BRAND.appUrl}" style="background:#dc2626">Update CAPA Now →</a></div>`
  );
}

/** CAPA due-soon reminder (3 days) */
function tplCAPAReminder({ capaId, findingNo, plant, dept, assigneeName, dueDate, daysLeft }) {
  return emailWrapper(
    `Reminder: CAPA Due in ${daysLeft} Day(s) — ${capaId}`,
    `CAPA ${capaId} is due in ${daysLeft} day(s).`,
    `<p class="para">Dear ${assigneeName || 'Team'},</p>
     <div class="alert-box alert-amber">⏰ <strong>Upcoming Deadline</strong> — CAPA <strong>${capaId}</strong> is due in <strong>${daysLeft} day(s)</strong> on ${dueDate}.</div>
     <div class="kv">
       <div class="kv-row"><span class="kv-label">CAPA ID</span><span class="kv-val">${capaId}</span></div>
       <div class="kv-row"><span class="kv-label">Finding Ref.</span><span class="kv-val">${findingNo || '—'}</span></div>
       <div class="kv-row"><span class="kv-label">Plant</span><span class="kv-val">${plant}</span></div>
       <div class="kv-row"><span class="kv-label">Department</span><span class="kv-val">${dept}</span></div>
       <div class="kv-row"><span class="kv-label">Due Date</span><span class="kv-val" style="color:#92400e">${dueDate}</span></div>
     </div>
     <p class="para">Please ensure your corrective action is completed on time to avoid escalation.</p>
     <div class="btn-wrap"><a class="btn" href="${BRAND.appUrl}">Complete CAPA →</a></div>`
  );
}

/** Audit plan created → lead auditor notified */
function tplAuditScheduled({ auditName, auditType, plant, dept, auditorName, plannedDate, scope }) {
  return emailWrapper(
    `Audit Scheduled: ${auditName}`,
    `You are assigned as Lead Auditor for ${auditName} on ${plannedDate}.`,
    `<p class="para">Dear ${auditorName},</p>
     <p class="para">You have been assigned as the <strong>Lead Auditor</strong> for the following audit. Please review the scope and prepare your checklist in advance.</p>
     <div class="kv">
       <div class="kv-row"><span class="kv-label">Audit Name</span><span class="kv-val">${auditName}</span></div>
       <div class="kv-row"><span class="kv-label">Type</span><span class="kv-val"><span class="badge badge-blue">${auditType}</span></span></div>
       <div class="kv-row"><span class="kv-label">Plant</span><span class="kv-val">${plant}</span></div>
       <div class="kv-row"><span class="kv-label">Department</span><span class="kv-val">${dept || 'All Departments'}</span></div>
       <div class="kv-row"><span class="kv-label">Planned Date</span><span class="kv-val">${plannedDate}</span></div>
     </div>
     ${scope ? `<div class="alert-box alert-blue">📋 <strong>Scope:</strong> ${scope}</div>` : ''}
     <div class="btn-wrap"><a class="btn" href="${BRAND.appUrl}">Open Audit Plan →</a></div>`
  );
}

/** Supplier audit due reminder */
function tplSupplierReminder({ supplierName, supplierCode, plant, adminName, dueDate, daysLeft, lastAuditDate }) {
  return emailWrapper(
    `Supplier Audit Due: ${supplierName}`,
    `Supplier ${supplierName} is due for audit in ${daysLeft} day(s).`,
    `<p class="para">Dear ${adminName},</p>
     <p class="para">The following supplier is due for a periodic audit within <strong>${daysLeft} day(s)</strong>. Please schedule the audit at the earliest.</p>
     <div class="kv">
       <div class="kv-row"><span class="kv-label">Supplier Name</span><span class="kv-val">${supplierName}</span></div>
       <div class="kv-row"><span class="kv-label">Supplier Code</span><span class="kv-val">${supplierCode || '—'}</span></div>
       <div class="kv-row"><span class="kv-label">Plant</span><span class="kv-val">${plant}</span></div>
       <div class="kv-row"><span class="kv-label">Last Audit Date</span><span class="kv-val">${lastAuditDate || 'Never'}</span></div>
       <div class="kv-row"><span class="kv-label">Next Due</span><span class="kv-val" style="color:#92400e">${dueDate}</span></div>
     </div>
     <div class="btn-wrap"><a class="btn" href="${BRAND.appUrl}">Schedule Supplier Audit →</a></div>`
  );
}

/** Effectiveness review due */
function tplEffectivenessReview({ capaId, findingNo, plant, dept, verifierName, reviewDate }) {
  return emailWrapper(
    `Effectiveness Review Due: ${capaId}`,
    `Effectiveness review for CAPA ${capaId} is due on ${reviewDate}.`,
    `<p class="para">Dear ${verifierName || 'Quality Team'},</p>
     <p class="para">An effectiveness review is due for the following CAPA. Please verify that the corrective action has resolved the root cause and the issue has not recurred.</p>
     <div class="kv">
       <div class="kv-row"><span class="kv-label">CAPA ID</span><span class="kv-val">${capaId}</span></div>
       <div class="kv-row"><span class="kv-label">Finding Ref.</span><span class="kv-val">${findingNo || '—'}</span></div>
       <div class="kv-row"><span class="kv-label">Plant</span><span class="kv-val">${plant}</span></div>
       <div class="kv-row"><span class="kv-label">Department</span><span class="kv-val">${dept}</span></div>
       <div class="kv-row"><span class="kv-label">Review Due</span><span class="kv-val" style="color:#92400e">${reviewDate}</span></div>
     </div>
     <div class="btn-wrap"><a class="btn" href="${BRAND.appUrl}">Complete Effectiveness Review →</a></div>`
  );
}

/** Weekly digest for Plant Admin / Super Admin */
function tplWeeklyDigest({ recipientName, plant, stats, overdueItems }) {
  const rows = overdueItems.map(i =>
    `<div class="kv-row"><span class="kv-val" style="text-align:left">${i.id}</span><span class="kv-val" style="color:#991b1b">${i.daysOverdue}d overdue</span></div>`
  ).join('');
  return emailWrapper(
    `Weekly Audit Digest — ${plant}`,
    `${stats.openCapa} open CAPAs, ${stats.overdueCapa} overdue this week.`,
    `<p class="para">Dear ${recipientName},</p>
     <p class="para">Here is your weekly summary for <strong>${plant}</strong>.</p>
     <div class="kv">
       <div class="kv-row"><span class="kv-label">Audits Planned (MTD)</span><span class="kv-val">${stats.plannedAudits}</span></div>
       <div class="kv-row"><span class="kv-label">Audits Completed (MTD)</span><span class="kv-val">${stats.completedAudits}</span></div>
       <div class="kv-row"><span class="kv-label">Open Findings</span><span class="kv-val">${stats.openFindings}</span></div>
       <div class="kv-row"><span class="kv-label">Open CAPAs</span><span class="kv-val">${stats.openCapa}</span></div>
       <div class="kv-row"><span class="kv-label">Overdue CAPAs</span><span class="kv-val" style="color:#991b1b">${stats.overdueCapa}</span></div>
       <div class="kv-row"><span class="kv-label">Closed This Week</span><span class="kv-val" style="color:#166534">${stats.closedThisWeek}</span></div>
     </div>
     ${overdueItems.length > 0 ? `<p class="para" style="font-weight:600;color:#991b1b">⚠️ Overdue Items Requiring Attention:</p><div class="kv">${rows}</div>` : ''}
     <div class="btn-wrap"><a class="btn" href="${BRAND.appUrl}">Open Portal →</a></div>`
  );
}

/** LPA audit result */
function tplLPAResult({ auditId, processStation, layer, plant, auditorName, score, deviations, auditDate }) {
  const scoreColor = score >= 90 ? '#166534' : score >= 70 ? '#92400e' : '#991b1b';
  return emailWrapper(
    `LPA Result: ${processStation} — Score ${score}%`,
    `LPA for ${processStation} scored ${score}% with ${deviations} deviation(s).`,
    `<p class="para">Dear ${auditorName},</p>
     <p class="para">The Layered Process Audit for the following station has been completed.</p>
     <div class="kv">
       <div class="kv-row"><span class="kv-label">Audit ID</span><span class="kv-val">${auditId}</span></div>
       <div class="kv-row"><span class="kv-label">Process / Station</span><span class="kv-val">${processStation}</span></div>
       <div class="kv-row"><span class="kv-label">Layer</span><span class="kv-val">${layer}</span></div>
       <div class="kv-row"><span class="kv-label">Plant</span><span class="kv-val">${plant}</span></div>
       <div class="kv-row"><span class="kv-label">Date</span><span class="kv-val">${auditDate}</span></div>
       <div class="kv-row"><span class="kv-label">Score</span><span class="kv-val" style="color:${scoreColor};font-size:16px"><strong>${score}%</strong></span></div>
       <div class="kv-row"><span class="kv-label">Deviations Found</span><span class="kv-val">${deviations}</span></div>
     </div>
     <div class="btn-wrap"><a class="btn" href="${BRAND.appUrl}">View LPA Report →</a></div>`
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  SHARED HELPERS
// ═══════════════════════════════════════════════════════════════════════════

async function notify(userId, message, type = 'info', link = '') {
  await db.collection('notifications').add({
    userId, message, type, link, read: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function logActivity(userId, userName, action, module, details, plant = '') {
  await db.collection('activityLogs').add({
    userId, userName, action, module, details, plant,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/** Get all Plant Admin + Super Admin emails for a given plant */
async function getAdminEmails(plant) {
  const snap = await db.collection('users')
    .where('role', 'in', ['Super Admin', 'Plant Admin'])
    .where('status', '==', 'Active')
    .get();
  return snap.docs
    .filter(d => {
      const p = d.data().plant;
      return !p || p === 'All Plants' || p === plant;
    })
    .map(d => d.data().email)
    .filter(Boolean);
}

/** Resolve a Firestore Timestamp or JS Date to a readable string */
function fmtDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function daysBetween(ts, now = new Date()) {
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return Math.floor((now - d) / 86400000);
}

function daysUntil(ts, now = new Date()) {
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return Math.floor((d - now) / 86400000);
}

// ═══════════════════════════════════════════════════════════════════════════
//  TRIGGER 1 — New Finding → auto-create CAPA + notify
// ═══════════════════════════════════════════════════════════════════════════
exports.onFindingCreated = onDocumentCreated('findings/{findingId}', async (event) => {
  const finding   = event.data.data();
  const findingId = event.params.findingId;
  if (!finding) return;

  // 1. Create CAPA shell
  const dueTs = admin.firestore.Timestamp.fromDate(
    new Date(Date.now() + 30 * 86400000) // 30 days default
  );
  const capaRef = await db.collection('correctiveActions').add({
    findingId,
    findingRef:        `findings/${findingId}`,
    title:             `CAPA for ${finding.findingNo || findingId}`,
    plant:             finding.plant,
    department:        finding.department,
    description:       '',
    rootCause:         '',
    immediateAction:   '',
    correctiveAction:  '',
    preventiveAction:  '',
    assignedTo:        '',
    assignedToName:    '',
    dueDate:           dueTs,
    status:            'Open',
    priority:          finding.severity === 'Critical' ? 'High' : 'Medium',
    createdAt:         admin.firestore.FieldValue.serverTimestamp(),
  });

  // 2. Link CAPA back to finding
  await event.data.ref.update({ capaId: capaRef.id, capaRef: `correctiveActions/${capaRef.id}` });

  // 3. Notify plant admins
  const adminEmails = await getAdminEmails(finding.plant);
  const html = tplFindingRaised({
    findingNo:    finding.findingNo || findingId,
    auditName:    finding.auditName || finding.auditId || '—',
    plant:        finding.plant,
    dept:         finding.department || '—',
    severity:     finding.severity || 'Minor',
    description:  finding.description,
    assigneeName: 'Team',
    dueDate:      fmtDate(dueTs),
  });
  const subject = `[${finding.severity || 'Finding'}] ${finding.findingNo || findingId} raised — ${finding.plant}`;
  for (const email of adminEmails) {
    await sendEmail(email, subject, html);
    // In-app notification
    const snap = await db.collection('users').where('email', '==', email).limit(1).get();
    if (!snap.empty) await notify(snap.docs[0].id, `New finding ${finding.findingNo} raised in ${finding.plant}`, 'warning');
  }

  console.log(`Finding ${findingId}: CAPA ${capaRef.id} created, ${adminEmails.length} admins notified.`);
});

// ═══════════════════════════════════════════════════════════════════════════
//  TRIGGER 2 — CAPA Updated → notify assignee, update myActions
// ═══════════════════════════════════════════════════════════════════════════
exports.onCAPAUpdated = onDocumentUpdated('correctiveActions/{capaId}', async (event) => {
  const before = event.data.before.data();
  const after  = event.data.after.data();
  const capaId = event.params.capaId;
  if (!before || !after) return;

  const assigneeChanged = before.assignedTo !== after.assignedTo && after.assignedTo;
  const justClosed      = before.status !== 'Closed' && after.status === 'Closed';

  // A. New assignee → upsert myAction + send email
  if (assigneeChanged) {
    // Upsert myAction
    const q = await db.collection('myActions')
      .where('sourceId', '==', capaId).where('userId', '==', after.assignedTo).limit(1).get();
    const actionData = {
      userId:      after.assignedTo,
      userName:    after.assignedToName || '',
      type:        'capa',
      title:       `Complete CAPA: ${after.title || capaId}`,
      sourceId:    capaId,
      sourceRef:   `correctiveActions/${capaId}`,
      plant:       after.plant,
      dueDate:     after.dueDate,
      priority:    after.priority || 'Medium',
      status:      'Pending',
      updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
    };
    if (q.empty) {
      await db.collection('myActions').add({ ...actionData, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    } else {
      await q.docs[0].ref.update(actionData);
    }

    // Email new assignee
    const userSnap = await db.collection('users').doc(after.assignedTo).get();
    const email    = userSnap.data()?.email;
    if (email) {
      await sendEmail(email,
        `CAPA Assigned to You: ${capaId}`,
        tplFindingRaised({
          findingNo:    after.findingId || '—',
          auditName:    '—',
          plant:        after.plant,
          dept:         after.department,
          severity:     after.priority || 'Medium',
          description:  after.description,
          assigneeName: after.assignedToName || 'Team',
          dueDate:      fmtDate(after.dueDate),
        })
      );
      await notify(after.assignedTo, `CAPA ${capaId} has been assigned to you`, 'info');
    }
  }

  // B. CAPA closed → close myActions + notify
  if (justClosed) {
    const q = await db.collection('myActions')
      .where('sourceId', '==', capaId).where('status', '==', 'Pending').get();
    const batch = db.batch();
    q.docs.forEach(d => batch.update(d.ref, { status: 'Completed', closedAt: admin.firestore.FieldValue.serverTimestamp() }));
    await batch.commit();

    // Effectiveness review due (90 days)
    const revDate = admin.firestore.Timestamp.fromDate(new Date(Date.now() + 90 * 86400000));
    await event.data.after.ref.update({ effectivenessReviewDate: revDate });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  TRIGGER 3 — Audit Plan Created → notify lead auditor
// ═══════════════════════════════════════════════════════════════════════════
exports.onAuditPlanCreated = onDocumentCreated('auditPlans/{planId}', async (event) => {
  const plan   = event.data.data();
  const planId = event.params.planId;
  if (!plan || !plan.leadAuditorId) return;

  // myAction for lead auditor
  await db.collection('myActions').add({
    userId:    plan.leadAuditorId,
    userName:  plan.leadAuditorName || '',
    type:      'audit',
    title:     `Conduct Audit: ${plan.name}`,
    sourceId:  planId,
    sourceRef: `auditPlans/${planId}`,
    plant:     plan.plant,
    dueDate:   plan.plannedDate,
    priority:  'Medium',
    status:    'Pending',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Email lead auditor
  const userSnap = await db.collection('users').doc(plan.leadAuditorId).get();
  const email    = userSnap.data()?.email;
  if (email) {
    await sendEmail(email,
      `Audit Scheduled: ${plan.name}`,
      tplAuditScheduled({
        auditName:    plan.name,
        auditType:    plan.auditType,
        plant:        plan.plant,
        dept:         plan.department,
        auditorName:  plan.leadAuditorName || 'Auditor',
        plannedDate:  fmtDate(plan.plannedDate),
        scope:        plan.scope,
      })
    );
    await notify(plan.leadAuditorId, `You are assigned as Lead Auditor for "${plan.name}"`, 'info');
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  TRIGGER 4 — Checklist Upload Log → batch-import rows
// ═══════════════════════════════════════════════════════════════════════════
exports.onChecklistUploadLog = onDocumentCreated('checklistUploadLogs/{logId}', async (event) => {
  const log   = event.data.data();
  const logId = event.params.logId;
  if (!log || log.status !== 'pending' || !log.rows?.length) return;

  const rows   = log.rows;
  const BATCH  = 400;
  let imported = 0, skipped = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const batch = db.batch();
    for (const r of chunk) {
      if (r._status !== 'valid') { skipped++; continue; }
      const ref = db.collection('auditChecklists').doc();
      batch.set(ref, {
        auditType:   r.auditType,
        standard:    r.standard,
        clause:      r.clause,
        subClause:   r.subClause || '',
        department:  r.department,
        processArea: r.processArea || '',
        question:    r.question,
        requirement: r.requirement || '',
        criticality: r.criticality,
        weightage:   parseInt(r.weightage) || 3,
        plant:       r.plant || 'All Plants',
        frequency:   r.frequency || 'Annual',
        active:      (r.active || 'Yes').toLowerCase() !== 'no',
        version:     log.version || 'v1',
        uploadLogId: logId,
        createdAt:   admin.firestore.FieldValue.serverTimestamp(),
      });
      imported++;
    }
    await batch.commit();
  }

  await event.data.ref.update({ status: 'completed', imported, skipped, processedAt: admin.firestore.FieldValue.serverTimestamp() });
  console.log(`Checklist log ${logId}: ${imported} imported, ${skipped} skipped.`);
});

// ═══════════════════════════════════════════════════════════════════════════
//  SCHEDULED — Daily CAPA Reminder (08:00 IST = 02:30 UTC)
// ═══════════════════════════════════════════════════════════════════════════
exports.dailyCAPAReminder = onSchedule({
  schedule:  'CRON_TZ=Asia/Kolkata 0 8 * * *',
  timeoutSeconds: 300,
  memory: '512MiB',
}, async () => {
  const now      = new Date();
  const snap     = await db.collection('correctiveActions')
    .where('status', 'in', ['Open', 'In Progress'])
    .get();

  if (snap.empty) return;

  const batch = db.batch();
  const promises = [];

  for (const doc of snap.docs) {
    const c = doc.data();
    if (!c.dueDate) continue;

    const daysLeft    = daysUntil(c.dueDate, now);
    const daysOverdue = daysBetween(c.dueDate, now);

    // Fetch assignee email once
    let assigneeEmail = null, assigneeName = c.assignedToName || 'Team';
    if (c.assignedTo) {
      const u = await db.collection('users').doc(c.assignedTo).get().catch(() => null);
      if (u?.exists) { assigneeEmail = u.data().email; assigneeName = u.data().name || assigneeName; }
    }

    if (daysLeft < 0) {
      // OVERDUE
      batch.update(doc.ref, { overdue: true, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      if (assigneeEmail) {
        promises.push(sendEmail(
          assigneeEmail,
          `⚠️ CAPA Overdue: ${doc.id} (${Math.abs(daysLeft)} days)`,
          tplCAPAOverdue({ capaId: doc.id, findingNo: c.findingId, plant: c.plant, dept: c.department, assigneeName, dueDate: fmtDate(c.dueDate), daysOverdue: Math.abs(daysLeft) })
        ));
        if (c.assignedTo) promises.push(notify(c.assignedTo, `CAPA ${doc.id} is ${Math.abs(daysLeft)} day(s) overdue`, 'error'));
      }
      // Also notify plant admin
      promises.push(
        getAdminEmails(c.plant).then(emails =>
          Promise.all(emails.map(e => sendEmail(e, `🚨 Overdue CAPA: ${doc.id} — ${c.plant}`,
            tplCAPAOverdue({ capaId: doc.id, findingNo: c.findingId, plant: c.plant, dept: c.department, assigneeName, dueDate: fmtDate(c.dueDate), daysOverdue: Math.abs(daysLeft) })
          )))
        )
      );
    } else if (daysLeft <= 3) {
      // DUE SOON
      if (assigneeEmail) {
        promises.push(sendEmail(
          assigneeEmail,
          `⏰ CAPA Due in ${daysLeft} Day(s): ${doc.id}`,
          tplCAPAReminder({ capaId: doc.id, findingNo: c.findingId, plant: c.plant, dept: c.department, assigneeName, dueDate: fmtDate(c.dueDate), daysLeft })
        ));
        if (c.assignedTo) promises.push(notify(c.assignedTo, `CAPA ${doc.id} is due in ${daysLeft} day(s)`, 'warning'));
      }
    }
  }

  await batch.commit();
  await Promise.allSettled(promises);
  console.log(`dailyCAPAReminder: processed ${snap.size} open CAPAs.`);
});

// ═══════════════════════════════════════════════════════════════════════════
//  SCHEDULED — Effectiveness Review Reminder (09:00 IST daily)
// ═══════════════════════════════════════════════════════════════════════════
exports.dailyEffectivenessReminder = onSchedule({
  schedule: 'CRON_TZ=Asia/Kolkata 0 9 * * *',
  timeoutSeconds: 240,
}, async () => {
  const snap = await db.collection('correctiveActions')
    .where('status', '==', 'Closed')
    .where('effectivenessVerified', '==', false)
    .get().catch(() => null);
  if (!snap || snap.empty) return;

  const now = new Date();
  const promises = [];
  for (const doc of snap.docs) {
    const c = doc.data();
    if (!c.effectivenessReviewDate) continue;
    const daysLeft = daysUntil(c.effectivenessReviewDate, now);
    if (daysLeft > 7 || daysLeft < 0) continue; // only 0–7 days window

    const adminEmails = await getAdminEmails(c.plant);
    for (const email of adminEmails) {
      promises.push(sendEmail(
        email,
        `Effectiveness Review Due: ${doc.id}`,
        tplEffectivenessReview({ capaId: doc.id, findingNo: c.findingId, plant: c.plant, dept: c.department, verifierName: 'Quality Team', reviewDate: fmtDate(c.effectivenessReviewDate) })
      ));
    }
  }
  await Promise.allSettled(promises);
  console.log(`dailyEffectivenessReminder: checked ${snap.size} closed CAPAs.`);
});

// ═══════════════════════════════════════════════════════════════════════════
//  SCHEDULED — Weekly Supplier Audit Reminder (Mon 09:00 IST)
// ═══════════════════════════════════════════════════════════════════════════
exports.weeklySupplierReminder = onSchedule({
  schedule: 'CRON_TZ=Asia/Kolkata 0 9 * * 1',
  timeoutSeconds: 240,
}, async () => {
  const now      = new Date();
  const in30     = new Date(now.getTime() + 30 * 86400000);
  const snap     = await db.collection('suppliers').get().catch(() => null);
  if (!snap || snap.empty) return;

  const promises = [];
  for (const doc of snap.docs) {
    const s = doc.data();
    if (!s.nextAuditDate) continue;
    const daysLeft = daysUntil(s.nextAuditDate, now);
    if (daysLeft < 0 || daysLeft > 30) continue;

    const adminEmails = await getAdminEmails(s.plant);
    for (const email of adminEmails) {
      promises.push(sendEmail(
        email,
        `Supplier Audit Due in ${daysLeft} Days: ${s.name}`,
        tplSupplierReminder({
          supplierName:  s.name,
          supplierCode:  s.code,
          plant:         s.plant,
          adminName:     'Plant Admin',
          dueDate:       fmtDate(s.nextAuditDate),
          daysLeft,
          lastAuditDate: fmtDate(s.lastAuditDate),
        })
      ));
    }
  }
  await Promise.allSettled(promises);
  console.log(`weeklySupplierReminder: processed ${snap.size} suppliers.`);
});

// ═══════════════════════════════════════════════════════════════════════════
//  SCHEDULED — Weekly Digest (Sunday 20:00 IST)
// ═══════════════════════════════════════════════════════════════════════════
exports.weeklyDigest = onSchedule({
  schedule: 'CRON_TZ=Asia/Kolkata 0 20 * * 0',
  timeoutSeconds: 300,
  memory: '512MiB',
}, async () => {
  const now       = new Date();
  const weekAgo   = new Date(now.getTime() - 7 * 86400000);

  const plantSnap = await db.collection('plants').where('active', '!=', false).get().catch(() => null);
  if (!plantSnap || plantSnap.empty) return;

  for (const plantDoc of plantSnap.docs) {
    const plant = plantDoc.data().name || plantDoc.id;
    try {
      const [plannedSnap, completedSnap, findingsSnap, openCapaSnap, overdueCapaSnap, closedSnap] = await Promise.all([
        db.collection('auditPlans').where('plant', '==', plant).where('status', '!=', 'Cancelled').get(),
        db.collection('auditPlans').where('plant', '==', plant).where('status', '==', 'Completed').get(),
        db.collection('findings').where('plant', '==', plant).where('status', '==', 'Open').get(),
        db.collection('correctiveActions').where('plant', '==', plant).where('status', 'in', ['Open', 'In Progress']).get(),
        db.collection('correctiveActions').where('plant', '==', plant).where('overdue', '==', true).get(),
        db.collection('correctiveActions').where('plant', '==', plant).where('status', '==', 'Closed').where('closedAt', '>=', admin.firestore.Timestamp.fromDate(weekAgo)).get(),
      ]);

      const stats = {
        plannedAudits:   plannedSnap.size,
        completedAudits: completedSnap.size,
        openFindings:    findingsSnap.size,
        openCapa:        openCapaSnap.size,
        overdueCapa:     overdueCapaSnap.size,
        closedThisWeek:  closedSnap.size,
      };

      const overdueItems = overdueCapaSnap.docs.slice(0, 5).map(d => ({
        id:         d.id,
        daysOverdue: Math.abs(daysUntil(d.data().dueDate, now)),
      }));

      const adminEmails = await getAdminEmails(plant);
      for (const email of adminEmails) {
        const userSnap = await db.collection('users').where('email', '==', email).limit(1).get();
        const name     = userSnap.empty ? 'Admin' : (userSnap.docs[0].data().name || 'Admin');
        await sendEmail(email, `📊 Weekly Audit Digest — ${plant}`, tplWeeklyDigest({ recipientName: name, plant, stats, overdueItems }));
      }
    } catch (err) {
      console.error(`weeklyDigest error for ${plant}:`, err.message);
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  SCHEDULED — Monthly KPI Snapshot (1st of month, 03:00 IST)
// ═══════════════════════════════════════════════════════════════════════════
exports.monthlyKPISnapshot = onSchedule({
  schedule: 'CRON_TZ=Asia/Kolkata 30 3 1 * *',
  timeoutSeconds: 300,
  memory: '512MiB',
}, async () => {
  const now   = new Date();
  const key   = `${now.getFullYear()}-${String(now.getMonth()).padStart(2, '0')}`; // previous month

  const [auditsSnap, findingsSnap, capaSnap, closedSnap] = await Promise.all([
    db.collection('auditPlans').where('status', '==', 'Completed').get(),
    db.collection('findings').get(),
    db.collection('correctiveActions').where('status', 'in', ['Open', 'In Progress']).get(),
    db.collection('correctiveActions').where('status', '==', 'Closed').get(),
  ]);

  await db.collection('kpiSnapshots').doc(key).set({
    month:               key,
    totalAudits:         auditsSnap.size,
    totalFindings:       findingsSnap.size,
    openCAPAs:           capaSnap.size,
    closedCAPAs:         closedSnap.size,
    createdAt:           admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`KPI snapshot written for ${key}.`);
});

// ═══════════════════════════════════════════════════════════════════════════
//  CALLABLE — getDashboardKPIs
// ═══════════════════════════════════════════════════════════════════════════
exports.getDashboardKPIs = onCall(async (request) => {
  const plant = request.data?.plant || null;
  let q = (c) => plant && plant !== 'All Plants' ? db.collection(c).where('plant', '==', plant) : db.collection(c);

  const [plans, findings, capas, overdue] = await Promise.all([
    q('auditPlans').get(),
    q('findings').where('status', '==', 'Open').get(),
    q('correctiveActions').where('status', 'in', ['Open', 'In Progress']).get(),
    q('correctiveActions').where('overdue', '==', true).get(),
  ]);

  const completed = plans.docs.filter(d => d.data().status === 'Completed').length;
  const complianceRate = plans.size ? Math.round((completed / plans.size) * 100) : 0;

  return {
    totalAudits:    plans.size,
    completedAudits: completed,
    complianceRate,
    openFindings:   findings.size,
    openCAPAs:      capas.size,
    overdueCAPAs:   overdue.size,
  };
});

// ═══════════════════════════════════════════════════════════════════════════
//  CALLABLE — sendManualNotification
// ═══════════════════════════════════════════════════════════════════════════
exports.sendManualNotification = onCall(async (request) => {
  const auth = request.auth;
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in required.');

  const userDoc = await db.collection('users').doc(auth.uid).get();
  const role    = userDoc.data()?.role;
  if (!['Super Admin', 'Plant Admin'].includes(role)) {
    throw new HttpsError('permission-denied', 'Admins only.');
  }

  const { to, subject, message } = request.data;
  if (!to || !message) throw new HttpsError('invalid-argument', 'to and message required.');

  await sendEmail(to, subject || 'Notification from Group Audit System', emailWrapper(
    subject || 'Notification',
    message,
    `<p class="para">${message}</p><div class="btn-wrap"><a class="btn" href="${BRAND.appUrl}">Open Portal →</a></div>`
  ));
  return { success: true };
});

// ═══════════════════════════════════════════════════════════════════════════
//  CALLABLE — rollbackChecklistVersion
// ═══════════════════════════════════════════════════════════════════════════
exports.rollbackChecklistVersion = onCall(async (request) => {
  const auth = request.auth;
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const userDoc = await db.collection('users').doc(auth.uid).get();
  if (userDoc.data()?.role !== 'Super Admin') throw new HttpsError('permission-denied', 'Super Admin only.');

  const { logId } = request.data;
  if (!logId) throw new HttpsError('invalid-argument', 'logId required.');

  const snap = await db.collection('auditChecklists').where('uploadLogId', '==', logId).get();
  const BATCH = 400;
  let deleted = 0;
  for (let i = 0; i < snap.docs.length; i += BATCH) {
    const batch = db.batch();
    snap.docs.slice(i, i + BATCH).forEach(d => { batch.delete(d.ref); deleted++; });
    await batch.commit();
  }
  await db.collection('checklistUploadLogs').doc(logId).update({ status: 'rolled_back', rolledBackAt: admin.firestore.FieldValue.serverTimestamp() });
  return { deleted };
});
