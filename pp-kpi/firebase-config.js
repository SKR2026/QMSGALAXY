// ════════════════════════════════════════════════════════════════
//  firebase-config.js  —  KPI Dashboard · Polyplastics India
//  Place this file in the SAME folder as kpi-dashboard.html
//  Firebase project : skr-msa
// ════════════════════════════════════════════════════════════════

import { initializeApp }                          from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword,
         signOut, onAuthStateChanged }             from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, doc,
         addDoc, setDoc, getDoc, getDocs,
         updateDoc, deleteDoc, query,
         where, orderBy, onSnapshot,
         serverTimestamp }                         from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getDatabase, ref, set, get,
         onValue, push, update, remove }           from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ── Firebase project config ──────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyD1Ey-yqHEqLB0NFOAfPND0N0TmwA4a6pE",
  authDomain:        "skr-msa.firebaseapp.com",
  databaseURL:       "https://skr-msa-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:         "skr-msa",
  storageBucket:     "skr-msa.firebasestorage.app",
  messagingSenderId: "957782831083",
  appId:             "1:957782831083:web:bc7bf8f9d5e73e3398b3ae"
};

// ── Initialise ───────────────────────────────────────────────────
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);        // Firestore  — master data + KPI entries
const rtdb = getDatabase(app);         // Realtime DB — live presence / alerts

// ════════════════════════════════════════════════════════════════
//  AUTH
// ════════════════════════════════════════════════════════════════

/**
 * Sign in with email + password.
 * Returns { user, profile } where profile is the Firestore /users/{uid} doc.
 * Throws on bad credentials.
 */
export async function loginUser(email, password) {
  const cred    = await signInWithEmailAndPassword(auth, email, password);
  const profile = await getUserProfile(cred.user.uid);
  return { user: cred.user, profile };
}

/** Sign the current user out. */
export async function logoutUser() {
  await signOut(auth);
}

/**
 * Subscribe to auth state changes.
 * callback(user | null)  — user is null when signed out.
 * Returns unsubscribe function.
 */
export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

// ════════════════════════════════════════════════════════════════
//  USERS  (Firestore: /users/{uid})
// ════════════════════════════════════════════════════════════════

/**
 * Firestore document shape:
 * {
 *   name: "Sushil Kumar",
 *   email: "sushil@polyplasticsindia.com",
 *   role: "Super Admin" | "Plant Admin" | "Department User",
 *   plant: "Chennai" | "Daslana" | "Noida" | "All",
 *   department: "Quality" | "Production" | "HR" | "Maintenance" | "Finance" | "SCM" | "All",
 *   createdAt: Timestamp
 * }
 */

export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getAllUsers() {
  const snap = await getDocs(collection(db, "users"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function createUser(uid, userData) {
  await setDoc(doc(db, "users", uid), {
    ...userData,
    createdAt: serverTimestamp()
  });
}

export async function updateUser(uid, updates) {
  await updateDoc(doc(db, "users", uid), updates);
}

// ════════════════════════════════════════════════════════════════
//  PLANTS  (Firestore: /plants/{plantId})
// ════════════════════════════════════════════════════════════════

/**
 * { plantCode: "CHN", plantName: "Chennai", createdAt }
 */

export async function getPlants() {
  const snap = await getDocs(collection(db, "plants"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function addPlant(plantData) {
  return await addDoc(collection(db, "plants"), {
    ...plantData,
    createdAt: serverTimestamp()
  });
}

export async function updatePlant(plantId, updates) {
  await updateDoc(doc(db, "plants", plantId), updates);
}

export async function deletePlant(plantId) {
  await deleteDoc(doc(db, "plants", plantId));
}

// ════════════════════════════════════════════════════════════════
//  KPI MASTER  (Firestore: /kpiMaster/{kpiId})
// ════════════════════════════════════════════════════════════════

/**
 * {
 *   name:        "Customer PPM",
 *   description: "Parts per million defects reported by customers",
 *   unit:        "PPM",
 *   target:      100,
 *   direction:   "lower" | "higher",
 *   weightage:   15,
 *   department:  "Quality",
 *   plant:       "All" | "Chennai" | ...,
 *   createdAt:   Timestamp
 * }
 */

export async function getKPIMaster() {
  const snap = await getDocs(query(collection(db, "kpiMaster"), orderBy("department")));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function addKPI(kpiData) {
  return await addDoc(collection(db, "kpiMaster"), {
    ...kpiData,
    createdAt: serverTimestamp()
  });
}

export async function updateKPI(kpiId, updates) {
  await updateDoc(doc(db, "kpiMaster", kpiId), updates);
}

export async function deleteKPI(kpiId) {
  await deleteDoc(doc(db, "kpiMaster", kpiId));
}

// ════════════════════════════════════════════════════════════════
//  KPI DATA ENTRIES  (Firestore: /kpiData/{entryId})
// ════════════════════════════════════════════════════════════════

/**
 * {
 *   year:         2026,
 *   month:        "June",
 *   plant:        "Chennai",
 *   department:   "Quality",
 *   kpiId:        "abc123",        ← Firestore doc ID from /kpiMaster
 *   kpiName:      "Customer PPM",  ← denormalised for fast reads
 *   target:       100,
 *   actual:       125,
 *   unit:         "PPM",
 *   achievementPct: 80,            ← computed and stored
 *   status:       "missed" | "achieved" | "near-miss",
 *   reason:       "...",           ← required when missed
 *   actionPlan:   "...",           ← required when missed
 *   responsiblePerson: "...",
 *   targetDate:   "2026-07-31",
 *   actionStatus: "open" | "in-progress" | "closed" | "overdue",
 *   submittedBy:  uid,
 *   createdAt:    Timestamp,
 *   updatedAt:    Timestamp
 * }
 */

/**
 * Save a new KPI data entry.
 * Automatically computes achievementPct and status before saving.
 */
export async function saveKPIEntry(entryData) {
  const { actual, target, direction } = entryData;
  const pct   = computeAchievement(actual, target, direction);
  const status = computeStatus(actual, target, direction, pct);

  const payload = {
    ...entryData,
    achievementPct: pct,
    status,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  const docRef = await addDoc(collection(db, "kpiData"), payload);

  // Mirror to Realtime DB for live dashboard updates
  await set(ref(rtdb, `kpiLive/${entryData.plant}/${entryData.year}/${entryData.month}/${docRef.id}`), {
    kpiName: entryData.kpiName,
    actual,
    target,
    status,
    achievementPct: pct,
    department: entryData.department
  });

  return docRef.id;
}

/**
 * Update an existing entry (e.g. close an action plan).
 */
export async function updateKPIEntry(entryId, updates) {
  await updateDoc(doc(db, "kpiData", entryId), {
    ...updates,
    updatedAt: serverTimestamp()
  });
}

/**
 * Get all entries — optionally filtered.
 * filters: { year, month, plant, department }  (any combination, all optional)
 */
export async function getKPIEntries(filters = {}) {
  let q = collection(db, "kpiData");
  const constraints = [orderBy("createdAt", "desc")];

  if (filters.year)       constraints.unshift(where("year",       "==", filters.year));
  if (filters.month && filters.month !== "All")
                          constraints.unshift(where("month",      "==", filters.month));
  if (filters.plant && filters.plant !== "All")
                          constraints.unshift(where("plant",      "==", filters.plant));
  if (filters.department && filters.department !== "All")
                          constraints.unshift(where("department", "==", filters.department));

  const snap = await getDocs(query(q, ...constraints));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Real-time listener for KPI entries.
 * Calls callback(entries[]) every time Firestore data changes.
 * Returns unsubscribe function — call it to stop listening.
 */
export function listenKPIEntries(filters = {}, callback) {
  let q = collection(db, "kpiData");
  const constraints = [orderBy("createdAt", "desc")];

  if (filters.year)       constraints.unshift(where("year",       "==", filters.year));
  if (filters.month && filters.month !== "All")
                          constraints.unshift(where("month",      "==", filters.month));
  if (filters.plant && filters.plant !== "All")
                          constraints.unshift(where("plant",      "==", filters.plant));
  if (filters.department && filters.department !== "All")
                          constraints.unshift(where("department", "==", filters.department));

  return onSnapshot(query(q, ...constraints), snap => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

// ════════════════════════════════════════════════════════════════
//  ACTION PLANS  (sub-view of kpiData where reason is set)
// ════════════════════════════════════════════════════════════════

export async function getOpenActionPlans() {
  const snap = await getDocs(
    query(collection(db, "kpiData"),
      where("actionStatus", "in", ["open", "in-progress", "overdue"]),
      orderBy("targetDate", "asc"))
  );
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function closeActionPlan(entryId) {
  await updateDoc(doc(db, "kpiData", entryId), {
    actionStatus: "closed",
    closedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

// ════════════════════════════════════════════════════════════════
//  REALTIME DB — Live KPI feed & Alerts
// ════════════════════════════════════════════════════════════════

/**
 * Subscribe to live KPI data for a plant/year/month.
 * callback({ kpiId: { kpiName, actual, target, status, achievementPct, department } })
 * Returns unsubscribe function.
 */
export function listenLiveKPI(plant, year, month, callback) {
  const r = ref(rtdb, `kpiLive/${plant}/${year}/${month}`);
  const unsub = onValue(r, snap => {
    callback(snap.exists() ? snap.val() : {});
  });
  return () => unsub(); // returns unsubscribe
}

/**
 * Write an alert to Realtime DB when a KPI turns red.
 * The app (or a Cloud Function) can listen to /alerts to send emails.
 */
export async function raiseAlert(alertData) {
  // alertData: { plant, department, kpiName, actual, target, month, year, raisedBy }
  await push(ref(rtdb, "alerts"), {
    ...alertData,
    status:    "open",
    raisedAt:  Date.now()
  });
}

/**
 * Subscribe to alerts (for Super Admin banner).
 * Returns unsubscribe function.
 */
export function listenAlerts(callback) {
  const r = ref(rtdb, "alerts");
  return onValue(r, snap => {
    const alerts = [];
    if (snap.exists()) {
      snap.forEach(child => alerts.push({ id: child.key, ...child.val() }));
    }
    callback(alerts);
  });
}

// ════════════════════════════════════════════════════════════════
//  SEED HELPER — run once to populate Firestore from local data
//  Usage: import { seedFirestore } from './firebase-config.js'
//         seedFirestore(kpiMasterArray, kpiDataArray)
// ════════════════════════════════════════════════════════════════

export async function seedFirestore(kpiMasterArray, kpiDataArray) {
  console.log("Seeding KPI Master...");
  const kpiIdMap = {};
  for (const k of kpiMasterArray) {
    const ref = await addDoc(collection(db, "kpiMaster"), {
      name:        k.name,
      unit:        k.unit,
      target:      k.target,
      direction:   k.dir,
      weightage:   k.weight,
      department:  k.dept,
      plant:       k.plant || "All",
      description: k.desc  || "",
      createdAt:   serverTimestamp()
    });
    kpiIdMap[k.id] = ref.id;
    console.log(`  ✓ ${k.name} → ${ref.id}`);
  }

  console.log("Seeding KPI Data...");
  for (const d of kpiDataArray) {
    const fsKpiId = kpiIdMap[d.kpiId];
    const kpiObj  = kpiMasterArray.find(k => k.id === d.kpiId);
    if (!fsKpiId || !kpiObj) continue;
    const pct    = computeAchievement(d.actual, d.target, kpiObj.dir);
    const status = computeStatus(d.actual, d.target, kpiObj.dir, pct);
    await addDoc(collection(db, "kpiData"), {
      year:              d.year,
      month:             d.month,
      plant:             d.plant,
      department:        d.dept,
      kpiId:             fsKpiId,
      kpiName:           kpiObj.name,
      target:            d.target,
      actual:            d.actual,
      unit:              kpiObj.unit,
      achievementPct:    pct,
      status,
      reason:            d.reason            || "",
      actionPlan:        d.action            || "",
      responsiblePerson: d.resp              || "",
      targetDate:        d.dueDate           || "",
      actionStatus:      d.actionStatus      || (d.reason ? "open" : ""),
      submittedBy:       "seed",
      createdAt:         serverTimestamp(),
      updatedAt:         serverTimestamp()
    });
  }
  console.log("Seed complete.");
}

// ════════════════════════════════════════════════════════════════
//  INTERNAL HELPERS  (mirrored in dashboard for offline use)
// ════════════════════════════════════════════════════════════════

function computeAchievement(actual, target, direction) {
  if (actual == null || target == null || isNaN(actual) || isNaN(target)) return null;
  if (direction === "lower") return Math.min(200, Math.round((target / actual) * 100));
  return Math.min(200, Math.round((actual / target) * 100));
}

function computeStatus(actual, target, direction, pct) {
  if (pct === null) return "pending";
  const dev = Math.abs(actual - target) / target * 100;
  if (direction === "lower") {
    if (actual <= target)  return "achieved";
    if (dev    <= 10)      return "near-miss";
    return "missed";
  } else {
    if (actual >= target)  return "achieved";
    if (dev    <= 10)      return "near-miss";
    return "missed";
  }
}

// ════════════════════════════════════════════════════════════════
//  EXPORTS SUMMARY
// ════════════════════════════════════════════════════════════════
//
//  Auth         : loginUser, logoutUser, onAuthChange
//  Users        : getUserProfile, getAllUsers, createUser, updateUser
//  Plants       : getPlants, addPlant, updatePlant, deletePlant
//  KPI Master   : getKPIMaster, addKPI, updateKPI, deleteKPI
//  KPI Entries  : saveKPIEntry, updateKPIEntry, getKPIEntries,
//                 listenKPIEntries
//  Action Plans : getOpenActionPlans, closeActionPlan
//  Realtime     : listenLiveKPI, raiseAlert, listenAlerts
//  Seed         : seedFirestore(kpiMasterArray, kpiDataArray)
//
// ════════════════════════════════════════════════════════════════
