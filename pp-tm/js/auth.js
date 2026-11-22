// ─────────────────────────────────────────────────────────────
//  PTMS – Authentication Module
//  Handles login, logout, session, role detection.
// ─────────────────────────────────────────────────────────────

import { auth, db } from "./firebase.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Current session state ────────────────────────────────────
export let currentUser = null;   // { uid, email, name, role, plantId, plantName }

// ── Login ────────────────────────────────────────────────────
export async function loginUser(email, password) {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  const profile    = await fetchUserProfile(credential.user.uid);
  if (!profile.isActive) {
    await signOut(auth);
    throw new Error("Your account has been deactivated. Contact your administrator.");
  }
  return profile;
}

// ── Logout ───────────────────────────────────────────────────
export async function logoutUser() {
  await signOut(auth);
  currentUser = null;
  window.location.href = "index.html";
}

// ── Fetch user profile from Firestore ────────────────────────
async function fetchUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) throw new Error("User profile not found.");
  const data = snap.data();

  let plantName = "";
  if (data.plantId) {
    const pSnap = await getDoc(doc(db, "plants", data.plantId));
    if (pSnap.exists()) plantName = pSnap.data().name;
  }

  currentUser = {
    uid,
    email:     data.email,
    name:      data.name,
    role:      data.role,          // "superAdmin" | "plantUser"
    plantId:   data.plantId || null,
    plantName: plantName,
    isActive:  data.isActive
  };
  return currentUser;
}

// ── Auth state observer ──────────────────────────────────────
// Call this once at app start. Calls onLoggedIn(user) or onLoggedOut().
export function observeAuth(onLoggedIn, onLoggedOut) {
  onAuthStateChanged(auth, async firebaseUser => {
    if (firebaseUser) {
      try {
        const profile = await fetchUserProfile(firebaseUser.uid);
        onLoggedIn(profile);
      } catch (e) {
        console.error("Auth profile error:", e);
        onLoggedOut();
      }
    } else {
      currentUser = null;
      onLoggedOut();
    }
  });
}

// ── Role guards ──────────────────────────────────────────────
export function requireSuperAdmin() {
  if (!currentUser || currentUser.role !== "superAdmin") {
    alert("Access denied.");
    window.location.href = "index.html";
    return false;
  }
  return true;
}

export function requirePlantUser() {
  if (!currentUser || !["plantUser","superAdmin"].includes(currentUser.role)) {
    alert("Please log in.");
    window.location.href = "index.html";
    return false;
  }
  return true;
}
