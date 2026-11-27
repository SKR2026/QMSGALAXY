// v1795361569 + bulk-upload
// ─────────────────────────────────────────────────────────────
//  PTMS – Main App Router
//  Handles page routing, nav building, session, clock.
// ─────────────────────────────────────────────────────────────

import { observeAuth, logoutUser, currentUser as _cu, changePassword } from "./auth.v2.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "./firebase.v2.js";
import { showDispatchPage }  from "./dispatch.v2.js";
import { showReceiptPage }   from "./receipt.v3.js?v=34";
import { showDashboardPage } from "./dashboard.v2.js";
import { showReportsPage }   from "./reports.v3.js";
import { showAdminPage }     from "./admin.v2.js";

// ── Load branding logo from Firestore on startup ──────────────
(async () => {
  try {
    const snap = await getDoc(doc(db, "settings", "branding"));
    if (snap.exists()) {
      const url = snap.data().logoUrl;
      if (url) applyLogoUrl(url);
    }
  } catch (_) { /* silently ignore — static logo.png stays as fallback */ }
})();

export function applyLogoUrl(url) {
  const loginImg   = document.getElementById("loginLogoImg");
  const sidebarImg = document.getElementById("sidebarLogoImg");
  const loginWrap   = document.getElementById("loginCompanyLogo");
  const sidebarWrap = document.getElementById("sidebarCompanyLogo");
  if (loginImg)   { loginImg.src = url;   if (loginWrap)   loginWrap.style.display = "flex"; }
  if (sidebarImg) { sidebarImg.src = url; if (sidebarWrap) sidebarWrap.style.display = "flex"; }
}
window.applyLogoUrl = applyLogoUrl;

// ── DOM refs ─────────────────────────────────────────────────
const loginPage    = document.getElementById("loginPage");
const appShell     = document.getElementById("appShell");
const loginForm    = document.getElementById("loginForm");
const loginError   = document.getElementById("loginError");
const loginBtn     = document.getElementById("loginBtn");
const loginBtnText = document.getElementById("loginBtnText");
const logoutBtn    = document.getElementById("logoutBtn");
const sidebarNav   = document.getElementById("sidebarNav");
const pageContent  = document.getElementById("pageContent");
const pageTitle    = document.getElementById("pageTitle");
const pageSpinner  = document.getElementById("pageSpinner");
const sidebarUserName  = document.getElementById("sidebarUserName");
const sidebarPlantName = document.getElementById("sidebarPlantName");
const sidebarRoleBadge = document.getElementById("sidebarRoleBadge");
const headerClock      = document.getElementById("headerClock");

// ── State ────────────────────────────────────────────────────
let activeRoute = null;

// ── Clock ────────────────────────────────────────────────────
function tickClock() {
  const now = new Date();
  headerClock.textContent = now.toLocaleTimeString("en-IN", { hour12: true });
}
setInterval(tickClock, 1000);
tickClock();

// ── Toast ────────────────────────────────────────────────────
export function showToast(msg, type = "info", duration = 3500) {
  const c = document.getElementById("toastContainer");
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), duration);
}
window.showToast = showToast;   // accessible from all modules

// Allow child modules to trigger navigation without circular imports
window.addEventListener("ptms-navigate", (e) => navigate(e.detail));

// ── Nav config per role ───────────────────────────────────────
function buildNav(user) {
  const isSuperAdmin = user.role === "superAdmin";
  const isPlant      = user.role === "plantUser";

  const sections = [];

  // Plant section (plant users + superAdmin)
  if (isPlant || isSuperAdmin) {
    sections.push({
      title: "Operations",
      items: [
        { id: "dashboard",    icon: "📊", label: "Dashboard" },
        { id: "dispatch",     icon: "🚚", label: "All Dispatches" },
        { id: "bulkupload",   icon: "📦", label: "Bulk Upload" },   // ← NEW
        { id: "receipt",      icon: "📥", label: "Incoming Vehicles" },
        { id: "reports",      icon: "📋", label: "Reports" },
      ]
    });
  }

  // Admin section
  if (isSuperAdmin) {
    sections.push({
      title: "Administration",
      items: [
        { id: "admin",      icon: "⚙️",  label: "Admin Panel" },
      ]
    });
  }

  sidebarNav.innerHTML = "";
  sections.forEach(sec => {
    const title = document.createElement("div");
    title.className = "nav-section-title";
    title.textContent = sec.title;
    sidebarNav.appendChild(title);
    sec.items.forEach(item => {
      const el = document.createElement("div");
      el.className = "nav-item";
      el.dataset.route = item.id;
      el.innerHTML = `<span class="nav-icon">${item.icon}</span><span class="nav-label">${item.label}</span>`;
      el.addEventListener("click", () => {
        navigate(item.id);
        // On mobile, close sidebar after navigation
        if (window.innerWidth <= 900) {
          document.getElementById("sidebar").classList.remove("sidebar-open");
          document.getElementById("sidebarOverlay").classList.remove("active");
        }
      });
      sidebarNav.appendChild(el);
    });
  });

  // Set up sidebar toggle
  setupSidebarToggle();
}

function setupSidebarToggle() {
  const sidebar  = document.getElementById("sidebar");
  const appShell = document.getElementById("appShell");

  // Add toggle button to sidebar brand if not already there
  if (!document.getElementById("sidebarToggleBtn")) {
    const toggleBtn = document.createElement("button");
    toggleBtn.id = "sidebarToggleBtn";
    toggleBtn.className = "sidebar-toggle-btn";
    toggleBtn.innerHTML = "☰";
    toggleBtn.title = "Toggle sidebar";
    toggleBtn.addEventListener("click", () => {
      if (window.innerWidth <= 900) {
        // Mobile: slide in/out
        sidebar.classList.toggle("sidebar-open");
        document.getElementById("sidebarOverlay").classList.toggle("active");
      } else {
        // Desktop: collapse to icons only
        appShell.classList.toggle("sidebar-collapsed");
        const isCollapsed = appShell.classList.contains("sidebar-collapsed");
        toggleBtn.innerHTML = isCollapsed ? "»" : "☰";
        localStorage.setItem("ptmsSidebarCollapsed", isCollapsed);
      }
    });
    // Inject into header
    const appHeader = document.getElementById("appHeader");
    if (appHeader) appHeader.prepend(toggleBtn);
  }

  // Overlay for mobile
  if (!document.getElementById("sidebarOverlay")) {
    const overlay = document.createElement("div");
    overlay.id = "sidebarOverlay";
    overlay.className = "sidebar-overlay";
    overlay.addEventListener("click", () => {
      sidebar.classList.remove("sidebar-open");
      overlay.classList.remove("active");
    });
    document.body.appendChild(overlay);
  }

  // Restore desktop collapsed state
  if (window.innerWidth > 900 && localStorage.getItem("ptmsSidebarCollapsed") === "true") {
    appShell.classList.add("sidebar-collapsed");
    const btn = document.getElementById("sidebarToggleBtn");
    if (btn) btn.innerHTML = "»";
  }
}

// ── Routing ───────────────────────────────────────────────────
export function navigate(route) {
  activeRoute = route;

  // "bulkupload" opens the modal overlay rather than a full page
  if (route === "bulkupload") {
    if (window.BulkUpload) {
      window.BulkUpload.reset();
      window.BulkUpload.open();
    }
    // Don't update pageContent — stay on whatever page was active
    // But do highlight the nav item briefly
    document.querySelectorAll(".nav-item").forEach(el => {
      el.classList.toggle("active", el.dataset.route === route);
    });
    return;
  }

  // Highlight active nav item
  document.querySelectorAll(".nav-item").forEach(el => {
    el.classList.toggle("active", el.dataset.route === route);
  });

  // Page titles
  const titles = {
    dashboard: "Dashboard",
    dispatch:  "All Dispatches",
    receipt:   "Incoming Vehicles",
    reports:   "Reports",
    admin:     "Admin Panel",
  };
  pageTitle.textContent = titles[route] || "PTMS";

  // Clear content, show spinner
  pageContent.innerHTML = "";
  const spinner = document.createElement("div");
  spinner.className = "spinner";
  pageContent.appendChild(spinner);

  // Load page module
  const user = _cu || window.__ptmsUser;
  const loaders = {
    dashboard: () => showDashboardPage(pageContent, user),
    dispatch:  () => showDispatchPage(pageContent, user),
    receipt:   () => showReceiptPage(pageContent, user),
    reports:   () => showReportsPage(pageContent, user),
    admin:     () => showAdminPage(pageContent, user),
  };
  const loader = loaders[route];
  if (loader) {
    Promise.resolve().then(loader).catch(err => {
      pageContent.innerHTML = `<div class="error-msg">Error loading page: ${err.message}</div>`;
    });
  }
}

// ── Auth observer ─────────────────────────────────────────────
observeAuth(
  user => {
    // Logged in
    window.__ptmsUser = user;
    loginPage.classList.add("hidden");
    appShell.classList.remove("hidden");

    // Populate sidebar user info
    sidebarUserName.textContent  = user.name;
    sidebarPlantName.textContent = user.plantName || "";
    sidebarRoleBadge.textContent = user.role === "superAdmin" ? "Super Admin"
                                 : user.role === "plantUser"  ? (user.plantName || "Plant User")
                                 : user.role;
    sidebarRoleBadge.className = "role-badge " + (
      user.role === "superAdmin" ? "admin" : "plant"
    );

    // Add Change Password button to sidebar footer (once)
    if (!document.getElementById("changePwdBtn")) {
      const footer = document.querySelector(".sidebar-footer");
      if (footer) {
        const pwdBtn = document.createElement("button");
        pwdBtn.id = "changePwdBtn";
        pwdBtn.className = "btn btn-outline btn-sm btn-block";
        pwdBtn.style.cssText = "margin-top:.5rem;color:rgba(255,255,255,.7);border-color:rgba(255,255,255,.25)";
        pwdBtn.innerHTML = "🔒 Change Password";
        pwdBtn.onclick = openChangePasswordModal;
        footer.appendChild(pwdBtn);
      }
    }

    buildNav(user);
    navigate("dashboard");

    // Show Bulk Upload FAB after login
    if (window.BulkUpload) window.BulkUpload.showFab();
  },
  () => {
    // Logged out
    window.__ptmsUser = null;
    appShell.classList.add("hidden");
    loginPage.classList.remove("hidden");
    // Hide FAB on logout
    if (window.BulkUpload) window.BulkUpload.hideFab();
  }
);

// ── Login form ────────────────────────────────────────────────
import { loginUser } from "./auth.v2.js";

loginForm.addEventListener("submit", async e => {
  e.preventDefault();
  loginError.classList.add("hidden");
  loginBtn.disabled  = true;
  loginBtnText.textContent = "Signing in…";

  const email    = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;

  try {
    await loginUser(email, password);
    // observeAuth will fire automatically
  } catch (err) {
    loginError.textContent = err.message || "Login failed. Check credentials.";
    loginError.classList.remove("hidden");
    loginBtn.disabled  = false;
    loginBtnText.textContent = "Sign In";
  }
});

// ── Logout ────────────────────────────────────────────────────
logoutBtn.addEventListener("click", () => {
  if (confirm("Sign out?")) logoutUser();
});

// ── Change Password Modal ──────────────────────────────────────
function openChangePasswordModal() {
  if (document.getElementById("changePwdBackdrop")) return; // already open
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.id = "changePwdBackdrop";
  backdrop.innerHTML = `
    <div class="modal" style="max-width:420px">
      <div class="modal-header">
        <span>🔒 Change Password</span>
        <button class="btn-close" id="closePwdModal">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-group" style="margin-bottom:.9rem">
          <label>Current Password *</label>
          <input type="password" id="pwdCurrent" placeholder="Enter current password" autocomplete="current-password">
        </div>
        <div class="form-group" style="margin-bottom:.9rem">
          <label>New Password *</label>
          <input type="password" id="pwdNew" placeholder="Min 6 characters" autocomplete="new-password">
        </div>
        <div class="form-group" style="margin-bottom:.9rem">
          <label>Confirm New Password *</label>
          <input type="password" id="pwdConfirm" placeholder="Repeat new password" autocomplete="new-password">
        </div>
        <div id="pwdError" class="error-msg hidden"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" id="cancelPwdBtn">Cancel</button>
        <button class="btn btn-primary" id="savePwdBtn">🔒 Update Password</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.querySelector("#closePwdModal").onclick = close;
  backdrop.querySelector("#cancelPwdBtn").onclick  = close;

  backdrop.querySelector("#savePwdBtn").onclick = async () => {
    const errEl    = backdrop.querySelector("#pwdError");
    const saveBtn  = backdrop.querySelector("#savePwdBtn");
    const current  = backdrop.querySelector("#pwdCurrent").value;
    const newPwd   = backdrop.querySelector("#pwdNew").value;
    const confirm2 = backdrop.querySelector("#pwdConfirm").value;

    errEl.classList.add("hidden");

    if (!current || !newPwd || !confirm2) {
      errEl.textContent = "All fields are required.";
      errEl.classList.remove("hidden");
      return;
    }
    if (newPwd.length < 6) {
      errEl.textContent = "New password must be at least 6 characters.";
      errEl.classList.remove("hidden");
      return;
    }
    if (newPwd !== confirm2) {
      errEl.textContent = "New passwords do not match.";
      errEl.classList.remove("hidden");
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Updating…";
    try {
      await changePassword(current, newPwd);
      window.showToast("✅ Password updated successfully.", "success");
      close();
    } catch (e) {
      const msg = e.code === "auth/wrong-password" || e.code === "auth/invalid-credential"
        ? "Current password is incorrect."
        : e.code === "auth/too-many-requests"
        ? "Too many attempts. Please try again later."
        : e.message;
      errEl.textContent = msg;
      errEl.classList.remove("hidden");
      saveBtn.disabled = false;
      saveBtn.textContent = "🔒 Update Password";
    }
  };
}
window.openChangePasswordModal = openChangePasswordModal;
