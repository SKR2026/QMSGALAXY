/**
 * CDRTS – Firebase Configuration
 * Replace the placeholder values below with your actual Firebase project credentials.
 * Never commit real credentials to a public repository.
 * Use environment variables or Firebase Hosting environment configuration for production.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth }        from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore }   from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage }     from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";
import { getFunctions }   from "https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js";

// ─── REPLACE THESE WITH YOUR FIREBASE PROJECT CREDENTIALS ────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyCUvMUFJ9kPTcyJMbZDymSBDLwqvAvjZmU",
  authDomain:        "skr-doc.firebaseapp.com",
  projectId:         "skr-doc",
  storageBucket:     "skr-doc.firebasestorage.app",
  messagingSenderId: "662002976664",
  appId:             "1:662002976664:web:b4fb5ce40f85db68ad8ded"
};
// ─────────────────────────────────────────────────────────────────────────────

const app       = initializeApp(firebaseConfig);
const auth      = getAuth(app);
const db        = getFirestore(app);
const storage   = getStorage(app);
const functions = getFunctions(app, "asia-south1"); // ✅ Mumbai region

export { app, auth, db, storage, functions };
