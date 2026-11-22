/**
 * HIRA Management System - Firebase Cloud Functions
 * Email reminder system using Gmail API via Nodemailer
 *
 * Deploy: firebase deploy --only functions
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

admin.initializeApp();
const db = admin.firestore();

// ─── GMAIL TRANSPORT ───
// Credentials stored in Firebase environment config (NEVER in code)
// Set with: firebase functions:config:set gmail.user="you@gmail.com" gmail.password="app-password"
function getTransporter() {
  const config = functions.config();
  return nodemailer.createTransporter({
    service: 'gmail',
    auth: {
      user: config.gmail?.user,
      pass: config.gmail?.password  // Gmail App Password (not your real password)
    }
  });
}

// ─── EMAIL LOG ───
async function logEmail({ recipient, cc, subject, type, hiraId, actionId, status, error }) {
  const key = [hiraId, actionId, type, new Date().toISOString().split('T')[0]].filter(Boolean).join('_');
  const existing = await db.collection('emailLogs').where('reminderKey','==',key).get();
  if (!existing.empty) {
    console.log(`Duplicate email prevented: ${key}`);
    return false; // already sent today
  }
  await db.collection('emailLogs').add({
    reminderKey: key, recipient, cc: cc||null, subject, type,
    hiraId: hiraId||null, actionId: actionId||null,
    sentAt: admin.firestore.FieldValue.serverTimestamp(),
    status, error: error||null
  });
  return true;
}

// ─── EMAIL TEMPLATES ───
function hiraReminderEmail(hira, plant, daysUntil) {
  const isOverdue = daysUntil < 0;
  const urgency = isOverdue ? '🔴 OVERDUE' : daysUntil <= 7 ? '🟠 URGENT' : '🟡 REMINDER';

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
  body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 20px; }
  .card { background: #fff; border-radius: 8px; max-width: 600px; margin: 0 auto; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
  .header { background: #1e3a5f; color: #fff; padding: 24px; }
  .header h1 { margin: 0; font-size: 22px; }
  .header p { margin: 6px 0 0; opacity: 0.8; font-size: 14px; }
  .body { padding: 24px; }
  .field { margin-bottom: 14px; }
  .field label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #666; }
  .field p { font-size: 15px; font-weight: 600; color: #222; margin: 2px 0 0; }
  .risk-badge { display: inline-block; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 700; }
  .risk-high { background: #fff3e0; color: #e65100; }
  .risk-critical { background: #ffebee; color: #c62828; }
  .risk-medium { background: #fff8e1; color: #f57f17; }
  .risk-low { background: #e8f5e9; color: #2e7d32; }
  .btn { display: inline-block; background: #1e3a5f; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; margin-top: 20px; }
  .footer { background: #f8f8f8; padding: 16px 24px; font-size: 12px; color: #888; text-align: center; border-top: 1px solid #eee; }
  .status-banner { padding: 12px 16px; border-radius: 6px; margin-bottom: 20px; font-weight: 600; }
  .overdue { background: #ffebee; color: #c62828; }
  .urgent { background: #fff3e0; color: #e65100; }
  .reminder { background: #e3f2fd; color: #1565c0; }
</style></head>
<body>
  <div class="card">
    <div class="header">
      <h1>⚠️ HIRA Review Reminder</h1>
      <p>HIRA Management System — Automated Notification</p>
    </div>
    <div class="body">
      <div class="status-banner ${isOverdue?'overdue':daysUntil<=7?'urgent':'reminder'}">
        ${urgency} — ${isOverdue ? `${Math.abs(daysUntil)} days overdue` : daysUntil === 0 ? 'Due TODAY' : `Due in ${daysUntil} days`}
      </div>

      <div class="field"><label>Plant</label><p>${plant?.name || '—'}</p></div>
      <div class="field"><label>HIRA ID</label><p style="font-family:monospace">${hira.hiraId || hira.id}</p></div>
      <div class="field"><label>Activity</label><p>${hira.activity || '—'}</p></div>
      <div class="field"><label>Department</label><p>${hira.department || '—'}</p></div>
      <div class="field"><label>Review Due Date</label><p>${new Date(hira.reviewDate).toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'})}</p></div>
      <div class="field"><label>Current Status</label><p>${hira.status || 'Approved'}</p></div>

      <p style="color:#555;font-size:14px;line-height:1.6;margin-top:20px">
        ${isOverdue
          ? `This HIRA is <strong>overdue for review</strong>. Please conduct an immediate review and update the assessment to maintain compliance.`
          : `Please ensure the HIRA review is completed before the due date. A current and approved HIRA is essential for workplace safety compliance.`
        }
      </p>

      <a href="${functions.config().app?.url || 'https://your-app.web.app'}" class="btn">Open HIRA System →</a>
    </div>
    <div class="footer">
      This is an automated notification from the HIRA Management System.<br>
      Do not reply to this email. Contact your EHS team for assistance.
    </div>
  </div>
</body>
</html>`;
}

function actionReminderEmail(action, hira, plant, daysUntil) {
  const isOverdue = daysUntil < 0;
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
  body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 20px; }
  .card { background: #fff; border-radius: 8px; max-width: 600px; margin: 0 auto; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
  .header { background: #c62828; color: #fff; padding: 24px; }
  .header h1 { margin: 0; font-size: 22px; }
  .body { padding: 24px; }
  .field { margin-bottom: 14px; }
  .field label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #666; }
  .field p { font-size: 15px; font-weight: 600; color: #222; margin: 2px 0 0; }
  .btn { display: inline-block; background: #c62828; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; margin-top: 20px; }
  .footer { background: #f8f8f8; padding: 16px 24px; font-size: 12px; color: #888; text-align: center; border-top: 1px solid #eee; }
</style></head>
<body>
  <div class="card">
    <div class="header">
      <h1>✅ Action Reminder</h1>
      <p>Subject: [HIRA REMINDER] ${action.actionId} due ${isOverdue ? `${Math.abs(daysUntil)} days ago` : `in ${daysUntil} days`}</p>
    </div>
    <div class="body">
      <div class="field"><label>Action ID</label><p style="font-family:monospace">${action.actionId || action.id}</p></div>
      <div class="field"><label>Plant</label><p>${plant?.name || action.plantName || '—'}</p></div>
      <div class="field"><label>HIRA Reference</label><p>${hira?.hiraId || action.hiraId?.slice(0,8) || '—'}</p></div>
      <div class="field"><label>Hazard</label><p>${action.hazardDesc || '—'}</p></div>
      <div class="field"><label>Action Required</label><p>${action.description || '—'}</p></div>
      <div class="field"><label>Control Type</label><p>${action.controlType || '—'}</p></div>
      <div class="field"><label>Responsible Person</label><p>${action.responsiblePerson || '—'}</p></div>
      <div class="field"><label>Target Date</label><p>${action.targetDate ? new Date(action.targetDate.toDate ? action.targetDate.toDate() : action.targetDate).toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'}) : '—'}</p></div>
      <div class="field"><label>Priority</label><p>${action.priority || '—'}</p></div>
      <div class="field"><label>Current Status</label><p>${action.status || '—'}</p></div>

      <p style="color:#555;font-size:14px;line-height:1.6;margin-top:20px">
        ${isOverdue
          ? `This action is <strong>overdue</strong>. Please complete this corrective action immediately or update the status with a revised timeline.`
          : `Please complete this action before the target date to maintain HIRA compliance and workplace safety.`
        }
      </p>

      <a href="${functions.config().app?.url || 'https://your-app.web.app'}" class="btn">Open Action Tracker →</a>
    </div>
    <div class="footer">
      This is an automated notification from the HIRA Management System.<br>
      Subject: [HIRA REMINDER] Action ${action.actionId} due in ${daysUntil} days
    </div>
  </div>
</body>
</html>`;
}

// ─── SCHEDULED: HIRA REVIEW REMINDERS ───
// Runs daily at 8 AM IST (2:30 AM UTC)
exports.hiraReviewReminder = functions.pubsub
  .schedule('30 2 * * *')
  .timeZone('Asia/Kolkata')
  .onRun(async (context) => {
    console.log('Running HIRA review reminder job...');
    const transporter = getTransporter();
    const today = new Date();

    const snap = await db.collection('hiras')
      .where('status', '==', 'Approved')
      .get();

    for (const doc of snap.docs) {
      const hira = { id: doc.id, ...doc.data() };
      if (!hira.reviewDate) continue;

      const reviewDate = hira.reviewDate.toDate ? hira.reviewDate.toDate() : new Date(hira.reviewDate);
      const daysUntil = Math.ceil((reviewDate - today) / 86400000);

      // Trigger points: 30, 15, 7, 0, and every 7 days after overdue
      const shouldSend =
        daysUntil === 30 || daysUntil === 15 || daysUntil === 7 ||
        daysUntil === 0 || (daysUntil < 0 && Math.abs(daysUntil) % 7 === 0);

      if (!shouldSend) continue;

      const plant = (await db.collection('plants').doc(hira.plantId).get()).data();
      const preparedByUser = hira.preparedBy;
      const recipient = plant?.ehsEmail || functions.config().gmail?.user;
      if (!recipient) continue;

      const reminderType = daysUntil >= 0 ? `review_${daysUntil}d` : `review_overdue_${Math.abs(daysUntil)}d`;
      const canSend = await logEmail({
        recipient, subject: `[HIRA REMINDER] ${hira.hiraId} review ${daysUntil >= 0 ? `in ${daysUntil} days` : 'OVERDUE'}`,
        type: reminderType, hiraId: hira.id, status: 'pending'
      });

      if (!canSend) continue;

      try {
        await transporter.sendMail({
          from: `HIRA System <${functions.config().gmail?.user}>`,
          to: recipient,
          subject: `[HIRA REMINDER] ${hira.hiraId} — Review ${daysUntil >= 0 ? `due in ${daysUntil} days` : `OVERDUE by ${Math.abs(daysUntil)} days`}`,
          html: hiraReminderEmail(hira, plant, daysUntil)
        });

        await db.collection('emailLogs').where('reminderKey', '==',
          [hira.id, null, reminderType, today.toISOString().split('T')[0]].filter(Boolean).join('_')
        ).get().then(snap => {
          snap.docs.forEach(d => d.ref.update({ status: 'sent' }));
        });

        console.log(`HIRA reminder sent for ${hira.hiraId} to ${recipient}`);
      } catch (err) {
        console.error(`Failed to send HIRA reminder for ${hira.hiraId}:`, err);
        await db.collection('emailLogs').add({
          type: reminderType, hiraId: hira.id, recipient,
          subject: `HIRA reminder - ${hira.hiraId}`,
          status: 'error', error: err.message,
          sentAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    }

    console.log('HIRA review reminder job complete.');
    return null;
  });

// ─── SCHEDULED: ACTION REMINDERS ───
// Runs daily at 8 AM IST
exports.actionReminder = functions.pubsub
  .schedule('35 2 * * *')
  .timeZone('Asia/Kolkata')
  .onRun(async (context) => {
    console.log('Running action reminder job...');
    const transporter = getTransporter();
    const today = new Date();

    const snap = await db.collection('actions')
      .where('status', 'in', ['Open', 'In Progress'])
      .get();

    for (const doc of snap.docs) {
      const action = { id: doc.id, ...doc.data() };
      if (!action.targetDate) continue;

      const targetDate = action.targetDate.toDate ? action.targetDate.toDate() : new Date(action.targetDate);
      const daysUntil = Math.ceil((targetDate - today) / 86400000);

      // Trigger: 7, 3, 1 days before; day of; every 3 days after overdue
      const shouldSend =
        daysUntil === 7 || daysUntil === 3 || daysUntil === 1 ||
        daysUntil === 0 || (daysUntil < 0 && Math.abs(daysUntil) % 3 === 0);

      if (!shouldSend) continue;

      const reminderType = `action_${daysUntil >= 0 ? daysUntil + 'd' : 'overdue_' + Math.abs(daysUntil) + 'd'}`;
      const recipient = action.responsibleEmail || functions.config().gmail?.user;
      if (!recipient) continue;

      const canSend = await logEmail({
        recipient, subject: `[HIRA REMINDER] Action ${action.actionId} due in ${daysUntil} days`,
        type: reminderType, hiraId: action.hiraId, actionId: action.id, status: 'pending'
      });
      if (!canSend) continue;

      let hira = null, plant = null;
      try {
        if (action.hiraId) hira = (await db.collection('hiras').doc(action.hiraId).get()).data();
        if (action.plantId) plant = (await db.collection('plants').doc(action.plantId).get()).data();
      } catch (e) { /* best effort */ }

      try {
        await transporter.sendMail({
          from: `HIRA System <${functions.config().gmail?.user}>`,
          to: recipient,
          subject: `[HIRA REMINDER] Action ${action.actionId} due ${daysUntil >= 0 ? `in ${daysUntil} days` : `OVERDUE ${Math.abs(daysUntil)} days`}`,
          html: actionReminderEmail(action, hira, plant, daysUntil)
        });
        console.log(`Action reminder sent for ${action.actionId}`);
      } catch (err) {
        console.error(`Failed to send action reminder for ${action.actionId}:`, err);
      }
    }

    console.log('Action reminder job complete.');
    return null;
  });

// ─── ON HIRA STATUS CHANGE: TRIGGER NOTIFICATION ───
exports.onHiraStatusChange = functions.firestore
  .document('hiras/{hiraId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    if (before.status === after.status) return null;

    const hiraId = context.params.hiraId;
    const creator = after.createdBy;

    // Create in-app notification for creator
    if (creator) {
      await db.collection('notifications').add({
        uid: creator,
        title: `HIRA ${after.status}`,
        body: `${after.hiraId} — ${after.activity} status changed to ${after.status}`,
        type: `hira_${after.status.toLowerCase().replace(/\s/g,'_')}`,
        hiraId, read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    return null;
  });

// ─── ON ACTION STATUS CHANGE ───
exports.onActionStatusChange = functions.firestore
  .document('actions/{actionId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    if (before.status === after.status) return null;

    // Notify HIRA creator if action marked complete
    if (after.status === 'Completed' && after.hiraId) {
      const hira = (await db.collection('hiras').doc(after.hiraId).get()).data();
      if (hira?.createdBy) {
        await db.collection('notifications').add({
          uid: hira.createdBy,
          title: 'Action Completed',
          body: `Action ${after.actionId} has been marked as completed.`,
          type: 'action_completed',
          hiraId: after.hiraId,
          read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    }

    return null;
  });
