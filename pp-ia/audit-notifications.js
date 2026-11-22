/**
 * Group Audit Management System – Notification Functions
 * Covers: General Audits + LPA Audits (all audit types)
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const admin    = require('firebase-admin');
const nodemailer = require('nodemailer');

const db           = admin.firestore();
const GMAIL_USER   = defineSecret('GMAIL_USER');
const GMAIL_PASS   = defineSecret('GMAIL_APP_PASS');
const APP_URL      = defineSecret('APP_URL');
const SECRETS      = [GMAIL_USER, GMAIL_PASS, APP_URL];
const REGION       = 'asia-south1';

function createTransport() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER.value(), pass: GMAIL_PASS.value() },
  });
}

function wrapHtml(title, body, appUrl) {
  var btn = appUrl ? '<a href="' + appUrl + '" style="display:inline-block;margin-top:18px;padding:11px 24px;background:#1E3A5F;color:#fff;text-decoration:none;border-radius:6px;font-weight:700">Open Audit Portal</a>' : '';
  return '<!DOCTYPE html><html><head><meta charset="utf-8"/><style>'
    + 'body{font-family:Arial,sans-serif;background:#f4f6f9;margin:0;padding:0}'
    + '.wrap{max-width:620px;margin:30px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.12)}'
    + '.hdr{background:#1E3A5F;padding:22px 28px;color:#fff}.hdr h2{margin:0;font-size:20px}'
    + '.hdr p{margin:4px 0 0;font-size:13px;opacity:.8}.body{padding:28px}'
    + 'p{margin:0 0 14px;font-size:14px;color:#334155;line-height:1.6}'
    + 'table{width:100%;border-collapse:collapse;margin:16px 0;font-size:13px}'
    + 'th{background:#F1F5F9;color:#475569;text-align:left;padding:8px 10px;border:1px solid #E2E8F0}'
    + 'td{padding:8px 10px;border:1px solid #E2E8F0;color:#334155}'
    + 'tr:nth-child(even) td{background:#F8FAFC}'
    + '.ftr{padding:16px 28px;background:#F8FAFC;border-top:1px solid #E2E8F0;font-size:11px;color:#94A3B8;text-align:center}'
    + '</style></head><body>'
    + '<div class="wrap">'
    + '<div class="hdr"><h2>🔍 Group Audit Management</h2><p>' + title + '</p></div>'
    + '<div class="body">' + body + btn + '</div>'
    + '<div class="ftr">Automated message from Group Audit Management System &middot; Do not reply</div>'
    + '</div></body></html>';
}

function fmtDate(ts) {
  if (!ts) return '—';
  var d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function sevBadge(s) {
  var v = (s || '').toLowerCase();
  if (v.includes('major')) return '🔴 Major NC';
  if (v.includes('obs'))   return '🟡 Observation';
  return '🔵 Minor NC';
}

async function sendMail(to, subject, html) {
  var list = Array.isArray(to) ? to : [to];
  list = [...new Set(list.filter(Boolean))];
  if (!list.length) return;
  await createTransport().sendMail({
    from: '"Audit Management" <' + GMAIL_USER.value() + '>',
    to: list.join(','),
    subject: subject,
    html: html,
  });
}

function tableRow(label, value) {
  return '<tr><th>' + label + '</th><td>' + (value || '—') + '</td></tr>';
}

// ── 1. PUBLISH SCHEDULE (callable) ───────────────────────────────────────────
exports.sendAuditScheduleEmail = onCall({ region: REGION, secrets: SECRETS }, async function(req) {
  var docIds     = req.data.docIds || [];
  var collection = req.data.collection || 'auditPlans';
  var recipients = req.data.recipients || []; // array of email strings
  if (!docIds.length) throw new HttpsError('invalid-argument', 'No plan IDs');

  var isLpa = collection === 'lpaAudits';
  var plans = await Promise.all(docIds.map(function(id) {
    return db.collection(collection).doc(id).get().then(function(s) {
      return Object.assign({ id: id }, s.data());
    });
  }));

  // Build recipient list from plans if not provided
  if (!recipients.length) {
    var emailSet = new Set();
    plans.forEach(function(p) {
      if (p.leadAuditorEmail) emailSet.add(p.leadAuditorEmail);
      if (p.auditeeEmail)     emailSet.add(p.auditeeEmail);
      if (p.auditorEmail)     emailSet.add(p.auditorEmail);
    });
    recipients = [...emailSet];
  }

  if (!recipients.length) throw new HttpsError('invalid-argument', 'No recipient emails found on plans');

  var rows = plans.map(function(p) {
    return '<tr><td>' + (p.auditNo ? '<strong>' + p.auditNo + '</strong><br>' : '') + (p.name || p.id) + '</td>'
      + '<td>' + (p.plant || '—') + '</td><td>' + (p.department || '—') + '</td>'
      + (isLpa ? '<td>' + (p.lpaLevel || '—') + '</td><td>' + (p.area || '—') + '</td>'
               : '<td>' + (p.auditType || '—') + '</td>')
      + '<td>' + (p.leadAuditorName || p.auditorName || '—') + '</td>'
      + '<td>' + (p.auditeeName || '—') + '</td>'
      + '<td>' + fmtDate(p.plannedDate) + '</td>'
      + '<td>' + (p.shift || '—') + '</td></tr>';
  }).join('');

  var extraTh = isLpa ? '<th>Level</th><th>Area</th>' : '<th>Audit Type</th>';
  var body = '<p>' + (isLpa ? 'LPA ' : '') + 'Audit schedule has been published. Please review your assigned audits below.</p>'
    + '<table><tr><th>Audit Name</th><th>Plant</th><th>Dept</th>' + extraTh
    + '<th>Auditor</th><th>Auditee</th><th>Date</th><th>Shift</th></tr>'
    + rows + '</table>'
    + '<p style="margin-top:16px">Please log in to the portal to view your tasks under <strong>My Actions</strong>.</p>';

  var toList = [...new Set(recipients.filter(Boolean))];
  await sendMail(toList,
    '📅 ' + (isLpa ? 'LPA ' : '') + 'Audit Schedule Published – ' + new Date().getFullYear(),
    wrapHtml('Audit Schedule Notification', body, APP_URL.value())
  );

  // ── Create / update myActions in Firestore for each plan's auditor & auditee ──
  var now = admin.firestore.FieldValue.serverTimestamp();
  var batch = db.batch();
  var batchCount = 0;

  async function flushBatch() {
    if (batchCount > 0) { await batch.commit(); batch = db.batch(); batchCount = 0; }
  }

  for (var p of plans) {
    async function upsertMyAction(email, role) {
      if (!email) return;
      // Look up userId from email
      var uSnap = await db.collection('users').where('email', '==', email).limit(1).get().catch(function() { return null; });
      var uid = (uSnap && !uSnap.empty) ? uSnap.docs[0].id : null;
      if (!uid) return;
      var sourceRef = collection + '/' + p.id;
      // Check existing
      var ex = await db.collection('myActions').where('userId', '==', uid).where('sourceRef', '==', sourceRef).limit(1).get().catch(function() { return null; });
      var data = {
        userId: uid, userEmail: email,
        title: 'Conduct Audit: ' + (p.name || p.id),
        auditType: p.auditType || '',
        auditNo: p.auditNo || '',
        plant: p.plant || '',
        department: p.department || '',
        dueDate: p.plannedDate || null,
        priority: 'Medium',
        status: 'Pending',
        module: 'Conduct Audit',
        sourceRef: sourceRef,
        role: role,
        updatedAt: now,
      };
      if (ex && !ex.empty) {
        batch.update(ex.docs[0].ref, data); batchCount++;
      } else {
        var ref = db.collection('myActions').doc();
        batch.set(ref, Object.assign({}, data, { createdAt: now, createdBy: req.auth ? req.auth.uid : 'system' }));
        batchCount++;
      }
      if (batchCount >= 400) await flushBatch();
    }
    await upsertMyAction(p.leadAuditorEmail || p.auditorEmail || '', 'Auditor');
    await upsertMyAction(p.auditeeEmail || '', 'Auditee');
  }
  await flushBatch();

  await db.collection('notifications').add({
    type: 'schedule_published',
    auditType: isLpa ? 'lpa' : 'general',
    recipients: toList,
    planIds: docIds,
    collection: collection,
    sentAt: admin.firestore.FieldValue.serverTimestamp(),
    sentBy: req.auth ? req.auth.uid : 'system',
  });

  return { success: true, sent: toList.length };
});

// ── 1b. AUDIT PLAN STATUS CHANGE → update myActions ─────────────────────────
exports.onAuditPlanUpdated = onDocumentUpdated({ document: 'auditPlans/{id}', region: REGION }, async function(event) {
  var before = event.data.before.data();
  var after  = event.data.after.data();
  if (!after) return;
  var statusChanged = before.status !== after.status;
  if (!statusChanged) return;
  var doneStatuses = ['Completed', 'Pending Review', 'Closed', 'Cancelled'];
  if (!doneStatuses.includes(after.status)) return;
  // Mark myActions for this plan as Completed
  var sourceRef = 'auditPlans/' + event.params.id;
  var snap = await db.collection('myActions').where('sourceRef', '==', sourceRef).get().catch(function() { return null; });
  if (!snap || snap.empty) return;
  var batch = db.batch();
  snap.docs.forEach(function(d) {
    batch.update(d.ref, { status: 'Completed', completedAt: admin.firestore.FieldValue.serverTimestamp() });
  });
  await batch.commit().catch(function() {});
});

// ── 1c. AUDIT PLAN DELETED → remove myActions ────────────────────────────────
const { onDocumentDeleted } = require('firebase-functions/v2/firestore');
exports.onAuditPlanDeleted = onDocumentDeleted({ document: 'auditPlans/{id}', region: REGION }, async function(event) {
  var sourceRef = 'auditPlans/' + event.params.id;
  var snap = await db.collection('myActions').where('sourceRef', '==', sourceRef).get().catch(function() { return null; });
  if (!snap || snap.empty) return;
  var batch = db.batch();
  snap.docs.forEach(function(d) { batch.delete(d.ref); });
  await batch.commit().catch(function() {});
});

// ── 2. NEW GENERAL FINDING ───────────────────────────────────────────────────
exports.onFindingCreated = onDocumentCreated({ document: 'findings/{id}', region: REGION, secrets: SECRETS }, async function(event) {
  var f = event.data.data();
  if (!f || f._isDummy) return;
  var emails = [f.auditorEmail, f.auditeeEmail, f.assigneeEmail].filter(Boolean);
  if (!emails.length) return;
  var body = '<p>A new non-conformance has been recorded.</p><table>'
    + tableRow('Plant', f.plant) + tableRow('Department', f.department)
    + tableRow('ISO Clause', f.clause || f.clauseNo) + tableRow('Severity', sevBadge(f.severity || f.type))
    + tableRow('Description', f.description || f.finding) + tableRow('Auditor', f.auditorName)
    + tableRow('Auditee', f.auditeeName) + tableRow('Due Date', fmtDate(f.dueDate))
    + '</table><p>Please log in to initiate corrective action.</p>';
  await sendMail(emails, '⚠️ New Finding – ' + (f.plant || '') + ' | ' + (f.department || ''), wrapHtml('New Finding Notification', body, APP_URL.value()));
});

// ── 3. NEW LPA FINDING ───────────────────────────────────────────────────────
exports.onLpaFindingCreated = onDocumentCreated({ document: 'lpaFindings/{id}', region: REGION, secrets: SECRETS }, async function(event) {
  var f = event.data.data();
  if (!f || f._isDummy) return;
  var pa = {};
  if (f.lpaAuditId) {
    var snap = await db.collection('lpaAudits').doc(f.lpaAuditId).get().catch(function() { return null; });
    if (snap && snap.exists) pa = snap.data();
  }
  var emails = [f.auditorEmail || pa.auditorEmail, f.auditeeEmail || pa.auditeeEmail, f.assigneeEmail].filter(Boolean);
  if (!emails.length) return;
  var body = '<p>A new LPA finding has been recorded.</p><table>'
    + tableRow('Plant', f.plant || pa.plant) + tableRow('Department', f.department || pa.department)
    + tableRow('LPA Level', f.lpaLevel || pa.lpaLevel) + tableRow('Area', f.area || pa.area)
    + tableRow('Severity', sevBadge(f.severity || f.type)) + tableRow('Description', f.description || f.finding)
    + tableRow('Due Date', fmtDate(f.dueDate))
    + '</table><p>Please log in to initiate the required action.</p>';
  await sendMail(emails, '⚠️ New LPA Finding – ' + (f.plant || pa.plant || ''), wrapHtml('New LPA Finding', body, APP_URL.value()));
});

// ── 4. CAPA UPDATED ──────────────────────────────────────────────────────────
exports.onCAPAUpdated = onDocumentUpdated({ document: 'correctiveActions/{id}', region: REGION, secrets: SECRETS }, async function(event) {
  var before = event.data.before.data();
  var after  = event.data.after.data();
  if (!after || after._isDummy) return;
  if (before.assigneeEmail === after.assigneeEmail && before.status === after.status) return;
  var email = after.assigneeEmail || after.ownerEmail;
  if (!email) return;
  var assigned = before.assigneeEmail !== after.assigneeEmail;
  var body = '<p>A CAPA has been ' + (assigned ? 'assigned to you' : 'updated') + '.</p><table>'
    + tableRow('CAPA No.', after.capaNo || event.params.id)
    + tableRow('Plant', after.plant) + tableRow('Department', after.department)
    + tableRow('Root Cause', after.rootCause) + tableRow('Action', after.action || after.correctiveAction)
    + tableRow('Status', after.status || 'Open') + tableRow('Target Date', fmtDate(after.targetDate))
    + '</table>';
  await sendMail(email, '📋 CAPA ' + (assigned ? 'Assigned' : 'Updated') + ' – ' + (after.capaNo || event.params.id), wrapHtml('CAPA Notification', body, APP_URL.value()));
});

// ── 5. LPA ACTION UPDATED ────────────────────────────────────────────────────
exports.onLpaActionUpdated = onDocumentUpdated({ document: 'lpaActions/{id}', region: REGION, secrets: SECRETS }, async function(event) {
  var before = event.data.before.data();
  var after  = event.data.after.data();
  if (!after || after._isDummy) return;
  if (before.assigneeEmail === after.assigneeEmail && before.status === after.status) return;
  var email = after.assigneeEmail || after.ownerEmail;
  if (!email) return;
  var assigned = before.assigneeEmail !== after.assigneeEmail;
  var body = '<p>An LPA action has been ' + (assigned ? 'assigned to you' : 'updated') + '.</p><table>'
    + tableRow('Action No.', after.actionNo || event.params.id)
    + tableRow('LPA Level', after.lpaLevel) + tableRow('Plant', after.plant)
    + tableRow('Department', after.department) + tableRow('Action', after.action || after.description)
    + tableRow('Status', after.status || 'Open') + tableRow('Target Date', fmtDate(after.targetDate))
    + '</table>';
  await sendMail(email, '📋 LPA Action ' + (assigned ? 'Assigned' : 'Updated') + ' – ' + (after.actionNo || event.params.id), wrapHtml('LPA Action Notification', body, APP_URL.value()));
});

// ── 6. DAILY REMINDER – 8 AM IST ─────────────────────────────────────────────
exports.dailyAuditReminder = onSchedule(
  { schedule: 'CRON_TZ=Asia/Kolkata 30 2 * * *', region: REGION, secrets: SECRETS },
  async function() {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var in3   = new Date(today.getTime() + 3 * 86400000);
    var in2   = new Date(today.getTime() + 2 * 86400000);
    var ts0   = admin.firestore.Timestamp.fromDate(today);
    var ts3   = admin.firestore.Timestamp.fromDate(in3);
    var ts2   = admin.firestore.Timestamp.fromDate(in2);

    async function upcoming(col, isLpa) {
      var snap = await db.collection(col).where('plannedDate', '>=', ts0).where('plannedDate', '<=', ts3).where('published', '==', true).get().catch(function() { return null; });
      if (!snap || snap.empty) return;
      var byEmail = {};
      snap.docs.forEach(function(d) {
        var p = d.data();
        [p.auditorEmail, p.auditeeEmail].filter(Boolean).forEach(function(e) {
          if (!byEmail[e]) byEmail[e] = [];
          byEmail[e].push(p);
        });
      });
      await Promise.allSettled(Object.entries(byEmail).map(async function(entry) {
        var email = entry[0], plans = entry[1];
        var rows = plans.map(function(p) { return '<tr><td>' + (p.name||'—') + '</td><td>' + (p.plant||'—') + '</td><td>' + (p.department||'—') + '</td><td>' + fmtDate(p.plannedDate) + '</td><td>' + (p.shift||'—') + '</td></tr>'; }).join('');
        var body = '<p>You have <strong>' + plans.length + ' ' + (isLpa?'LPA ':'') + 'audit(s)</strong> in the next 3 days.</p><table><tr><th>No.</th><th>Plant</th><th>Dept</th><th>Date</th><th>Shift</th></tr>' + rows + '</table>';
        await sendMail(email, '📅 Reminder: ' + plans.length + ' ' + (isLpa?'LPA ':'') + 'Audit(s) in 3 Days', wrapHtml('Upcoming Audit Reminder', body, APP_URL.value()));
      }));
    }

    async function overdue(col, isLpa) {
      var snap = await db.collection(col).where('status', 'in', ['Open', 'In Progress']).where('dueDate', '<', ts0).get().catch(function() { return null; });
      if (!snap || snap.empty) return;
      var byEmail = {};
      snap.docs.forEach(function(d) {
        var f = Object.assign({ id: d.id }, d.data());
        [f.auditorEmail, f.auditeeEmail, f.assigneeEmail].filter(Boolean).forEach(function(e) {
          if (!byEmail[e]) byEmail[e] = [];
          byEmail[e].push(f);
        });
      });
      await Promise.allSettled(Object.entries(byEmail).map(async function(entry) {
        var email = entry[0], list = entry[1];
        var rows = list.map(function(f) {
          var due = f.dueDate && f.dueDate.toDate ? f.dueDate.toDate() : new Date(f.dueDate);
          var days = Math.floor((today - due) / 86400000);
          return '<tr><td>' + f.id + '</td><td>' + (f.plant||'—') + '</td><td>' + (f.department||'—') + '</td><td>' + sevBadge(f.severity) + '</td><td>' + fmtDate(f.dueDate) + '</td><td style="color:#DC2626;font-weight:700">' + days + 'd</td></tr>';
        }).join('');
        var body = '<p style="color:#DC2626">⚠️ ' + list.length + ' overdue ' + (isLpa?'LPA ':'') + 'finding(s) need immediate attention.</p><table><tr><th>ID</th><th>Plant</th><th>Dept</th><th>Severity</th><th>Due Date</th><th>Overdue By</th></tr>' + rows + '</table>';
        await sendMail(email, '🚨 OVERDUE: ' + list.length + ' ' + (isLpa?'LPA ':'') + 'Finding(s)', wrapHtml('Overdue Findings Alert', body, APP_URL.value()));
      }));
    }

    async function actions(col, isLpa, label) {
      var snap = await db.collection(col).where('status', 'in', ['Open', 'In Progress', 'Pending']).where('targetDate', '<', ts2).get().catch(function() { return null; });
      if (!snap || snap.empty) return;
      var byEmail = {};
      snap.docs.forEach(function(d) {
        var c = Object.assign({ id: d.id }, d.data());
        var e = c.assigneeEmail || c.ownerEmail;
        if (!e) return;
        if (!byEmail[e]) byEmail[e] = [];
        byEmail[e].push(c);
      });
      await Promise.allSettled(Object.entries(byEmail).map(async function(entry) {
        var email = entry[0], items = entry[1];
        var od = items.filter(function(c) { var d = c.targetDate && c.targetDate.toDate ? c.targetDate.toDate() : new Date(c.targetDate||0); return d < today; });
        var rows = items.map(function(c) {
          var due = c.targetDate && c.targetDate.toDate ? c.targetDate.toDate() : new Date(c.targetDate||0);
          var isOD = due < today;
          var lbl = isOD ? '<span style="color:#DC2626">' + Math.floor((today-due)/86400000) + 'd overdue</span>' : '<span style="color:#D97706">Due in ' + Math.ceil((due-today)/86400000) + 'd</span>';
          return '<tr><td>' + (c.capaNo||c.actionNo||c.id) + '</td><td>' + (c.plant||'—') + '</td><td>' + (c.department||'—') + '</td><td>' + (c.action||c.correctiveAction||c.description||'—') + '</td><td>' + fmtDate(c.targetDate) + '</td><td>' + lbl + '</td></tr>';
        }).join('');
        var body = (od.length ? '<p style="color:#DC2626"><strong>' + od.length + ' overdue.</strong></p>' : '') + '<table><tr><th>No.</th><th>Plant</th><th>Dept</th><th>Action</th><th>Target Date</th><th>Status</th></tr>' + rows + '</table>';
        await sendMail(email, '⏰ ' + label + ' Reminder – ' + od.length + ' Overdue, ' + (items.length - od.length) + ' Due Soon', wrapHtml(label + ' Reminder', body, APP_URL.value()));
      }));
    }

    await Promise.allSettled([
      upcoming('auditPlans', false),  upcoming('lpaAudits', true),
      overdue('findings', false),     overdue('lpaFindings', true),
      actions('correctiveActions', false, 'CAPA'),
      actions('lpaActions', true, 'LPA Action'),
    ]);
    console.log('Daily audit reminder complete');
  }
);

// ── 7. TEST EMAIL (callable) ──────────────────────────────────────────────────
exports.sendTestEmail = onCall({ region: REGION, secrets: SECRETS }, async function(req) {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required');
  var to = (req.data && req.data.email) || req.auth.token.email;
  if (!to) throw new HttpsError('invalid-argument', 'No email');
  var body = '<p>✅ Gmail configuration is working correctly!</p><table>'
    + tableRow('Sender', GMAIL_USER.value())
    + tableRow('Recipient', to)
    + tableRow('Time', new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST')
    + '</table><p>All audit notification functions are active:</p>'
    + '<ul style="font-size:14px;color:#334155;line-height:2.2">'
    + '<li>📅 Schedule published → auditors & auditees (General + LPA)</li>'
    + '<li>⚠️ New finding → auditor, auditee, assignee (General + LPA)</li>'
    + '<li>📋 CAPA / LPA Action assigned or updated</li>'
    + '<li>🔔 Daily 8 AM IST reminders (upcoming audits, overdue findings, due CAPAs)</li>'
    + '</ul>';
  await sendMail(to, '✅ Test Email – Group Audit Management System', wrapHtml('Email Configuration Test', body, APP_URL.value()));
  return { success: true, to: to };
});
