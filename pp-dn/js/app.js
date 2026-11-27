/**
 * CDRTS – Main Application JavaScript
 * Corporate Document Registration & Tracking System
 */

import { auth, db, storage, functions }
  from "./firebase-config.js";

import {
  signInWithEmailAndPassword,
  signInAnonymously,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

import {
  collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc, setDoc,
  query, where, orderBy, limit, onSnapshot, serverTimestamp,
  Timestamp, writeBatch, runTransaction, startAfter
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

import {
  ref, uploadBytesResumable, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

import {
  httpsCallable
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js";

// ═══════════════════════════════════════════════════════════════════════════
// GLOBALS
// ═══════════════════════════════════════════════════════════════════════════
let currentUser     = null;
let currentUserData = null;
let allDocuments    = [];        // cached document list for client-side ops
let activeFilters   = {};
let selectedPlant   = "";
let chartInstances  = {};
let currentPage     = 1;
const PAGE_SIZE     = 20;
let sortCol         = "submissionDate";
let sortDir         = "desc";
let selectedDocIds  = new Set();
let activeDocModalId = null;
let assignModalDocId = null;
let returnModalDocId = null;
let plants = [], departments = [], categories = [], users = [];

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════
function toIST(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" });
}

function toISTDate(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day:"2-digit", month:"short", year:"numeric" });
}

function nowIST() {
  return new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

function statusLabel(s) {
  const map = {
    draft: "Draft",
    submitted: "Submitted",
    pending_with_mr: "Pending with MR",
    under_process: "Under Process",
    returned_for_correction: "Returned",
    resubmitted: "Resubmitted",
    number_assigned: "Completed",
    closed: "Closed",
    deleted: "Deleted",
  };
  return map[s] || s;
}

function statusBadge(s) {
  return `<span class="status-badge status-${s || "draft"}">${statusLabel(s)}</span>`;
}

function fileIcon(name) {
  if (!name) return "bi-file";
  const ext = name.split(".").pop().toLowerCase();
  const map = { pdf: "bi-file-pdf text-danger", doc: "bi-file-word text-primary", docx: "bi-file-word text-primary",
    xls: "bi-file-excel text-success", xlsx: "bi-file-excel text-success",
    ppt: "bi-file-ppt text-warning", pptx: "bi-file-ppt text-warning" };
  return map[ext] || "bi-file-earmark";
}

function formatFileSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes/1024).toFixed(1) + " KB";
  return (bytes/1048576).toFixed(1) + " MB";
}

function showToast(msg, type = "info") {
  const toast = document.getElementById("appToast");
  const toastMsg = document.getElementById("toastMsg");
  toastMsg.textContent = msg;
  toast.className = `toast align-items-center border-0 toast-${type}`;
  const bsToast = bootstrap.Toast.getOrCreateInstance(toast, { delay: 4000 });
  bsToast.show();
}

function showError(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.classList.remove("d-none"); }
}

function hideError(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add("d-none");
}

function getInitials(name) {
  if (!name) return "?";
  return name.split(" ").map(w => w[0]).join("").substring(0, 2).toUpperCase();
}

function roleName(r) {
  return { superadmin: "Superadmin", corporate_mr: "Corporate MR", user: "Plant User", top_management: "Top Management" }[r] || r;
}

function isSuperadmin() { return currentUserData?.role === "superadmin"; }
function isCorporateMR() { return currentUserData?.role === "corporate_mr"; }
function isUser() { return currentUserData?.role === "user"; }
function isTopManagement() { return currentUserData?.role === "top_management"; }

// IST clock ticker
function startClock() {
  const el = document.getElementById("istClock");
  function tick() {
    el.textContent = new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata", hour:"2-digit", minute:"2-digit", second:"2-digit",
      day:"2-digit", month:"short", year:"numeric"
    }) + " IST";
  }
  tick(); setInterval(tick, 1000);
}

function logActivity(data) {
  return addDoc(collection(db, "activityLogs"), {
    ...data,
    userId: currentUser?.uid,
    userName: currentUserData?.displayName || currentUser?.email,
    timestamp: serverTimestamp(),
  }).catch(console.error);
}

// ── EARLY BRANDING (apply logo on auth screen before login) ──────────────
(async () => {
  try {
    const snap = await getDoc(doc(db, "appSettings", "branding"));
    if (snap.exists()) {
      const b = snap.data();
      const authLogo    = document.getElementById("authLogo");
      const authLogoWrap= document.getElementById("authLogoWrap");
      const authCoName  = document.getElementById("authCompanyName");
      // Logo
      if (b.logoRemoved) {
        if (authLogoWrap) authLogoWrap.style.display = "none";
      } else if (b.logoUrl) {
        if (authLogoWrap) authLogoWrap.style.display = "";
        if (authLogo) { authLogo.src = b.logoUrl; authLogo.style.display = ""; }
      }
      // Company name under logo
      if (b.companyName && authCoName) authCoName.textContent = b.companyName;
      // Primary color
      if (b.primaryColor) {
        document.documentElement.style.setProperty("--primary", b.primaryColor);
        document.documentElement.style.setProperty("--primary-dark", b.primaryColor);
      }
    }
  } catch (_) {}
})();

// ═══════════════════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════════════════
document.getElementById("togglePass").addEventListener("click", () => {
  const el = document.getElementById("loginPassword");
  el.type = el.type === "password" ? "text" : "password";
});

// ── AUTH TAB SWITCHING ────────────────────────────────────────────────────
function showAuthTab(tab) {
  // tab = "login" | "mgmt" | "forgot"
  const loginPanel  = document.getElementById("loginForm");
  const mgmtPanel   = document.getElementById("mgmtForm");
  const forgotPanel = document.getElementById("forgotForm");
  const authTabs    = document.getElementById("authTabs");
  const tabSignIn   = document.getElementById("tabSignIn");
  const tabMgmt     = document.getElementById("tabMgmt");

  loginPanel.classList.add("d-none");
  mgmtPanel.classList.add("d-none");
  forgotPanel.classList.add("d-none");

  if (tab === "login") {
    loginPanel.classList.remove("d-none");
    authTabs.style.display = "";
    tabSignIn.classList.add("active");
    tabMgmt.classList.remove("active");
  } else if (tab === "mgmt") {
    mgmtPanel.classList.remove("d-none");
    authTabs.style.display = "";
    tabMgmt.classList.add("active");
    tabSignIn.classList.remove("active");
  } else if (tab === "forgot") {
    forgotPanel.classList.remove("d-none");
    authTabs.style.display = "none";
  }
}

document.getElementById("tabSignIn").addEventListener("click", () => showAuthTab("login"));
document.getElementById("tabMgmt").addEventListener("click", () => showAuthTab("mgmt"));

document.getElementById("forgotPassLink").addEventListener("click", e => {
  e.preventDefault();
  showAuthTab("forgot");
});

document.getElementById("backToLogin").addEventListener("click", e => {
  e.preventDefault();
  showAuthTab("login");
});

// ── MANAGEMENT VIEW (no PIN — direct access) ─────────────────────────────

document.getElementById("mgmtLoginBtn").addEventListener("click", async () => {
  const errEl = document.getElementById("mgmtPinError");
  const spin  = document.getElementById("mgmtSpinner");
  errEl.classList.add("d-none");
  spin.classList.remove("d-none");

  try {
    const cred = await signInAnonymously(auth);
    currentUser = cred.user;
    currentUserData = {
      uid: cred.user.uid,
      email: "management@view",
      displayName: "Top Management",
      role: "top_management",
      isActive: true,
    };
    spin.classList.add("d-none");
    document.getElementById("authScreen").classList.add("d-none");
    document.getElementById("appShell").classList.remove("d-none");
    initApp();
  } catch (e) {
    spin.classList.add("d-none");
    errEl.textContent = "Error: " + e.message;
    errEl.classList.remove("d-none");
  }
});

document.getElementById("resetBtn").addEventListener("click", async () => {
  const email = document.getElementById("resetEmail").value.trim();
  const msgEl = document.getElementById("resetMsg");
  if (!email) return;
  try {
    await sendPasswordResetEmail(auth, email);
    msgEl.className = "alert alert-success";
    msgEl.textContent = "Password reset link sent! Check your inbox.";
    msgEl.classList.remove("d-none");
  } catch (e) {
    msgEl.className = "alert alert-danger";
    msgEl.textContent = e.message;
    msgEl.classList.remove("d-none");
  }
});

async function doLogin() {
  const email = document.getElementById("loginEmail").value.trim();
  const pass  = document.getElementById("loginPassword").value;
  const errEl = document.getElementById("loginError");
  const spin  = document.getElementById("loginSpinner");
  if (!email || !pass) return;
  errEl.classList.add("d-none");
  spin.classList.remove("d-none");
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    errEl.textContent = e.code === "auth/invalid-credential" || e.code === "auth/wrong-password"
      ? "Invalid email or password." : e.message;
    errEl.classList.remove("d-none");
  } finally {
    spin.classList.add("d-none");
  }
}

document.getElementById("loginBtn").addEventListener("click", doLogin);

// Allow Enter key to trigger login from email or password field
["loginEmail","loginPassword"].forEach(id => {
  document.getElementById(id).addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); doLogin(); }
  });
});

function doSignOut() {
  localStorage.removeItem("sidebarCollapsed");
  signOut(auth).then(() => {
    currentUser = null; currentUserData = null; allDocuments = [];
    document.getElementById("appShell").classList.add("d-none");
    document.getElementById("authScreen").classList.remove("d-none");
    showAuthTab("login");
  });
}

document.getElementById("logoutBtn").addEventListener("click", doSignOut);
document.getElementById("powerOffBtn").addEventListener("click", e => { e.preventDefault(); doSignOut(); });

// ── CHANGE PASSWORD ───────────────────────────────────────────────────────
document.getElementById("changePassMenuBtn").addEventListener("click", e => {
  e.preventDefault();
  document.getElementById("cpCurrentPass").value = "";
  document.getElementById("cpNewPass").value = "";
  document.getElementById("cpConfirmPass").value = "";
  document.getElementById("cpMsg").classList.add("d-none");
  new bootstrap.Modal(document.getElementById("changePassModal")).show();
});

document.getElementById("cpSaveBtn").addEventListener("click", async () => {
  const current = document.getElementById("cpCurrentPass").value;
  const newPass = document.getElementById("cpNewPass").value;
  const confirm = document.getElementById("cpConfirmPass").value;
  const msgEl   = document.getElementById("cpMsg");
  const spin    = document.getElementById("cpSpinner");

  msgEl.classList.add("d-none");

  if (!current || !newPass || !confirm) {
    msgEl.className = "alert alert-danger";
    msgEl.textContent = "Please fill in all fields.";
    msgEl.classList.remove("d-none");
    return;
  }
  if (newPass.length < 8) {
    msgEl.className = "alert alert-danger";
    msgEl.textContent = "New password must be at least 8 characters.";
    msgEl.classList.remove("d-none");
    return;
  }
  if (newPass !== confirm) {
    msgEl.className = "alert alert-danger";
    msgEl.textContent = "New passwords do not match.";
    msgEl.classList.remove("d-none");
    return;
  }

  spin.classList.remove("d-none");
  try {
    const credential = EmailAuthProvider.credential(currentUser.email, current);
    await reauthenticateWithCredential(currentUser, credential);
    await updatePassword(currentUser, newPass);
    msgEl.className = "alert alert-success";
    msgEl.textContent = "Password changed successfully!";
    msgEl.classList.remove("d-none");
    document.getElementById("cpCurrentPass").value = "";
    document.getElementById("cpNewPass").value = "";
    document.getElementById("cpConfirmPass").value = "";
  } catch (e) {
    msgEl.className = "alert alert-danger";
    msgEl.textContent = e.code === "auth/wrong-password" || e.code === "auth/invalid-credential"
      ? "Current password is incorrect."
      : e.message;
    msgEl.classList.remove("d-none");
  } finally {
    spin.classList.add("d-none");
  }
});

onAuthStateChanged(auth, async user => {
  // Skip if already in management view mode
  if (currentUserData?.role === "top_management") return;
  if (user) {
    currentUser = user;
    await loadCurrentUser();
    document.getElementById("authScreen").classList.add("d-none");
    document.getElementById("appShell").classList.remove("d-none");
    initApp();
  } else {
    // Don't redirect if management view is active
    if (currentUserData?.role !== "top_management") {
      document.getElementById("authScreen").classList.remove("d-none");
      document.getElementById("appShell").classList.add("d-none");
    }
  }
});

async function loadCurrentUser() {
  const { setDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
  const userRef = doc(db, "users", currentUser.uid);
  const snap = await getDoc(userRef);

  if (snap.exists()) {
    currentUserData = { uid: currentUser.uid, ...snap.data() };

    // Guard: if user is marked inactive, sign them out
    if (currentUserData.active === false) {
      showToast("Your account has been deactivated. Contact the administrator.", "error");
      await signOut(auth);
      return;
    }
  } else {
    // No user document exists yet — check if this should be the first superadmin
    const usersSnap = await getDocs(query(collection(db, "users"), limit(1)));
    const isFirstUser = usersSnap.empty;

    currentUserData = {
      uid: currentUser.uid,
      email: currentUser.email,
      displayName: currentUser.displayName || currentUser.email.split("@")[0],
      role: isFirstUser ? "superadmin" : "user",
      active: true,
      createdAt: serverTimestamp(),
    };

    // Use setDoc via Admin SDK route (Cloud Function) if not first user
    // For first user, we write directly (Firestore rules allow write if no users exist)
    try {
      await setDoc(userRef, currentUserData);
    } catch (e) {
      console.warn("Could not write user doc:", e.message);
      // Still proceed with in-memory data so app doesn't break
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// APP INIT
// ═══════════════════════════════════════════════════════════════════════════
async function initApp() {
  startClock();
  applyBranding();          // load logo/color/title from Firestore first
  buildSidebar();
  buildTopnavUser();
  setupNavigation();
  setupSidebar();
  setupFilterToggle();
  loadMasterData();
  setupSubmitForm();
  setupSendNotification();
  setupDangerZone();
  navigateTo("dashboard");

  // Deep-link: open doc modal if URL contains #doc/<id>
  const hashMatch = location.hash.match(/^#doc\/(.+)$/);
  if (hashMatch) {
    const docId = hashMatch[1];
    // Small delay so Firestore listeners are ready
    setTimeout(() => openDocModal(docId), 800);
  }
}

async function applyBranding() {
  try {
    const snap = await getDoc(doc(db, "appSettings", "branding"));
    if (!snap.exists()) return;
    const b = snap.data();
    // Apply logo to auth screen and sidebar
    const authLogo     = document.getElementById("authLogo");
    const authLogoWrap = document.getElementById("authLogoWrap");
    const sidebarLogo  = document.getElementById("sidebarLogo");
    if (b.logoRemoved) {
      if (authLogoWrap) authLogoWrap.style.display = "none";
      if (authLogo)     authLogo.style.display = "none";
      if (sidebarLogo)  sidebarLogo.style.display = "none";
    } else if (b.logoUrl) {
      if (authLogoWrap) authLogoWrap.style.display = "";
      if (authLogo)   { authLogo.src = b.logoUrl; authLogo.style.display = ""; }
      if (sidebarLogo){ sidebarLogo.src = b.logoUrl; sidebarLogo.style.display = ""; }
    }
    // Apply company name
    const authCoName     = document.getElementById("authCompanyName");
    const sidebarCoName  = document.getElementById("sidebarCompanyName");
    if (b.companyName) {
      if (authCoName)    authCoName.textContent    = b.companyName;
      if (sidebarCoName) sidebarCoName.textContent = b.companyName;
    }
    // Apply primary color
    if (b.primaryColor) {
      document.documentElement.style.setProperty("--primary", b.primaryColor);
      // Compute darker shade for hover
      document.documentElement.style.setProperty("--primary-dark", b.primaryColor);
    }
    // Apply app title — update page title only; hide topnav brand text if logo is present
    const topnavBrandText = document.getElementById("topnavBrandText");
    if (b.appTitle) {
      document.title = b.appTitle + " – Corporate Document Registration & Tracking";
      document.querySelectorAll(".sidebar-title").forEach(el => el.textContent = b.appTitle);
    }
    // Hide topnav brand text when a logo is shown in sidebar (avoid duplication)
    if (!b.logoRemoved && b.logoUrl && topnavBrandText) {
      topnavBrandText.style.display = "none";
    }
  } catch (e) {
    console.warn("Branding load failed:", e);
  }
}

function buildTopnavUser() {
  const name = currentUserData?.displayName || currentUser?.email || "User";
  const role = currentUserData?.role;
  document.getElementById("topnavAvatar").textContent = getInitials(name);
  document.getElementById("topnavName").textContent = name;
  document.getElementById("topnavRoleLabel").textContent = roleName(role);

  // Show change password only for real (non-anonymous) users
  const cpBtn = document.getElementById("changePassMenuBtn");
  if (role !== "top_management") {
    cpBtn.style.display = "";
  } else {
    cpBtn.style.display = "none";
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SIDEBAR BUILD (role-based)
// ═══════════════════════════════════════════════════════════════════════════
function buildSidebar() {
  const name = currentUserData?.displayName || currentUser?.email || "User";
  document.getElementById("userNameSidebar").textContent = name;
  document.getElementById("userRoleSidebar").textContent = roleName(currentUserData?.role);
  document.getElementById("userAvatarSidebar").textContent = getInitials(name);

  const nav = document.getElementById("sidebarNav");
  nav.innerHTML = "";

  const addSection = label => {
    const li = document.createElement("li");
    li.innerHTML = `<div class="nav-section-label">${label}</div>`;
    nav.appendChild(li);
  };

  const addLink = (view, icon, label) => {
    const li = document.createElement("li");
    li.innerHTML = `<a href="#" data-view="${view}" data-label="${label}"><i class="bi ${icon}"></i><span class="nav-label">&nbsp;${label}</span></a>`;
    nav.appendChild(li);
  };

  addSection("Main");
  addLink("dashboard", "bi-speedometer2", "Dashboard");

  if (isUser()) {
    addSection("Documents");
    addLink("submit", "bi-cloud-upload", "Submit Document");
    addLink("mydocs", "bi-folder2-open", "My Documents");
  }

  if (isCorporateMR()) {
    addSection("Processing");
    addLink("mr", "bi-clipboard-check", "Document Queue");
  }

  if (isSuperadmin()) {
    addSection("Administration");
    addLink("mr", "bi-clipboard-check", "Document Queue");
    addLink("audit", "bi-journal-text", "Audit Logs");
    addLink("settings", "bi-gear", "Settings");
  }

  if (isTopManagement()) {
    // Read-only: dashboard only, no actions
    const badge = document.createElement("li");
    badge.innerHTML = `<div class="text-center px-3 py-2">
      <span class="badge bg-success-subtle text-success border border-success-subtle w-100">
        <i class="bi bi-eye me-1"></i>Read-Only View
      </span></div>`;
    nav.appendChild(badge);
  }

  // Send Notification button (users + corporate MR)
  const sendNotifBtn = document.getElementById("sendNotifBtn");
  if (isUser() || isCorporateMR() || isSuperadmin()) {
    sendNotifBtn.classList.remove("d-none");
  }

  // Bulk actions (superadmin only)
  if (isSuperadmin()) {
    document.querySelectorAll(".superadmin-only").forEach(el => el.classList.remove("d-none"));
    document.getElementById("bulkActions").classList.remove("d-none");
  }

  // Corporate MR — explicitly block all delete access (belt-and-suspenders)
  if (isCorporateMR()) {
    const bulkActions = document.getElementById("bulkActions");
    if (bulkActions) bulkActions.style.setProperty("display", "none", "important");
    document.querySelectorAll(".superadmin-only").forEach(el => {
      el.classList.add("d-none");
      el.style.setProperty("display", "none", "important");
    });
    // Also set body attribute for CSS selector guard
    document.body.dataset.role = "corporate_mr";
  }

  // Hide action buttons for top management
  if (isTopManagement()) {
    document.querySelectorAll(".superadmin-only, #bulkActions, #sendNotifBtn, .btn-assign, .btn-return, .btn-delete").forEach(el => el.classList.add("d-none"));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════
function navigateTo(view) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.querySelectorAll(".sidebar-nav a").forEach(a => a.classList.remove("active"));

  const viewEl = document.getElementById(`view-${view}`);
  if (viewEl) viewEl.classList.add("active");

  document.querySelectorAll(`[data-view="${view}"]`).forEach(a => a.classList.add("active"));

  const titles = {
    dashboard: "Dashboard",
    submit: "Submit Document",
    mydocs: "My Documents",
    mr: "Document Processing Queue",
    audit: "Audit & Activity Logs",
    settings: "Settings"
  };
  document.getElementById("pageTitle").textContent = titles[view] || view;

  // Load view-specific data
  if (view === "dashboard") loadDashboard();
  if (view === "mydocs")    loadMyDocuments();
  if (view === "mr")        { _mrAllTabLoaded = false; initMRTabs(); loadMRQueue(); }
  if (view === "audit")     loadAuditLogs();
  if (view === "settings")  loadSettings();
  if (view === "submit")    { prepareSubmitForm(); loadRecentSubmissions(); }

  // Close mobile sidebar
  document.getElementById("sidebar").classList.remove("mobile-open");
  document.querySelector(".sidebar-overlay")?.classList.remove("active");
}

let _navigationInitialized = false;
function setupNavigation() {
  if (_navigationInitialized) return;
  _navigationInitialized = true;
  document.getElementById("sidebarNav").addEventListener("click", e => {
    const a = e.target.closest("a[data-view]");
    if (a) { e.preventDefault(); navigateTo(a.dataset.view); }
  });

  // KPI card clicks → filter by status
  const kpiStatusMap = {
    kpiTotal:       "",                      // all (clear status filter)
    kpiPending:     "__awaiting_mr",           // multi-status: submitted + pending_with_mr + resubmitted + under_process
    kpiUnderProcess:"under_process",
    kpiReturned:    "returned_for_correction",
    kpiNumbered:    "completed",
    kpiDmsTime:     "",                      // metric only — no status filter
    kpiTurnaround:  "",                      // metric only — no status filter
  };
  document.getElementById("kpiRow").addEventListener("click", e => {
    const card = e.target.closest(".kpi-card");
    if (!card) return;
    const valueEl = card.querySelector("[id^='kpi']");
    if (!valueEl) return;
    const kpiId = valueEl.id;
    const statusVal = kpiStatusMap[kpiId];
    if (statusVal === undefined) return;
    document.getElementById("filterStatus").value = statusVal;
    // highlight active card
    document.querySelectorAll(".kpi-card").forEach(c => {
      c.style.outline = "";
      c.style.boxShadow = "";
    });
    if (statusVal !== "") {
      card.style.outline = "2px solid var(--accent)";
      card.style.boxShadow = "0 0 0 4px rgba(46,134,222,0.15)";
    }
    loadDashboard();
  });

  document.getElementById("applyFilters").addEventListener("click", () => loadDashboard());
  document.getElementById("clearFilters").addEventListener("click", () => {
    document.getElementById("filterFY").value = "";
    document.getElementById("filterMonth").value = "";
    document.getElementById("filterDateFrom").value = "";
    document.getElementById("filterDateTo").value = "";
    document.getElementById("filterDept").value = "";
    document.getElementById("filterCat").value = "";
    document.getElementById("filterStatus").value = "";
    selectedPlant = "";
    document.querySelectorAll(".plant-btn").forEach(b => b.classList.remove("active"));
    document.querySelector(".plant-btn[data-plant='']")?.classList.add("active");
    loadDashboard();
  });

  // Settings tabs
  document.getElementById("settingsTabs").addEventListener("click", e => {
    const a = e.target.closest("a[data-tab]");
    if (!a) return;
    e.preventDefault();
    document.querySelectorAll(".nav-tabs .nav-link").forEach(l => l.classList.remove("active"));
    document.querySelectorAll(".settings-tab").forEach(t => t.classList.remove("active"));
    a.classList.add("active");
    document.getElementById(a.dataset.tab).classList.add("active");
  });

  // Financial year options
  const fySelect = document.getElementById("filterFY");
  const year = new Date().getFullYear();
  for (let y = year; y >= year - 5; y--) {
    fySelect.innerHTML += `<option value="${y}-${y+1}">${y}-${y+1}</option>`;
  }
  fySelect.insertAdjacentHTML("afterbegin", `<option value="">All Years</option>`);

  // Table search
  document.getElementById("tableSearch").addEventListener("input", e => {
    renderDocTable(filterDocsBySearch(allDocuments, e.target.value));
  });

  // Sort columns
  document.getElementById("docTable").addEventListener("click", e => {
    const th = e.target.closest("th[data-col]");
    if (!th) return;
    const col = th.dataset.col;
    sortDir = sortCol === col ? (sortDir === "asc" ? "desc" : "asc") : "asc";
    sortCol = col;
    renderDocTable(allDocuments);
  });

  // Master checkbox
  document.getElementById("masterCheckbox")?.addEventListener("change", e => {
    document.querySelectorAll(".row-checkbox").forEach(cb => {
      cb.checked = e.target.checked;
      e.target.checked ? selectedDocIds.add(cb.dataset.id) : selectedDocIds.delete(cb.dataset.id);
    });
    updateSelectionUI();
  });

  // Export Excel
  document.getElementById("exportExcelBtn").addEventListener("click", exportToExcel);

  // Delete selected
  document.getElementById("deleteSelectedBtn")?.addEventListener("click", () => {
    if (!selectedDocIds.size) return showToast("Select at least one record.", "warning");
    document.getElementById("deleteCount").textContent = selectedDocIds.size;
    new bootstrap.Modal(document.getElementById("deleteModal")).show();
  });

  // Confirm delete
  document.getElementById("confirmDeleteBtn").addEventListener("click", handleDeleteRecords);

  // MR filters — dropdowns & search filter in-memory instantly (no re-fetch)
  ["mrFilterPlant","mrFilterDept","mrFilterCat","mrFilterStatus"].forEach(id => {
    document.getElementById(id).addEventListener("change", renderMRQueue);
  });

  document.getElementById("mrSearch").addEventListener("input", renderMRQueue);
}

const SIDEBAR_FULL = 260;   // matches --sidebar-width in styles.css
const SIDEBAR_MINI = 56;    // icon-strip width

function updateSelectionUI() {
  const count = selectedDocIds.size;
  const badge = document.getElementById("selectedCountBadge");
  const deleteBtn = document.getElementById("deleteSelectedBtn");
  if (badge) {
    if (count > 0) {
      badge.textContent = count;
      badge.style.setProperty("display", "inline-block", "important");
    } else {
      badge.style.setProperty("display", "none", "important");
    }
  }
  // Also update Select All button label
  const selectAllBtn = document.getElementById("selectAllBtn");
  if (selectAllBtn) {
    const total = document.querySelectorAll(".row-checkbox").length;
    const allSelected = count > 0 && count === total;
    selectAllBtn.innerHTML = allSelected
      ? `<i class="bi bi-x-square"></i> Deselect All`
      : `<i class="bi bi-check-all"></i> Select All <span style="font-size:11px;opacity:0.7;">${count > 0 ? "("+count+" selected)" : ""}</span>`;
  }
}

function applySidebarLayout(collapsed) {
  // styles.css now handles margin-left and width via the sibling selector.
  // No inline styles needed — CSS transitions handle the animation.
}

let _sidebarInitialized = false;
function setupSidebar() {
  // Only initialize once — re-running on account switch adds duplicate listeners
  if (_sidebarInitialized) {
    // Just reset mobile-open state when switching accounts
    const sidebar = document.getElementById("sidebar");
    sidebar.classList.remove("mobile-open");
    document.querySelector(".sidebar-overlay")?.classList.remove("active");
    return;
  }
  _sidebarInitialized = true;

  const overlay = document.createElement("div");
  overlay.className = "sidebar-overlay";
  document.body.appendChild(overlay);

  const sidebar = document.getElementById("sidebar");

  // Restore state on load
  const startCollapsed = localStorage.getItem("sidebarCollapsed") === "true";
  if (startCollapsed) sidebar.classList.add("collapsed");
  applySidebarLayout(startCollapsed);

  document.getElementById("menuToggle").addEventListener("click", () => {
    sidebar.classList.toggle("mobile-open");
    overlay.classList.toggle("active");
  });

  document.getElementById("sidebarToggle").addEventListener("click", () => {
    const isCollapsed = sidebar.classList.toggle("collapsed");
    applySidebarLayout(isCollapsed);
    localStorage.setItem("sidebarCollapsed", String(isCollapsed));
    document.getElementById("sidebarToggle").title = isCollapsed ? "Expand sidebar" : "Collapse sidebar";
  });

  overlay.addEventListener("click", () => {
    sidebar.classList.remove("mobile-open");
    overlay.classList.remove("active");
  });
}

let _filterToggleInitialized = false;
function setupFilterToggle() {
  if (_filterToggleInitialized) return;
  _filterToggleInitialized = true;
  const btn = document.getElementById("filterToggle");
  const body = document.getElementById("filterBody");
  const chevron = document.getElementById("filterChevron");
  if (!btn || !body) return;
  btn.addEventListener("click", () => {
    const hidden = body.style.display === "none";
    body.style.display = hidden ? "" : "none";
    chevron.className = hidden ? "bi bi-chevron-up" : "bi bi-chevron-down";
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// MASTER DATA (plants, departments, categories)
// ═══════════════════════════════════════════════════════════════════════════
async function loadMasterData() {
  const [plantsSnap, deptsSnap, catsSnap] = await Promise.all([
    getDocs(query(collection(db, "plants"), where("active", "==", true))),
    getDocs(query(collection(db, "departments"), where("active", "==", true))),
    getDocs(query(collection(db, "documentCategories"), where("active", "==", true))),
  ]);

  plants = plantsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  departments = deptsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  categories = catsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  populatePlantFilters();
  populateFilterDropdowns();
}

function populatePlantFilters() {
  const container = document.getElementById("plantFilterBtns");
  container.innerHTML = `<button class="plant-btn active" data-plant="">All Plants</button>`;
  plants.forEach(p => {
    container.innerHTML += `<button class="plant-btn" data-plant="${p.id}">${p.name}</button>`;
  });

  container.querySelectorAll(".plant-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      container.querySelectorAll(".plant-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      selectedPlant = btn.dataset.plant;
      loadDashboard();
    });
  });

  // Also populate MR filter dropdowns
  const mrPlantSel = document.getElementById("mrFilterPlant");
  mrPlantSel.innerHTML = `<option value="">All Plants</option>`;
  plants.forEach(p => mrPlantSel.innerHTML += `<option value="${p.id}">${p.name}</option>`);
}

function populateFilterDropdowns() {
  // Department filter
  const deptSel = document.getElementById("filterDept");
  const mrDeptSel = document.getElementById("mrFilterDept");
  deptSel.innerHTML = `<option value="">All Departments</option>`;
  mrDeptSel.innerHTML = `<option value="">All Departments</option>`;
  departments.forEach(d => {
    const opt = `<option value="${d.id}">${d.name}</option>`;
    deptSel.innerHTML += opt;
    mrDeptSel.innerHTML += opt;
  });

  // Category filter
  const catSel = document.getElementById("filterCat");
  const mrCatSel = document.getElementById("mrFilterCat");
  catSel.innerHTML = `<option value="">All Categories</option>`;
  mrCatSel.innerHTML = `<option value="">All Categories</option>`;
  categories.forEach(c => {
    const opt = `<option value="${c.id}">${c.name}</option>`;
    catSel.innerHTML += opt;
    mrCatSel.innerHTML += opt;
  });

  // Submit form dropdowns
  const docCatSel  = document.getElementById("docCategory");
  const docDeptSel = document.getElementById("docDept");
  docCatSel.innerHTML = `<option value="">Select Category</option>`;
  categories.forEach(c => docCatSel.innerHTML += `<option value="${c.id}" data-name="${c.name}">${c.name}</option>`);

  docDeptSel.innerHTML = `<option value="">Select Department</option>`;
  departments.forEach(d => docDeptSel.innerHTML += `<option value="${d.id}" data-name="${d.name}">${d.name}</option>`);

  // docPlant is now a hidden input + docPlantDisplay text input (read-only)
  // Plant auto-filled from currentUserData in prepareSubmitForm()
  if (currentUserData?.departmentId) docDeptSel.value = currentUserData.departmentId;

  // Also resolve plantName in currentUserData if only plantId is known
  if (currentUserData?.plantId && !currentUserData?.plantName) {
    const matchPlant = plants.find(p => p.id === currentUserData.plantId);
    if (matchPlant) currentUserData.plantName = matchPlant.name;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════
async function loadDashboard() {
  const filters = getActiveFilters();
  let q = collection(db, "documents");
  // Avoid != operator (requires composite index) — fetch all, filter client-side
  let constraints = [];

  // Only add equality filters (safe, no index needed with single field)
  // "__awaiting_mr" is a client-side multi-status filter — skip Firestore where clause
  if (filters.status && filters.status !== "" && filters.status !== "__awaiting_mr") {
    constraints.push(where("status", "==", filters.status));
  }
  if (isUser()) constraints.push(where("submittedBy", "==", currentUser.uid));

  const snap = await getDocs(constraints.length ? query(q, ...constraints) : q);
  allDocuments = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Filter client-side (no index required)
  allDocuments = allDocuments.filter(d => d.status !== "deleted");
  if (filters.status === "__awaiting_mr") {
    allDocuments = allDocuments.filter(d => ["submitted","pending_with_mr","resubmitted","under_process"].includes(d.status));
  }
  if (filters.plantId)      allDocuments = allDocuments.filter(d => d.plantId === filters.plantId);
  if (filters.departmentId) allDocuments = allDocuments.filter(d => d.departmentId === filters.departmentId);
  if (filters.categoryId)   allDocuments = allDocuments.filter(d => d.categoryId === filters.categoryId);

  // Sort client-side by date desc (support both old submissionDate and new submittedAt)
  allDocuments.sort((a, b) => {
    const da = (a.submittedAt || a.submissionDate)?.toMillis?.() || 0;
    const db2 = (b.submittedAt || b.submissionDate)?.toMillis?.() || 0;
    return db2 - da;
  });

  // Date range filter (client-side)
  let filtered = allDocuments;
  if (filters.dateFrom || filters.dateTo) {
    filtered = allDocuments.filter(doc => {
      if (!doc.submissionDate) return false;
      const d = doc.submissionDate.toDate();
      if (filters.dateFrom && d < new Date(filters.dateFrom)) return false;
      if (filters.dateTo && d > new Date(filters.dateTo + "T23:59:59")) return false;
      return true;
    });
  }
  if (filters.month) {
    filtered = filtered.filter(doc => {
      if (!doc.submissionDate) return false;
      const d = doc.submissionDate.toDate();
      return (d.getMonth() + 1) === parseInt(filters.month);
    });
  }

  allDocuments = filtered;

  updateKPIs(filtered);
  updateCharts(filtered);
  renderDocTable(filtered);
}

function getActiveFilters() {
  return {
    plantId:      selectedPlant,
    departmentId: document.getElementById("filterDept").value,
    categoryId:   document.getElementById("filterCat").value,
    status:       document.getElementById("filterStatus").value,
    dateFrom:     document.getElementById("filterDateFrom").value,
    dateTo:       document.getElementById("filterDateTo").value,
    month:        document.getElementById("filterMonth").value,
    fy:           document.getElementById("filterFY").value,
  };
}

function updateKPIs(docs) {
  const total     = docs.filter(d => d.status !== "draft" && d.status !== "deleted").length;
  const pending   = docs.filter(d => ["submitted","pending_with_mr","resubmitted","under_process"].includes(d.status)).length;
  const process   = docs.filter(d => ["under_process"].includes(d.status)).length;
  const returned  = docs.filter(d => d.status === "returned_for_correction").length;
  const numbered  = docs.filter(d => ["completed","number_assigned","closed"].includes(d.status)).length;

  // Helper: get submission timestamp (supports both old submissionDate and new submittedAt)
  const getSubMs = d => {
    const ts = d.submittedAt || d.submissionDate;
    if (!ts) return null;
    return ts.toDate ? ts.toDate().getTime() : (ts.seconds ? ts.seconds * 1000 : null);
  };

  // Average DMS Upload Time: submission → dmsUploadDate
  // dmsUploadDate is a date-only string; use end-of-day IST to avoid negative diff
  const dmsTimeDocs = docs.filter(d => getSubMs(d) !== null && d.dmsUploadDate);
  let avgDms = "—";
  if (dmsTimeDocs.length) {
    const totalDays = dmsTimeDocs.reduce((acc, d) => {
      const sub = getSubMs(d);
      const dms = new Date(d.dmsUploadDate + "T23:59:59+05:30").getTime();
      return acc + Math.max(0, (dms - sub) / 86400000);
    }, 0);
    avgDms = (totalDays / dmsTimeDocs.length).toFixed(1) + "d";
  }

  // Average Numbering Turnaround: submission → assignmentDate (or dmsUploadDate fallback)
  const taDocs = docs.filter(d => getSubMs(d) !== null && (d.assignmentDate || d.dmsUploadDate));
  let avgTA = "—";
  if (taDocs.length) {
    const totalDays = taDocs.reduce((acc, d) => {
      const sub = getSubMs(d);
      let asg;
      if (d.assignmentDate) {
        asg = d.assignmentDate.toDate ? d.assignmentDate.toDate().getTime() : d.assignmentDate.seconds * 1000;
      } else {
        asg = new Date(d.dmsUploadDate + "T23:59:59+05:30").getTime();
      }
      return acc + Math.max(0, (asg - sub) / 86400000);
    }, 0);
    avgTA = (totalDays / taDocs.length).toFixed(1) + "d";
  }

  setKPI("kpiTotal", total);
  setKPI("kpiPending", pending);
  setKPI("kpiUnderProcess", process);
  setKPI("kpiReturned", returned);
  setKPI("kpiNumbered", numbered);
  setKPI("kpiDmsTime", avgDms);
  setKPI("kpiTurnaround", avgTA);
}

function setKPI(id, val) {
  const el = document.getElementById(id);
  if (el) { el.textContent = val; el.classList.add("updated"); setTimeout(() => el.classList.remove("updated"), 400); }
}

function updateCharts(docs) {
  const COLORS = ["#2e86de","#22c55e","#f59e0b","#ef4444","#8b5cf6","#14b8a6","#f97316","#ec4899","#64748b","#06b6d4"];

  // Plant-wise bar chart
  const plantMap = {};
  docs.forEach(d => { if(d.plantName) plantMap[d.plantName] = (plantMap[d.plantName]||0) + 1; });
  buildChart("chartPlant", "bar", Object.keys(plantMap), Object.values(plantMap), "Documents", COLORS);

  // Monthly trend line chart
  const monthMap = {};
  docs.forEach(d => {
    if (!d.submissionDate) return;
    const dt = d.submissionDate.toDate();
    const key = dt.toLocaleString("en-IN", { month:"short", year:"2-digit" });
    monthMap[key] = (monthMap[key]||0) + 1;
  });
  const monthKeys = Object.keys(monthMap).slice(-12);
  buildChart("chartMonthly", "line", monthKeys, monthKeys.map(k=>monthMap[k]), "Submissions", [COLORS[0]]);

  // Dept pie
  const deptMap = {};
  docs.forEach(d => { if(d.departmentName) deptMap[d.departmentName] = (deptMap[d.departmentName]||0) + 1; });
  buildChart("chartDept", "doughnut", Object.keys(deptMap), Object.values(deptMap), null, COLORS);

  // Category pie
  const catMap = {};
  docs.forEach(d => { if(d.categoryName) catMap[d.categoryName] = (catMap[d.categoryName]||0) + 1; });
  buildChart("chartCat", "doughnut", Object.keys(catMap), Object.values(catMap), null, COLORS);

  // Status overview
  const statusMap = {};
  docs.forEach(d => { const l = statusLabel(d.status); statusMap[l] = (statusMap[l]||0) + 1; });
  buildChart("chartStatus", "doughnut", Object.keys(statusMap), Object.values(statusMap), null, COLORS);
}

function buildChart(canvasId, type, labels, data, label, colors) {
  if (chartInstances[canvasId]) { chartInstances[canvasId].destroy(); }
  const ctx = document.getElementById(canvasId)?.getContext("2d");
  if (!ctx) return;
  const bgColors = type === "line" ? colors.map(c => c + "30") : colors;
  chartInstances[canvasId] = new Chart(ctx, {
    type,
    data: {
      labels,
      datasets: [{
        label: label || "Count",
        data,
        backgroundColor: type === "line" ? bgColors : colors.slice(0, data.length),
        borderColor: colors.slice(0, data.length),
        borderWidth: type === "line" ? 2 : 1,
        tension: 0.4,
        fill: type === "line",
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: type === "doughnut",
      aspectRatio: type === "doughnut" ? 1 : undefined,
      layout: { padding: { top: 2, bottom: 2 } },
      plugins: {
        legend: {
          display: type !== "bar",
          position: "bottom",
          labels: { boxWidth: 7, boxHeight: 7, font: { size: 9 }, padding: 6 }
        },
        tooltip: { bodyFont: { size: 10 }, titleFont: { size: 10 } }
      },
      scales: type !== "doughnut" ? {
        x: { ticks: { font: { size: 9 }, maxRotation: 30 }, grid: { display: false } },
        y: { ticks: { font: { size: 9 }, stepSize: 1 }, beginAtZero: true, grid: { color: "#f1f5f9" } }
      } : {},
      cutout: type === "doughnut" ? "60%" : undefined
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// DOCUMENT TABLE
// ═══════════════════════════════════════════════════════════════════════════
function filterDocsBySearch(docs, q) {
  if (!q) return docs;
  q = q.toLowerCase();
  return docs.filter(d =>
    (d.submissionRefNo||"").toLowerCase().includes(q) ||
    (d.documentTitle||"").toLowerCase().includes(q) ||
    (d.plantName||"").toLowerCase().includes(q) ||
    (d.departmentName||"").toLowerCase().includes(q) ||
    (d.categoryName||"").toLowerCase().includes(q) ||
    (d.submittedByName||"").toLowerCase().includes(q) ||
    (d.officialDocNumber||"").toLowerCase().includes(q) ||
    (d.status||"").toLowerCase().includes(q)
  );
}

function renderDocTable(docs) {
  // Sort
  docs = [...docs].sort((a, b) => {
    let av = a[sortCol], bv = b[sortCol];
    if (av?.toDate) av = av.toDate().getTime();
    if (bv?.toDate) bv = bv.toDate().getTime();
    if (av === undefined) av = "";
    if (bv === undefined) bv = "";
    return sortDir === "asc" ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
  });

  // Pagination
  const total = docs.length;
  const pages = Math.ceil(total / PAGE_SIZE);
  if (currentPage > pages) currentPage = 1;
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageDocs = docs.slice(start, start + PAGE_SIZE);

  document.getElementById("tableInfo").textContent =
    `Showing ${start + 1}–${Math.min(start + PAGE_SIZE, total)} of ${total} records`;

  // Pagination controls
  const pag = document.getElementById("tablePagination");
  pag.innerHTML = "";
  for (let p = 1; p <= Math.min(pages, 7); p++) {
    pag.innerHTML += `<li class="page-item ${p === currentPage ? "active" : ""}">
      <a class="page-link" href="#" data-page="${p}">${p}</a></li>`;
  }
  pag.addEventListener("click", e => {
    const a = e.target.closest("a[data-page]");
    if (a) { e.preventDefault(); currentPage = parseInt(a.dataset.page); renderDocTable(docs); }
  });

  const tbody = document.getElementById("docTableBody");
  if (!pageDocs.length) {
    tbody.innerHTML = `<tr><td colspan="13" class="text-center py-4 text-muted">No documents found.</td></tr>`;
    return;
  }

  tbody.innerHTML = pageDocs.map(d => `
    <tr>
      ${isSuperadmin() ? `<td><input type="checkbox" class="row-checkbox" data-id="${d.id}"
        ${selectedDocIds.has(d.id) ? "checked" : ""}></td>` : ""}
      <td class="fw-semibold text-primary">${d.submissionRefNo || "—"}</td>
      <td>${d.documentTitle || "—"}</td>
      <td>${d.categoryName || "—"}</td>
      <td>${d.plantName || "—"}</td>
      <td>${d.departmentName || "—"}</td>
      <td>${d.submittedByName || "—"}</td>
      <td>${toIST(d.submittedAt || d.submissionDate)}</td>
      <td class="fw-semibold">${d.officialDocNumber || "—"}</td>
      <td>${d.assignmentDate ? toIST(d.assignmentDate) : (d.dmsUploadDate || "—")}</td>
      <td>${statusBadge(d.status)}</td>
      <td style="min-width:260px;padding:4px 8px">${buildHorizontalTimeline(d)}</td>
      <td>
        <div class="action-btns">
          <button class="btn-act-view view-doc-btn" data-id="${d.id}" title="View Details"><i class="bi bi-eye"></i></button>
          ${d.fileUrl ? `<a class="btn-act-open" href="${d.fileUrl}" target="_blank" title="Open Document"><i class="bi bi-box-arrow-up-right"></i></a>` : ""}
          ${d.fileUrl ? `<a class="btn-act-dl" href="${d.fileUrl}" download title="Download"><i class="bi bi-download"></i></a>` : ""}
          ${(isCorporateMR() || isSuperadmin()) && ["submitted","pending_with_mr","under_process","resubmitted"].includes(d.status) ? `
            <button class="btn-act-assign assign-btn" data-id="${d.id}" title="Assign DMS Number"><i class="bi bi-hash"></i></button>
            <button class="btn-act-return return-btn" data-id="${d.id}" title="Return for Correction"><i class="bi bi-arrow-return-left"></i></button>` : ""}
        </div>
      </td>
    </tr>
  `).join("");

  // Wire up buttons
  tbody.querySelectorAll(".view-doc-btn").forEach(btn =>
    btn.addEventListener("click", () => openDocModal(btn.dataset.id)));
  tbody.querySelectorAll(".assign-btn").forEach(btn =>
    btn.addEventListener("click", () => openAssignModal(btn.dataset.id)));
  tbody.querySelectorAll(".return-btn").forEach(btn =>
    btn.addEventListener("click", () => openReturnModal(btn.dataset.id)));
  tbody.querySelectorAll(".row-checkbox").forEach(cb =>
    cb.addEventListener("change", e => {
      e.target.checked ? selectedDocIds.add(cb.dataset.id) : selectedDocIds.delete(cb.dataset.id);
      updateSelectionUI();
    }));
}

// ═══════════════════════════════════════════════════════════════════════════
// MY DOCUMENTS (user view)
// ═══════════════════════════════════════════════════════════════════════════
async function loadMyDocuments() {
  const snap = await getDocs(query(
    collection(db, "documents"),
    where("submittedBy", "==", currentUser.uid)
  ));

  const docs = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(d => d.status !== "deleted")
    .sort((a,b) => (b.submissionDate?.toMillis?.() || 0) - (a.submissionDate?.toMillis?.() || 0));
  const tbody = document.getElementById("myDocsBody");

  if (!docs.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">No documents submitted yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = docs.map(d => {
    // Support both old field (submissionDate) and new field (submittedAt)
    const submittedTs = d.submittedAt || d.submissionDate;

    // DMS assignment: use assignmentDate (Firestore Timestamp) for accurate time
    let dmsDateDisplay = "—";
    let dmsDateMs = null;
    if (d.assignmentDate) {
      const parsed = d.assignmentDate.toDate ? d.assignmentDate.toDate() : new Date(d.assignmentDate);
      dmsDateMs = parsed.getTime();
      dmsDateDisplay = `<span class="small" style="white-space:nowrap">${parsed.toLocaleString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit",timeZone:"Asia/Kolkata"})}</span>`;
    } else if (d.dmsUploadDate) {
      // Fallback for old records that only have date string
      const parsed = new Date(d.dmsUploadDate + "T00:00:00+05:30");
      dmsDateMs = parsed.getTime();
      dmsDateDisplay = `<span class="small" style="white-space:nowrap">${parsed.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric",timeZone:"Asia/Kolkata"})}</span>`;
    }

    // Time taken: DMS assigned − submitted (using accurate timestamps)
    let timeTakenDisplay = "—";
    if (dmsDateMs && submittedTs) {
      const submittedMs = submittedTs.toDate ? submittedTs.toDate().getTime() : new Date(submittedTs).getTime();
      const diffMs = dmsDateMs - submittedMs;
      if (diffMs >= 0) {
        const totalMins = Math.floor(diffMs / 60000);
        const days  = Math.floor(totalMins / (60 * 24));
        const hours = Math.floor((totalMins % (60 * 24)) / 60);
        const mins  = totalMins % 60;
        let label = "";
        if (days > 0)       label = `${days}d ${hours}h`;
        else if (hours > 0) label = `${hours}h ${mins}m`;
        else                label = `${mins}m`;
        const color = days <= 3 ? "success" : days <= 7 ? "warning" : "danger";
        timeTakenDisplay = `<span class="badge bg-${color} text-white" style="font-size:0.72rem;" title="Assigned: ${new Date(dmsDateMs).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})}&#10;Submitted: ${submittedTs.toDate ? submittedTs.toDate().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}) : '—'}">${label}</span>`;
      }
    }

    return `
    <tr class="mydoc-row" data-id="${d.id}" data-cat="${d.categoryName || ""}" data-status="${d.status || ""}">
      <td class="fw-semibold text-primary" style="white-space:nowrap">${d.submissionRefNo || "Draft"}</td>
      <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${d.documentTitle || ""}">${d.documentTitle || "—"}</td>
      <td><span class="text-muted small">${d.categoryName || "—"}</span></td>
      <td><span class="small" style="white-space:nowrap">${toIST(submittedTs)}</span></td>
      <td class="fw-semibold text-success" style="white-space:nowrap">${d.officialDocNumber || `<span class="text-muted">—</span>`}</td>
      <td>${dmsDateDisplay}</td>
      <td>${timeTakenDisplay}</td>
      <td>${statusBadge(d.status)}</td>
      <td style="min-width:280px;padding:6px 10px">${buildHorizontalTimeline(d)}</td>
      <td>
        <div class="action-btns">
          <button class="btn-act-view view-doc-btn" data-id="${d.id}" title="View Details"><i class="bi bi-eye"></i></button>
          ${d.fileUrl ? `<a class="btn-act-open" href="${d.fileUrl}" target="_blank" title="Open Document"><i class="bi bi-box-arrow-up-right"></i></a>` : ""}
          ${d.fileUrl ? `<a class="btn-act-dl" href="${d.fileUrl}" download title="Download"><i class="bi bi-download"></i></a>` : ""}
          ${["draft","returned_for_correction"].includes(d.status) ? `
            <button class="btn-act-edit edit-doc-btn" data-id="${d.id}" title="Edit"><i class="bi bi-pencil"></i></button>` : ""}
        </div>
      </td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll(".view-doc-btn").forEach(b =>
    b.addEventListener("click", () => openDocModal(b.dataset.id)));
  tbody.querySelectorAll(".edit-doc-btn").forEach(b =>
    b.addEventListener("click", () => { navigateTo("submit"); prepareSubmitForm(b.dataset.id); }));

  // Populate category filter from loaded docs
  const catSel = document.getElementById("myDocsCatFilter");
  const existingCats = new Set(docs.map(d => d.categoryName).filter(Boolean));
  catSel.innerHTML = `<option value="">All Categories</option>`;
  [...existingCats].sort().forEach(c => {
    catSel.innerHTML += `<option value="${c}">${c}</option>`;
  });

  function applyMyDocsFilters() {
    const q      = document.getElementById("myDocsSearch").value.toLowerCase();
    const cat    = document.getElementById("myDocsCatFilter").value;
    const status = document.getElementById("myDocsStatusFilter").value;
    tbody.querySelectorAll(".mydoc-row").forEach(row => {
      const text    = row.textContent.toLowerCase();
      const rowCat  = row.dataset.cat || "";
      const rowStat = row.dataset.status || "";
      const matchQ  = !q      || text.includes(q);
      const matchC  = !cat    || rowCat === cat;
      const matchS  = !status || rowStat === status;
      row.style.display = (matchQ && matchC && matchS) ? "" : "none";
    });
  }

  document.getElementById("myDocsSearch").oninput        = applyMyDocsFilters;
  document.getElementById("myDocsCatFilter").onchange    = applyMyDocsFilters;
  document.getElementById("myDocsStatusFilter").onchange = applyMyDocsFilters;
}

// ── Horizontal timeline builder (numbered circles, perfectly aligned) ─────────
function buildHorizontalTimeline(d) {
  const allSteps = [
    { key: "submitted",               label: "Submitted"    },
    { key: "resubmitted",             label: "Resubmitted"  },
    { key: "under_process",           label: "MR Submitted" },
    { key: "returned_for_correction", label: "Returned"     },
    { key: "completed",               label: "Completed"    },
  ];

  const histMap = {};
  (d.statusHistory || []).forEach(h => { if (!histMap[h.status]) histMap[h.status] = h; });

  const steps = allSteps.filter(s => {
    if (s.key === "resubmitted")             return !!histMap["resubmitted"];
    if (s.key === "returned_for_correction") return !!histMap["returned_for_correction"];
    return true;
  });

  // Map terminal statuses to the last step
  const statusForIdx = ["number_assigned","closed"].includes(d.status) ? "completed" : d.status;
  const currentIdx = steps.findIndex(s => s.key === statusForIdx);
  const effectiveIdx = currentIdx === -1 ? steps.length - 1 : currentIdx;
  const n = steps.length;

  // ── Render: one wrapper with two rows stacked ──
  // Row 1: [half-line] [circle] [half-line] ... repeated — all in one flex row
  // Row 2: labels — same flex widths so they align under circles

  // "completed" is a terminal/final status — treat ALL steps as done, not "current"
  const isFullyComplete = ["completed","number_assigned","closed"].includes(d.status);

  const circlesRow = steps.map((step, idx) => {
    const hit       = histMap[step.key];
    // For completed docs: every step is "done" (green check)
    const isCurrent = !isFullyComplete && step.key === d.status;
    const isDone    = isFullyComplete ? idx <= effectiveIdx : (!!hit && !isCurrent);
    const circleClass = isDone ? "done" : isCurrent ? "current" : "future";
    const inner = isDone
      ? `<i class="bi bi-check-lg"></i>`
      : isCurrent
        ? `<i class="bi bi-play-fill" style="margin-left:1px"></i>`
        : `${idx + 1}`;
    const leftColor  = idx === 0   ? "transparent" : idx <= effectiveIdx ? "#22c55e" : "#cbd5e1";
    const rightColor = idx === n-1 ? "transparent" : idx <  effectiveIdx ? "#22c55e" : "#cbd5e1";
    return `
      <div class="doc-hstep">
        <div class="doc-hstep-track">
          <div class="doc-hstep-line" style="background:${leftColor}"></div>
          <div class="doc-hstep-circle ${circleClass}">${inner}</div>
          <div class="doc-hstep-line" style="background:${rightColor}"></div>
        </div>
      </div>`;
  }).join("");

  const labelsRow = steps.map((step, idx) => {
    const hit       = histMap[step.key];
    const isCurrent = !isFullyComplete && step.key === d.status;
    const isDone    = isFullyComplete ? idx <= effectiveIdx : (!!hit && !isCurrent);
    const labelClass = isDone ? "done" : isCurrent ? "current" : "";
    const name = hit?.changedByName ? hit.changedByName.split(" ")[0] : "";
    return `
      <div class="doc-hstep">
        <div class="doc-hstep-label ${labelClass}">${step.label}</div>
        ${name ? `<div class="doc-hstep-sub">${name}</div>` : ""}
      </div>`;
  }).join("");

  return `
    <div style="display:flex;flex-direction:column;width:100%">
      <div class="doc-hline">${circlesRow}</div>
      <div class="doc-hline" style="margin-top:2px">${labelsRow}</div>
    </div>`;
}

// ── (showDocTimeline removed – timeline now inline per row via buildHorizontalTimeline)
function showDocTimeline(d) {
  const panel = document.getElementById("myDocsTimelineBody");
  if (!panel || !d) return;

  const statusColors = {
    draft:                   "#6c757d",
    submitted:               "#0d6efd",
    resubmitted:             "#0d6efd",
    pending_with_mr:         "#fd7e14",
    under_process:           "#6610f2",
    returned_for_correction: "#dc3545",
    number_assigned:         "#198754",
    completed:               "#198754",
  };
  const statusIcons = {
    draft:                   "bi-pencil-square",
    submitted:               "bi-send",
    resubmitted:             "bi-arrow-repeat",
    pending_with_mr:         "bi-hourglass-split",
    under_process:           "bi-gear",
    returned_for_correction: "bi-arrow-left-circle",
    number_assigned:         "bi-award",
    completed:               "bi-check-circle-fill",
  };

  // Use raw statusHistory array (preserves duplicates & order)
  const history = [...(d.statusHistory || [])];

  // If no history yet but doc has a status, synthesise one entry
  if (!history.length && d.status) {
    history.push({ status: d.status, changedByName: d.submittedByName || "", changedAt: "" });
  }

  const entriesHtml = history.map((h, idx) => {
    const isLast  = idx === history.length - 1;
    const color   = statusColors[h.status] || "#6c757d";
    const icon    = statusIcons[h.status]  || "bi-circle";
    const lineColor = isLast ? "#dee2e6" : color;

    return `
      <div class="d-flex gap-2">
        <div class="d-flex flex-column align-items-center" style="width:22px;flex-shrink:0">
          <div style="width:16px;height:16px;border-radius:50%;background:${color};
               flex-shrink:0;margin-top:2px;display:flex;align-items:center;justify-content:center">
            <i class="bi ${icon}" style="font-size:8px;color:#fff"></i>
          </div>
          ${!isLast ? `<div style="width:2px;flex:1;background:${lineColor}33;min-height:20px;margin-top:2px"></div>` : ""}
        </div>
        <div class="pb-3" style="min-width:0;padding-top:1px">
          <div class="fw-semibold" style="font-size:12px;color:${color};line-height:1.3">
            ${statusLabel(h.status)}
            ${isLast ? `<span class="badge ms-1 rounded-pill" style="background:${color};font-size:9px;vertical-align:middle">CURRENT</span>` : ""}
          </div>
          ${h.changedByName ? `<div style="font-size:11px;color:#6c757d">By: ${h.changedByName}</div>` : ""}
          ${h.changedAt     ? `<div style="font-size:11px;color:#adb5bd">${h.changedAt}</div>` : ""}
          ${h.remarks       ? `<div style="font-size:10px;color:#6c757d;font-style:italic;margin-top:2px">"${h.remarks}"</div>` : ""}
        </div>
      </div>`;
  }).join("");

  panel.innerHTML = `
    <div class="mb-3 pb-2 border-bottom">
      <div class="fw-bold text-primary" style="font-size:13px">${d.submissionRefNo || "Draft"}</div>
      <div class="text-muted" style="font-size:12px">${d.documentTitle || "—"}</div>
      <div class="mt-1 d-flex gap-1 flex-wrap">
        ${statusBadge(d.status)}
        ${d.officialDocNumber ? `<span class="badge bg-success">${d.officialDocNumber}</span>` : ""}
      </div>
    </div>
    <div class="fw-semibold text-uppercase mb-2" style="font-size:10px;letter-spacing:.06em;color:#adb5bd">
      Status History
    </div>
    ${entriesHtml || '<div class="text-muted small">No history yet.</div>'}
  `;
}

// ═══════════════════════════════════════════════════════════════════════════
// DOCUMENT MODAL (view details)
// ═══════════════════════════════════════════════════════════════════════════
async function openDocModal(docId) {
  activeDocModalId = docId;
  const modal = new bootstrap.Modal(document.getElementById("docModal"));
  document.getElementById("docModalBody").innerHTML = "<div class='text-center py-4'><div class='spinner-border'></div></div>";
  document.getElementById("docModalFooter").innerHTML = "";
  modal.show();

  const snap = await getDoc(doc(db, "documents", docId));
  if (!snap.exists()) {
    document.getElementById("docModalBody").innerHTML = "<p class='text-danger'>Document not found.</p>";
    return;
  }

  const d = { id: snap.id, ...snap.data() };
  document.getElementById("docModalTitle").textContent = d.documentTitle || "Document Details";

  const history = (d.statusHistory || []).map(h => `
    <li>
      <div class="timeline-status">${statusLabel(h.status)}</div>
      <div class="timeline-by">By: ${h.changedByName || "—"}</div>
      <div class="timeline-when">${h.changedAt || ""}</div>
      ${h.remarks ? `<div class="text-muted small">${h.remarks}</div>` : ""}
    </li>
  `).join("");

  document.getElementById("docModalBody").innerHTML = `
    <div class="row g-3">
      <div class="col-sm-6">
        <div class="detail-row"><div class="detail-label">Submission Ref. No.</div>
          <div class="detail-value fw-bold text-primary">${d.submissionRefNo || "—"}</div></div>
      </div>
      <div class="col-sm-6">
        <div class="detail-row"><div class="detail-label">Status</div>
          <div class="detail-value">${statusBadge(d.status)}</div></div>
      </div>
      <div class="col-sm-6">
        <div class="detail-row"><div class="detail-label">Document Title</div>
          <div class="detail-value">${d.documentTitle || "—"}</div></div>
      </div>
      <div class="col-sm-6">
        <div class="detail-row"><div class="detail-label">Category</div>
          <div class="detail-value">${d.categoryName || "—"}</div></div>
      </div>
      <div class="col-sm-6">
        <div class="detail-row"><div class="detail-label">Plant</div>
          <div class="detail-value">${d.plantName || "—"}</div></div>
      </div>
      <div class="col-sm-6">
        <div class="detail-row"><div class="detail-label">Department</div>
          <div class="detail-value">${d.departmentName || "—"}</div></div>
      </div>
      <div class="col-sm-6">
        <div class="detail-row"><div class="detail-label">Submitted By</div>
          <div class="detail-value">${d.submittedByName || "—"}</div></div>
      </div>
      <div class="col-sm-6">
        <div class="detail-row"><div class="detail-label">Submission Date (IST)</div>
          <div class="detail-value">${toIST(d.submissionDate)}</div></div>
      </div>
      ${d.documentDescription ? `<div class="col-12">
        <div class="detail-row"><div class="detail-label">Description</div>
          <div class="detail-value">${d.documentDescription}</div></div></div>` : ""}
      ${d.documentRevision ? `<div class="col-sm-6">
        <div class="detail-row"><div class="detail-label">Revision</div>
          <div class="detail-value">${d.documentRevision}</div></div></div>` : ""}
      ${d.fileUrl ? `<div class="col-12">
        <div class="detail-row"><div class="detail-label">Attachment</div>
          <div class="detail-value">
            <a href="${d.fileUrl}" target="_blank" class="btn btn-sm btn-outline-primary">
              <i class="bi bi-download me-1"></i>Download Document
            </a>
          </div></div></div>` : ""}

      ${d.officialDocNumber ? `
      <div class="col-12"><hr class="my-2"></div>
      <div class="col-sm-6">
        <div class="detail-row"><div class="detail-label">Official DMS Number</div>
          <div class="detail-value fw-bold text-success fs-6">${d.officialDocNumber}</div></div>
      </div>
      <div class="col-sm-6">
        <div class="detail-row"><div class="detail-label">DMS Upload Date</div>
          <div class="detail-value">${d.dmsUploadDate || "—"}</div></div>
      </div>
      <div class="col-sm-6">
        <div class="detail-row"><div class="detail-label">Assignment Date (IST)</div>
          <div class="detail-value">${toIST(d.assignmentDate)}</div></div>
      </div>
      <div class="col-sm-6">
        <div class="detail-row"><div class="detail-label">Processed By</div>
          <div class="detail-value">${d.processedByName || "—"}</div></div>
      </div>` : ""}

      ${d.corporateMRRemarks ? `<div class="col-12">
        <div class="detail-row"><div class="detail-label">Corporate MR Remarks</div>
          <div class="detail-value alert alert-warning py-2 mb-0">${d.corporateMRRemarks}</div></div>
      </div>` : ""}

      ${history ? `<div class="col-12">
        <div class="detail-label mb-2">Status History</div>
        <ul class="status-timeline">${history}</ul></div>` : ""}
    </div>
  `;

  // Footer buttons
  let footer = `<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>`;
  if (d.fileUrl) footer += `<a href="${d.fileUrl}" target="_blank" class="btn btn-primary"><i class="bi bi-download me-1"></i>Download</a>`;
  if ((isCorporateMR() || isSuperadmin()) && ["submitted","pending_with_mr","under_process","resubmitted"].includes(d.status)) {
    footer += `
      <button class="btn btn-success" id="modalAssignBtn"><i class="bi bi-hash me-1"></i>Assign Number</button>
      <button class="btn btn-warning" id="modalReturnBtn"><i class="bi bi-arrow-return-left me-1"></i>Return</button>`;
  }
  // Submitter sees Re-upload button when doc is returned for correction
  if (isUser() && d.status === "returned_for_correction" && d.submittedBy === currentUser?.uid) {
    footer += `<button class="btn btn-warning" id="modalReuploadBtn"><i class="bi bi-upload me-1"></i>Re-upload Corrected Doc</button>`;
  }
  document.getElementById("docModalFooter").innerHTML = footer;

  document.getElementById("modalAssignBtn")?.addEventListener("click", () => {
    bootstrap.Modal.getInstance(document.getElementById("docModal")).hide();
    openAssignModal(docId);
  });
  document.getElementById("modalReturnBtn")?.addEventListener("click", () => {
    bootstrap.Modal.getInstance(document.getElementById("docModal")).hide();
    openReturnModal(docId);
  });
  document.getElementById("modalReuploadBtn")?.addEventListener("click", () => {
    bootstrap.Modal.getInstance(document.getElementById("docModal")).hide();
    openReuploadModal(docId, d);
  });

  // Log download attempt
  if (d.fileUrl) {
    logActivity({ activity: "document_viewed", documentId: docId, submissionRefNo: d.submissionRefNo });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ASSIGN NUMBER MODAL
// ═══════════════════════════════════════════════════════════════════════════
function openAssignModal(docId) {
  assignModalDocId = docId;
  document.getElementById("dmsDocNumber").value = "";
  document.getElementById("dmsDate").value = new Date().toISOString().split("T")[0];
  document.getElementById("dmsTime").value = "";
  document.getElementById("dmsRemarks").value = "";
  document.getElementById("dmsNumCheckResult").innerHTML = "";
  hideError("assignNumError");
  new bootstrap.Modal(document.getElementById("assignNumModal")).show();
}

document.getElementById("checkDmsNumBtn").addEventListener("click", async () => {
  const num = document.getElementById("dmsDocNumber").value.trim();
  if (!num) return;
  const checkFn = httpsCallable(functions, "checkDocumentNumber");
  try {
    const res = await checkFn({ docNumber: num });
    const result = document.getElementById("dmsNumCheckResult");
    if (res.data.exists) {
      const ex = res.data.existingRecord;
      result.innerHTML = `<div class="alert alert-danger alert-sm py-2 mt-1 small">
        <i class="bi bi-x-circle me-1"></i><strong>Duplicate!</strong>
        Already assigned to <strong>${ex.documentTitle}</strong> (Ref: ${ex.submissionRefNo})
        – Plant: ${ex.plantName}, Dept: ${ex.departmentName}</div>`;
    } else {
      result.innerHTML = `<div class="alert alert-success alert-sm py-2 mt-1 small">
        <i class="bi bi-check-circle me-1"></i>Number is available.</div>`;
    }
  } catch (e) {
    console.error(e);
  }
});

document.getElementById("confirmAssignBtn").addEventListener("click", async () => {
  const spin    = document.getElementById("assignSpinner");
  const btn     = document.getElementById("confirmAssignBtn");
  hideError("assignNumError");
  const num = document.getElementById("dmsDocNumber").value.trim();
  if (!num) { showError("assignNumError", "DMS Document Number is required."); return; }

  // Instant feedback — close modal & show toast immediately
  spin.classList.remove("d-none");
  btn.disabled = true;

  const payload = {
    documentId:        assignModalDocId,
    officialDocNumber: num,
    dmsUploadDate:     document.getElementById("dmsDate").value,
    dmsUploadTime:     document.getElementById("dmsTime").value,
    remarks:           document.getElementById("dmsRemarks").value,
    dmsAssignedAt:     new Date().toISOString(),   // ISO string for accurate time-taken calc
  };

  // Close modal right away so user isn't blocked
  bootstrap.Modal.getInstance(document.getElementById("assignNumModal")).hide();
  showToast(`Assigning DMS Number "${num}"…`, "info");

  const assignFn = httpsCallable(functions, "assignDocumentNumber", { timeout: 30000 });
  try {
    await assignFn(payload);
    showToast(`DMS Number "${num}" assigned & document completed.`, "success");
    loadDashboard();
    if (isCorporateMR()) loadMRQueue();
  } catch (e) {
    // Re-open modal on error so user can retry
    showToast("Assignment failed: " + (e.message || "Unknown error"), "danger");
    openAssignModal(payload.documentId);
    document.getElementById("dmsDocNumber").value = num;
    showError("assignNumError", e.message || "Failed to assign number.");
  } finally {
    spin.classList.add("d-none");
    btn.disabled = false;
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// RETURN FOR CORRECTION
// ═══════════════════════════════════════════════════════════════════════════
function openReturnModal(docId) {
  returnModalDocId = docId;
  document.getElementById("returnRemarks").value = "";
  hideError("returnError");
  new bootstrap.Modal(document.getElementById("returnModal")).show();
}

document.getElementById("confirmReturnBtn").addEventListener("click", async () => {
  const spin = document.getElementById("returnSpinner");
  hideError("returnError");
  const remarks = document.getElementById("returnRemarks").value.trim();
  if (!remarks) { showError("returnError", "Remarks are required."); return; }

  spin.classList.remove("d-none");
  const returnFn = httpsCallable(functions, "returnDocumentForCorrection");
  try {
    await returnFn({ documentId: returnModalDocId, remarks });
    bootstrap.Modal.getInstance(document.getElementById("returnModal")).hide();
    showToast("Document returned for correction.", "warning");
    loadDashboard();
    if (isCorporateMR()) loadMRQueue();
  } catch (e) {
    showError("returnError", e.message);
  } finally {
    spin.classList.add("d-none");
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// RE-UPLOAD CORRECTED DOCUMENT (Submitter, returned docs only)
// ═══════════════════════════════════════════════════════════════════════════
let _reuploadDocId   = null;
let _reuploadFileRef = null;

function openReuploadModal(docId, docData) {
  _reuploadDocId   = docId;
  _reuploadFileRef = null;
  document.getElementById("reuploadFileName").textContent = "";
  document.getElementById("reuploadFileInput").value = "";
  document.getElementById("reuploadProgress").classList.add("d-none");
  document.getElementById("reuploadBar").style.width = "0%";
  hideError("reuploadError");
  // Show current remarks so submitter knows what to fix
  const remarksEl = document.getElementById("reuploadRemarks");
  remarksEl.textContent = docData.corporateMRRemarks
    ? `Corporate MR Remarks: "${docData.corporateMRRemarks}"`
    : "";
  new bootstrap.Modal(document.getElementById("reuploadModal")).show();
}

document.getElementById("reuploadFileInput")?.addEventListener("change", (e) => {
  _reuploadFileRef = e.target.files[0] || null;
  document.getElementById("reuploadFileName").textContent = _reuploadFileRef
    ? `Selected: ${_reuploadFileRef.name}`
    : "";
});

document.getElementById("confirmReuploadBtn")?.addEventListener("click", async () => {
  if (!_reuploadDocId) return;
  if (!_reuploadFileRef) { showError("reuploadError", "Please select a file to upload."); return; }

  const btn  = document.getElementById("confirmReuploadBtn");
  const spin = document.getElementById("reuploadSpinner");
  const prog = document.getElementById("reuploadProgress");
  const bar  = document.getElementById("reuploadBar");
  hideError("reuploadError");
  btn.disabled = true;
  spin.classList.remove("d-none");
  prog.classList.remove("d-none");

  try {
    // Upload new file to same document path
    const storageRef = ref(storage, `documents/${currentUser.uid}/${_reuploadDocId}/${_reuploadFileRef.name}`);
    const uploadTask = uploadBytesResumable(storageRef, _reuploadFileRef);

    await new Promise((resolve, reject) => {
      uploadTask.on("state_changed",
        snap => { bar.style.width = Math.round((snap.bytesTransferred / snap.totalBytes) * 100) + "%"; },
        reject,
        resolve
      );
    });

    const newFileUrl    = await getDownloadURL(storageRef);
    const submitterName = currentUserData?.displayName || currentUser.email;

    // Read existing history first, then update in one write
    const existingSnap = await getDoc(doc(db, "documents", _reuploadDocId));
    const existingHistory = existingSnap.data()?.statusHistory || [];
    const newHistoryEntry = {
      status:        "resubmitted",
      changedBy:     currentUser.uid,
      changedByName: submitterName,
      changedAt:     nowIST(),
      note:          "Corrected document re-uploaded",
    };

    await updateDoc(doc(db, "documents", _reuploadDocId), {
      fileUrl:       newFileUrl,
      fileName:      _reuploadFileRef.name,
      fileSize:      _reuploadFileRef.size,
      status:        "resubmitted",
      updatedAt:     serverTimestamp(),
      resubmittedAt: serverTimestamp(),
      statusHistory: [...existingHistory, newHistoryEntry],
    });

    bootstrap.Modal.getInstance(document.getElementById("reuploadModal")).hide();
    showToast("✅ Corrected document uploaded. Document resubmitted for review.", "success");
    loadDashboard();
  } catch (e) {
    console.error("Reupload error:", e);
    showError("reuploadError", e.message || "Upload failed. Please try again.");
  } finally {
    btn.disabled = false;
    spin.classList.add("d-none");
    prog.classList.add("d-none");
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CORPORATE MR QUEUE
// ═══════════════════════════════════════════════════════════════════════════
let _mrAllDocs = [];   // cached for in-memory filtering

async function loadMRQueue(searchText = "") {
  // Always re-fetch from Firestore (called on view open or after assign/return)
  const snap = await getDocs(collection(db, "documents"));
  _mrAllDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(d => d.status !== "deleted");
  _mrAllDocs.sort((a,b) => {
    const ta = (a.submittedAt || a.submissionDate)?.toMillis?.() || 0;
    const tb = (b.submittedAt || b.submissionDate)?.toMillis?.() || 0;
    return tb - ta;
  });

  // Auto-mark submitted/pending_with_mr as "Under Process" when MR views queue
  _mrAllDocs.forEach(async d => {
    if (d.status === "submitted" || d.status === "pending_with_mr") {
      await updateDoc(doc(db, "documents", d.id), {
        status: "under_process",
        updatedAt: serverTimestamp(),
        statusHistory: d.statusHistory ? [
          ...d.statusHistory,
          { status: "under_process", changedBy: currentUser.uid,
            changedByName: currentUserData?.displayName || currentUser.email,
            changedAt: nowIST() }
        ] : [{ status: "under_process" }],
      }).catch(console.error);
      // Update local cache too so table reflects it immediately
      d.status = "under_process";
    }
  });

  renderMRQueue();
}

function renderMRQueue() {
  const PENDING = ["submitted","pending_with_mr","under_process","resubmitted"];
  const plantId = document.getElementById("mrFilterPlant").value;
  const deptId  = document.getElementById("mrFilterDept").value;
  const catId   = document.getElementById("mrFilterCat").value;
  const statusV = document.getElementById("mrFilterStatus").value;
  const srch    = document.getElementById("mrSearch").value.toLowerCase();

  let docs = [..._mrAllDocs];

  // Status filter
  if (statusV === "all") {
    // show everything
  } else if (statusV === "pending" || statusV === "") {
    docs = docs.filter(d => PENDING.includes(d.status));
  } else {
    docs = docs.filter(d => d.status === statusV);
  }

  if (plantId) docs = docs.filter(d => d.plantId === plantId);
  if (deptId)  docs = docs.filter(d => d.departmentId === deptId);
  if (catId)   docs = docs.filter(d => d.categoryId === catId);

  if (srch) {
    docs = docs.filter(d =>
      (d.submissionRefNo||"").toLowerCase().includes(srch) ||
      (d.documentTitle||"").toLowerCase().includes(srch) ||
      (d.submittedByName||"").toLowerCase().includes(srch) ||
      (d.categoryName||"").toLowerCase().includes(srch) ||
      (d.plantName||"").toLowerCase().includes(srch) ||
      (d.officialDocNumber||"").toLowerCase().includes(srch)
    );
  }

  const tbody = document.getElementById("mrTableBody");
  if (!docs.length) {
    tbody.innerHTML = `<tr><td colspan="12" class="text-center py-4 text-muted">No documents in queue.</td></tr>`;
    return;
  }

  tbody.innerHTML = docs.map(d => {
    const submittedTs = d.submittedAt || d.submissionDate;

    // DMS assignment date + time taken (same logic as My Documents)
    let mrDmsDate = "—", mrDmsMs = null;
    if (d.assignmentDate) {
      const p = d.assignmentDate.toDate ? d.assignmentDate.toDate() : new Date(d.assignmentDate);
      mrDmsMs = p.getTime();
      mrDmsDate = `<span class="small" style="white-space:nowrap">${p.toLocaleString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit",timeZone:"Asia/Kolkata"})}</span>`;
    } else if (d.dmsUploadDate) {
      const p = new Date(d.dmsUploadDate + "T00:00:00+05:30");
      mrDmsMs = p.getTime();
      mrDmsDate = `<span class="small">${p.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric",timeZone:"Asia/Kolkata"})}</span>`;
    }
    let mrTimeTaken = "—";
    if (mrDmsMs && submittedTs) {
      const sMs = submittedTs.toDate ? submittedTs.toDate().getTime() : new Date(submittedTs).getTime();
      const diff = mrDmsMs - sMs;
      if (diff >= 0) {
        const totalMins = Math.floor(diff / 60000);
        const days = Math.floor(totalMins / 1440), hrs = Math.floor((totalMins % 1440) / 60), mins = totalMins % 60;
        const lbl = days > 0 ? `${days}d ${hrs}h` : hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
        mrTimeTaken = `<span class="badge bg-${days <= 3 ? "success" : days <= 7 ? "warning" : "danger"} text-white" style="font-size:0.72rem;">${lbl}</span>`;
      }
    }

    return `
    <tr>
      <td class="fw-semibold text-primary" style="white-space:nowrap">${d.submissionRefNo || "—"}</td>
      <td style="max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${d.documentTitle||""}">${d.documentTitle || "—"}</td>
      <td><span class="text-muted small">${d.categoryName || "—"}</span></td>
      <td><span class="small">${d.plantName || "—"}<br><span class="text-muted">${d.departmentName || ""}</span></span></td>
      <td>${d.submittedByName || "—"}</td>
      <td><span class="small" style="white-space:nowrap">${toIST(submittedTs)}</span></td>
      <td class="fw-semibold text-success" style="white-space:nowrap">${d.officialDocNumber || "—"}</td>
      <td>${mrDmsDate}</td>
      <td>${mrTimeTaken}</td>
      <td>${statusBadge(d.status)}</td>
      <td style="min-width:260px;padding:4px 8px">${buildHorizontalTimeline(d)}</td>
      <td>
        <div class="action-btns">
          <button class="btn-act-view view-doc-btn" data-id="${d.id}" title="View Details"><i class="bi bi-eye"></i></button>
          ${d.fileUrl ? `<a class="btn-act-open" href="${d.fileUrl}" target="_blank" title="Open Document"><i class="bi bi-box-arrow-up-right"></i></a>` : ""}
          ${d.fileUrl ? `<a class="btn-act-dl" href="${d.fileUrl}" download title="Download"><i class="bi bi-download"></i></a>` : ""}
          ${["submitted","pending_with_mr","under_process","resubmitted"].includes(d.status) ? `
            <button class="btn-act-assign assign-btn" data-id="${d.id}" title="Assign DMS Number"><i class="bi bi-hash"></i></button>
            <button class="btn-act-return return-btn" data-id="${d.id}" title="Return for Correction"><i class="bi bi-arrow-return-left"></i></button>` : ""}
        </div>
      </td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll(".view-doc-btn").forEach(b =>
    b.addEventListener("click", () => openDocModal(b.dataset.id)));
  tbody.querySelectorAll(".assign-btn").forEach(b =>
    b.addEventListener("click", () => openAssignModal(b.dataset.id)));
  tbody.querySelectorAll(".return-btn").forEach(b =>
    b.addEventListener("click", () => openReturnModal(b.dataset.id)));
}

// ═══════════════════════════════════════════════════════════════════════════
// MR — ALL DOCUMENTS TAB  (read-only, no delete, corporate_mr + superadmin)
// ═══════════════════════════════════════════════════════════════════════════
let _mrAllTabDocs = [];   // cached for filter/sort without re-fetch
let _mrAllTabLoaded = false;
let _mrAllTabPage = 1;
const MR_ALL_PAGE = 25;
let _mrTabsInited = false;

function initMRTabs() {
  if (_mrTabsInited) return;   // only wire events once
  _mrTabsInited = true;
  // Wire sub-tab clicks
  document.querySelectorAll("#mrTabs [data-mr-tab]").forEach(link => {
    link.addEventListener("click", e => {
      e.preventDefault();
      document.querySelectorAll("#mrTabs [data-mr-tab]").forEach(l => l.classList.remove("active"));
      link.classList.add("active");
      const tab = link.dataset.mrTab;
      const qPanel = document.getElementById("mrPanelQueue");
      const aPanel = document.getElementById("mrPanelAll");
      if (tab === "queue") {
        if (qPanel) qPanel.style.display = "";
        if (aPanel) aPanel.style.display = "none";
      } else {
        if (qPanel) qPanel.style.display = "none";
        if (aPanel) aPanel.style.display = "";
        if (!_mrAllTabLoaded) { _mrAllTabLoaded = true; loadMRAllDocs(); }
      }
    });
  });

  // Wire All-docs filters + search
  ["mrAllFilterPlant","mrAllFilterDept","mrAllFilterCat","mrAllFilterStatus","mrAllSearch"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", () => { _mrAllTabPage = 1; renderMRAllDocs(); });
  });

  // Export button
  document.getElementById("mrAllExportBtn")?.addEventListener("click", exportMRAllDocs);

  // Sort headers
  document.getElementById("mrAllTable")?.querySelectorAll("th[data-col]").forEach(th => {
    th.style.cursor = "pointer";
    th.addEventListener("click", () => {
      if (_mrAllTabSort.col === th.dataset.col) _mrAllTabSort.dir *= -1;
      else { _mrAllTabSort.col = th.dataset.col; _mrAllTabSort.dir = -1; }
      renderMRAllDocs();
    });
  });
}

let _mrAllTabSort = { col: "submissionDate", dir: -1 };

async function loadMRAllDocs() {
  const tbody = document.getElementById("mrAllTableBody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="12" class="text-center py-4 text-muted">
    <span class="spinner-border spinner-border-sm me-2"></span>Loading all documents…</td></tr>`;

  try {
    const snap = await getDocs(collection(db, "documents"));
    _mrAllTabDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(d => d.status !== "deleted");
    populateMRAllFilters();
    renderMRAllDocs();
  } catch (err) {
    console.error("[MR-AllDocs] load error:", err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="12" class="text-center py-4 text-danger">Error: ${err.message}</td></tr>`;
  }
}

function populateMRAllFilters() {
  const plants = [...new Set(_mrAllTabDocs.map(d => d.plantName).filter(Boolean))].sort();
  const depts  = [...new Set(_mrAllTabDocs.map(d => d.departmentName).filter(Boolean))].sort();
  const cats   = [...new Set(_mrAllTabDocs.map(d => d.categoryName).filter(Boolean))].sort();
  const fill = (id, vals) => {
    const sel = document.getElementById(id); if (!sel) return;
    const cur = sel.value;
    while (sel.options.length > 1) sel.remove(1);
    vals.forEach(v => sel.add(new Option(v, v)));
    sel.value = cur;
  };
  fill("mrAllFilterPlant", plants);
  fill("mrAllFilterDept",  depts);
  fill("mrAllFilterCat",   cats);
}

function renderMRAllDocs() {
  const plant  = document.getElementById("mrAllFilterPlant")?.value  || "";
  const dept   = document.getElementById("mrAllFilterDept")?.value   || "";
  const cat    = document.getElementById("mrAllFilterCat")?.value    || "";
  const status = document.getElementById("mrAllFilterStatus")?.value || "";
  const srch   = (document.getElementById("mrAllSearch")?.value || "").toLowerCase();

  let rows = _mrAllTabDocs.filter(d => {
    if (plant  && d.plantName      !== plant)  return false;
    if (dept   && d.departmentName !== dept)   return false;
    if (cat    && d.categoryName   !== cat)    return false;
    if (status && d.status         !== status) return false;
    if (srch) {
      const hay = [d.submissionRefNo, d.documentTitle, d.submittedByName,
                   d.officialDocNumber, d.plantName, d.departmentName, d.status]
                  .join(" ").toLowerCase();
      if (!hay.includes(srch)) return false;
    }
    return true;
  });

  // Sort
  rows.sort((a, b) => {
    let av = a[_mrAllTabSort.col], bv = b[_mrAllTabSort.col];
    if (av?.toMillis) av = av.toMillis();
    if (bv?.toMillis) bv = bv.toMillis();
    av = av ?? ""; bv = bv ?? "";
    return av < bv ? _mrAllTabSort.dir : av > bv ? -_mrAllTabSort.dir : 0;
  });

  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / MR_ALL_PAGE));
  _mrAllTabPage = Math.min(_mrAllTabPage, pages);
  const slice = rows.slice((_mrAllTabPage - 1) * MR_ALL_PAGE, _mrAllTabPage * MR_ALL_PAGE);

  const tbody = document.getElementById("mrAllTableBody");
  if (!tbody) return;

  tbody.innerHTML = slice.length
    ? slice.map(d => buildMRAllRow(d)).join("")
    : `<tr><td colspan="12" class="text-center py-4 text-muted">No documents found.</td></tr>`;

  // Wire view buttons
  tbody.querySelectorAll(".view-doc-btn").forEach(b =>
    b.addEventListener("click", () => openDocModal(b.dataset.id)));

  // Info + pagination
  const info = document.getElementById("mrAllTableInfo");
  if (info) info.textContent = `Showing ${(_mrAllTabPage-1)*MR_ALL_PAGE+1}–${Math.min(_mrAllTabPage*MR_ALL_PAGE,total)} of ${total} record(s)`;

  const pgNav = document.getElementById("mrAllTablePagination");
  if (pgNav) {
    pgNav.innerHTML = "";
    for (let p = 1; p <= pages; p++) {
      pgNav.innerHTML += `<li class="page-item ${p===_mrAllTabPage?"active":""}">
        <a class="page-link" href="#" data-p="${p}">${p}</a></li>`;
    }
    pgNav.querySelectorAll("a[data-p]").forEach(a =>
      a.addEventListener("click", e => { e.preventDefault(); _mrAllTabPage = +a.dataset.p; renderMRAllDocs(); }));
  }
}

function buildMRAllRow(d) {
  const submittedTs = d.submittedAt || d.submissionDate;
  let dmsDate = "—";
  if (d.assignmentDate) {
    const p = d.assignmentDate.toDate ? d.assignmentDate.toDate() : new Date(d.assignmentDate);
    dmsDate = p.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric",timeZone:"Asia/Kolkata"});
  } else if (d.dmsUploadDate) {
    dmsDate = d.dmsUploadDate;
  }
  // NO delete button — read-only tab
  return `<tr>
    <td class="fw-semibold text-primary" style="white-space:nowrap">${d.submissionRefNo || "—"}</td>
    <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${(d.documentTitle||"").replace(/"/g,"&quot;")}">${d.documentTitle || "—"}</td>
    <td><span class="text-muted small">${d.categoryName || "—"}</span></td>
    <td><span class="small">${d.plantName || "—"}</span></td>
    <td><span class="small">${d.departmentName || "—"}</span></td>
    <td>${d.submittedByName || "—"}</td>
    <td><span class="small" style="white-space:nowrap">${toIST(submittedTs)}</span></td>
    <td class="fw-semibold text-success">${d.officialDocNumber || "—"}</td>
    <td>${dmsDate}</td>
    <td>${statusBadge(d.status)}</td>
    <td style="min-width:260px;padding:4px 8px">${buildHorizontalTimeline(d)}</td>
    <td><button class="btn-act-view view-doc-btn" data-id="${d.id}" title="View"><i class="bi bi-eye"></i></button></td>
  </tr>`;
}

function exportMRAllDocs() {
  if (!window.XLSX) return showToast("XLSX library not ready. Please wait.", "warning");
  const rows = _mrAllTabDocs.map(d => ({
    "Ref. No.":     d.submissionRefNo  || "",
    "Title":        d.documentTitle    || "",
    "Category":     d.categoryName     || "",
    "Plant":        d.plantName        || "",
    "Department":   d.departmentName   || "",
    "Submitted By": d.submittedByName  || "",
    "Submitted On": d.submittedAt?.toDate ? d.submittedAt.toDate().toLocaleDateString("en-IN",{timeZone:"Asia/Kolkata"}) : (d.submissionDate?.toDate ? d.submissionDate.toDate().toLocaleDateString("en-IN",{timeZone:"Asia/Kolkata"}) : ""),
    "DMS No.":      d.officialDocNumber || "",
    "DMS Date":     d.dmsUploadDate    || "",
    "Status":       d.status           || "",
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "All Documents");
  XLSX.writeFile(wb, "CDRTS_All_Documents.xlsx");
}

// ═══════════════════════════════════════════════════════════════════════════
// SUBMIT DOCUMENT FORM
// ═══════════════════════════════════════════════════════════════════════════
let editingDocId = null;
let uploadedFileRef = null;

function prepareSubmitForm(docId = null) {
  editingDocId = docId;

  // Auto-fill submitter info (Plant MR = current user)
  document.getElementById("subByDisplay").value = currentUserData?.displayName || currentUser.email;
  document.getElementById("subEmailDisplay").value = currentUser.email;

  // Hide success panel, show form
  document.getElementById("submitSuccessPanel")?.classList.add("d-none");
  document.getElementById("submitDocForm")?.classList.remove("d-none");

  // Live clock in header
  if (window._submitClock) clearInterval(window._submitClock);
  const updateDate = () => {
    const el = document.getElementById("subDateDisplay");
    if (el) el.textContent = nowIST();
  };
  updateDate();
  window._submitClock = setInterval(updateDate, 1000);

  document.getElementById("submitDocMsg").classList.add("d-none");

  // Auto-fill plant from user's mapped plant (read-only display)
  const plantDisplay = document.getElementById("docPlantDisplay");
  const plantHidden  = document.getElementById("docPlant");
  if (currentUserData?.plantId) {
    plantHidden.value  = currentUserData.plantId;
    plantDisplay.value = currentUserData.plantName || currentUserData.plantId;
  } else {
    plantHidden.value  = "";
    plantDisplay.value = "Not assigned";
  }

  if (!docId) {
    document.getElementById("submitDocForm").reset();
    // Re-apply plant after reset
    if (currentUserData?.plantId) {
      plantHidden.value  = currentUserData.plantId;
      plantDisplay.value = currentUserData.plantName || currentUserData.plantId;
    }
    document.getElementById("subByDisplay").value = currentUserData?.displayName || currentUser.email;
    document.getElementById("subEmailDisplay").value = currentUser.email;
    document.getElementById("filePreview").classList.add("d-none");
    uploadedFileRef = null;
    if (currentUserData?.departmentId) document.getElementById("docDept").value = currentUserData.departmentId;
  } else {
    // Load existing doc for editing
    getDoc(doc(db, "documents", docId)).then(snap => {
      if (!snap.exists()) return;
      const d = snap.data();
      document.getElementById("docTitle").value = d.documentTitle || "";
      document.getElementById("docCategory").value = d.categoryId || "";
      plantHidden.value  = d.plantId || "";
      plantDisplay.value = d.plantName || d.plantId || "";
      document.getElementById("docDept").value = d.departmentId || "";
      document.getElementById("docDesc").value = d.documentDescription || "";
      document.getElementById("docRevision").value = d.documentRevision || "";
      document.getElementById("reqByName").value = d.requestedByName || "";
      document.getElementById("reqByEmail").value = d.requestedByEmail || "";
    });
  }
}

let _submitFormInitialized = false;
function setupSubmitForm() {
  if (_submitFormInitialized) return;
  _submitFormInitialized = true;
  const uploadZone = document.getElementById("uploadZone");
  const fileInput = document.getElementById("docFile");

  uploadZone.addEventListener("click", () => fileInput.click());
  uploadZone.addEventListener("dragover", e => { e.preventDefault(); uploadZone.classList.add("drag-over"); });
  uploadZone.addEventListener("dragleave", () => uploadZone.classList.remove("drag-over"));
  uploadZone.addEventListener("drop", e => {
    e.preventDefault();
    uploadZone.classList.remove("drag-over");
    if (e.dataTransfer.files[0]) handleFileSelect(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener("change", e => {
    if (e.target.files[0]) handleFileSelect(e.target.files[0]);
  });

  document.getElementById("saveDraftBtn").addEventListener("click", () => saveDocument(true));
  document.getElementById("submitDocForm").addEventListener("submit", async e => {
    e.preventDefault();
    if (saveDocument._saving) return;          // block double-submit
    saveDocument._saving = true;
    try { await saveDocument(false); }
    finally { saveDocument._saving = false; }
  });

  // "New Entry" button after successful submit
  document.getElementById("newEntryBtn").addEventListener("click", () => {
    document.getElementById("submitSuccessPanel").classList.add("d-none");
    document.getElementById("submitDocForm").classList.remove("d-none");
    document.getElementById("submitDocForm").reset();
    document.getElementById("filePreview")?.classList.add("d-none");
    document.getElementById("submitDocMsg")?.classList.add("d-none");
    prepareSubmitForm(null);
  });
}

async function loadRecentSubmissions() {
  const container = document.getElementById("recentSubmissionsBody");
  if (!container || !currentUser) return;
  try {
    // Single where only — no orderBy to avoid composite index requirement
    const snap = await getDocs(
      query(collection(db, "documents"),
        where("submittedBy", "==", currentUser.uid),
        limit(50))
    );
    const allDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const ta = (a.submittedAt || a.submissionDate)?.toMillis?.() || a.submittedAt?.seconds * 1000 || 0;
        const tb = (b.submittedAt || b.submissionDate)?.toMillis?.() || b.submittedAt?.seconds * 1000 || 0;
        return tb - ta;
      })
      .slice(0, 10);
    if (!allDocs.length) {
      container.innerHTML = `<div class="text-center text-muted py-3" style="font-size:0.85rem;">No submissions yet.</div>`;
      return;
    }
    const rows = allDocs.map(doc => `<tr>
        <td style="font-size:0.78rem;">${doc.submissionRefNo || "—"}</td>
        <td style="font-size:0.78rem;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${doc.documentTitle || "—"}</td>
        <td style="font-size:0.78rem;">${doc.plantName || "—"}</td>
        <td style="font-size:0.78rem;">${doc.departmentName || "—"}</td>
        <td style="font-size:0.78rem;">${statusBadge(doc.status)}</td>
        <td style="font-size:0.78rem;">${toISTDate(doc.submittedAt || doc.submissionDate)}</td>
      </tr>`).join("");
    container.innerHTML = `<table class="table table-sm table-hover mb-0">
      <thead class="table-light">
        <tr>
          <th style="font-size:0.75rem;">Ref No.</th>
          <th style="font-size:0.75rem;">Document Title</th>
          <th style="font-size:0.75rem;">Plant</th>
          <th style="font-size:0.75rem;">Dept</th>
          <th style="font-size:0.75rem;">Status</th>
          <th style="font-size:0.75rem;">Submitted</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
  } catch (e) {
    // Fallback: try without orderBy (no composite index needed if no where+orderBy)
    try {
      const snap2 = await getDocs(
        query(collection(db, "documents"), where("submittedBy", "==", currentUser.uid), limit(20))
      );
      const docs2 = snap2.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.submittedAt?.seconds || 0) - (a.submittedAt?.seconds || 0))
        .slice(0, 10);
      if (!docs2.length) {
        container.innerHTML = `<div class="text-center text-muted py-3" style="font-size:0.85rem;">No submissions yet.</div>`;
        return;
      }
      const rows2 = docs2.map(doc => `<tr>
        <td style="font-size:0.78rem;">${doc.submissionRefNo || "—"}</td>
        <td style="font-size:0.78rem;">${doc.documentTitle || "—"}</td>
        <td style="font-size:0.78rem;">${doc.plantName || "—"}</td>
        <td style="font-size:0.78rem;">${doc.departmentName || "—"}</td>
        <td style="font-size:0.78rem;">${statusBadge(doc.status)}</td>
        <td style="font-size:0.78rem;">${toISTDate(doc.submittedAt)}</td>
      </tr>`).join("");
      container.innerHTML = `<table class="table table-sm table-hover mb-0">
        <thead class="table-light">
          <tr>
            <th style="font-size:0.75rem;">Ref No.</th>
            <th style="font-size:0.75rem;">Document Title</th>
            <th style="font-size:0.75rem;">Plant</th>
            <th style="font-size:0.75rem;">Dept</th>
            <th style="font-size:0.75rem;">Status</th>
            <th style="font-size:0.75rem;">Submitted</th>
          </tr>
        </thead>
        <tbody>${rows2}</tbody>
      </table>`;
    } catch(e2) {
      container.innerHTML = `<div class="text-center text-muted py-3" style="font-size:0.85rem;">Unable to load recent submissions.</div>`;
    }
  }
}

function handleFileSelect(file) {
  const allowed = ["pdf","doc","docx","xls","xlsx","ppt","pptx"];
  const ext = file.name.split(".").pop().toLowerCase();
  if (!allowed.includes(ext)) {
    showToast("File type not allowed.", "error");
    return;
  }
  if (file.size > 50 * 1024 * 1024) {
    showToast("File size must be under 50MB.", "error");
    return;
  }
  const preview = document.getElementById("filePreview");
  preview.classList.remove("d-none");
  preview.innerHTML = `
    <i class="bi ${fileIcon(file.name)} file-icon"></i>
    <span class="file-name">${file.name}</span>
    <span class="file-size">${formatFileSize(file.size)}</span>
  `;
  uploadedFileRef = file;
}

async function saveDocument(isDraft) {
  const title      = document.getElementById("docTitle").value.trim();
  const catSel     = document.getElementById("docCategory");
  const catId      = catSel.value;
  const catName    = catSel.options[catSel.selectedIndex]?.dataset.name || catSel.options[catSel.selectedIndex]?.text || "";
  const plantId    = document.getElementById("docPlant").value;
  const plantName  = document.getElementById("docPlantDisplay")?.value || "";
  const deptSel    = document.getElementById("docDept");
  const deptId     = deptSel.value;
  const deptName   = deptSel.options[deptSel.selectedIndex]?.dataset.name || deptSel.options[deptSel.selectedIndex]?.text || "";
  const desc       = document.getElementById("docDesc").value.trim();
  const rev        = document.getElementById("docRevision").value.trim();
  const reqName    = document.getElementById("reqByName")?.value.trim() || "";
  const reqEmail   = document.getElementById("reqByEmail")?.value.trim() || "";
  const msgEl      = document.getElementById("submitDocMsg");
  const spin       = document.getElementById("submitSpinner");

  msgEl.classList.add("d-none");

  if (!isDraft && (!title || !catId || !plantId || !deptId)) {
    msgEl.className = "mt-2 alert alert-danger";
    msgEl.textContent = "Please fill all required fields (Title, Category, Dept).";
    msgEl.classList.remove("d-none");
    return;
  }
  if (!isDraft && !reqEmail) {
    msgEl.className = "mt-2 alert alert-danger";
    msgEl.textContent = "Requester email is required for submission.";
    msgEl.classList.remove("d-none");
    return;
  }
  if (!isDraft && !uploadedFileRef && !editingDocId) {
    msgEl.className = "mt-2 alert alert-danger";
    msgEl.textContent = "Please attach a document file before submitting.";
    msgEl.classList.remove("d-none");
    return;
  }

  spin?.classList.remove("d-none");
  const submitBtn = document.getElementById("submitDocBtn");
  if (submitBtn) submitBtn.disabled = true;

  try {
    let fileUrl = null, fileName = null, fileSize = null;

    // ── Upload file if selected ──────────────────────────────────────────────
    if (uploadedFileRef) {
      const docIdForPath = editingDocId || ("new_" + Date.now());
      const storageRef = ref(storage, `documents/${currentUser.uid}/${docIdForPath}/${uploadedFileRef.name}`);
      const uploadTask = uploadBytesResumable(storageRef, uploadedFileRef);

      const progDiv = document.getElementById("uploadProgress");
      const progBar = document.getElementById("uploadBar");
      const progPct = document.getElementById("uploadPct");
      if (progDiv) progDiv.classList.remove("d-none");

      await new Promise((resolve, reject) => {
        uploadTask.on("state_changed",
          snap => {
            const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
            if (progBar) progBar.style.width = pct + "%";
            if (progPct) progPct.textContent = pct + "%";
          },
          reject,
          resolve
        );
      });

      fileUrl  = await getDownloadURL(storageRef);
      fileName = uploadedFileRef.name;
      fileSize = uploadedFileRef.size;
      if (progDiv) progDiv.classList.add("d-none");
    }

    // ── Build document data ─────────────────────────────────────────────────
    const submitterName  = currentUserData?.displayName || currentUser.email;
    const submitterEmail = currentUser.email;

    const docData = {
      documentTitle:      title,
      categoryId:         catId,
      categoryName:       catName,
      plantId,
      plantName,
      departmentId:       deptId,
      departmentName:     deptName,
      documentDescription: desc,
      documentRevision:   rev,
      submittedBy:        currentUser.uid,
      submittedByName:    submitterName,
      submittedByEmail:   submitterEmail,
      requestedByName:    reqName,
      requestedByEmail:   reqEmail,
      status:             isDraft ? "draft" : "submitted",
      updatedAt:          serverTimestamp(),
    };
    if (fileUrl)  { docData.fileUrl = fileUrl; docData.fileName = fileName; docData.fileSize = fileSize; }

    // ── Save or update Firestore document ───────────────────────────────────
    if (editingDocId) {
      await updateDoc(doc(db, "documents", editingDocId), docData);
    } else {
      const newRef = await addDoc(collection(db, "documents"), {
        ...docData,
        createdAt:     serverTimestamp(),
        statusHistory: [{
          status:      isDraft ? "draft" : "submitted",
          changedBy:   currentUser.uid,
          changedByName: submitterName,
          changedAt:   nowIST(),
        }],
      });
      editingDocId = newRef.id;
    }

    if (!isDraft) {
      // ── Generate ref number directly via Firestore (fast, no cold-start) ──
      let refNo = await runTransaction(db, async (txn) => {
        const counterRef  = doc(db, "appSettings", "refCounter");
        const counterSnap = await txn.get(counterRef);
        let seq = 1;
        if (counterSnap.exists()) {
          seq = (counterSnap.data().lastSeq || 0) + 1;
        }
        txn.set(counterRef, { lastSeq: seq }, { merge: true });
        const year = new Date().getFullYear();
        return `CDRTS/${year}/${String(seq).padStart(5, "0")}`;
      });
      // Update the doc with the ref number and confirmed status
      await updateDoc(doc(db, "documents", editingDocId), {
        submissionRefNo: refNo,
        status:          "submitted",
        submittedAt:     serverTimestamp(),
        submissionDate:  serverTimestamp(),   // keep both for backward compat
      });

      // ── Emails are sent ONLY when user clicks "Send Notification" button ──
      // (handled by sendUserNotification Cloud Function — not triggered here)

      // ── Success UI ───────────────────────────────────────────────────────
      showToast(`Submitted! Ref: ${refNo}`, "success");

      // Show success panel, hide form
      document.getElementById("submitDocForm").classList.add("d-none");
      const successPanel = document.getElementById("submitSuccessPanel");
      successPanel.classList.remove("d-none");
      document.getElementById("submitSuccessRef").textContent = `Reference: ${refNo}`;
      editingDocId = null;
      uploadedFileRef = null;
      if (window._submitClock) { clearInterval(window._submitClock); window._submitClock = null; }

      // Refresh recent submissions
      loadRecentSubmissions();

    } else {
      // Draft saved
      msgEl.className = "mt-2 alert alert-info";
      msgEl.textContent = "Draft saved successfully.";
      msgEl.classList.remove("d-none");
      showToast("Draft saved.", "info");
    }

  } catch (e) {
    console.error("saveDocument error:", e);
    msgEl.className = "mt-2 alert alert-danger";
    msgEl.textContent = e.message || "An error occurred. Please try again.";
    msgEl.classList.remove("d-none");
  } finally {
    spin?.classList.add("d-none");
    if (submitBtn) submitBtn.disabled = false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SEND NOTIFICATION (user button)
// ═══════════════════════════════════════════════════════════════════════════
let _sendNotifInitialized = false;
function setupSendNotification() {
  if (_sendNotifInitialized) return;
  _sendNotifInitialized = true;
  const btn = document.getElementById("sendNotifBtn");
  const lastEl = document.getElementById("notifLastSent");

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Sending…`;

    // Clear this user's notificationQueue entries so any server-side cooldown check is bypassed
    try {
      const { getDocs: gd, query: q2, collection: col2, where: wh, deleteDoc: dd, doc: dc } =
        await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
      const qSnap = await gd(q2(col2(db, "notificationQueue"), wh("userId", "==", currentUser.uid)));
      await Promise.all(qSnap.docs.map(d => dd(dc(db, "notificationQueue", d.id))));
    } catch (_) { /* ignore — proceed to send anyway */ }

    const notifFn = httpsCallable(functions, "sendUserNotification");
    try {
      const res = await notifFn();
      const isMR = currentUserData?.role === "corporate_mr" || currentUserData?.role === "superadmin";
      if (res.data.success) {
        const msg = res.data.message ||
          (isMR
            ? `Notification sent for ${res.data.count} document(s).`
            : `Reminder sent to Corporate MR for ${res.data.count} document(s).`);
        showToast(msg, "success");
        lastEl.textContent = `Last sent: ${nowIST()}`;
        lastEl.classList.remove("d-none");
      } else {
        showToast(res.data.message || "No documents found.", "warning");
      }
    } catch (e) {
      const msg = e?.details?.message || e?.message || "Failed to send notification.";
      showToast(msg, "danger");
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<i class="bi bi-bell-fill me-1"></i>Send Notification`;
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT LOGS
// ═══════════════════════════════════════════════════════════════════════════
async function loadAuditLogs() {
  const snap = await getDocs(query(
    collection(db, "activityLogs"),
    orderBy("timestamp", "desc"),
    limit(200)
  ));

  const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const tbody = document.getElementById("auditBody");

  if (!logs.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-muted">No audit logs found.</td></tr>`;
    return;
  }

  tbody.innerHTML = logs.map(l => `
    <tr>
      <td>${toIST(l.timestamp)}</td>
      <td>${l.userName || l.userId || "—"}</td>
      <td><code>${l.activity || "—"}</code></td>
      <td>${l.submissionRefNo || l.documentId || "—"}</td>
      <td class="text-muted small">${l.details || ""}</td>
    </tr>
  `).join("");

  document.getElementById("auditSearch").oninput = e => {
    const q = e.target.value.toLowerCase();
    tbody.querySelectorAll("tr").forEach(row => {
      row.style.display = row.textContent.toLowerCase().includes(q) ? "" : "none";
    });
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// DELETE RECORDS
// ═══════════════════════════════════════════════════════════════════════════
async function handleDeleteRecords() {
  const spin = document.getElementById("deleteSpinner");
  const reason = document.getElementById("deleteReason").value.trim();
  hideError("deleteError");

  if (!reason) { showError("deleteError", "Deletion reason is required."); return; }
  if (!selectedDocIds.size) { showError("deleteError", "No records selected."); return; }

  spin.classList.remove("d-none");
  const deleteFn = httpsCallable(functions, "deleteRecords");
  try {
    const result = await deleteFn({ documentIds: [...selectedDocIds], reason });
    bootstrap.Modal.getInstance(document.getElementById("deleteModal")).hide();
    showToast(`${result.data.count} record(s) archived successfully.`, "success");
    selectedDocIds.clear();
    document.getElementById("masterCheckbox").checked = false;
    updateSelectionUI();
    loadDashboard();
  } catch (e) {
    showError("deleteError", e.message);
  } finally {
    spin.classList.add("d-none");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DATA RETENTION & WIPE  (superadmin)
// ═══════════════════════════════════════════════════════════════════════════

async function loadRetentionSettings() {
  if (!isSuperadmin()) return;
  try {
    const snap = await getDoc(doc(db, "appSettings", "retention")).catch(() => null);
    if (snap?.exists()) {
      const r = snap.data();
      document.getElementById("retentionDays").value = r.days ?? 90;
      ["submitted","returned","completed"].forEach(s => {
        const el = document.getElementById("retain" + s.charAt(0).toUpperCase() + s.slice(1));
        if (el) el.checked = r.statuses ? r.statuses.includes(s) : true;
      });
      const lastRun = r.lastRunAt?.toDate ? r.lastRunAt.toDate() : null;
      document.getElementById("retentionLastRun").textContent =
        lastRun ? "Last run: " + lastRun.toLocaleString("en-IN") : "Never run";
      if (r.days) {
        const next = new Date(); next.setDate(next.getDate() + 1);
        document.getElementById("retentionNextRun").textContent = "Next run: tomorrow (daily)";
      }
    }
  } catch(e) { console.warn("loadRetentionSettings:", e); }
}

async function saveRetentionSettings() {
  if (!isSuperadmin()) return;
  const days = parseInt(document.getElementById("retentionDays").value) || 0;
  const statuses = ["submitted","returned","completed"].filter(s => {
    const el = document.getElementById("retain" + s.charAt(0).toUpperCase() + s.slice(1));
    return el?.checked;
  });
  const msgEl = document.getElementById("retentionMsg");
  msgEl.classList.add("d-none");
  try {
    await setDoc(doc(db, "appSettings", "retention"), { days, statuses }, { merge: true });
    msgEl.className = "alert alert-success mt-3";
    msgEl.textContent = `✅ Retention policy saved: delete after ${days} days${days === 0 ? " (disabled)" : ""}.`;
    msgEl.classList.remove("d-none");
  } catch(e) {
    msgEl.className = "alert alert-danger mt-3";
    msgEl.textContent = e.message;
    msgEl.classList.remove("d-none");
  }
}

async function runRetentionNow() {
  if (!isSuperadmin()) return;
  const spin = document.getElementById("retentionSpinner");
  const btn  = document.getElementById("runRetentionNowBtn");
  const msgEl = document.getElementById("retentionMsg");
  spin.classList.remove("d-none"); btn.disabled = true;
  msgEl.classList.add("d-none");
  try {
    const fn = httpsCallable(functions, "runRetentionDelete");
    const res = await fn();
    msgEl.className = "alert alert-success mt-3";
    msgEl.textContent = `✅ Deleted ${res.data.deleted ?? 0} document(s) and ${res.data.files ?? 0} file(s).`;
    msgEl.classList.remove("d-none");
    await setDoc(doc(db, "appSettings", "retention"), { lastRunAt: serverTimestamp() }, { merge: true });
    document.getElementById("retentionLastRun").textContent = "Last run: just now";
  } catch(e) {
    msgEl.className = "alert alert-danger mt-3";
    msgEl.textContent = "Error: " + e.message;
    msgEl.classList.remove("d-none");
  } finally {
    spin.classList.add("d-none"); btn.disabled = false;
  }
}

// ── Wipe modal helpers ───────────────────────────────────────────────────────
let _wipePendingMode = null;

function openWipeModal(mode) {
  _wipePendingMode = mode;
  const titles = {
    docs:  "Wipe All Documents",
    full:  "Full App Reset",
  };
  const descs = {
    docs: "This will permanently delete <strong>ALL documents</strong>, their uploaded files in Firebase Storage, and all activity logs. The reference counter will be reset to 0. <br><br>Plants, departments, users, and categories are NOT affected.",
    full: "This will permanently delete <strong>ALL documents, plants, departments, and categories</strong>. User accounts and system settings (email, branding) are preserved. <br><br>Use this to start the app completely fresh.",
  };
  document.getElementById("wipeModalTitle").textContent = titles[mode] || "Confirm Wipe";
  document.getElementById("wipeModalDesc").innerHTML   = descs[mode]  || "";
  document.getElementById("wipeConfirmLabel").textContent = titles[mode];
  document.getElementById("wipeConfirmInput").value = "";
  document.getElementById("wipeModalError").classList.add("d-none");
  new bootstrap.Modal(document.getElementById("wipeModal")).show();
}

async function executeWipe() {
  if (!isSuperadmin()) return;
  const input = document.getElementById("wipeConfirmInput").value.trim();
  const errEl = document.getElementById("wipeModalError");
  errEl.classList.add("d-none");
  if (input !== "WIPE") {
    errEl.textContent = "Please type WIPE (all caps) to confirm.";
    errEl.classList.remove("d-none");
    return;
  }
  const spin = document.getElementById("wipeSpinner");
  const btn  = document.getElementById("confirmWipeBtn");
  spin.classList.remove("d-none"); btn.disabled = true;

  // Helper: delete all docs in a Firestore collection in batches (client-side)
  async function wipeCollection(colName) {
    let total = 0;
    while (true) {
      const snap = await getDocs(query(collection(db, colName), limit(400)));
      if (snap.empty) break;
      const batches = [];
      let b = writeBatch(db);
      let count = 0;
      for (const d of snap.docs) {
        b.delete(d.ref);
        count++;
        if (count === 400) { batches.push(b.commit()); b = writeBatch(db); count = 0; }
      }
      if (count > 0) batches.push(b.commit());
      await Promise.all(batches);
      total += snap.size;
    }
    return total;
  }

  try {
    const mode = _wipePendingMode || "docs";

    // 1. Delete all documents
    const docsDeleted = await wipeCollection("documents");
    // 2. Clear activity logs & notification queue
    await wipeCollection("activityLogs");
    await wipeCollection("notificationQueue");
    // 3. Reset ref counter
    await setDoc(doc(db, "appSettings", "refCounter"), { lastSeq: 0 }, { merge: true });
    // 4. Full reset: also wipe master data
    if (mode === "full") {
      await wipeCollection("plants");
      await wipeCollection("departments");
      await wipeCollection("categories");
      await wipeCollection("documentNumberRegistry");
    }
    // 5. Write audit log
    await addDoc(collection(db, "activityLogs"), {
      activity:    mode === "full" ? "full_app_reset" : "wipe_documents",
      performedBy: auth.currentUser.uid,
      docsDeleted,
      timestamp:   serverTimestamp(),
    });

    bootstrap.Modal.getInstance(document.getElementById("wipeModal")).hide();
    showToast(`✅ Wipe complete: ${docsDeleted} docs deleted.`, "success");
    loadDashboard();
  } catch(e) {
    console.error("Wipe error:", e);
    errEl.textContent = "Error: " + (e.message || "Wipe failed.");
    errEl.classList.remove("d-none");
  } finally {
    spin.classList.add("d-none"); btn.disabled = false;
  }
}

let _dangerZoneInitialized = false;
function setupDangerZone() {
  if (_dangerZoneInitialized) return;
  _dangerZoneInitialized = true;
  document.getElementById("wipeDocsBtn")?.addEventListener("click", () => openWipeModal("docs"));
  document.getElementById("wipeAllBtn")?.addEventListener("click",  () => openWipeModal("full"));
  document.getElementById("confirmWipeBtn")?.addEventListener("click", executeWipe);
  document.getElementById("saveRetentionBtn")?.addEventListener("click", saveRetentionSettings);
  document.getElementById("runRetentionNowBtn")?.addEventListener("click", runRetentionNow);
  document.getElementById("saveDigestBtn")?.addEventListener("click", saveDigestSettings);
  document.getElementById("sendDigestNowBtn")?.addEventListener("click", sendDigestNow);
  document.getElementById("fillDummyDataBtn")?.addEventListener("click", fillDummyDigestData);
  document.getElementById("clearDummyDataBtn")?.addEventListener("click", clearDummyDigestData);
}

// ─── DAILY DIGEST SETTINGS ───────────────────────────────────────────────
async function loadDigestSettings() {
  try {
    const snap = await getDoc(doc(db, "appSettings", "dailyDigest")).catch(() => null);
    if (snap?.exists()) {
      const d = snap.data();
      const hourEl = document.getElementById("digestHour");
      if (hourEl && d.hour !== undefined) hourEl.value = String(d.hour);
      const enabledEl = document.getElementById("digestEnabled");
      if (enabledEl) enabledEl.checked = d.enabled !== false;
      const lastEl = document.getElementById("digestLastSent");
      if (lastEl) {
        const last = d.lastSentAt?.toDate ? d.lastSentAt.toDate() : null;
        lastEl.textContent = last ? "Last sent: " + last.toLocaleString("en-IN") : "Never sent";
      }
    }
  } catch(e) { console.warn("loadDigestSettings:", e); }
}

async function saveDigestSettings() {
  const hour = parseInt(document.getElementById("digestHour").value);
  const enabled = document.getElementById("digestEnabled").checked;
  const msgEl = document.getElementById("digestMsg");
  try {
    await setDoc(doc(db, "appSettings", "dailyDigest"), { hour, enabled }, { merge: true });
    msgEl.className = "alert alert-success mt-3";
    msgEl.textContent = `Daily digest ${enabled ? "enabled" : "disabled"}. Will send at ${hour}:00 IST.`;
    msgEl.classList.remove("d-none");
    setTimeout(() => msgEl.classList.add("d-none"), 4000);
  } catch(e) {
    msgEl.className = "alert alert-danger mt-3";
    msgEl.textContent = "Failed to save: " + e.message;
    msgEl.classList.remove("d-none");
  }
}

async function sendDigestNow() {
  const spin = document.getElementById("digestSpinner");
  const btn  = document.getElementById("sendDigestNowBtn");
  const msgEl = document.getElementById("digestMsg");
  if (spin) spin.classList.remove("d-none");
  if (btn) btn.disabled = true;
  try {
    const fn = httpsCallable(functions, "sendDailyDigestNow");
    const result = await fn();
    msgEl.className = "alert alert-success mt-3";
    msgEl.textContent = result.data.test
      ? `Test email sent to superadmin. No document activity found in last 24h — blank template delivered.`
      : `Digest sent successfully. ${result.data.sent} email(s) dispatched.`;
    msgEl.classList.remove("d-none");
    loadDigestSettings();
  } catch(e) {
    msgEl.className = "alert alert-danger mt-3";
    msgEl.textContent = "Failed: " + (e.message || "Unknown error");
    msgEl.classList.remove("d-none");
  } finally {
    if (spin) spin.classList.add("d-none");
    if (btn) btn.disabled = false;
  }
}

const DUMMY_DIGEST_TAG = "__digestTest__";

async function fillDummyDigestData() {
  const msgEl = document.getElementById("digestMsg");
  const btn = document.getElementById("fillDummyDataBtn");
  btn.disabled = true;
  try {
    const now = new Date();
    const batch = writeBatch(db);
    const dummyDocs = [
      {
        submissionRefNo: "TEST-001", documentTitle: "Welding Procedure Rev 3",
        plantName: "YNR", plantId: "test-plant-1",
        categoryName: "SOP", departmentName: "ENG",
        submittedBy: currentUser.uid, submittedByName: currentUserData?.displayName || "Test User",
        submittedByEmail: currentUser.email,
        submissionDate: serverTimestamp(),
        numberAssignedAt: serverTimestamp(),
        officialDocNumber: "CORP-2026-045",
        status: "completed", tag: DUMMY_DIGEST_TAG,
      },
      {
        submissionRefNo: "TEST-002", documentTitle: "ISO Inspection Checklist",
        plantName: "ENG", plantId: "test-plant-2",
        categoryName: "ISO", departmentName: "QC",
        submittedBy: currentUser.uid, submittedByName: currentUserData?.displayName || "Test User",
        submittedByEmail: currentUser.email,
        submissionDate: serverTimestamp(),
        status: "submitted", tag: DUMMY_DIGEST_TAG,
      },
      {
        submissionRefNo: "TEST-003", documentTitle: "Safety Training Manual",
        plantName: "YNR", plantId: "test-plant-1",
        categoryName: "Training", departmentName: "HR",
        submittedBy: currentUser.uid, submittedByName: currentUserData?.displayName || "Test User",
        submittedByEmail: currentUser.email,
        submissionDate: Timestamp.fromDate(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)),
        status: "under_process", tag: DUMMY_DIGEST_TAG,
      },
      {
        submissionRefNo: "TEST-004", documentTitle: "Quality Control Procedure",
        plantName: "ENG", plantId: "test-plant-2",
        categoryName: "QC", departmentName: "QC",
        submittedBy: currentUser.uid, submittedByName: currentUserData?.displayName || "Test User",
        submittedByEmail: currentUser.email,
        submissionDate: Timestamp.fromDate(new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)),
        status: "pending_with_mr", tag: DUMMY_DIGEST_TAG,
      },
    ];
    dummyDocs.forEach(d => batch.set(doc(collection(db, "documents")), d));
    await batch.commit();
    msgEl.className = "alert alert-success mt-3";
    msgEl.textContent = "4 test documents added. Click Send Now (Test) to preview the digest.";
    msgEl.classList.remove("d-none");
  } catch(e) {
    msgEl.className = "alert alert-danger mt-3";
    msgEl.textContent = "Failed: " + e.message;
    msgEl.classList.remove("d-none");
  } finally { btn.disabled = false; }
}

async function clearDummyDigestData() {
  const msgEl = document.getElementById("digestMsg");
  const btn = document.getElementById("clearDummyDataBtn");
  btn.disabled = true;
  try {
    const snap = await getDocs(query(collection(db, "documents"), where("tag", "==", DUMMY_DIGEST_TAG)));
    if (snap.empty) {
      msgEl.className = "alert alert-warning mt-3";
      msgEl.textContent = "No test documents found to clear.";
      msgEl.classList.remove("d-none");
      return;
    }
    const batch = writeBatch(db);
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    msgEl.className = "alert alert-success mt-3";
    msgEl.textContent = `${snap.size} test document(s) cleared.`;
    msgEl.classList.remove("d-none");
  } catch(e) {
    msgEl.className = "alert alert-danger mt-3";
    msgEl.textContent = "Failed: " + e.message;
    msgEl.classList.remove("d-none");
  } finally { btn.disabled = false; }
}

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════════════════
async function loadSettings() {
  loadPlantsTable();
  loadDeptsTable();
  loadUsersTable();
  loadCatsTable();
  if (isSuperadmin()) { loadRetentionSettings(); loadDigestSettings(); }

  // Load saved settings
  const emailSnap = await getDoc(doc(db, "appSettings", "notifications")).catch(() => null);
  if (emailSnap?.exists()) {
    const s = emailSnap.data();
    document.getElementById("settingAppUrl").value = s.appUrl || "";
    document.getElementById("settingFromName").value = s.fromName || "CDRTS System";
    if (document.getElementById("settingFromName")) document.getElementById("settingFromName").value = s.fromName || "CDRTS System";
  }
  // Load Gmail credentials (stored separately for security)
  const gmailSnap = await getDoc(doc(db, "appSettings", "emailCredentials")).catch(() => null);
  if (gmailSnap?.exists()) {
    const g = gmailSnap.data();
    document.getElementById("settingGmailUser").value = g.gmailUser || "";
    // Show masked password placeholder if set
    if (g.gmailPassSet) {
      document.getElementById("settingGmailPass").placeholder = "••••••••••••••••  (saved — enter new to change)";
    }
  }

  // Toggle Gmail password visibility
  document.getElementById("toggleGmailPass").addEventListener("click", () => {
    const el = document.getElementById("settingGmailPass");
    const icon = document.querySelector("#toggleGmailPass i");
    el.type = el.type === "password" ? "text" : "password";
    icon.className = el.type === "password" ? "bi bi-eye" : "bi bi-eye-slash";
  });

  document.getElementById("saveEmailSettings").onclick = async () => {
    const msgEl  = document.getElementById("emailSettingsMsg");
    const spin   = document.getElementById("emailSaveSpinner");
    const gmailUser = document.getElementById("settingGmailUser").value.trim();
    const gmailPass = document.getElementById("settingGmailPass").value.trim();
    const appUrl    = document.getElementById("settingAppUrl").value.trim();
    const fromName  = document.getElementById("settingFromName").value.trim();

    msgEl.classList.add("d-none");
    spin.classList.remove("d-none");

    try {
      // Save general settings
      await setOrMergeSettings("notifications", { appUrl, fromName });

      // Save Gmail credentials if provided
      if (gmailUser || gmailPass) {
        const credData = { gmailUser, updatedAt: serverTimestamp() };
        if (gmailPass) {
          // Strip spaces from app password (xxxx xxxx xxxx xxxx → xxxxxxxxxxxxxxxx)
          credData.gmailAppPassword = gmailPass.replace(/\s/g, "");
          credData.gmailPassSet = true;
        }
        await setOrMergeSettings("emailCredentials", credData);
      }

      spin.classList.add("d-none");
      msgEl.className = "alert alert-success";
      msgEl.textContent = "✓ Email settings saved successfully.";
      msgEl.classList.remove("d-none");
      document.getElementById("settingGmailPass").value = "";
      document.getElementById("settingGmailPass").placeholder = "••••••••••••••••  (saved — enter new to change)";
      showToast("Email settings saved.", "success");
    } catch (e) {
      spin.classList.add("d-none");
      msgEl.className = "alert alert-danger";
      msgEl.textContent = "Error: " + e.message;
      msgEl.classList.remove("d-none");
    }
  };

  document.getElementById("saveNotifSettings").onclick = async () => {
    await setOrMergeSettings("notifications", {
      fromName: document.getElementById("settingFromName")?.value.trim() || "CDRTS System",
    });
    showToast("Notification settings saved.", "success");
  };

  // Branding — load existing values
  const brandSnap = await getDoc(doc(db, "appSettings", "branding")).catch(() => null);
  if (brandSnap?.exists()) {
    const b = brandSnap.data();
    if (b.appTitle)     { const el = document.getElementById("settingAppTitle");     if(el) el.value = b.appTitle; }
    if (b.primaryColor) { const el = document.getElementById("settingPrimaryColor"); if(el) el.value = b.primaryColor; }
    if (b.companyName)  { const el = document.getElementById("settingCompanyName");  if(el) el.value = b.companyName; }
    const logoDiv = document.getElementById("currentLogo");
    if (logoDiv) {
      if (b.logoRemoved || !b.logoUrl) {
        logoDiv.innerHTML = `<span class="text-muted small">No logo set.</span>`;
      } else {
        logoDiv.innerHTML = `<img src="${b.logoUrl}" height="40" alt="Current Logo" style="border-radius:6px;border:1px solid var(--border);">`;
      }
    }
  }

  document.getElementById("saveBrandingBtn").onclick = async () => {
    try {
      await setOrMergeSettings("branding", {
        appTitle:     document.getElementById("settingAppTitle")?.value || "",
        primaryColor: document.getElementById("settingPrimaryColor")?.value || "",
        companyName:  document.getElementById("settingCompanyName")?.value || "",
      });
      applyBranding();
      showToast("Branding saved.", "success");
    } catch(e) { showToast("Save failed: " + e.message, "error"); }
  };

  const logoZone = document.getElementById("logoUploadZone");
  const logoFile = document.getElementById("logoFile");
  logoZone.addEventListener("click", () => logoFile.click());
  logoFile.addEventListener("change", async e => {
    const file = e.target.files[0];
    if (!file) return;
    const logoDiv = document.getElementById("currentLogo");
    logoDiv.innerHTML = `<div class="spinner-border spinner-border-sm text-primary me-2"></div><span class="text-muted small">Uploading logo…</span>`;
    try {
      const ext = file.name.split(".").pop().toLowerCase();
      const storageRef = ref(storage, `branding/logo.${ext}`);
      const task = uploadBytesResumable(storageRef, file);
      await new Promise((resolve, reject) => task.on("state_changed", null, reject, resolve));
      const url = await getDownloadURL(storageRef);
      await setOrMergeSettings("branding", { logoUrl: url, logoRemoved: false });
      // Apply immediately
      const authLogo = document.getElementById("authLogo");
      const sidebarLogo = document.getElementById("sidebarLogo");
      const authLogoWrapU = document.getElementById("authLogoWrap");
      if (authLogoWrapU) authLogoWrapU.style.display = "";
      if (authLogo)    { authLogo.src = url; authLogo.style.display = ""; }
      if (sidebarLogo) { sidebarLogo.src = url; sidebarLogo.style.display = ""; }
      logoDiv.innerHTML = `<img src="${url}" height="40" alt="Logo" style="border-radius:6px;border:1px solid var(--border);">`;
      showToast("Logo uploaded successfully.", "success");
    } catch (err) {
      logoDiv.innerHTML = `<span class="text-danger small"><i class="bi bi-exclamation-triangle me-1"></i>Upload failed: ${err.message}</span>`;
      showToast("Logo upload failed: " + err.message, "error");
    }
  });

  // ── Remove Logo ────────────────────────────────────────────────────────────
  document.getElementById("removeLogoBtn")?.addEventListener("click", async () => {
    if (!confirm("Remove the branding logo? You can upload a new one anytime.")) return;
    try {
      await setOrMergeSettings("branding", { logoUrl: "", logoRemoved: true });
      // Hide immediately on page
      const authLogo     = document.getElementById("authLogo");
      const authLogoWrap = document.getElementById("authLogoWrap");
      const sidebarLogo  = document.getElementById("sidebarLogo");
      if (authLogoWrap) authLogoWrap.style.display = "none";
      if (authLogo)     { authLogo.src = ""; authLogo.style.display = "none"; }
      if (sidebarLogo)  { sidebarLogo.src = ""; sidebarLogo.style.display = "none"; }
      document.getElementById("currentLogo").innerHTML = `<span class="text-muted small">No logo set.</span>`;
      showToast("Logo removed.", "success");
    } catch(err) {
      showToast("Error removing logo: " + err.message, "error");
      console.error("removeLogoBtn error:", err);
    }
  });

  // ── Test Mail ──────────────────────────────────────────────────────────────
  const sendTestMailBtn = document.getElementById("sendTestMailBtn");
  if (sendTestMailBtn) {
    sendTestMailBtn.addEventListener("click", async () => {
      const toEl      = document.getElementById("testMailTo");
      const subjEl    = document.getElementById("testMailSubject");
      const bodyEl    = document.getElementById("testMailBody");
      const msgEl     = document.getElementById("testMailMsg");
      const to        = toEl?.value.trim();
      const subject   = subjEl?.value.trim() || "CDRTS – Test Email";
      const bodyText  = bodyEl?.value.trim();

      if (!to) {
        if (msgEl) { msgEl.className = "alert alert-danger"; msgEl.textContent = "Please enter a recipient email."; msgEl.classList.remove("d-none"); }
        return;
      }

      sendTestMailBtn.disabled = true;
      sendTestMailBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> Sending…`;
      if (msgEl) msgEl.classList.add("d-none");

      try {
        const sendMailFn = httpsCallable(functions, "sendTestEmail");
        await sendMailFn({
          to,
          subject,
          html: `<div style="font-family:sans-serif;padding:16px;">
            <h3 style="color:#1971c2;">📧 CDRTS Test Email</h3>
            <p>${bodyText || "This is a test email from CDRTS to verify your email configuration."}</p>
            <hr style="border:none;border-top:1px solid #dee2e6;margin:16px 0;">
            <p style="color:#868e96;font-size:12px;">Sent from CDRTS at ${nowIST()}</p>
          </div>`,
        });
        if (msgEl) {
          msgEl.className = "alert alert-success";
          msgEl.innerHTML = `✅ Test email sent to <strong>${to}</strong>. Check your inbox.`;
          msgEl.classList.remove("d-none");
        }
        showToast("Test email sent!", "success");
      } catch (e) {
        const hint = e.message?.includes("not found") || e.message?.includes("UNAUTHENTICATED")
          ? " (Cloud Function not deployed — deploy functions first)"
          : "";
        if (msgEl) {
          msgEl.className = "alert alert-danger";
          msgEl.textContent = "Failed to send: " + (e.message || "Unknown error") + hint;
          msgEl.classList.remove("d-none");
        }
        showToast("Test email failed.", "error");
      } finally {
        sendTestMailBtn.disabled = false;
        sendTestMailBtn.innerHTML = `<i class="bi bi-send me-1"></i> Send Test Email`;
      }
    });
  }
}

async function setOrMergeSettings(docId, data) {
  const ref2 = doc(db, "appSettings", docId);
  await setDoc(ref2, data, { merge: true });
}

// ── PLANTS TABLE ──────────────────────────────────────────────────────────
async function loadPlantsTable() {
  const snap = await getDocs(collection(db, "plants"));
  const plantsAll = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const tbody = document.getElementById("plantsBody");
  tbody.innerHTML = plantsAll.map((p, i) => `
    <tr>
      <td>${i+1}</td>
      <td>${p.name}</td>
      <td>${p.code || "—"}</td>
      <td>${p.active ? `<span class="badge bg-success">Active</span>` : `<span class="badge bg-secondary">Inactive</span>`}</td>
      <td>
        <button class="btn btn-sm btn-outline-primary edit-plant" data-id="${p.id}" data-name="${p.name}" data-code="${p.code||""}">Edit</button>
        <button class="btn btn-sm btn-outline-${p.active ? "danger" : "success"} toggle-plant"
          data-id="${p.id}" data-active="${p.active}">${p.active ? "Deactivate" : "Activate"}</button>
        <button class="btn btn-sm btn-outline-danger delete-plant" data-id="${p.id}" data-name="${p.name}">Delete</button>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="5" class="text-center text-muted">No plants yet.</td></tr>`;

  tbody.querySelectorAll(".edit-plant").forEach(b => b.addEventListener("click", () => {
    showGenericModal("Edit Plant", `
      <div class="mb-3"><label class="form-label">Plant Name</label>
        <input type="text" id="gm_plantName" class="form-control" value="${b.dataset.name}" /></div>
      <div class="mb-3"><label class="form-label">Plant Code</label>
        <input type="text" id="gm_plantCode" class="form-control" value="${b.dataset.code}" /></div>
    `, async () => {
      const name = document.getElementById("gm_plantName").value.trim();
      const code = document.getElementById("gm_plantCode").value.trim();
      if (!name) throw new Error("Plant name is required.");
      await updateDoc(doc(db, "plants", b.dataset.id), { name, code });
      loadPlantsTable(); loadMasterData();
    });
  }));

  tbody.querySelectorAll(".toggle-plant").forEach(b => b.addEventListener("click", async () => {
    const active = b.dataset.active !== "true";
    await updateDoc(doc(db, "plants", b.dataset.id), { active });
    loadPlantsTable();
  }));

  tbody.querySelectorAll(".delete-plant").forEach(b => b.addEventListener("click", () => {
    showGenericModal("Delete Plant",
      `<p>Are you sure you want to delete plant <strong>${b.dataset.name}</strong>?</p>
       <p class="text-danger small">This cannot be undone. Documents linked to this plant will retain their plant name.</p>`,
      async () => {
        await deleteDoc(doc(db, "plants", b.dataset.id));
        loadPlantsTable(); loadMasterData();
        showToast("Plant deleted.", "success");
      }, "Delete", "btn-danger");
  }));

  document.getElementById("addPlantBtn").onclick = () => {
    showGenericModal("Add Plant", `
      <div class="mb-3"><label class="form-label fw-semibold">Plant Name *</label>
        <input type="text" id="gm_plantName" class="form-control" placeholder="e.g. Plant A" /></div>
      <div class="mb-3"><label class="form-label">Plant Code</label>
        <input type="text" id="gm_plantCode" class="form-control" placeholder="e.g. PLT-A" /></div>
    `, async () => {
      const name = document.getElementById("gm_plantName").value.trim();
      const code = document.getElementById("gm_plantCode").value.trim();
      if (!name) throw new Error("Plant name is required.");
      const existing = await getDocs(query(collection(db, "plants"), where("name", "==", name)));
      if (!existing.empty) throw new Error("Plant already exists.");
      await addDoc(collection(db, "plants"), { name, code, active: true, createdAt: serverTimestamp() });
      loadPlantsTable(); loadMasterData();
    });
  };
}

// ── DEPARTMENTS TABLE ─────────────────────────────────────────────────────
async function loadDeptsTable() {
  const snap = await getDocs(collection(db, "departments"));
  const depts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const tbody = document.getElementById("deptsBody");
  tbody.innerHTML = depts.map((d, i) => `
    <tr>
      <td>${i+1}</td><td>${d.name}</td>
      <td>${d.active ? `<span class="badge bg-success">Active</span>` : `<span class="badge bg-secondary">Inactive</span>`}</td>
      <td>
        <button class="btn btn-sm btn-outline-primary edit-dept" data-id="${d.id}" data-name="${d.name}">Edit</button>
        <button class="btn btn-sm btn-outline-${d.active ? "danger" : "success"} toggle-dept"
          data-id="${d.id}" data-active="${d.active}">${d.active ? "Deactivate" : "Activate"}</button>
        <button class="btn btn-sm btn-outline-danger delete-dept" data-id="${d.id}" data-name="${d.name}">Delete</button>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="4" class="text-center text-muted">No departments yet.</td></tr>`;

  tbody.querySelectorAll(".toggle-dept").forEach(b => b.addEventListener("click", async () => {
    await updateDoc(doc(db, "departments", b.dataset.id), { active: b.dataset.active !== "true" });
    loadDeptsTable();
  }));

  tbody.querySelectorAll(".edit-dept").forEach(b => b.addEventListener("click", () => {
    showGenericModal("Edit Department", `
      <div class="mb-3"><label class="form-label fw-semibold">Department Name *</label>
        <input type="text" id="gm_deptName" class="form-control" value="${b.dataset.name}" /></div>
    `, async () => {
      const name = document.getElementById("gm_deptName").value.trim();
      if (!name) throw new Error("Department name is required.");
      await updateDoc(doc(db, "departments", b.dataset.id), { name });
      loadDeptsTable(); loadMasterData();
      showToast("Department updated.", "success");
    });
  }));

  tbody.querySelectorAll(".delete-dept").forEach(b => b.addEventListener("click", () => {
    showGenericModal("Delete Department",
      `<p>Are you sure you want to delete department <strong>${b.dataset.name}</strong>?</p>
       <p class="text-danger small">This cannot be undone. Documents linked to this department will retain their department name.</p>`,
      async () => {
        await deleteDoc(doc(db, "departments", b.dataset.id));
        loadDeptsTable(); loadMasterData();
        showToast("Department deleted.", "success");
      }, "Delete", "btn-danger");
  }));

  document.getElementById("addDeptBtn").onclick = () => {
    showGenericModal("Add Department", `
      <div class="mb-3"><label class="form-label fw-semibold">Department Name *</label>
        <input type="text" id="gm_deptName" class="form-control" /></div>
    `, async () => {
      const name = document.getElementById("gm_deptName").value.trim();
      if (!name) throw new Error("Department name is required.");
      const existing = await getDocs(query(collection(db, "departments"), where("name", "==", name)));
      if (!existing.empty) throw new Error("Department already exists.");
      await addDoc(collection(db, "departments"), { name, active: true, createdAt: serverTimestamp() });
      loadDeptsTable(); loadMasterData();
    });
  };
}

// ── USERS TABLE ───────────────────────────────────────────────────────────
async function loadUsersTable() {
  const snap = await getDocs(collection(db, "users"));
  const usersAll = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const tbody = document.getElementById("usersBody");
  // Store user objects by id for safe access in event handlers (avoids HTML attribute escaping issues)
  const usersMap = {};
  usersAll.forEach(u => { usersMap[u.id] = u; });

  tbody.innerHTML = usersAll.map(u => `
    <tr>
      <td>${u.displayName || "—"}</td>
      <td>${u.email || "—"}</td>
      <td><span class="badge bg-primary">${roleName(u.role)}</span></td>
      <td>${u.plantName || "—"}</td>
      <td>${u.departmentName || "—"}</td>
      <td>${u.active ? `<span class="badge bg-success">Active</span>` : `<span class="badge bg-secondary">Inactive</span>`}</td>
      <td>
        <button class="btn btn-sm btn-outline-primary edit-user" data-id="${u.id}">Edit</button>
        <button class="btn btn-sm btn-outline-${u.active ? "danger" : "success"} toggle-user"
          data-id="${u.id}" data-active="${u.active}">${u.active ? "Deactivate" : "Activate"}</button>
        <button class="btn btn-sm btn-outline-danger delete-user" data-id="${u.id}">Delete</button>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="7" class="text-center text-muted">No users yet.</td></tr>`;

  tbody.querySelectorAll(".toggle-user").forEach(b => b.addEventListener("click", async () => {
    await updateDoc(doc(db, "users", b.dataset.id), { active: b.dataset.active !== "true" });
    loadUsersTable();
  }));

  tbody.querySelectorAll(".edit-user").forEach(b => b.addEventListener("click", () => {
    const u = usersMap[b.dataset.id];
    if (!u) return;
    const plantOptions = plants.map(p =>
      `<option value="${p.id}" data-name="${p.name}" ${p.id === (u.plantId||"") ? "selected" : ""}>${p.name}</option>`
    ).join("");
    const deptOptions = departments.map(d =>
      `<option value="${d.id}" data-name="${d.name}" ${d.id === (u.departmentId||"") ? "selected" : ""}>${d.name}</option>`
    ).join("");
    showGenericModal("Edit User", `
      <div class="mb-3"><label class="form-label fw-semibold">Full Name *</label>
        <input type="text" id="gm_userName" class="form-control" value="${(u.displayName||"").replace(/"/g,"&quot;")}" /></div>
      <div class="mb-3"><label class="form-label fw-semibold">Role *</label>
        <select id="gm_userRole" class="form-select">
          <option value="user" ${u.role==="user"?"selected":""}>Plant / Department User</option>
          <option value="corporate_mr" ${u.role==="corporate_mr"?"selected":""}>Corporate MR</option>
          <option value="superadmin" ${u.role==="superadmin"?"selected":""}>Superadmin</option>
        </select></div>
      <div class="mb-3"><label class="form-label">Plant</label>
        <select id="gm_userPlant" class="form-select"><option value="">None</option>${plantOptions}</select></div>
      <div class="mb-3"><label class="form-label">Department</label>
        <select id="gm_userDept" class="form-select"><option value="">None</option>${deptOptions}</select></div>
    `, async () => {
      const displayName = document.getElementById("gm_userName").value.trim();
      const role = document.getElementById("gm_userRole").value;
      const pSel = document.getElementById("gm_userPlant");
      const dSel = document.getElementById("gm_userDept");
      if (!displayName) throw new Error("Name is required.");
      await updateDoc(doc(db, "users", u.id), {
        displayName, role,
        plantId:        pSel.value || null,
        plantName:      pSel.options[pSel.selectedIndex]?.dataset.name || "",
        departmentId:   dSel.value || null,
        departmentName: dSel.options[dSel.selectedIndex]?.dataset.name || "",
      });
      loadUsersTable();
      showToast("User updated.", "success");
    });
  }));

  tbody.querySelectorAll(".delete-user").forEach(b => b.addEventListener("click", () => {
    const u = usersMap[b.dataset.id];
    if (!u) return;
    showGenericModal("Delete User",
      `<p>Are you sure you want to delete user <strong>${u.displayName || u.email}</strong>?</p>
       <p class="text-danger small">This removes the user from CDRTS. Their submitted documents will remain. Firebase Auth account is not deleted automatically.</p>`,
      async () => {
        await deleteDoc(doc(db, "users", u.id));
        loadUsersTable();
        showToast("User deleted from CDRTS.", "success");
      }, "Delete", "btn-danger");
  }));

  document.getElementById("addUserBtn").onclick = () => {
    const plantOptions = plants.map(p => `<option value="${p.id}" data-name="${p.name}">${p.name}</option>`).join("");
    const deptOptions = departments.map(d => `<option value="${d.id}" data-name="${d.name}">${d.name}</option>`).join("");
    showGenericModal("Add User", `
      <div class="mb-3"><label class="form-label fw-semibold">Full Name *</label>
        <input type="text" id="gm_userName" class="form-control" /></div>
      <div class="mb-3"><label class="form-label fw-semibold">Email *</label>
        <input type="email" id="gm_userEmail" class="form-control" /></div>
      <div class="mb-3"><label class="form-label fw-semibold">Password *</label>
        <input type="password" id="gm_userPass" class="form-control" /></div>
      <div class="mb-3"><label class="form-label fw-semibold">Role *</label>
        <select id="gm_userRole" class="form-select">
          <option value="user">Plant / Department User</option>
          <option value="corporate_mr">Corporate MR</option>
          <option value="superadmin">Superadmin</option>
        </select></div>
      <div class="mb-3"><label class="form-label">Plant</label>
        <select id="gm_userPlant" class="form-select"><option value="">None</option>${plantOptions}</select></div>
      <div class="mb-3"><label class="form-label">Department</label>
        <select id="gm_userDept" class="form-select"><option value="">None</option>${deptOptions}</select></div>
    `, async () => {
      const displayName = document.getElementById("gm_userName").value.trim();
      const email = document.getElementById("gm_userEmail").value.trim();
      const password = document.getElementById("gm_userPass").value;
      const role = document.getElementById("gm_userRole").value;
      const pSel = document.getElementById("gm_userPlant");
      const dSel = document.getElementById("gm_userDept");
      if (!displayName || !email || !password) throw new Error("Fill all required fields (Name, Email, Password).");

      const plantId   = pSel.value;
      const plantName = pSel.options[pSel.selectedIndex]?.dataset.name || "";
      const deptId    = dSel.value;
      const deptName  = dSel.options[dSel.selectedIndex]?.dataset.name || "";

      // Try Cloud Function first (preferred — creates Auth user without affecting current session)
      let uid = null;
      try {
        const createFn = httpsCallable(functions, "createUser");
        const result = await createFn({ displayName, email, password, role, plantId, plantName, departmentId: deptId, departmentName: deptName });
        uid = result?.data?.uid;
      } catch (fnErr) {
        // Cloud Function not available — create via secondary auth instance
        const { initializeApp: initApp2, getApps } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js");
        const { getAuth: getAuth2, createUserWithEmailAndPassword: cwep, updateProfile, signOut: so2 } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js");
        const { setDoc: sd2 } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");

        // Use a secondary app instance so we don't sign out the current admin
        const secondaryAppName = "secondary-" + Date.now();
        const secondaryApp = initApp2(
          { apiKey: "AIzaSyCUvMUFJ9kPTcyJMbZDymSBDLwqvAvjZmU", authDomain: "skr-doc.firebaseapp.com", projectId: "skr-doc" },
          secondaryAppName
        );
        const secondaryAuth = getAuth2(secondaryApp);

        try {
          const cred = await cwep(secondaryAuth, email, password);
          uid = cred.user.uid;
          await updateProfile(cred.user, { displayName });
          await so2(secondaryAuth); // sign out of secondary immediately
        } catch (authErr) {
          throw new Error("Cannot create user: " + authErr.message);
        }

        // Write user doc to Firestore
        const { setDoc: setDocFn } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
        await setDocFn(doc(db, "users", uid), {
          uid, email, displayName, role,
          plantId: plantId || null, plantName: plantName || null,
          departmentId: deptId || null, departmentName: deptName || null,
          active: true, createdAt: serverTimestamp(), createdBy: currentUser.uid,
        });
      }

      loadUsersTable();
      showToast(`User "${displayName}" created successfully.`, "success");
    });
  };
}

// ── CATEGORIES TABLE ──────────────────────────────────────────────────────
async function loadCatsTable() {
  const snap = await getDocs(collection(db, "documentCategories"));
  const cats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const tbody = document.getElementById("catsBody");
  tbody.innerHTML = cats.map((c, i) => `
    <tr>
      <td>${i+1}</td><td>${c.name}</td><td>${c.description || "—"}</td>
      <td>${c.active !== false ? `<span class="badge bg-success">Active</span>` : `<span class="badge bg-secondary">Inactive</span>`}</td>
      <td>
        <button class="btn btn-sm btn-outline-primary edit-cat" data-id="${c.id}" data-name="${c.name}" data-desc="${(c.description||"").replace(/"/g,"&quot;")}">Edit</button>
        <button class="btn btn-sm btn-outline-${c.active !== false ? "danger" : "success"} toggle-cat"
          data-id="${c.id}" data-active="${c.active !== false}">${c.active !== false ? "Deactivate" : "Activate"}</button>
        <button class="btn btn-sm btn-outline-danger delete-cat" data-id="${c.id}" data-name="${c.name}">Delete</button>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="5" class="text-center text-muted">No categories yet.</td></tr>`;

  tbody.querySelectorAll(".toggle-cat").forEach(b => b.addEventListener("click", async () => {
    await updateDoc(doc(db, "documentCategories", b.dataset.id), { active: b.dataset.active !== "true" });
    loadCatsTable();
  }));

  tbody.querySelectorAll(".edit-cat").forEach(b => b.addEventListener("click", () => {
    showGenericModal("Edit Category", `
      <div class="mb-3"><label class="form-label fw-semibold">Category Name *</label>
        <input type="text" id="gm_catName" class="form-control" value="${b.dataset.name}" /></div>
      <div class="mb-3"><label class="form-label">Description</label>
        <textarea id="gm_catDesc" class="form-control" rows="2">${b.dataset.desc}</textarea></div>
    `, async () => {
      const name = document.getElementById("gm_catName").value.trim();
      const desc = document.getElementById("gm_catDesc").value.trim();
      if (!name) throw new Error("Category name is required.");
      await updateDoc(doc(db, "documentCategories", b.dataset.id), { name, description: desc });
      loadCatsTable(); loadMasterData();
      showToast("Category updated.", "success");
    });
  }));

  tbody.querySelectorAll(".delete-cat").forEach(b => b.addEventListener("click", () => {
    showGenericModal("Delete Category",
      `<p>Are you sure you want to delete category <strong>${b.dataset.name}</strong>?</p>
       <p class="text-danger small">This cannot be undone. Documents in this category will retain their category name.</p>`,
      async () => {
        await deleteDoc(doc(db, "documentCategories", b.dataset.id));
        loadCatsTable(); loadMasterData();
        showToast("Category deleted.", "success");
      }, "Delete", "btn-danger");
  }));

  document.getElementById("addCatBtn").onclick = () => {
    showGenericModal("Add Document Category", `
      <div class="mb-3"><label class="form-label fw-semibold">Category Name *</label>
        <input type="text" id="gm_catName" class="form-control" /></div>
      <div class="mb-3"><label class="form-label">Description</label>
        <textarea id="gm_catDesc" class="form-control" rows="2"></textarea></div>
    `, async () => {
      const name = document.getElementById("gm_catName").value.trim();
      const desc = document.getElementById("gm_catDesc").value.trim();
      if (!name) throw new Error("Category name is required.");
      const existing = await getDocs(query(collection(db, "documentCategories"), where("name", "==", name)));
      if (!existing.empty) throw new Error("Category already exists.");
      await addDoc(collection(db, "documentCategories"), { name, description: desc, active: true, createdAt: serverTimestamp() });
      loadCatsTable(); loadMasterData();
      showToast("Category added.", "success");
    });
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// GENERIC MODAL HELPER
// ═══════════════════════════════════════════════════════════════════════════
function showGenericModal(title, bodyHtml, onSave, saveLabel = "Save", saveCls = "btn-primary") {
  document.getElementById("genericModalTitle").textContent = title;
  document.getElementById("genericModalBody").innerHTML = bodyHtml;
  hideError("genericSpinner");
  const modal = new bootstrap.Modal(document.getElementById("genericModal"));
  modal.show();

  // Clone first to strip old listeners
  const saveBtn = document.getElementById("genericModalSave");
  const newSave = saveBtn.cloneNode(true);
  saveBtn.parentNode.replaceChild(newSave, saveBtn);

  // Update label — find/set only the text node so the spinner <span> is preserved
  const spinnerSpan = newSave.querySelector("span");
  // Clear text nodes then re-add label after spinner
  Array.from(newSave.childNodes).forEach(n => { if (n.nodeType === Node.TEXT_NODE) n.remove(); });
  newSave.appendChild(document.createTextNode(saveLabel));

  // Replace only the colour class (btn-primary / btn-danger / btn-success etc.)
  newSave.className = newSave.className.replace(/\bbtn-(primary|secondary|danger|success|warning|info)\b/, saveCls);

  newSave.addEventListener("click", async () => {
    if (spinnerSpan) spinnerSpan.classList.remove("d-none");
    try {
      await onSave();
      modal.hide();
    } catch (e) {
      showToast(e.message || "Save failed.", "error");
    } finally {
      if (spinnerSpan) spinnerSpan.classList.add("d-none");
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// EXCEL EXPORT
// ═══════════════════════════════════════════════════════════════════════════
function exportToExcel() {
  const rows = allDocuments.map(d => ({
    "Ref. No.": d.submissionRefNo || "",
    "Document Title": d.documentTitle || "",
    "Category": d.categoryName || "",
    "Plant": d.plantName || "",
    "Department": d.departmentName || "",
    "Submitted By": d.submittedByName || "",
    "Submission Date (IST)": toIST(d.submissionDate),
    "Official DMS No.": d.officialDocNumber || "",
    "DMS Upload Date": d.dmsUploadDate || "",
    "Assignment Date (IST)": toIST(d.assignmentDate),
    "Status": statusLabel(d.status),
    "MR Remarks": d.corporateMRRemarks || "",
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Documents");
  XLSX.writeFile(wb, `CDRTS_Export_${new Date().toISOString().split("T")[0]}.xlsx`);
  showToast("Excel file exported.", "success");
}

// ── Power button sign out ──────────────────────────────────────────
document.getElementById('topPowerBtn')?.addEventListener('click', () => {
  document.getElementById('logoutBtn')?.click();
});

// ── Notification Bell toggle ───────────────────────────────────────
document.getElementById('notifBellBtn')?.addEventListener('click', function(e) {
  e.stopPropagation();
  const d = document.getElementById('notifDropdown');
  if (d) d.style.display = d.style.display === 'none' ? 'block' : 'none';
});
document.addEventListener('click', () => {
  const d = document.getElementById('notifDropdown');
  if (d) d.style.display = 'none';
});
