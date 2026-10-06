/**
 * reminders/actionReminders.js
 * Processes corrective action reminders and escalations.
 */

'use strict';

const admin = require('firebase-admin');
const { getTodayIST, addDays, formatDate } = require('../utilities/dateUtils');

const ACTIVE_STATUSES = ['Open','Assigned','In Progress','Returned','Submitted'];

async function processDailyActionReminders(db, appRoot, log) {
  const today = getTodayIST();

  const configDoc = await db.doc(`${appRoot}/settings/reminderConfiguration`).get();
  const cfg = configDoc.exists ? configDoc.data() : {};
  const reminderDays = [cfg.auditReminder1||7, cfg.auditReminder2||3, cfg.auditReminder3||1];

  const notifCol = db.collection(`${appRoot}/notifications`);

  // ── Upcoming reminders ─────────────────────────────────
  for (const daysAhead of reminderDays) {
    const targetDate = formatDate(addDays(today, daysAhead));

    const snap = await db.collection(`${appRoot}/correctiveActions`)
      .where('targetDate', '==', targetDate)
      .where('status', 'in', ACTIVE_STATUSES)
      .get();

    for (const doc of snap.docs) {
      const action = doc.data();
      const key    = `action_reminder_${doc.id}_${targetDate}_d${daysAhead}`;

      await createNotificationIdempotent(notifCol, key, {
        recipientUserId:   action.createdBy,
        plantId:           action.plantId,
        type:              'action_due',
        title:             `Action Due in ${daysAhead} Day${daysAhead > 1 ? 's' : ''}`,
        message:           `Corrective action ${doc.id} is due on ${targetDate}: ${action.description?.substring(0,80)}`,
        relatedRecordType: 'action',
        relatedRecordId:   doc.id,
        priority:          daysAhead <= 1 ? 'high' : 'medium',
        reminderKey:       key
      });

      log.recordsProcessed++;
      log.notificationsCreated++;
    }
  }

  // ── Due today ──────────────────────────────────────────
  const todayStr      = formatDate(today);
  const dueTodaySnap  = await db.collection(`${appRoot}/correctiveActions`)
    .where('targetDate', '==', todayStr)
    .where('status', 'in', ACTIVE_STATUSES)
    .get();

  for (const doc of dueTodaySnap.docs) {
    const action = doc.data();
    const key    = `action_due_today_${doc.id}_${todayStr}`;

    await createNotificationIdempotent(notifCol, key, {
      recipientUserId:   action.createdBy,
      plantId:           action.plantId,
      type:              'action_due',
      title:             'Action Due Today',
      message:           `Action ${doc.id} is due today: ${action.description?.substring(0,80)}`,
      relatedRecordType: 'action',
      relatedRecordId:   doc.id,
      priority:          'high',
      reminderKey:       key
    });

    log.recordsProcessed++;
    log.notificationsCreated++;
  }

  // ── Mark overdue ───────────────────────────────────────
  const yesterdayStr = formatDate(addDays(today, -1));
  const overdueSnap  = await db.collection(`${appRoot}/correctiveActions`)
    .where('targetDate', '<=', yesterdayStr)
    .where('status', 'in', ACTIVE_STATUSES)
    .get();

  const batch   = db.batch();
  const updated = [];

  for (const doc of overdueSnap.docs) {
    batch.update(doc.ref, {
      status:    'Overdue',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    updated.push(doc);
    log.recordsProcessed++;
  }

  if (updated.length > 0) await batch.commit();

  for (const doc of updated) {
    const action = doc.data();
    const key    = `action_overdue_${doc.id}_${todayStr}`;

    await createNotificationIdempotent(notifCol, key, {
      recipientUserId:   action.createdBy,
      plantId:           action.plantId,
      type:              'action_overdue',
      title:             'Action Overdue',
      message:           `Corrective action ${doc.id} is overdue (was due ${action.targetDate}).`,
      relatedRecordType: 'action',
      relatedRecordId:   doc.id,
      priority:          'critical',
      reminderKey:       key
    });

    log.notificationsCreated++;
  }
}

async function processActionEscalations(db, appRoot, log) {
  const today = getTodayIST();

  const configDoc = await db.doc(`${appRoot}/settings/reminderConfiguration`).get();
  const cfg = configDoc.exists ? configDoc.data() : {};
  const escLevels = [
    { days: cfg.escalationLevel1 || 3,  level: 1 },
    { days: cfg.escalationLevel2 || 7,  level: 2 },
    { days: cfg.escalationLevel3 || 15, level: 3 }
  ];

  for (const esc of escLevels) {
    const cutoff = formatDate(addDays(today, -esc.days));
    const snap   = await db.collection(`${appRoot}/correctiveActions`)
      .where('targetDate', '<=', cutoff)
      .where('status', 'in', ['Overdue', ...ACTIVE_STATUSES])
      .get();

    const todayStr = formatDate(today);
    const notifCol = db.collection(`${appRoot}/notifications`);

    for (const doc of snap.docs) {
      if (!doc.data().targetDate || doc.data().targetDate > cutoff) continue;

      const action     = doc.data();
      const recipients = await getEscalationRecipients(db, appRoot, action.plantId, esc.level);

      for (const recipId of recipients) {
        const rKey = `action_esc_l${esc.level}_${doc.id}_${todayStr}_${recipId}`;
        await createNotificationIdempotent(notifCol, rKey, {
          recipientUserId:   recipId,
          plantId:           action.plantId,
          type:              'escalation',
          title:             `Action Escalation — Level ${esc.level}`,
          message:           `Action ${doc.id} is ${esc.days}+ days overdue: ${action.description?.substring(0,60)}`,
          relatedRecordType: 'action',
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

async function getEscalationRecipients(db, appRoot, plantId, level) {
  const recipients = [];

  if (level <= 2) {
    const snap = await db.collection(`${appRoot}/users`)
      .where('plantId', '==', plantId)
      .where('role', '==', 'plant_admin')
      .where('status', '==', 'active')
      .get();
    snap.forEach(d => recipients.push(d.id));
  }

  if (level >= 3) {
    const snap = await db.collection(`${appRoot}/users`)
      .where('role', '==', 'super_admin')
      .where('status', '==', 'active')
      .get();
    snap.forEach(d => recipients.push(d.id));
  }

  return [...new Set(recipients)];
}

async function createNotificationIdempotent(notifCol, reminderKey, data) {
  const existing = await notifCol.where('reminderKey', '==', reminderKey).limit(1).get();
  if (!existing.empty) return;

  await notifCol.add({
    ...data,
    read:      false,
    sent:      false,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

module.exports = { processDailyActionReminders, processActionEscalations };
