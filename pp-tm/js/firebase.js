// ─────────────────────────────────────────────────────────────
//  PTMS – Firebase Configuration  (project: skr-tm)
// ─────────────────────────────────────────────────────────────

import { initializeApp }    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth }          from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager }
                            from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyC0vOWt3PBDu5DzgF37keVvFzll4nriYv0",
  authDomain:        "skr-tm.firebaseapp.com",
  projectId:         "skr-tm",
  storageBucket:     "skr-tm.firebasestorage.app",
  messagingSenderId: "703644096773",
  appId:             "1:703644096773:web:2e156592690f23e4547f6c",
  measurementId:     "G-LP6H8RX4ZN"
};

export const app = initializeApp(FIREBASE_CONFIG);

export const auth = getAuth(app);

// Use new persistent cache API (replaces deprecated enableIndexedDbPersistence)
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
} catch (e) {
  // Falls back to in-memory if already initialized or unsupported
  db = getFirestore(app);
}
export { db };
