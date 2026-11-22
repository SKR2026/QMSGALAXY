/**
 * firebase-config.js
 * Firebase project configuration for LPA Management System.
 *
 * IMPORTANT: Replace the placeholder values below with your actual Firebase
 * project credentials. These values are safe to include in browser JavaScript
 * (they are public API keys, NOT secret service-account credentials).
 *
 * NEVER place serviceAccountKey.json or any private key in this file.
 * Cloud Functions use Firebase managed identity automatically.
 */

const firebaseConfig = {
  apiKey:            "AIzaSyCgq887hJbn-IRoHvxkj1PULcZhnX5rJ38",
  authDomain:        "skr-lpa.firebaseapp.com",
  projectId:         "skr-lpa",
  storageBucket:     "skr-lpa.firebasestorage.app",
  messagingSenderId: "936292389725",
  appId:             "1:936292389725:web:89aae009142edac0d30eb4"
};

// Initialize Firebase (compat SDK loaded in index.html)
firebase.initializeApp(firebaseConfig);

// Convenience references used throughout the application
const auth = firebase.auth();
const db   = firebase.firestore();

// Application namespace — all LPA data lives under /apps/lpa/
// This prevents user/data collisions if other apps share the same Firebase project.
const APP_ROOT = 'apps/lpa';

/**
 * Firestore collection helpers.
 * Usage: col('users'), col('audits'), etc.
 */
function col(name) {
  return db.collection(`${APP_ROOT}/${name}`);
}

/**
 * Convenience shorthand for a single document reference.
 */
function docRef(collection, id) {
  return db.doc(`${APP_ROOT}/${collection}/${id}`);
}

// Time zone used for all date calculations in the frontend.
// Should match the setting stored in Firestore settings/appSettings.
const ORG_TIMEZONE = 'Asia/Kolkata';

// Pagination defaults
const PAGE_SIZE = 25;

console.log('[LPA] Firebase initialized. App root:', APP_ROOT);
