// v1795361569
// ─────────────────────────────────────────────────────────────
//  PTMS – Main App Router
//  Handles page routing, nav building, session, clock.
// ─────────────────────────────────────────────────────────────

import { observeAuth, logoutUser, currentUser as _cu } from "./auth.v2.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "./firebase.v2.js";
import { showDispatchPage }  from "./dispatch.v2.js";
import { showReceiptPage }   from "./receipt.v3.js";
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
        { id: "dashboard",  icon: "📊", label: "Dashboard" },
        { id: "dispatch",   icon: "🚚", label: "All Dispatches" },
        { id: "receipt",    icon: "📥", label: "Incoming Vehicles" },
        { id: "reports",    icon: "📋", label: "Reports" },
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

    buildNav(user);
    navigate("dashboard");
  },
  () => {
    // Logged out
    window.__ptmsUser = null;
    appShell.classList.add("hidden");
    loginPage.classList.remove("hidden");
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
