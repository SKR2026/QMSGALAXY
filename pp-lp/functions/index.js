/**
 * functions/index.js
 * LPA Management System — Firebase Cloud Functions
 *
 * These functions run server-side using Firebase Admin SDK.
 * They continue executing even when no browser is open.
 *
 * DEPLOYMENT:
 *   cd functions
 *   npm install
 *   firebase deploy --only functions
 *
 * NEVER place service account keys in this file or commit them to git.
 * Cloud Functions use Firebase's managed service identity automatically.
 */

'use strict';

const functions  = require('firebase-functions');
const admin      = require('firebase-admin');
const config     = require('./config');
const { processDailyAuditReminders, processAuditEscalations } = require('./reminders/auditReminders');
const { processDailyActionReminders, processActionEscalations } = require('./reminders/actionReminders');
const { processEmailQueue } = require('./notifications/notifications');

admin.initializeApp();

const db      = admin.firestore();
const APP_ROOT = 'apps/lpa';

// ── Scheduled: Daily Reminder & Escalation Processor ─────
// Runs every day at 6:00 AM IST (00:30 UTC)
exports.processDailyReminders = functions
  .runWith({ timeoutSeconds: 300, memory: '256MB' })
  .pubsub.schedule('30 0 * * *')
  .timeZone('Asia/Kolkata')
  .onRun(async (context) => {
    const startTime = Date.now();
    const log = { recordsProcessed: 0, notificationsCreated: 0, errors: [] };

    console.log('[LPA Functions] processDailyReminders started at', new Date().toISOString());

    try {
      await processDailyAuditReminders(db, APP_ROOT, log);
      await processDailyActionReminders(db, APP_ROOT, log);
      await processAuditEscalations(db, APP_ROOT, log);
      await processActionEscalations(db, APP_ROOT, log);

      await updateFunctionLog(db, APP_ROOT, 'processDailyReminders', {
        status: 'success',
        recordsProcessed: log.recordsProcessed,
        notificationsCreated: log.notificationsCreated,
        duration: Date.now() - startTime
      });

      console.log(`[LPA Functions] processDailyReminders done. Processed: ${log.recordsProcessed}, Notifications: ${log.notificationsCreated}`);

    } catch (error) {
      console.error('[LPA Functions] processDailyReminders FAILED:', error);

      await updateFunctionLog(db, APP_ROOT, 'processDailyReminders', {
        status: 'error',
        lastError: error.message?.substring(0, 500),
        duration: Date.now() - startTime
      });
    }

    return null;
  });

// ── Scheduled: Email Queue Processor ─────────────────────
// Runs every 15 minutes
exports.processEmailQueue = functions
  .runWith({ timeoutSeconds: 120, memory: '128MB' })
  .pubsub.schedule('every 15 minutes')
  .onRun(async (context) => {
    const log = { emailsSent: 0, errors: [] };

    try {
      await processEmailQueue(db, APP_ROOT, log);

      await updateFunctionLog(db, APP_ROOT, 'processEmailQueue', {
        status: 'success',
        notificationsCreated: log.emailsSent
      });
    } catch (error) {
      console.error('[LPA Functions] processEmailQueue FAILED:', error);
      await updateFunctionLog(db, APP_ROOT, 'processEmailQueue', {
        status: 'error',
        lastError: error.message?.substring(0, 500)
      });
    }

    return null;
  });

// ── Callable: Create LPA User ─────────────────────────────
// Called from the frontend to create a Firebase Auth user + LPA profile atomically.
// Only Super Admin or Plant Admin can call this.
exports.createLPAUser = functions.https.onCall(async (data, context) => {
  // Verify caller is authenticated
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }

  const callerUid = context.auth.uid;

  // Load caller's LPA profile
  const callerDoc = await db.doc(`${APP_ROOT}/users/${callerUid}`).get();
  if (!callerDoc.exists || !['super_admin','plant_admin'].includes(callerDoc.data().role)) {
    throw new functions.https.HttpsError('permission-denied', 'Only administrators can create users.');
  }

  const caller = callerDoc.data();

  // Validate input
  const { email, password, profile } = data;
  if (!email || !password || !profile) {
    throw new functions.https.HttpsError('invalid-argument', 'email, password, and profile are required.');
  }

  // Plant admin can only create users in their own plant
  if (caller.role === 'plant_admin' && profile.plantId !== caller.plantId) {
    throw new functions.https.HttpsError('permission-denied', 'You can only create users for your assigned plant.');
  }

  try {
    // Create Firebase Auth user
    const userRecord = await admin.auth().createUser({
      email,
      password,
      displayName: profile.name,
      disabled: false
    });

    // Create LPA user profile using the new UID as the document ID
    const profileData = {
      ...profile,
      email,
      status:    'active',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: callerUid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastLogin: null
    };

    await db.doc(`${APP_ROOT}/users/${userRecord.uid}`).set(profileData);

    // Log activity
    await db.collection(`${APP_ROOT}/activityLogs`).add({
      userId:    callerUid,
      userName:  caller.name,
      userRole:  caller.role,
      plantId:   caller.plantId || null,
      type:      'user',
      action:    `User created via Cloud Function: ${email}`,
      recordId:  userRecord.uid,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`[LPA Functions] User created: ${email} / ${userRecord.uid}`);

    return { uid: userRecord.uid, success: true };

  } catch (error) {
    console.error('[LPA Functions] createLPAUser error:', error);

    if (error.code === 'auth/email-already-exists') {
      throw new functions.https.HttpsError('already-exists', 'A user with this email already exists.');
    }

    throw new functions.https.HttpsError('internal', 'Failed to create user. Please try again.');
  }
});

// ── Helper: Update Function Execution Log ─────────────────
async function updateFunctionLog(db, appRoot, functionName, data) {
  try {
    await db.doc(`${appRoot}/settings/functionLogs`).set({
      [functionName]: {
        ...data,
        lastRun: admin.firestore.FieldValue.serverTimestamp()
      }
    }, { merge: true });
  } catch (e) {
    console.warn('[LPA Functions] Could not update function log:', e.message);
  }
}
