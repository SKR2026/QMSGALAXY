/**
 * set-custom-claims.js
 * Firebase Cloud Functions — call this whenever a user is created or
 * their role/plant/status changes.
 *
 * Deploy: place this inside your existing functions/index.js (or import it).
 *
 * These claims are read by firestore.rules to authorise requests without
 * a per-document Firestore get() — critical for Super Admin collection scans.
 */

const functions = require('firebase-functions');
const admin     = require('firebase-admin');

// ── Triggered on Firestore user profile write ─────────────────────────────
// Watches /apps/lpa/users/{uid} — sets custom claims whenever role/plant/status changes.
exports.syncUserClaims = functions.firestore
  .document('apps/lpa/users/{uid}')
  .onWrite(async (change, context) => {
    const uid  = context.params.uid;
    const data = change.after.exists ? change.after.data() : null;

    if (!data) {
      // Document deleted — clear claims
      await admin.auth().setCustomUserClaims(uid, {});
      console.log(`[Claims] Cleared for deleted user ${uid}`);
      return;
    }

    const claims = {
      lpa_role:   data.role     || '',
      lpa_plant:  data.plantId  || '',
      lpa_status: data.status   || 'inactive',
    };

    await admin.auth().setCustomUserClaims(uid, claims);
    console.log(`[Claims] Set for ${uid}:`, claims);
  });


// ── HTTP callable — backfill existing users (run once after deploy) ───────
// Call from Firebase Console > Functions > syncAllClaims, or via:
//   firebase functions:call syncAllUserClaims
exports.syncAllUserClaims = functions.https.onCall(async (data, context) => {
  // Must be called by a super_admin
  if (!context.auth?.token?.lpa_role === 'super_admin') {
    throw new functions.https.HttpsError('permission-denied', 'Super Admin only.');
  }

  const snap = await admin.firestore()
    .collection('apps/lpa/users')
    .get();

  let updated = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    await admin.auth().setCustomUserClaims(doc.id, {
      lpa_role:   d.role     || '',
      lpa_plant:  d.plantId  || '',
      lpa_status: d.status   || 'inactive',
    });
    updated++;
  }

  return { updated };
});
