/**
 * reminders/auditReminders.js
 * Processes audit reminders and escalations.
 *
 * IDEMPOTENCY: Every notification uses a unique reminderKey so that
 * a function retry or re-run never creates duplicate notifications.
 * Pattern: `audit_${type}_${auditId}_${YYYY-MM-DD}`
 */

'use strict';

const admin = require('firebase-admin');
const { getTodayIST, addDays, formatDate } = require('../utilities/dateUtils');

/**
 * Process daily audit reminders:
 * - Find audits due in 7, 3, 1 day(s)
 * - Find audits due today
 * - Find newly overdue audits
 */
async function processDailyAuditReminders(db, appRoot, log) {
  const today = getTodayIST();

  // Load reminder configuration
  const configDoc = await db.doc(`${appRoot}/settings/reminderConfiguration`).get();
  const cfg = configDoc.exists ? configDoc.data() : {};
  const reminderDays = [
    cfg.auditReminder1 || 7,
    cfg.auditReminder2 || 3,
    cfg.auditReminder3 || 1
  ];

  const notificationsCol = db.collection(`${appRoot}/notifications`);

  // ── Upcoming reminder windows ──────────────────────────
  for (const daysAhead of reminderDays) {
    const targetDate = formatDate(addDays(today, daysAhead));

    const snap = await db.collection(`${appRoot}/audits`)
      .where('plannedDate', '==', targetDate)
      .where('status', 'in', ['Planned','Assigned'])
      .get();

    for (const doc of snap.docs) {
      const audit = doc.data();
      const key   = `audit_reminder_${doc.id}_${targetDate}_d${daysAhead}`;

      await createNotificationIdempotent(notificationsCol, key, {
        recipientUserId:   audit.auditorId,
        plantId:           audit.plantId,
        type:              'audit_due',
        title:             `Audit Due in ${daysAhead} Day${daysAhead > 1 ? 's' : ''}`,
        message:           `Audit for ${audit.processName} (${audit.departmentName}) is due on ${targetDate}.`,
        relatedRecordType: 'audit',
        relatedRecordId:   doc.id,
        priority:          daysAhead === 1 ? 'high' : 'medium',
        reminderKey:       key
      });

      log.recordsProcessed++;
      log.notificationsCreated++;
    }
  }

  // ── Due today ──────────────────────────────────────────
  const todayStr = formatDate(today);
  const dueTodaySnap = await db.collection(`${appRoot}/audits`)
    .where('plannedDate', '==', todayStr)
    .where('status', 'in', ['Planned','Assigned'])
    .get();

  for (const doc of dueTodaySnap.docs) {
    const audit = doc.data();
    const key   = `audit_due_today_${doc.id}_${todayStr}`;

    await createNotificationIdempotent(notificationsCol, key, {
      recipientUserId:   audit.auditorId,
      plantId:           audit.plantId,
      type:              'audit_due',
      title:             'Audit Due Today',
      message:           `Audit for ${audit.processName} is due today. Please complete it.`,
      relatedRecordType: 'audit',
      relatedRecordId:   doc.id,
      priority:          'high',
      reminderKey:       key
    });

    log.recordsProcessed++;
    log.notificationsCreated++;
  }

  // ── Mark overdue + notify ──────────────────────────────
  const yesterdayStr = formatDate(addDays(today, -1));
  const overdueSnap  = await db.collection(`${appRoot}/audits`)
    .where('plannedDate', '<=', yesterdayStr)
    .where('status', 'in', ['Planned','Assigned','In Progress'])
    .get();

  const batch = db.batch();
  const updated = [];

  for (const doc of overdueSnap.docs) {
    batch.update(doc.ref, { status: 'Overdue', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    updated.push(doc);
    log.recordsProcessed++;
  }

  if (updated.length > 0) await batch.commit();

  for (const doc of updated) {
    const audit = doc.data();
    const key   = `audit_overdue_${doc.id}_${todayStr}`;

    await createNotificationIdempotent(notificationsCol, key, {
      recipientUserId:   audit.auditorId,
      plantId:           audit.plantId,
      type:              'audit_overdue',
      title:             'Audit Overdue',
      message:           `Audit for ${audit.processName} is overdue (was due ${audit.plannedDate}).`,
      relatedRecordType: 'audit',
      relatedRecordId:   doc.id,
      priority:          'critical',
      reminderKey:       key
    });

    log.notificationsCreated++;
  }
}

/**
 * Process audit escalations for overdue audits.
 */
async function processAuditEscalations(db, appRoot, log) {
  const today = getTodayIST();

  const configDoc = await db.doc(`${appRoot}/settings/reminderConfiguration`).get();
  const cfg = configDoc.exists ? configDoc.data() : {};
  const escLevels = [
    { days: cfg.escalationLevel1 || 3, level: 1 },
    { days: cfg.escalationLevel2 || 7, level: 2 },
    { days: cfg.escalationLevel3 || 15, level: 3 }
  ];

  for (const esc of escLevels) {
    const cutoff    = formatDate(addDays(today, -esc.days));
    const escalSnap = await db.collection(`${appRoot}/audits`)
      .where('plannedDate', '<=', cutoff)
      .where('status', '==', 'Overdue')
      .get();

    for (const doc of escalSnap.docs) {
      const audit    = doc.data();
      const todayStr = formatDate(today);
      const key      = `audit_esc_l${esc.level}_${doc.id}_${todayStr}`;
      const notifCol = db.collection(`${appRoot}/notifications`);

      // Determine escalation recipients
      const recipients = await getEscalationRecipients(db, appRoot, audit.plantId, esc.level);

      for (const recipientId of recipients) {
        const rKey = `${key}_${recipientId}`;
        await createNotificationIdempotent(notifCol, rKey, {
          recipientUserId:   recipientId,
          plantId:           audit.plantId,
          type:              'escalation',
          title:             `Audit Escalation — Level ${esc.level}`,
          message:           `Audit ${doc.id} for ${audit.processName} is ${esc.days}+ days overdue.`,
          relatedRecordType: 'audit',
          relatedRecordId:   doc.id,
          priority:          'critical',
          escalationLevel:   esc.level,
          reminderKey:       rKey
        });
        log.notificationsCreated++;
      }

      log.recordsProcessed++;
    }
  }
}

/* ── Helpers ─────────────────────────────────────────────── */
async function getEscalationRecipients(db, appRoot, plantId, level) {
  const recipients = [];

  if (level <= 2) {
    // Plant admins for this plant
    const snap = await db.collection(`${appRoot}/users`)
      .where('plantId', '==', plantId)
      .where('role', '==', 'plant_admin')
      .where('status', '==', 'active')
      .get();
    snap.forEach(d => recipients.push(d.id));
  }

  if (level >= 3) {
    // Super Admins (corporate escalation)
    const snap = await db.collection(`${appRoot}/users`)
      .where('role', '==', 'super_admin')
      .where('status', '==', 'active')
      .get();
    snap.forEach(d => recipients.push(d.id));
  }

  return [...new Set(recipients)]; // dedupe
}

/**
 * Create a notification only if the reminderKey doesn't already exist.
 * This guarantees idempotency across function retries.
 */
async function createNotificationIdempotent(notificationsCol, reminderKey, data) {
  // Check for existing notification with this key
  const existing = await notificationsCol
    .where('reminderKey', '==', reminderKey)
    .limit(1)
    .get();

  if (!existing.empty) {
    console.log('[Reminders] Duplicate skipped:', reminderKey);
    return; // Already sent
  }

  await notificationsCol.add({
    ...data,
    read:      false,
    sent:      false,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  // Optionally create an email queue entry
  try {
    await notificationsCol.firestore
      .collection(notificationsCol.parent.path + '/emailQueue')
      .add({
        recipientUserId: data.recipientUserId,
        type:            data.type,
        subject:         data.title,
        body:            data.message,
        relatedRecordId: data.relatedRecordId,
        status:          'Pending',
        attempts:        0,
        createdAt:       admin.firestore.FieldValue.serverTimestamp()
      });
  } catch (e) {
    console.warn('[Reminders] Could not queue email:', e.message);
  }
}

module.exports = { processDailyAuditReminders, processAuditEscalations };
