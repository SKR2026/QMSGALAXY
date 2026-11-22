/**
 * 5S Management System — Cloud Functions
 * Region: asia-south1
 */
'use strict';

import * as admin    from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentWritten, onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import * as nodemailer from 'nodemailer';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

admin.initializeApp();
const db   = admin.firestore();
const auth = admin.auth();

const REGION   = 'asia-south1';
const APP_URL  = process.env.APP_URL || 'https://www.qmsgalaxy.com/pp-5S';
const APP_TZ   = process.env.APP_TZ  || 'Asia/Kolkata';
const SECRETS  = ['GMAIL_USER', 'GMAIL_APP_PASSWORD'] as const;

const GMAIL_USER = defineSecret('GMAIL_USER');
const GMAIL_PASS = defineSecret('GMAIL_APP_PASSWORD');

const CORS_ORIGINS = [
  'https://www.qmsgalaxy.com',
  'https://skr-5s.web.app',
  'https://skr-5s.firebaseapp.com',
  'http://localhost:5000',
  'http://localhost:5173',
  'http://localhost:5000',
  'http://localhost:5173',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function gmailTransport() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER.value(), pass: GMAIL_PASS.value() }
  });
}

async function getUser(uid: string) {
  const snap = await db.collection('users').doc(uid).get();
  return snap.exists ? { id: snap.id, ...snap.data() } as Record<string, unknown> : null;
}

async function sendMail(opts: { to: string | string[]; subject: string; html: string; text?: string }) {
  const t = gmailTransport();
  const result = await t.sendMail({
    from: `"5S Management System" <${GMAIL_USER.value()}>`,
    to: Array.isArray(opts.to) ? opts.to.join(',') : opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  });
  // Log to Firestore
  await db.collection('notificationLogs').add({
    to: opts.to, subject: opts.subject,
    status: 'sent', messageId: result.messageId,
    sentAt: admin.firestore.FieldValue.serverTimestamp()
  });
  return result;
}

async function sendMailSafe(opts: { to: string | string[]; subject: string; html: string }) {
  try { await sendMail(opts); }
  catch (e: unknown) {
    const err = e as Error;
    console.error('[sendMail] Failed:', err.message);
    await db.collection('notificationLogs').add({
      to: opts.to, subject: opts.subject,
      status: 'failed', error: err.message,
      sentAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
}

function istDate(d: Date = new Date()) {
  const zoned = toZonedTime(d, APP_TZ);
  return format(zoned, 'dd MMM yyyy, HH:mm') + ' IST';
}

// ── Email HTML Template ───────────────────────────────────────────────────────
function emailHtml(opts: {
  title: string; subtitle?: string; bodyHtml: string;
  ctaLabel?: string; ctaUrl?: string; footerNote?: string;
}) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${opts.title}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Segoe UI',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px">
        <!-- Header -->
        <tr><td style="background:#1d4ed8;border-radius:12px 12px 0 0;padding:28px 32px;text-align:center">
          <div style="font-size:20px;font-weight:700;color:#fff">5S Management System</div>
          <div style="font-size:13px;color:rgba(255,255,255,.7);margin-top:4px">Manufacturing Excellence</div>
        </td></tr>
        <!-- Body -->
        <tr><td style="background:#fff;padding:32px">
          <h2 style="margin:0 0 8px;font-size:18px;color:#111827">${opts.title}</h2>
          ${opts.subtitle ? `<p style="margin:0 0 20px;color:#6b7280;font-size:14px">${opts.subtitle}</p>` : ''}
          <div style="font-size:14px;color:#374151;line-height:1.7">${opts.bodyHtml}</div>
          ${opts.ctaLabel && opts.ctaUrl ? `
          <div style="margin-top:28px;text-align:center">
            <a href="${opts.ctaUrl}" target="_blank"
               style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;
                      padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px">
              ${opts.ctaLabel} →
            </a>
          </div>` : ''}
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#f9fafb;border-radius:0 0 12px 12px;padding:16px 32px;text-align:center;border-top:1px solid #e5e7eb">
          <div style="font-size:12px;color:#9ca3af">
            ${opts.footerNote ?? 'This is an automated notification from 5S Management System.'}<br>
            © ${new Date().getFullYear()} · Do not reply to this email.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── setUserRole — Superadmin callable ─────────────────────────────────────────
export const setUserRole = onCall(
  { region: REGION, cors: CORS_ORIGINS, secrets: SECRETS },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign-in required.');
    const caller = await getUser(request.auth.uid);
    if (caller?.role !== 'superadmin') throw new HttpsError('permission-denied', 'Superadmin only.');

    const { uid, role, plantIds } = request.data as { uid: string; role: string; plantIds: string[] };
    if (!uid || !role) throw new HttpsError('invalid-argument', 'uid and role required.');

    const validRoles = ['superadmin', 'plant_admin', 'auditor', 'area_owner', 'action_owner', 'viewer'];
    if (!validRoles.includes(role)) throw new HttpsError('invalid-argument', `Invalid role: ${role}`);

    // Set custom claim on Firebase Auth
    await auth.setCustomUserClaims(uid, { role, plantIds: plantIds ?? [] });

    // Update Firestore user doc
    await db.collection('users').doc(uid).update({
      role, plantIds: plantIds ?? [],
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Audit log
    await db.collection('activityLogs').add({
      userId: request.auth.uid, action: 'setUserRole',
      entity: 'user', entityId: uid,
      details: { role, plantIds },
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    return { success: true };
  }
);

// ── sendInvitation ────────────────────────────────────────────────────────────
export const sendInvitation = onCall(
  { region: REGION, cors: CORS_ORIGINS, secrets: SECRETS },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign-in required.');
    const caller = await getUser(request.auth.uid);
    if (!['superadmin', 'plant_admin'].includes(String(caller?.role ?? '')))
      throw new HttpsError('permission-denied', 'Admin only.');

    const { email, name, role, plantIds, tempPassword } = request.data as {
      email: string; name: string; role: string; plantIds: string[]; tempPassword: string;
    };

    // Create Firebase Auth user
    const fbUser = await auth.createUser({ email, password: tempPassword, displayName: name });

    // Set custom claims
    await auth.setCustomUserClaims(fbUser.uid, { role, plantIds });

    // Create Firestore user doc
    await db.collection('users').doc(fbUser.uid).set({
      email, name, role, plantIds,
      status: 'invited',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Send invitation email
    const html = emailHtml({
      title: `Welcome to 5S Management System, ${name}!`,
      subtitle: 'Your account has been created.',
      bodyHtml: `
        <p>You have been invited as <strong>${role.replace('_', ' ')}</strong>.</p>
        <p><strong>Email:</strong> ${email}<br>
           <strong>Temporary Password:</strong> <code style="background:#f3f4f6;padding:2px 6px;border-radius:4px">${tempPassword}</code></p>
        <p style="color:#dc2626;font-size:13px">⚠️ Please change your password immediately after signing in.</p>`,
      ctaLabel: 'Sign In Now',
      ctaUrl: `${APP_URL}/login`,
    });

    await sendMailSafe({ to: email, subject: 'Your 5S Management System Account', html });

    await db.collection('activityLogs').add({
      userId: request.auth.uid, action: 'sendInvitation',
      entity: 'user', entityId: fbUser.uid,
      details: { email, role }, timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    return { success: true, uid: fbUser.uid };
  }
);

// ── onAuditWritten — notify on submit / approve ───────────────────────────────
export const onAuditWritten = onDocumentWritten(
  { document: 'audits/{auditId}', region: REGION, secrets: SECRETS },
  async (event) => {
    const before = event.data?.before?.data();
    const after  = event.data?.after?.data();
    if (!after) return; // deleted

    const prev   = before?.status ?? '';
    const curr   = after.status as string;
    if (prev === curr) return; // no status change

    const auditId = event.params.auditId;

    if (curr === 'Submitted' && prev === 'Draft') {
      // Notify plant admin / reviewer
      const plantSnap = await db.collection('plants').doc(after.plantId as string).get();
      const plant = plantSnap.data();
      if (!plant?.adminIds) return;

      const adminDocs = await Promise.all(
        (plant.adminIds as string[]).map((uid: string) => db.collection('users').doc(uid).get())
      );
      const emails = adminDocs.filter(d => d.exists).map(d => d.data()?.email as string).filter(Boolean);
      if (!emails.length) return;

      const html = emailHtml({
        title: 'Audit Submitted for Review',
        bodyHtml: `
          <p>An audit has been submitted and requires your review.</p>
          <table style="width:100%;font-size:13px;border-collapse:collapse">
            <tr><td style="padding:6px 0;color:#6b7280">Audit:</td><td><strong>${after.templateName}</strong></td></tr>
            <tr><td style="padding:6px 0;color:#6b7280">Area:</td><td>${after.areaName ?? after.deptName ?? '—'}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280">Auditor:</td><td>${after.auditorName}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280">Score:</td><td><strong>${Math.round(after.scores?.overall?.percentage ?? 0)}%</strong></td></tr>
            <tr><td style="padding:6px 0;color:#6b7280">Submitted:</td><td>${istDate()}</td></tr>
          </table>`,
        ctaLabel: 'Review Audit',
        ctaUrl: `${APP_URL}/app/audits/${auditId}`,
      });

      for (const email of emails) {
        await sendMailSafe({
          to: email,
          subject: `Audit Submitted: ${after.templateName} — ${after.areaName ?? after.plantName}`,
          html
        });
      }
    }

    if (curr === 'Approved' && prev !== 'Approved') {
      // Notify auditor
      const auditorSnap = await db.collection('users').doc(after.auditorId as string).get();
      const auditorEmail = auditorSnap.data()?.email as string;
      if (!auditorEmail) return;

      const html = emailHtml({
        title: '✅ Audit Approved',
        bodyHtml: `
          <p>Your audit has been approved.</p>
          <table style="width:100%;font-size:13px;border-collapse:collapse">
            <tr><td style="padding:6px 0;color:#6b7280">Audit:</td><td><strong>${after.templateName}</strong></td></tr>
            <tr><td style="padding:6px 0;color:#6b7280">Score:</td><td><strong>${Math.round(after.scores?.overall?.percentage ?? 0)}%</strong></td></tr>
            <tr><td style="padding:6px 0;color:#6b7280">Approved:</td><td>${istDate()}</td></tr>
          </table>`,
        ctaLabel: 'View Audit Report',
        ctaUrl: `${APP_URL}/app/audits/${auditId}`,
      });

      await sendMailSafe({
        to: auditorEmail,
        subject: `✅ Audit Approved: ${after.templateName}`,
        html
      });
    }
  }
);

// ── onActionCreated — notify owner ────────────────────────────────────────────
export const onActionCreated = onDocumentCreated(
  { document: 'actions/{actionId}', region: REGION, secrets: SECRETS },
  async (event) => {
    const data    = event.data?.data();
    if (!data) return;
    const actionId = event.params.actionId;

    const ownerSnap = await db.collection('users').doc(data.ownerId as string).get();
    const ownerEmail = ownerSnap.data()?.email as string;
    if (!ownerEmail) return;

    const html = emailHtml({
      title: 'New Corrective Action Assigned',
      bodyHtml: `
        <p>A corrective action has been assigned to you.</p>
        <table style="width:100%;font-size:13px;border-collapse:collapse">
          <tr><td style="padding:6px 0;color:#6b7280">Finding:</td><td><strong>${data.findingDescription}</strong></td></tr>
          <tr><td style="padding:6px 0;color:#6b7280">Priority:</td><td>${data.priority}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280">Due Date:</td><td>${data.targetDate?.toDate ? format(data.targetDate.toDate(), 'dd MMM yyyy') : '—'}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280">Area:</td><td>${data.areaName ?? '—'}</td></tr>
        </table>
        <p style="color:#dc2626;font-size:13px">Please log in and update the status and root cause analysis.</p>`,
      ctaLabel: 'View Action',
      ctaUrl: `${APP_URL}/app/actions/${actionId}`,
    });

    await sendMailSafe({
      to: ownerEmail,
      subject: `New Action Assigned: ${(data.findingDescription as string).slice(0, 60)}`,
      html
    });
  }
);

// ── onActionStatusChanged — notify reviewer on submission ─────────────────────
export const onActionWritten = onDocumentWritten(
  { document: 'actions/{actionId}', region: REGION, secrets: SECRETS },
  async (event) => {
    const before = event.data?.before?.data();
    const after  = event.data?.after?.data();
    if (!after || !before) return;
    if (before.status === after.status) return;

    const actionId = event.params.actionId;
    const curr = after.status as string;

    if (curr === 'SubmittedForVerification' && after.reviewerId) {
      const snap = await db.collection('users').doc(after.reviewerId as string).get();
      const email = snap.data()?.email as string;
      if (!email) return;

      const html = emailHtml({
        title: 'Action Submitted for Verification',
        bodyHtml: `
          <p>A corrective action has been submitted for your verification.</p>
          <table style="width:100%;font-size:13px;border-collapse:collapse">
            <tr><td style="padding:6px 0;color:#6b7280">Finding:</td><td><strong>${after.findingDescription}</strong></td></tr>
            <tr><td style="padding:6px 0;color:#6b7280">Owner:</td><td>${after.ownerName}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280">Priority:</td><td>${after.priority}</td></tr>
          </table>`,
        ctaLabel: 'Verify Action',
        ctaUrl: `${APP_URL}/app/actions/${actionId}`,
      });

      await sendMailSafe({ to: email, subject: `Action Ready for Verification: ${(after.findingDescription as string).slice(0, 50)}`, html });
    }

    if (curr === 'Verified' || curr === 'Rejected') {
      const snap = await db.collection('users').doc(after.ownerId as string).get();
      const email = snap.data()?.email as string;
      if (!email) return;

      const isVerified = curr === 'Verified';
      const html = emailHtml({
        title: isVerified ? '✅ Action Verified' : '❌ Action Rejected',
        bodyHtml: `
          <p>Your corrective action has been <strong>${curr.toLowerCase()}</strong>.</p>
          <table style="width:100%;font-size:13px;border-collapse:collapse">
            <tr><td style="padding:6px 0;color:#6b7280">Finding:</td><td><strong>${after.findingDescription}</strong></td></tr>
            <tr><td style="padding:6px 0;color:#6b7280">Status:</td><td><strong style="color:${isVerified ? '#16a34a' : '#dc2626'}">${curr}</strong></td></tr>
          </table>`,
        ctaLabel: 'View Action',
        ctaUrl: `${APP_URL}/app/actions/${actionId}`,
      });

      await sendMailSafe({
        to: email,
        subject: `Action ${curr}: ${(after.findingDescription as string).slice(0, 50)}`,
        html
      });
    }
  }
);

// ── scheduledReminders — daily at 08:00 IST ───────────────────────────────────
export const scheduledReminders = onSchedule(
  { schedule: '0 8 * * *', timeZone: APP_TZ, region: REGION, secrets: SECRETS },
  async () => {
    console.log('[reminders] Starting daily reminder check…');
    const now = new Date();

    // 1. Upcoming audit reminders (due in ≤ 3 days)
    const soon = new Date(now); soon.setDate(soon.getDate() + 3);
    const schedSnap = await db.collection('auditSchedules')
      .where('status', '==', 'Scheduled')
      .where('dueDate', '<=', admin.firestore.Timestamp.fromDate(soon))
      .where('dueDate', '>=', admin.firestore.Timestamp.fromDate(now))
      .limit(50).get();

    for (const doc of schedSnap.docs) {
      const s = doc.data();
      for (const auditorId of (s.auditorIds as string[])) {
        const userSnap = await db.collection('users').doc(auditorId).get();
        const email = userSnap.data()?.email as string;
        if (!email) continue;

        const html = emailHtml({
          title: '📅 Upcoming Audit Reminder',
          bodyHtml: `
            <p>You have an upcoming audit due soon.</p>
            <table style="width:100%;font-size:13px">
              <tr><td style="color:#6b7280;padding:4px 0">Audit:</td><td><strong>${s.title}</strong></td></tr>
              <tr><td style="color:#6b7280;padding:4px 0">Due:</td><td>${format((s.dueDate as admin.firestore.Timestamp).toDate(), 'dd MMM yyyy')}</td></tr>
            </table>`,
          ctaLabel: 'Start Audit',
          ctaUrl: `${APP_URL}/app/schedules`,
        });

        await sendMailSafe({ to: email, subject: `Upcoming Audit: ${s.title}`, html });
      }
    }

    // 2. Overdue actions escalation
    const actionSnap = await db.collection('actions')
      .where('status', 'in', ['Open', 'InProgress'])
      .where('targetDate', '<', admin.firestore.Timestamp.fromDate(now))
      .limit(100).get();

    const batch = db.batch();
    for (const doc of actionSnap.docs) {
      const a = doc.data();
      // Mark overdue if not already
      if (a.status !== 'Overdue') {
        batch.update(doc.ref, {
          status: 'Overdue',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      // Only notify if not notified today
      const lastNotified = (a.overdueNotifiedAt as admin.firestore.Timestamp)?.toDate();
      if (lastNotified && (now.getTime() - lastNotified.getTime()) < 86400000) continue;

      const ownerSnap = await db.collection('users').doc(a.ownerId as string).get();
      const email = ownerSnap.data()?.email as string;
      if (!email) continue;

      const html = emailHtml({
        title: '⚠️ Overdue Action',
        bodyHtml: `
          <p>The following corrective action is <strong style="color:#dc2626">overdue</strong>.</p>
          <table style="width:100%;font-size:13px">
            <tr><td style="color:#6b7280;padding:4px 0">Finding:</td><td><strong>${a.findingDescription}</strong></td></tr>
            <tr><td style="color:#6b7280;padding:4px 0">Due Date:</td><td style="color:#dc2626">${format((a.targetDate as admin.firestore.Timestamp).toDate(), 'dd MMM yyyy')}</td></tr>
            <tr><td style="color:#6b7280;padding:4px 0">Priority:</td><td>${a.priority}</td></tr>
          </table>
          <p>Please update the status and complete the action as soon as possible.</p>`,
        ctaLabel: 'Update Action',
        ctaUrl: `${APP_URL}/app/actions/${doc.id}`,
      });

      await sendMailSafe({ to: email, subject: `⚠️ Overdue Action: ${(a.findingDescription as string).slice(0, 50)}`, html });
      batch.update(doc.ref, { overdueNotifiedAt: admin.firestore.FieldValue.serverTimestamp() });
    }
    await batch.commit();
    console.log('[reminders] Done.');
  }
);

// ── sendTestEmail — callable for admins ───────────────────────────────────────
export const sendTestEmail = onCall(
  { region: REGION, cors: CORS_ORIGINS, secrets: SECRETS },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign-in required.');
    const caller = await getUser(request.auth.uid);
    if (!['superadmin', 'plant_admin'].includes(String(caller?.role ?? '')))
      throw new HttpsError('permission-denied', 'Admin only.');

    const { to } = request.data as { to: string };
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))
      throw new HttpsError('invalid-argument', 'Valid email required.');

    const html = emailHtml({
      title: '🧪 Test Email',
      bodyHtml: `<p>This is a test email from your 5S Management System configuration.</p>
                 <p>If you received this, Gmail notifications are working correctly.</p>
                 <p style="color:#6b7280;font-size:12px">Sent at: ${istDate()}</p>`,
    });

    try {
      await sendMail({ to, subject: '5S Test Email — Configuration OK', html });
      return { success: true };
    } catch (e: unknown) {
      throw new HttpsError('internal', (e as Error).message);
    }
  }
);

// ── generateReport — callable ─────────────────────────────────────────────────
export const generateReport = onCall(
  { region: REGION, cors: CORS_ORIGINS },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign-in required.');
    const caller = await getUser(request.auth.uid);
    if (!['superadmin', 'plant_admin'].includes(String(caller?.role ?? '')))
      throw new HttpsError('permission-denied', 'Admin only.');

    const { plantId, dateFrom, dateTo, type } = request.data as {
      plantId?: string; dateFrom: string; dateTo: string; type: 'audit' | 'action';
    };

    const from = admin.firestore.Timestamp.fromDate(new Date(dateFrom));
    const to   = admin.firestore.Timestamp.fromDate(new Date(dateTo));

    if (type === 'audit') {
      let q = db.collection('audits')
        .where('status', '==', 'Approved')
        .where('approvedAt', '>=', from)
        .where('approvedAt', '<=', to);
      if (plantId) q = q.where('plantId', '==', plantId) as typeof q;

      const snap = await q.limit(500).get();
      const rows = snap.docs.map(d => {
        const a = d.data();
        return {
          id: d.id,
          templateName: a.templateName,
          plantName: a.plantName,
          areaName: a.areaName ?? '—',
          auditorName: a.auditorName,
          overallScore: Math.round(a.scores?.overall?.percentage ?? 0),
          approvedAt: a.approvedAt?.toDate ? format(a.approvedAt.toDate(), 'dd/MM/yyyy') : '—',
        };
      });
      return { success: true, data: rows };
    }

    if (type === 'action') {
      let q = db.collection('actions')
        .where('createdAt', '>=', from)
        .where('createdAt', '<=', to);
      if (plantId) q = q.where('plantId', '==', plantId) as typeof q;

      const snap = await q.limit(500).get();
      const rows = snap.docs.map(d => {
        const a = d.data();
        return {
          id: d.id,
          finding: a.findingDescription,
          ownerName: a.ownerName,
          priority: a.priority,
          status: a.status,
          targetDate: a.targetDate?.toDate ? format(a.targetDate.toDate(), 'dd/MM/yyyy') : '—',
        };
      });
      return { success: true, data: rows };
    }

    throw new HttpsError('invalid-argument', 'type must be audit or action');
  }
);
