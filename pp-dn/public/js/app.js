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
  collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc,
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
    number_assigned: "Number Assigned",
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
      if (b.logoUrl) {
        const authLogo = document.getElementById("authLogo");
        if (authLogo) { authLogo.src = b.logoUrl; authLogo.style.display = ""; }
      }
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
  const snap = await getDoc(doc(db, "users", currentUser.uid));
  if (snap.exists()) {
    currentUserData = snap.data();
  } else {
    // First run: check if any users exist; if not, create as superadmin
    const usersSnap = await getDocs(query(collection(db, "users"), limit(1)));
    if (usersSnap.empty) {
      currentUserData = {
        uid: currentUser.uid,
        email: currentUser.email,
        displayName: currentUser.displayName || currentUser.email,
        role: "superadmin",
        active: true,
      };
      await doc(db, "users", currentUser.uid).set
        ? null
        : await addDoc(collection(db, "users"), currentUserData);
      await db.collection
        ? null
        : await updateDoc(doc(db, "users", currentUser.uid), currentUserData).catch(() =>
            addDoc(collection(db, "users"), { ...currentUserData, createdAt: serverTimestamp() })
          );
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
  loadMasterData();
  setupSubmitForm();
  setupSendNotification();
  navigateTo("dashboard");
}

async function applyBranding() {
  try {
    const snap = await getDoc(doc(db, "appSettings", "branding"));
    if (!snap.exists()) return;
    const b = snap.data();
    // Apply logo to auth screen and sidebar
    if (b.logoUrl) {
      const authLogo = document.getElementById("authLogo");
      const sidebarLogo = document.getElementById("sidebarLogo");
      if (authLogo)   { authLogo.src = b.logoUrl; authLogo.style.display = ""; }
      if (sidebarLogo){ sidebarLogo.src = b.logoUrl; sidebarLogo.style.display = ""; }
    }
    // Apply primary color
    if (b.primaryColor) {
      document.documentElement.style.setProperty("--primary", b.primaryColor);
      // Compute darker shade for hover
      document.documentElement.style.setProperty("--primary-dark", b.primaryColor);
    }
    // Apply app title
    if (b.appTitle) {
      document.title = b.appTitle + " – Corporate Document Registration & Tracking";
      document.querySelectorAll(".sidebar-title").forEach(el => el.textContent = b.appTitle);
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
    li.innerHTML = `<a href="#" data-view="${view}"><i class="bi ${icon}"></i>${label}</a>`;
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

  // Send Notification button (users only)
  const sendNotifBtn = document.getElementById("sendNotifBtn");
  if (isUser()) {
    sendNotifBtn.classList.remove("d-none");
  }

  // Bulk actions (superadmin only)
  if (isSuperadmin()) {
    document.querySelectorAll(".superadmin-only").forEach(el => el.classList.remove("d-none"));
    document.getElementById("bulkActions").classList.remove("d-none");
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
  if (view === "mr")        loadMRQueue();
  if (view === "audit")     loadAuditLogs();
  if (view === "settings")  loadSettings();
  if (view === "submit")    prepareSubmitForm();

  // Close mobile sidebar
  document.getElementById("sidebar").classList.remove("mobile-open");
  document.querySelector(".sidebar-overlay")?.classList.remove("active");
}

function setupNavigation() {
  document.getElementById("sidebarNav").addEventListener("click", e => {
    const a = e.target.closest("a[data-view]");
    if (a) { e.preventDefault(); navigateTo(a.dataset.view); }
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

  // MR filters
  ["mrFilterPlant","mrFilterDept","mrFilterCat","mrFilterStatus"].forEach(id => {
    document.getElementById(id).addEventListener("change", loadMRQueue);
  });

  document.getElementById("mrSearch").addEventListener("input", e => {
    loadMRQueue(e.target.value);
  });
}

function setupSidebar() {
  // Create overlay
  const overlay = document.createElement("div");
  overlay.className = "sidebar-overlay";
  document.body.appendChild(overlay);

  document.getElementById("menuToggle").addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("mobile-open");
    overlay.classList.toggle("active");
  });

  document.getElementById("sidebarToggle").addEventListener("click", () => {
    const sidebar = document.getElementById("sidebar");
    const main = document.getElementById("mainContent");
    sidebar.classList.toggle("collapsed");
    main.classList.toggle("full-width");
  });

  overlay.addEventListener("click", () => {
    document.getElementById("sidebar").classList.remove("mobile-open");
    overlay.classList.remove("active");
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
  const docCatSel = document.getElementById("docCategory");
  const docPlantSel = document.getElementById("docPlant");
  const docDeptSel = document.getElementById("docDept");
  docCatSel.innerHTML = `<option value="">Select Category</option>`;
  categories.forEach(c => docCatSel.innerHTML += `<option value="${c.id}" data-name="${c.name}">${c.name}</option>`);

  docPlantSel.innerHTML = `<option value="">Select Plant</option>`;
  plants.forEach(p => docPlantSel.innerHTML += `<option value="${p.id}" data-name="${p.name}">${p.name}</option>`);

  docDeptSel.innerHTML = `<option value="">Select Department</option>`;
  departments.forEach(d => docDeptSel.innerHTML += `<option value="${d.id}" data-name="${d.name}">${d.name}</option>`);

  // Default to user's plant/dept
  if (currentUserData?.plantId) docPlantSel.value = currentUserData.plantId;
  if (currentUserData?.departmentId) docDeptSel.value = currentUserData.departmentId;
}

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════
async function loadDashboard() {
  const filters = getActiveFilters();
  let q = collection(db, "documents");
  let constraints = [where("status", "!=", "deleted")];

  if (filters.plantId) constraints.push(where("plantId", "==", filters.plantId));
  if (filters.departmentId) constraints.push(where("departmentId", "==", filters.departmentId));
  if (filters.categoryId) constraints.push(where("categoryId", "==", filters.categoryId));
  if (filters.status) constraints.push(where("status", "==", filters.status));

  // User only sees own docs
  if (isUser()) constraints.push(where("submittedBy", "==", currentUser.uid));

  const snap = await getDocs(query(q, ...constraints, orderBy("status"), orderBy("submissionDate", "desc")));
  allDocuments = snap.docs.map(d => ({ id: d.id, ...d.data() }));

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
  const pending   = docs.filter(d => ["submitted","pending_with_mr"].includes(d.status)).length;
  const process   = docs.filter(d => d.status === "under_process").length;
  const returned  = docs.filter(d => d.status === "returned_for_correction").length;
  const numbered  = docs.filter(d => d.status === "number_assigned" || d.status === "closed").length;

  // Average DMS Upload Time: submission → dmsUploadDate
  const dmsTimeDocs = docs.filter(d => d.submissionDate && d.dmsUploadDate);
  let avgDms = "—";
  if (dmsTimeDocs.length) {
    const totalDays = dmsTimeDocs.reduce((acc, d) => {
      const sub = d.submissionDate.toDate().getTime();
      const dms = new Date(d.dmsUploadDate).getTime();
      return acc + (dms - sub) / 86400000;
    }, 0);
    avgDms = (totalDays / dmsTimeDocs.length).toFixed(1) + "d";
  }

  // Average Numbering Turnaround: submission → assignmentDate
  const taDocs = docs.filter(d => d.submissionDate && d.assignmentDate);
  let avgTA = "—";
  if (taDocs.length) {
    const totalDays = taDocs.reduce((acc, d) => {
      const sub = d.submissionDate.toDate().getTime();
      const asg = d.assignmentDate.toDate().getTime();
      return acc + (asg - sub) / 86400000;
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
      maintainAspectRatio: true,
      plugins: { legend: { display: type !== "bar", position: "bottom",
        labels: { boxWidth: 10, font: { size: 11 } } } },
      scales: type !== "doughnut" ? {
        x: { ticks: { font: { size: 11 } }, grid: { display: false } },
        y: { ticks: { font: { size: 11 }, stepSize: 1 }, beginAtZero: true }
      } : {}
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
      <td>${toIST(d.submissionDate)}</td>
      <td class="fw-semibold">${d.officialDocNumber || "—"}</td>
      <td>${d.dmsUploadDate || "—"}</td>
      <td>${toIST(d.assignmentDate)}</td>
      <td>${statusBadge(d.status)}</td>
      <td>
        <div class="action-btns">
          <button class="btn btn-sm btn-outline-primary view-doc-btn" data-id="${d.id}" title="View">
            <i class="bi bi-eye"></i>
          </button>
          ${d.fileUrl ? `<a class="btn btn-sm btn-outline-secondary" href="${d.fileUrl}" target="_blank" title="Download">
            <i class="bi bi-download"></i></a>` : ""}
          ${(isCorporateMR() || isSuperadmin()) && ["submitted","pending_with_mr","under_process","resubmitted"].includes(d.status) ? `
            <button class="btn btn-sm btn-outline-success assign-btn" data-id="${d.id}" title="Assign Number">
              <i class="bi bi-hash"></i>
            </button>
            <button class="btn btn-sm btn-outline-warning return-btn" data-id="${d.id}" title="Return">
              <i class="bi bi-arrow-return-left"></i>
            </button>` : ""}
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
    }));
}

// ═══════════════════════════════════════════════════════════════════════════
// MY DOCUMENTS (user view)
// ═══════════════════════════════════════════════════════════════════════════
async function loadMyDocuments() {
  const snap = await getDocs(query(
    collection(db, "documents"),
    where("submittedBy", "==", currentUser.uid),
    where("status", "!=", "deleted"),
    orderBy("status"),
    orderBy("submissionDate", "desc")
  ));

  const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const tbody = document.getElementById("myDocsBody");

  if (!docs.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-muted">No documents submitted yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = docs.map(d => `
    <tr>
      <td class="fw-semibold text-primary">${d.submissionRefNo || "Draft"}</td>
      <td>${d.documentTitle || "—"}</td>
      <td>${d.categoryName || "—"}</td>
      <td>${toIST(d.submissionDate)}</td>
      <td class="fw-semibold text-success">${d.officialDocNumber || "—"}</td>
      <td>${toIST(d.assignmentDate)}</td>
      <td>${statusBadge(d.status)}</td>
      <td>
        <div class="action-btns">
          <button class="btn btn-sm btn-outline-primary view-doc-btn" data-id="${d.id}"><i class="bi bi-eye"></i></button>
          ${d.fileUrl ? `<a class="btn btn-sm btn-outline-secondary" href="${d.fileUrl}" target="_blank"><i class="bi bi-download"></i></a>` : ""}
          ${["draft","returned_for_correction"].includes(d.status) ? `
            <button class="btn btn-sm btn-warning edit-doc-btn" data-id="${d.id}">
              <i class="bi bi-pencil"></i> Edit
            </button>` : ""}
        </div>
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll(".view-doc-btn").forEach(b =>
    b.addEventListener("click", () => openDocModal(b.dataset.id)));
  tbody.querySelectorAll(".edit-doc-btn").forEach(b =>
    b.addEventListener("click", () => { navigateTo("submit"); prepareSubmitForm(b.dataset.id); }));

  // Search
  document.getElementById("myDocsSearch").oninput = e => {
    const q = e.target.value.toLowerCase();
    tbody.querySelectorAll("tr").forEach(row => {
      row.style.display = row.textContent.toLowerCase().includes(q) ? "" : "none";
    });
  };
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
  document.getElementById("docModalFooter").innerHTML = footer;

  document.getElementById("modalAssignBtn")?.addEventListener("click", () => {
    bootstrap.Modal.getInstance(document.getElementById("docModal")).hide();
    openAssignModal(docId);
  });
  document.getElementById("modalReturnBtn")?.addEventListener("click", () => {
    bootstrap.Modal.getInstance(document.getElementById("docModal")).hide();
    openReturnModal(docId);
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
  const spin = document.getElementById("assignSpinner");
  hideError("assignNumError");
  const num = document.getElementById("dmsDocNumber").value.trim();
  if (!num) { showError("assignNumError", "DMS Document Number is required."); return; }

  spin.classList.remove("d-none");
  const assignFn = httpsCallable(functions, "assignDocumentNumber");
  try {
    await assignFn({
      documentId: assignModalDocId,
      officialDocNumber: num,
      dmsUploadDate: document.getElementById("dmsDate").value,
      dmsUploadTime: document.getElementById("dmsTime").value,
      remarks: document.getElementById("dmsRemarks").value,
    });
    bootstrap.Modal.getInstance(document.getElementById("assignNumModal")).hide();
    showToast(`DMS Number "${num}" assigned successfully.`, "success");
    loadDashboard();
    if (isCorporateMR()) loadMRQueue();
  } catch (e) {
    showError("assignNumError", e.message || "Failed to assign number.");
  } finally {
    spin.classList.add("d-none");
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
// CORPORATE MR QUEUE
// ═══════════════════════════════════════════════════════════════════════════
async function loadMRQueue(searchText = "") {
  const plantId  = document.getElementById("mrFilterPlant").value;
  const deptId   = document.getElementById("mrFilterDept").value;
  const catId    = document.getElementById("mrFilterCat").value;
  const statusV  = document.getElementById("mrFilterStatus").value;
  const srch     = typeof searchText === "string" ? searchText : document.getElementById("mrSearch").value;

  let constraints = [];
  if (statusV && statusV !== "all") {
    constraints.push(where("status", "==", statusV));
  } else if (!statusV || statusV === "") {
    constraints.push(where("status", "in", ["submitted","pending_with_mr","under_process","resubmitted"]));
  }
  if (plantId)  constraints.push(where("plantId", "==", plantId));
  if (deptId)   constraints.push(where("departmentId", "==", deptId));
  if (catId)    constraints.push(where("categoryId", "==", catId));

  const snap = await getDocs(query(
    collection(db, "documents"),
    ...constraints,
    orderBy("submissionDate", "desc")
  ));

  let docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  if (srch) {
    const q = srch.toLowerCase();
    docs = docs.filter(d =>
      (d.submissionRefNo||"").toLowerCase().includes(q) ||
      (d.documentTitle||"").toLowerCase().includes(q) ||
      (d.submittedByName||"").toLowerCase().includes(q) ||
      (d.officialDocNumber||"").toLowerCase().includes(q)
    );
  }

  const tbody = document.getElementById("mrTableBody");
  if (!docs.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center py-4 text-muted">No documents in queue.</td></tr>`;
    return;
  }

  tbody.innerHTML = docs.map(d => `
    <tr>
      <td class="fw-semibold text-primary">${d.submissionRefNo || "—"}</td>
      <td>${d.documentTitle || "—"}</td>
      <td>${d.categoryName || "—"}</td>
      <td>${d.plantName || "—"}</td>
      <td>${d.departmentName || "—"}</td>
      <td>${d.submittedByName || "—"}</td>
      <td>${toIST(d.submissionDate)}</td>
      <td class="fw-semibold text-success">${d.officialDocNumber || "—"}</td>
      <td>${statusBadge(d.status)}</td>
      <td>
        <div class="action-btns">
          <button class="btn btn-sm btn-outline-primary view-doc-btn" data-id="${d.id}"><i class="bi bi-eye"></i></button>
          ${d.fileUrl ? `<a class="btn btn-sm btn-outline-secondary" href="${d.fileUrl}" target="_blank"><i class="bi bi-download"></i></a>` : ""}
          ${["submitted","pending_with_mr","under_process","resubmitted"].includes(d.status) ? `
            <button class="btn btn-sm btn-success assign-btn" data-id="${d.id}">
              <i class="bi bi-hash"></i> Assign
            </button>
            <button class="btn btn-sm btn-warning return-btn" data-id="${d.id}">
              <i class="bi bi-arrow-return-left"></i>
            </button>` : ""}
        </div>
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll(".view-doc-btn").forEach(b =>
    b.addEventListener("click", () => openDocModal(b.dataset.id)));
  tbody.querySelectorAll(".assign-btn").forEach(b =>
    b.addEventListener("click", () => openAssignModal(b.dataset.id)));
  tbody.querySelectorAll(".return-btn").forEach(b =>
    b.addEventListener("click", () => openReturnModal(b.dataset.id)));

  // Mark as "Under Process" when MR opens/downloads
  docs.forEach(async d => {
    if (d.status === "submitted" || d.status === "pending_with_mr") {
      await updateDoc(doc(db, "documents", d.id), {
        status: "under_process",
        updatedAt: serverTimestamp(),
        statusHistory: d.statusHistory ? [
          ...d.statusHistory,
          { status: "under_process", changedBy: currentUser.uid,
            changedByName: currentUserData.displayName || currentUser.email,
            changedAt: nowIST() }
        ] : [{ status: "under_process" }],
      }).catch(console.error);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// SUBMIT DOCUMENT FORM
// ═══════════════════════════════════════════════════════════════════════════
let editingDocId = null;
let uploadedFileRef = null;

function prepareSubmitForm(docId = null) {
  editingDocId = docId;
  document.getElementById("subByDisplay").value = currentUserData?.displayName || currentUser.email;
  document.getElementById("subEmailDisplay").value = currentUser.email;
  document.getElementById("subDateDisplay").value = nowIST();
  document.getElementById("submitDocMsg").classList.add("d-none");

  if (!docId) {
    document.getElementById("submitDocForm").reset();
    document.getElementById("filePreview").classList.add("d-none");
    uploadedFileRef = null;
    if (currentUserData?.plantId) document.getElementById("docPlant").value = currentUserData.plantId;
    if (currentUserData?.departmentId) document.getElementById("docDept").value = currentUserData.departmentId;
  } else {
    // Load existing doc for editing
    getDoc(doc(db, "documents", docId)).then(snap => {
      if (!snap.exists()) return;
      const d = snap.data();
      document.getElementById("docTitle").value = d.documentTitle || "";
      document.getElementById("docCategory").value = d.categoryId || "";
      document.getElementById("docPlant").value = d.plantId || "";
      document.getElementById("docDept").value = d.departmentId || "";
      document.getElementById("docDesc").value = d.documentDescription || "";
      document.getElementById("docRevision").value = d.documentRevision || "";
    });
  }
}

function setupSubmitForm() {
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
    await saveDocument(false);
  });
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
  const title   = document.getElementById("docTitle").value.trim();
  const catSel  = document.getElementById("docCategory");
  const catId   = catSel.value;
  const catName = catSel.options[catSel.selectedIndex]?.dataset.name || "";
  const plantSel = document.getElementById("docPlant");
  const plantId  = plantSel.value;
  const plantName = plantSel.options[plantSel.selectedIndex]?.dataset.name || "";
  const deptSel  = document.getElementById("docDept");
  const deptId   = deptSel.value;
  const deptName = deptSel.options[deptSel.selectedIndex]?.dataset.name || "";
  const desc    = document.getElementById("docDesc").value.trim();
  const rev     = document.getElementById("docRevision").value.trim();
  const msgEl   = document.getElementById("submitDocMsg");
  const spin    = document.getElementById("submitSpinner");

  msgEl.classList.add("d-none");

  if (!isDraft && (!title || !catId || !plantId || !deptId)) {
    msgEl.className = "alert alert-danger mt-3";
    msgEl.textContent = "Please fill all required fields.";
    msgEl.classList.remove("d-none");
    return;
  }

  if (!isDraft && !uploadedFileRef && !editingDocId) {
    msgEl.className = "alert alert-danger mt-3";
    msgEl.textContent = "Please attach a document.";
    msgEl.classList.remove("d-none");
    return;
  }

  spin?.classList.remove("d-none");

  try {
    let fileUrl = null, fileName = null;

    // Upload file if selected
    if (uploadedFileRef) {
      const docIdForPath = editingDocId || Date.now().toString();
      const storageRef = ref(storage, `documents/${currentUser.uid}/${docIdForPath}/${uploadedFileRef.name}`);
      const uploadTask = uploadBytesResumable(storageRef, uploadedFileRef);

      // Show progress
      const progDiv = document.getElementById("uploadProgress");
      const progBar = document.getElementById("uploadBar");
      const progPct = document.getElementById("uploadPct");
      progDiv.classList.remove("d-none");

      await new Promise((resolve, reject) => {
        uploadTask.on("state_changed",
          snap => {
            const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
            progBar.style.width = pct + "%";
            progPct.textContent = pct + "%";
          },
          reject,
          resolve
        );
      });

      fileUrl = await getDownloadURL(storageRef);
      fileName = uploadedFileRef.name;
      progDiv.classList.add("d-none");
    }

    const docData = {
      documentTitle: title,
      categoryId: catId,
      categoryName: catName,
      plantId,
      plantName,
      departmentId: deptId,
      departmentName: deptName,
      documentDescription: desc,
      documentRevision: rev,
      submittedBy: currentUser.uid,
      submittedByName: currentUserData?.displayName || currentUser.email,
      submittedByEmail: currentUser.email,
      status: isDraft ? "draft" : (editingDocId ? "returned_for_correction" : "draft"),
      updatedAt: serverTimestamp(),
    };

    if (fileUrl) { docData.fileUrl = fileUrl; docData.fileName = fileName; }

    if (editingDocId) {
      await updateDoc(doc(db, "documents", editingDocId), docData);
    } else {
      const newRef = await addDoc(collection(db, "documents"), {
        ...docData,
        createdAt: serverTimestamp(),
        statusHistory: [{ status: "draft", changedBy: currentUser.uid,
          changedByName: currentUserData?.displayName || currentUser.email, changedAt: nowIST() }],
      });
      editingDocId = newRef.id;
    }

    if (!isDraft) {
      // Submit via Cloud Function (generates ref number)
      const submitFn = httpsCallable(functions, "submitDocument");
      const result = await submitFn({ documentId: editingDocId });
      msgEl.className = "alert alert-success mt-3";
      msgEl.textContent = `Document submitted successfully! Reference No: ${result.data.submissionRefNo}`;
      msgEl.classList.remove("d-none");
      editingDocId = null;
      uploadedFileRef = null;
      document.getElementById("submitDocForm").reset();
      document.getElementById("filePreview").classList.add("d-none");
      showToast(`Submitted! Ref: ${result.data.submissionRefNo}`, "success");
    } else {
      msgEl.className = "alert alert-info mt-3";
      msgEl.textContent = "Draft saved successfully.";
      msgEl.classList.remove("d-none");
      showToast("Draft saved.", "info");
    }
  } catch (e) {
    console.error(e);
    msgEl.className = "alert alert-danger mt-3";
    msgEl.textContent = e.message || "An error occurred.";
    msgEl.classList.remove("d-none");
  } finally {
    spin?.classList.add("d-none");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SEND NOTIFICATION (user button)
// ═══════════════════════════════════════════════════════════════════════════
function setupSendNotification() {
  const btn = document.getElementById("sendNotifBtn");
  const lastEl = document.getElementById("notifLastSent");

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Sending…`;

    const notifFn = httpsCallable(functions, "sendUserNotification");
    try {
      const res = await notifFn();
      if (res.data.success) {
        showToast(`Reminder sent to Corporate MR for ${res.data.count} document(s).`, "success");
        lastEl.textContent = `Last sent: ${nowIST()}`;
        lastEl.classList.remove("d-none");
      } else {
        showToast(res.data.message || "No pending documents.", "info");
      }
    } catch (e) {
      showToast(e.message || "Failed to send notification.", "error");
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
    loadDashboard();
  } catch (e) {
    showError("deleteError", e.message);
  } finally {
    spin.classList.add("d-none");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════════════════
async function loadSettings() {
  loadPlantsTable();
  loadDeptsTable();
  loadUsersTable();
  loadCatsTable();

  // Load saved settings
  const emailSnap = await getDoc(doc(db, "appSettings", "notifications")).catch(() => null);
  if (emailSnap?.exists()) {
    const s = emailSnap.data();
    document.getElementById("settingAppUrl").value = s.appUrl || "";
    document.getElementById("settingFromName").value = s.fromName || "CDRTS System";
    document.getElementById("settingCooldown").value = s.notificationCooldownMinutes || 120;
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
      notificationCooldownMinutes: parseInt(document.getElementById("settingCooldown").value) || 120,
    });
    showToast("Notification settings saved.", "success");
  };

  // Branding — load existing values
  const brandSnap = await getDoc(doc(db, "appSettings", "branding")).catch(() => null);
  if (brandSnap?.exists()) {
    const b = brandSnap.data();
    if (b.appTitle)     document.getElementById("settingAppTitle").value = b.appTitle;
    if (b.primaryColor) document.getElementById("settingPrimaryColor").value = b.primaryColor;
    if (b.logoUrl)      document.getElementById("currentLogo").innerHTML =
      `<img src="${b.logoUrl}" height="40" alt="Current Logo" style="border-radius:6px;border:1px solid var(--border);">`;
  }

  document.getElementById("saveBrandingBtn").onclick = async () => {
    await setOrMergeSettings("branding", {
      appTitle: document.getElementById("settingAppTitle").value,
      primaryColor: document.getElementById("settingPrimaryColor").value,
    });
    applyBranding();
    showToast("Branding saved.", "success");
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
      await setOrMergeSettings("branding", { logoUrl: url });
      // Apply immediately
      const authLogo = document.getElementById("authLogo");
      const sidebarLogo = document.getElementById("sidebarLogo");
      if (authLogo)    { authLogo.src = url; authLogo.style.display = ""; }
      if (sidebarLogo) { sidebarLogo.src = url; sidebarLogo.style.display = ""; }
      logoDiv.innerHTML = `<img src="${url}" height="40" alt="Logo" style="border-radius:6px;border:1px solid var(--border);">`;
      showToast("Logo uploaded successfully.", "success");
    } catch (err) {
      logoDiv.innerHTML = `<span class="text-danger small"><i class="bi bi-exclamation-triangle me-1"></i>Upload failed: ${err.message}</span>`;
      showToast("Logo upload failed: " + err.message, "error");
    }
  });
}

async function setOrMergeSettings(docId, data) {
  const ref2 = doc(db, "appSettings", docId);
  const snap = await getDoc(ref2);
  if (snap.exists()) await updateDoc(ref2, data);
  else await addDoc(collection(db, "appSettings"), { ...data, _id: docId }).catch(() =>
    updateDoc(ref2, data)
  );
  // Proper set with merge:
  const { setDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
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
      if (!name) return;
      await updateDoc(doc(db, "plants", b.dataset.id), { name, code });
      loadPlantsTable(); loadMasterData();
    });
  }));

  tbody.querySelectorAll(".toggle-plant").forEach(b => b.addEventListener("click", async () => {
    const active = b.dataset.active !== "true";
    await updateDoc(doc(db, "plants", b.dataset.id), { active });
    loadPlantsTable();
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
      if (!name) return;
      // Check duplicate
      const existing = await getDocs(query(collection(db, "plants"), where("name", "==", name)));
      if (!existing.empty) { showToast("Plant already exists.", "error"); return; }
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
      <td>${d.plantName || "—"}</td>
      <td>${d.active ? `<span class="badge bg-success">Active</span>` : `<span class="badge bg-secondary">Inactive</span>`}</td>
      <td>
        <button class="btn btn-sm btn-outline-${d.active ? "danger" : "success"} toggle-dept"
          data-id="${d.id}" data-active="${d.active}">${d.active ? "Deactivate" : "Activate"}</button>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="5" class="text-center text-muted">No departments yet.</td></tr>`;

  tbody.querySelectorAll(".toggle-dept").forEach(b => b.addEventListener("click", async () => {
    await updateDoc(doc(db, "departments", b.dataset.id), { active: b.dataset.active !== "true" });
    loadDeptsTable();
  }));

  document.getElementById("addDeptBtn").onclick = () => {
    const plantOptions = plants.map(p => `<option value="${p.id}" data-name="${p.name}">${p.name}</option>`).join("");
    showGenericModal("Add Department", `
      <div class="mb-3"><label class="form-label fw-semibold">Department Name *</label>
        <input type="text" id="gm_deptName" class="form-control" /></div>
      <div class="mb-3"><label class="form-label">Associated Plant</label>
        <select id="gm_deptPlant" class="form-select"><option value="">None</option>${plantOptions}</select></div>
    `, async () => {
      const name = document.getElementById("gm_deptName").value.trim();
      const pSel = document.getElementById("gm_deptPlant");
      const plantId2 = pSel.value;
      const plantName2 = pSel.options[pSel.selectedIndex]?.dataset.name || "";
      if (!name) return;
      const existing = await getDocs(query(collection(db, "departments"), where("name", "==", name)));
      if (!existing.empty) { showToast("Department already exists.", "error"); return; }
      await addDoc(collection(db, "departments"), { name, plantId: plantId2, plantName: plantName2, active: true, createdAt: serverTimestamp() });
      loadDeptsTable(); loadMasterData();
    });
  };
}

// ── USERS TABLE ───────────────────────────────────────────────────────────
async function loadUsersTable() {
  const snap = await getDocs(collection(db, "users"));
  const usersAll = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const tbody = document.getElementById("usersBody");
  tbody.innerHTML = usersAll.map(u => `
    <tr>
      <td>${u.displayName || "—"}</td>
      <td>${u.email || "—"}</td>
      <td><span class="badge bg-primary">${roleName(u.role)}</span></td>
      <td>${u.plantName || "—"}</td>
      <td>${u.departmentName || "—"}</td>
      <td>${u.active ? `<span class="badge bg-success">Active</span>` : `<span class="badge bg-secondary">Inactive</span>`}</td>
      <td>
        <button class="btn btn-sm btn-outline-${u.active ? "danger" : "success"} toggle-user"
          data-id="${u.id}" data-active="${u.active}">${u.active ? "Deactivate" : "Activate"}</button>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="7" class="text-center text-muted">No users yet.</td></tr>`;

  tbody.querySelectorAll(".toggle-user").forEach(b => b.addEventListener("click", async () => {
    await updateDoc(doc(db, "users", b.dataset.id), { active: b.dataset.active !== "true" });
    loadUsersTable();
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
      if (!displayName || !email || !password) { showToast("Fill all required fields.", "error"); return; }
      const createFn = httpsCallable(functions, "createUser");
      const result = await createFn({
        displayName, email, password, role,
        plantId: pSel.value, plantName: pSel.options[pSel.selectedIndex]?.dataset.name || "",
        departmentId: dSel.value, departmentName: dSel.options[dSel.selectedIndex]?.dataset.name || "",
      });
      if (!result?.data?.success) throw new Error("User creation failed — check Firebase Functions logs.");
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
        <button class="btn btn-sm btn-outline-${c.active !== false ? "danger" : "success"} toggle-cat"
          data-id="${c.id}" data-active="${c.active !== false}">${c.active !== false ? "Deactivate" : "Activate"}</button>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="5" class="text-center text-muted">No categories yet.</td></tr>`;

  tbody.querySelectorAll(".toggle-cat").forEach(b => b.addEventListener("click", async () => {
    await updateDoc(doc(db, "documentCategories", b.dataset.id), { active: b.dataset.active !== "true" });
    loadCatsTable();
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
      if (!name) return;
      const existing = await getDocs(query(collection(db, "documentCategories"), where("name", "==", name)));
      if (!existing.empty) { showToast("Category already exists.", "error"); return; }
      await addDoc(collection(db, "documentCategories"), { name, description: desc, active: true, createdAt: serverTimestamp() });
      loadCatsTable(); loadMasterData();
    });
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// GENERIC MODAL HELPER
// ═══════════════════════════════════════════════════════════════════════════
function showGenericModal(title, bodyHtml, onSave) {
  document.getElementById("genericModalTitle").textContent = title;
  document.getElementById("genericModalBody").innerHTML = bodyHtml;
  hideError("genericSpinner");
  const modal = new bootstrap.Modal(document.getElementById("genericModal"));
  modal.show();

  const saveBtn = document.getElementById("genericModalSave");
  const newSave = saveBtn.cloneNode(true);
  saveBtn.parentNode.replaceChild(newSave, saveBtn);

  newSave.addEventListener("click", async () => {
    document.getElementById("genericSpinner").classList.remove("d-none");
    try {
      await onSave();
      modal.hide();
    } catch (e) {
      showToast(e.message || "Save failed.", "error");
    } finally {
      document.getElementById("genericSpinner").classList.add("d-none");
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
