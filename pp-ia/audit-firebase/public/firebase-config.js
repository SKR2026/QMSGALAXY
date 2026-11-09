// ─── FIREBASE CONFIG ─────────────────────────────────────────────────────────
// Replace the values below with your actual Firebase project configuration.
// Get these from: Firebase Console → Project Settings → Your Apps → Web App
//
// Steps:
// 1. Go to https://console.firebase.google.com/
// 2. Create a project (or open existing)
// 3. Add a Web App (</> icon on Project Overview)
// 4. Copy the firebaseConfig object values below

const firebaseConfig = {
  apiKey:            "REPLACE_WITH_YOUR_API_KEY",
  authDomain:        "YOUR-PROJECT-ID.firebaseapp.com",
  projectId:         "YOUR-PROJECT-ID",
  storageBucket:     "YOUR-PROJECT-ID.appspot.com",
  messagingSenderId: "REPLACE_WITH_SENDER_ID",
  appId:             "REPLACE_WITH_APP_ID",
  measurementId:     "REPLACE_WITH_MEASUREMENT_ID"   // optional — for Analytics
};

// ─── REQUIRED FIREBASE SERVICES ──────────────────────────────────────────────
// Enable these in your Firebase Console before first use:
//
//  Authentication  → Sign-in method → Email/Password  → Enable
//  Firestore       → Create database → Production mode → Choose region
//  Storage         → Get started → Production mode
//  Functions       → Upgrade to Blaze (pay-as-you-go) plan required
//
// ─── SECRET MANAGER SETUP (for Gmail / email notifications) ──────────────────
//  1.  Enable Secret Manager API in Google Cloud Console
//  2.  Create a secret named  gmail-oauth-creds  with this JSON payload:
//      {
//        "clientId":     "...",
//        "clientSecret": "...",
//        "refreshToken": "...",
//        "fromEmail":    "notifications@yourdomain.com"
//      }
//  3.  Grant the Cloud Functions service account access:
//      roles/secretmanager.secretAccessor
//
// ─── DEPLOY ──────────────────────────────────────────────────────────────────
//  npm install -g firebase-tools
//  firebase login
//  firebase use --add                      # select your project
//  cd functions && npm install && cd ..
//  firebase deploy                         # deploys hosting + functions + rules
//
//  To use emulators for local dev:
//  firebase emulators:start

