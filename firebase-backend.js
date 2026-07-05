// ═══════════════════════════════════════════════════════════════
//  firebase-backend.js  —  QMS GALAXY  |  Secure Backend Layer
//  Replace YOUR_* placeholders with your actual Firebase values
// ═══════════════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  collection, query, orderBy, onSnapshot, serverTimestamp, where, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getStorage,
  ref, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

// ─── FIREBASE CONFIG ─────────────────────────────────────────────────────────
// ⚠️  Replace these values with your own from Firebase Console
const firebaseConfig = {
  apiKey:            "AIzaSyCYGV5HpF6-j_HBqix3EA-XFGmT8E698k8",
  authDomain:        "skr-task.firebaseapp.com",
  projectId:         "skr-task",
  storageBucket:     "skr-task.firebasestorage.app",
  messagingSenderId: "1011690659933",
  appId:             "1:1011690659933:web:f57e43ee0267a475682db4"
};

const app     = initializeApp(firebaseConfig);
const auth    = getAuth(app);
const db      = getFirestore(app);
const storage = getStorage(app);

// ════════════════════════════════════════════════════════════════
//  AUTH  —  Admin & Public Users
// ════════════════════════════════════════════════════════════════

/** Get currently logged-in user */
export const getCurrentUser = () => auth.currentUser;

/** Watch auth state changes */
export const onAuthChange = (callback) => onAuthStateChanged(auth, callback);

/**
 * Admin Login  (email + password — PIN is gone!)
 * @returns {Promise<{success, user, error}>}
 */
export async function adminLogin(email, password) {
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const profile = await getUserProfile(cred.user.uid);
    if (profile?.role !== 'admin') {
      await signOut(auth);
      return { success: false, error: "Not an admin account." };
    }
    return { success: true, user: cred.user };
  } catch (e) {
    return { success: false, error: friendlyAuthError(e.code) };
  }
}

/**
 * Public User Registration
 */
export async function registerUser(username, email, password) {
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: username });
    await setDoc(doc(db, "users", cred.user.uid), {
      username,
      email,
      role: "user",
      createdAt: serverTimestamp()
    });
    return { success: true, user: cred.user };
  } catch (e) {
    return { success: false, error: friendlyAuthError(e.code) };
  }
}

/**
 * Public User Login
 */
export async function loginUser(email, password) {
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    return { success: true, user: cred.user };
  } catch (e) {
    return { success: false, error: friendlyAuthError(e.code) };
  }
}

/** Logout */
export async function logout() {
  await signOut(auth);
}

/** Get user profile from Firestore */
export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/** Check if current user is admin */
export async function isAdmin() {
  const user = auth.currentUser;
  if (!user) return false;
  const profile = await getUserProfile(user.uid);
  return profile?.role === 'admin';
}

// ════════════════════════════════════════════════════════════════
//  SITE CONFIG  —  Brand, Hero, Stats, Contact Info
// ════════════════════════════════════════════════════════════════

/** Load site configuration */
export async function getSiteConfig() {
  const snap = await getDoc(doc(db, "siteConfig", "main"));
  return snap.exists() ? snap.data() : null;
}

/**
 * Save site configuration (admin only — enforced by Firestore rules)
 * @param {Object} config
 */
export async function saveSiteConfig(config) {
  try {
    await setDoc(doc(db, "siteConfig", "main"), {
      ...config,
      updatedAt: serverTimestamp()
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ════════════════════════════════════════════════════════════════
//  PRODUCTS / SERVICES
// ════════════════════════════════════════════════════════════════

/** Get all products (real-time) */
export function onProductsChange(callback) {
  const q = query(collection(db, "products"), orderBy("order", "asc"));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

/** Add or update a product */
export async function saveProduct(product, id = null) {
  try {
    if (id) {
      await updateDoc(doc(db, "products", id), { ...product, updatedAt: serverTimestamp() });
    } else {
      await addDoc(collection(db, "products"), { ...product, createdAt: serverTimestamp() });
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/** Delete a product */
export async function deleteProduct(id) {
  try {
    await deleteDoc(doc(db, "products", id));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ════════════════════════════════════════════════════════════════
//  ENQUIRIES  —  Contact Form Submissions
// ════════════════════════════════════════════════════════════════

/** Submit a contact enquiry */
export async function submitEnquiry(data) {
  try {
    await addDoc(collection(db, "enquiries"), {
      ...data,
      status: "new",
      createdAt: serverTimestamp()
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/** Get all enquiries — admin only (real-time) */
export function onEnquiriesChange(callback) {
  const q = query(collection(db, "enquiries"), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

/** Mark enquiry as read */
export async function markEnquiryRead(id) {
  await updateDoc(doc(db, "enquiries", id), { status: "read" });
}

/** Delete an enquiry */
export async function deleteEnquiry(id) {
  await deleteDoc(doc(db, "enquiries", id));
}

// ════════════════════════════════════════════════════════════════
//  INVOICES
// ════════════════════════════════════════════════════════════════

/** Save invoice */
export async function saveInvoice(invoice) {
  try {
    const ref = await addDoc(collection(db, "invoices"), {
      ...invoice,
      createdAt: serverTimestamp()
    });
    return { success: true, id: ref.id };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/** Get all invoices (real-time) */
export function onInvoicesChange(callback) {
  const q = query(collection(db, "invoices"), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

// ════════════════════════════════════════════════════════════════
//  FORUM  —  Threads & Replies
// ════════════════════════════════════════════════════════════════

/** Get forum threads (real-time) */
export function onThreadsChange(callback) {
  const q = query(collection(db, "forumThreads"), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

/** Create new thread */
export async function createThread(title, body, attachmentUrl = null) {
  const user = auth.currentUser;
  if (!user) return { success: false, error: "Not logged in" };
  try {
    const ref = await addDoc(collection(db, "forumThreads"), {
      title, body,
      authorUid: user.uid,
      authorName: user.displayName || "Anonymous",
      attachmentUrl,
      pinned: false,
      replyCount: 0,
      createdAt: serverTimestamp()
    });
    return { success: true, id: ref.id };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/** Get replies for a thread (real-time) */
export function onRepliesChange(threadId, callback) {
  const q = query(
    collection(db, "forumReplies"),
    where("threadId", "==", threadId),
    orderBy("createdAt", "asc")
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

/** Post a reply */
export async function postReply(threadId, body) {
  const user = auth.currentUser;
  if (!user) return { success: false, error: "Not logged in" };
  try {
    await addDoc(collection(db, "forumReplies"), {
      threadId, body,
      authorUid: user.uid,
      authorName: user.displayName || "Anonymous",
      createdAt: serverTimestamp()
    });
    await updateDoc(doc(db, "forumThreads", threadId), {
      replyCount: (await getDoc(doc(db, "forumThreads", threadId))).data().replyCount + 1
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/** Delete thread (admin or author) */
export async function deleteThread(threadId) {
  try {
    await deleteDoc(doc(db, "forumThreads", threadId));
    // Delete all replies for this thread
    const repliesQ = query(collection(db, "forumReplies"), where("threadId", "==", threadId));
    const repliesSnap = await getDocs(repliesQ);
    const deletions = repliesSnap.docs.map(d => deleteDoc(d.ref));
    await Promise.all(deletions);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ════════════════════════════════════════════════════════════════
//  FILE UPLOADS  —  Firebase Storage
// ════════════════════════════════════════════════════════════════

/**
 * Upload a file to Firebase Storage
 * @param {File} file
 * @param {string} path  e.g. "brand/logo.png" | "products/img1.jpg"
 * @returns {Promise<{success, url, error}>}
 */
export async function uploadFile(file, path) {
  try {
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);
    return { success: true, url };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/** Delete a file from Storage */
export async function deleteFile(path) {
  try {
    await deleteObject(ref(storage, path));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ════════════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════════════

function friendlyAuthError(code) {
  const map = {
    "auth/user-not-found":       "No account found with this email.",
    "auth/wrong-password":       "Incorrect password.",
    "auth/email-already-in-use": "Email already registered.",
    "auth/weak-password":        "Password must be at least 6 characters.",
    "auth/invalid-email":        "Invalid email address.",
    "auth/too-many-requests":    "Too many attempts. Try again later.",
    "auth/invalid-credential":   "Invalid email or password."
  };
  return map[code] || "Something went wrong. Please try again.";
}
