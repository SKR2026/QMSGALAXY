/**
 * app.js
 * Application bootstrap, navigation controller, and global UI utilities.
 */

let sidebarCollapsed = false;
let mobileOpen = false;
let currentView = 'dashboard';
let searchDebounceTimer = null;

/* ── Boot ────────────────────────────────────────────────── */
async function bootApp() {
  const user = window.currentUser;

  // Update sidebar user info
  document.getElementById('sidebarUserName').textContent = user.name;
  document.getElementById('sidebarUserRole').textContent = ROLE_LABELS[user.role] || user.role;
  document.getElementById('sidebarAvatar').textContent   = user.initials;

  // Update power-menu header
  if (typeof updatePowerMenuUser === 'function') updatePowerMenuUser(user);

  // Apply role-based UI
  applyRoleUI(user.role);

  // Populate plant selector for Super Admin
  if (user.role === ROLES.SUPER_ADMIN) {
    await populatePlantSelector();
  }

  // Populate report plant filter
  await populateReportPlantFilter();

  // Show app
  showAppShell();

  // Load initial view
  navigate('dashboard');

  // Start notification listener
  startNotificationListener();

  // Log login
  await logActivity('user', 'User logged in', null, null);

  console.log('[LPA] App booted for', user.name, '/', user.role);
}

/* ── Navigation ──────────────────────────────────────────── */
function navigate(viewName, linkEl) {
  // Deactivate previous
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  // Activate clicked nav item (or find by data-view)
  if (linkEl) {
    linkEl.classList.add('active');
  } else {
    const navEl = document.querySelector(`[data-view="${viewName}"]`);
    if (navEl) navEl.classList.add('active');
  }

  // Hide all views
  document.querySelectorAll('.view').forEach(v => {
    v.classList.remove('active');
    v.classList.add('hidden');
  });

  // Show target view
  const target = document.getElementById(`view-${viewName}`);
  if (target) {
    target.classList.remove('hidden');
    target.classList.add('active');
  }

  // Update breadcrumb
  const labels = {
    dashboard:      'Dashboard',
    audits:         'Audits',
    calendar:       'Calendar',
    findings:       'Findings',
    actions:        'Corrective Actions',
    reports:        'Reports',
    mgmtreview:     'Management Review',
    masterdata:     'Master Data',
    users:          'User Management',
    activitylog:    'Activity Log',
    settings:       'Settings',
    'audit-execute':'Audit Execution'
  };

  document.getElementById('breadcrumbMain').textContent = labels[viewName] || viewName;
  document.getElementById('breadcrumbSub').classList.add('hidden');

  currentView = viewName;

  // Close mobile sidebar
  if (mobileOpen && window.innerWidth <= 640) {
    document.getElementById('sidebar').classList.remove('mobile-open');
    mobileOpen = false;
  }

  // Load view data
  loadViewData(viewName);
}

async function loadViewData(viewName) {
  try {
    switch (viewName) {
      case 'dashboard':   await loadDashboard();    break;
      case 'audits':      await loadAudits();        break;
      case 'calendar':    await renderCalendar();    break;
      case 'findings':    await loadFindings();      break;
      case 'actions':     await loadActions();       break;
      case 'reports':     await initReports();       break;
      case 'mgmtreview':  await loadMgmtReview();    break;
      case 'masterdata':  await initMasterData();    break;
      case 'users':       await loadUsers();         break;
      case 'activitylog': await loadActivityLog();   break;
      case 'settings':    await initSettings();      break;
    }
  } catch (e) {
    console.error('[Navigation] loadViewData error:', e);
    showToast('Error loading view: ' + friendlyFirebaseError(e), 'error');
  }
}

/* ── Sidebar ─────────────────────────────────────────────── */
function toggleSidebar() {
  if (window.innerWidth <= 640) {
    // Mobile: slide in/out
    const sidebar = document.getElementById('sidebar');
    mobileOpen = !mobileOpen;
    sidebar.classList.toggle('mobile-open', mobileOpen);
  } else {
    // Desktop: collapse/expand
    sidebarCollapsed = !sidebarCollapsed;
    document.getElementById('sidebar').classList.toggle('collapsed', sidebarCollapsed);
  }
}

/* ── Query helpers (avoid composite-index requirements) ──── */
/**
 * Firestore needs a composite index for "where(a) + orderBy(b)".
 * Those indexes were never created, so every such query failed with
 * "failed-precondition" and dropdowns/forms stayed empty.
 * Fetch with equality filters only and sort in the browser instead.
 */
async function fetchSorted(query, field, dir = 'asc') {
  const snap = await query.get();
  const docs = snap.docs.slice();
  docs.sort((a, b) => {
    const x = a.data()[field], y = b.data()[field];
    if (x === y) return 0;
    if (x === undefined || x === null) return 1;
    if (y === undefined || y === null) return -1;
    const r = (typeof x === 'number' && typeof y === 'number')
      ? x - y : String(x).localeCompare(String(y));
    return dir === 'desc' ? -r : r;
  });
  return docs;
}

/**
 * Plants the current user may see. Super Admin: all plants.
 * Others: only their own plant document(s) (Firestore rules do not allow
 * listing the whole collection for non-super-admins).
 */
async function fetchPlants(activeOnly = true) {
  const user = window.currentUser;
  let docs = [];
  if (user.role === ROLES.SUPER_ADMIN) {
    docs = await fetchSorted(col('plants'), 'name');
  } else {
    const ids = [...new Set([user.plantId, ...(user.plantIds || [])].filter(Boolean))];
    const snaps = await Promise.all(ids.map(id => col('plants').doc(id).get()));
    docs = snaps.filter(s => s.exists);
  }
  if (activeOnly) docs = docs.filter(d => (d.data().status || 'active') === 'active');
  return docs;
}

/* ── Plant Selector (Super Admin) ────────────────────────── */
async function populatePlantSelector() {
  try {
    const docsP = await fetchPlants(true);
    const sel  = document.getElementById('plantSelector');
    // Clear existing except "All Plants"
    sel.innerHTML = '<option value="all">🏭 All Plants</option>';
    docsP.forEach(doc => {
      const opt = document.createElement('option');
      opt.value = doc.id;
      opt.textContent = doc.data().name;
      sel.appendChild(opt);
    });
  } catch (e) {
    console.warn('[App] Could not populate plant selector:', e.message);
  }
}

function onPlantSelectorChange(plantId) {
  // Super Admin is switching plant scope
  window.selectedPlantFilter = plantId === 'all' ? null : plantId;
  loadViewData(currentView);
}

/**
 * Get the effective plant ID filter.
 * Super Admin uses the selector; others are locked to their plant.
 */
function getActivePlantId() {
  if (window.currentUser?.role === ROLES.SUPER_ADMIN) {
    return window.selectedPlantFilter || null; // null = all plants
  }
  return window.currentUser?.plantId || null;
}

/* ── Global Search ───────────────────────────────────────── */
function debounceSearch(value) {
  clearTimeout(searchDebounceTimer);
  if (!value || value.length < 2) {
    document.getElementById('searchResults').classList.add('hidden');
    return;
  }
  searchDebounceTimer = setTimeout(() => performSearch(value), 350);
}

async function performSearch(query) {
  const resultsEl = document.getElementById('searchResults');
  resultsEl.innerHTML = '<div class="search-result-item text-muted">Searching…</div>';
  resultsEl.classList.remove('hidden');

  const q     = query.trim().toLowerCase();
  const plant = getActivePlantId();
  const results = [];

  try {
    // Search audits by ID
    let auditQuery = col('audits').where('searchTokens', 'array-contains', q).limit(5);
    if (plant) auditQuery = auditQuery.where('plantId', '==', plant);
    const auditsSnap = await auditQuery.get();
    auditsSnap.forEach(doc => {
      const d = doc.data();
      results.push({ type: 'Audit', id: doc.id, label: `${doc.id} — ${d.departmentName || ''} ${d.processName || ''}`, view: 'audits', recordId: doc.id });
    });

    // Search findings
    let findQuery = col('findings').where('searchTokens', 'array-contains', q).limit(5);
    if (plant) findQuery = findQuery.where('plantId', '==', plant);
    const findSnap = await findQuery.get();
    findSnap.forEach(doc => {
      const d = doc.data();
      results.push({ type: 'Finding', id: doc.id, label: `${doc.id} — ${d.description?.substring(0,60) || ''}`, view: 'findings', recordId: doc.id });
    });

    if (results.length === 0) {
      resultsEl.innerHTML = '<div class="search-result-item text-muted">No results found.</div>';
    } else {
      resultsEl.innerHTML = results.map(r => `
        <div class="search-result-item" onclick="navigateToRecord('${r.view}','${r.recordId}')">
          <div class="search-result-type">${r.type}</div>
          <div>${escapeHtml(r.label)}</div>
        </div>
      `).join('');
    }
  } catch (e) {
    resultsEl.innerHTML = '<div class="search-result-item text-muted">Search error. Please try again.</div>';
  }
}

function navigateToRecord(view, recordId) {
  document.getElementById('searchResults').classList.add('hidden');
  document.getElementById('globalSearch').value = '';
  navigate(view);
  // After navigation, highlight the record if possible
  setTimeout(() => {
    const row = document.querySelector(`[data-record-id="${recordId}"]`);
    if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 500);
}

// Close search results when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-wrapper')) {
    document.getElementById('searchResults')?.classList.add('hidden');
  }
  if (!e.target.closest('.notif-btn') && !e.target.closest('.notif-panel')) {
    document.getElementById('notifPanel')?.classList.add('hidden');
  }
});

/* ── Modal Utilities ─────────────────────────────────────── */
function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
}

function openModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
}

// Close modal on overlay click (but not box click)
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.add('hidden');
  }
});

// Keyboard ESC closes modals
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));
  }
});

/* ── Confirmation Dialog ─────────────────────────────────── */
function confirmAction(options) {
  return new Promise((resolve) => {
    document.getElementById('confirmTitle').textContent   = options.title   || 'Confirm';
    document.getElementById('confirmMessage').textContent = options.message || 'Are you sure?';

    const reasonGroup = document.getElementById('confirmReasonGroup');
    const reasonInput = document.getElementById('confirmReason');

    if (options.requireReason) {
      reasonGroup.classList.remove('hidden');
      document.getElementById('confirmReasonLabel').textContent = options.reasonLabel || 'Reason';
      reasonInput.value = '';
    } else {
      reasonGroup.classList.add('hidden');
    }

    const okBtn = document.getElementById('confirmOkBtn');
    okBtn.textContent = options.confirmText || 'Confirm';
    okBtn.className   = `btn ${options.dangerStyle ? 'btn-danger' : 'btn-primary'}`;

    openModal('confirmModal');

    const handler = () => {
      if (options.requireReason && !reasonInput.value.trim()) {
        reasonInput.style.borderColor = 'var(--color-danger)';
        return;
      }
      closeModal('confirmModal');
      okBtn.removeEventListener('click', handler);
      resolve({ confirmed: true, reason: reasonInput.value.trim() });
    };

    document.getElementById('confirmCancelBtn').onclick = () => {
      closeModal('confirmModal');
      okBtn.removeEventListener('click', handler);
      resolve({ confirmed: false });
    };

    okBtn.addEventListener('click', handler);
  });
}

/* ── Toast Notifications ─────────────────────────────────── */
function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icons = {
    success: '✓',
    error:   '✕',
    warning: '⚠',
    info:    'ℹ'
  };

  toast.innerHTML = `<span style="font-size:16px">${icons[type] || 'ℹ'}</span><span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideInRight .25s ease reverse';
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

/* ── Loading Overlay ─────────────────────────────────────── */
function showLoading(message = 'Loading…') {
  document.getElementById('loadingMessage').textContent = message;
  document.getElementById('loadingOverlay').classList.remove('hidden');
}

function hideLoading() {
  document.getElementById('loadingOverlay').classList.add('hidden');
}

/* ── Populate Plant Filters / Selects ────────────────────── */
async function populatePlantOptions(selectEl, includeAll = true) {
  if (!selectEl) return;
  try {
    const user = window.currentUser;
    const plantDocs = await fetchPlants(true);
    selectEl.innerHTML = includeAll ? '<option value="">All Plants</option>' : '<option value="">Select Plant</option>';

    plantDocs.forEach(doc => {
      if (user.role !== ROLES.SUPER_ADMIN && !canAccessPlant(doc.id)) return;
      const opt = document.createElement('option');
      opt.value = doc.id;
      opt.textContent = doc.data().name;
      selectEl.appendChild(opt);
    });

    // Pre-select plant for non-super-admin
    if (user.role !== ROLES.SUPER_ADMIN && user.plantId) {
      selectEl.value = user.plantId;
      if (selectEl.options[selectEl.selectedIndex]?.value !== user.plantId) {
        // Plant not in list — user may be deactivated from that plant
        console.warn('[App] User plant not in active plants list');
      }
    }
  } catch (e) {
    console.error('[App] populatePlantOptions error:', e);
  }
}

async function populateDeptOptions(selectEl, plantId, includeAll = true) {
  if (!selectEl || !plantId) return;
  selectEl.innerHTML = includeAll ? '<option value="">All Departments</option>' : '<option value="">Select Department</option>';
  try {
    const deptDocs = (await fetchSorted(col('departments').where('plantId', '==', plantId), 'name'))
      .filter(d => (d.data().status || 'active') === 'active');
    deptDocs.forEach(doc => {
      const opt = document.createElement('option');
      opt.value = doc.id;
      opt.textContent = doc.data().name;
      selectEl.appendChild(opt);
    });
  } catch (e) {
    console.warn('[App] populateDeptOptions error:', e.message);
  }
}

async function populateProcessOptions(selectEl, deptId, includeAll = true) {
  if (!selectEl || !deptId) return;
  selectEl.innerHTML = includeAll ? '<option value="">All Processes</option>' : '<option value="">Select Process</option>';
  try {
    const procDocs = (await fetchSorted(col('processes').where('deptId', '==', deptId), 'name'))
      .filter(d => (d.data().status || 'active') === 'active');
    procDocs.forEach(doc => {
      const opt = document.createElement('option');
      opt.value = doc.id;
      opt.textContent = doc.data().name;
      selectEl.appendChild(opt);
    });
  } catch (e) {
    console.warn('[App] populateProcessOptions error:', e.message);
  }
}

async function populateLevelOptions(selectEl, includeAll = true) {
  if (!selectEl) return;
  selectEl.innerHTML = includeAll ? '<option value="">All Levels</option>' : '<option value="">Select Level</option>';
  try {
    const levelDocs = (await fetchSorted(col('auditLevels'), 'levelNumber'))
      .filter(d => (d.data().status || 'active') === 'active');
    levelDocs.forEach(doc => {
      const opt = document.createElement('option');
      opt.value = doc.id;
      opt.textContent = `Level ${doc.data().levelNumber} — ${doc.data().name}`;
      selectEl.appendChild(opt);
    });
  } catch (e) {
    console.warn('[App] populateLevelOptions error:', e.message);
  }
}

async function populateUserOptions(selectEl, plantId, roleFilter) {
  if (!selectEl) return;
  selectEl.innerHTML = '<option value="">Select</option>';
  try {
    let query = col('users').where('status', '==', 'active');
    if (plantId) query = query.where('plantId', '==', plantId);
    if (roleFilter) query = query.where('role', '==', roleFilter);
    const userDocs = await fetchSorted(query, 'name');
    userDocs.forEach(doc => {
      const opt = document.createElement('option');
      opt.value = doc.id;
      opt.textContent = `${doc.data().name} (${doc.data().empId || doc.data().email})`;
      selectEl.appendChild(opt);
    });
  } catch (e) {
    console.warn('[App] populateUserOptions error:', e.message);
  }
}

async function populateReportPlantFilter() {
  const sel = document.getElementById('rptPlant');
  if (!sel) return;
  await populatePlantOptions(sel, true);
}

/* ── Badge Helpers ───────────────────────────────────────── */
function getAuditStatusBadge(status) {
  const map = {
    'Planned':         'badge-planned',
    'Assigned':        'badge-assigned',
    'In Progress':     'badge-progress',
    'Submitted':       'badge-submitted',
    'Under Review':    'badge-review',
    'Action Required': 'badge-action',
    'Action Submitted':'badge-submitted',
    'Verified':        'badge-verified',
    'Closed':          'badge-closed',
    'Overdue':         'badge-overdue',
    'Cancelled':       'badge-cancelled'
  };
  return `<span class="badge ${map[status] || 'badge-planned'}">${status || '—'}</span>`;
}

function getActionStatusBadge(status) {
  const map = {
    'Open':                'badge-open',
    'Assigned':            'badge-assigned',
    'In Progress':         'badge-progress',
    'Submitted':           'badge-submitted',
    'Returned':            'badge-returned',
    'Verification Pending':'badge-review',
    'Verified':            'badge-verified',
    'Closed':              'badge-closed',
    'Overdue':             'badge-overdue'
  };
  return `<span class="badge ${map[status] || 'badge-open'}">${status || '—'}</span>`;
}

function getCriticalityBadge(crit) {
  const map = { 'Critical': 'badge-critical', 'Major': 'badge-major', 'Minor': 'badge-minor' };
  return `<span class="badge ${map[crit] || 'badge-minor'}">${crit || '—'}</span>`;
}

function getScoreBadge(score) {
  if (score === null || score === undefined || score === '') return '—';
  const num   = parseFloat(score);
  const cls   = num >= 95 ? 'score-green' : num >= 90 ? 'score-yellow' : 'score-red';
  return `<span class="score-badge ${cls}">${num.toFixed(1)}%</span>`;
}

/* ── Date Utilities ──────────────────────────────────────── */
function formatDate(ts) {
  if (!ts) return '—';
  let d;
  if (ts.toDate) d = ts.toDate();
  else if (ts instanceof Date) d = ts;
  else d = new Date(ts);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(ts) {
  if (!ts) return '—';
  let d;
  if (ts.toDate) d = ts.toDate();
  else if (ts instanceof Date) d = ts;
  else d = new Date(ts);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function isOverdue(dateStr) {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date(new Date().toDateString());
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = new Date(dateStr) - new Date(new Date().toDateString());
  return Math.ceil(diff / 86400000);
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

/* ── HTML Escaping ───────────────────────────────────────── */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── ID Generation ───────────────────────────────────────── */
function generateId(prefix) {
  const ts   = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substr(2, 4).toUpperCase();
  return `${prefix}-${ts}-${rand}`;
}

/**
 * Build searchTokens array for simple full-text-like search in Firestore.
 * Stores lowercase tokens so queries work with array-contains.
 */
function buildSearchTokens(...fields) {
  const tokens = new Set();
  fields.forEach(f => {
    if (!f) return;
    const str = String(f).toLowerCase();
    str.split(/\s+/).forEach(w => {
      if (w.length > 1) tokens.add(w);
    });
    // Also add full string
    if (str.length > 1) tokens.add(str);
  });
  return Array.from(tokens).slice(0, 40); // Firestore array limit safety
}
