// ─────────────────────────────────────────────────────────────
//  PTMS – Firebase Configuration
//  Replace the values below with your own Firebase project keys.
//  NEVER commit real credentials to a public GitHub repository.
//  Use environment variables or Firebase Hosting env config.
// ─────────────────────────────────────────────────────────────

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyC0vOWt3PBDu5DzgF37keVvFzll4nriYv0",
  authDomain:        "skr-tm.firebaseapp.com",
  projectId:         "skr-tm",
  storageBucket:     "skr-tm.firebasestorage.app",
  messagingSenderId: "703644096773",
  appId:             "1:703644096773:web:2e156592690f23e4547f6c",
  measurementId:     "G-LP6H8RX4ZN"
};

// ── Initialise Firebase ──────────────────────────────────────
import { initializeApp }                    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth }                          from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, enableIndexedDbPersistence }
                                            from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const app = initializeApp(FIREBASE_CONFIG);

export const auth = getAuth(app);
export const db   = getFirestore(app);

// Optional offline persistence
enableIndexedDbPersistence(db).catch(err => {
  if (err.code === "failed-precondition") {
    console.warn("PTMS: Persistence unavailable – multiple tabs open.");
  } else if (err.code === "unimplemented") {
    console.warn("PTMS: Persistence not supported in this browser.");
  }
});
