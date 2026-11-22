/**
 * permissions.js
 * Role hierarchy, permission matrix, and authorization helpers.
 *
 * Roles (stored in Firestore user documents):
 *   super_admin  — Full system access across all plants
 *   plant_admin  — Full access within assigned plant(s)
 *   auditor      — Create/execute audits assigned to them
 *   management   — Read-only dashboards and reports
 */

const ROLES = {
  SUPER_ADMIN:  'super_admin',
  PLANT_ADMIN:  'plant_admin',
  AUDITOR:      'auditor',
  MANAGEMENT:   'management'
};

const ROLE_LABELS = {
  super_admin: 'Super Admin',
  plant_admin: 'Plant Admin',
  auditor:     'Auditor',
  management:  'Management'
};

/**
 * Permission keys — used to check access throughout the app.
 * Populated from Firestore settings/permissions (configurable).
 * Defaults are below.
 */
const DEFAULT_PERMISSIONS = {
  super_admin: {
    view_dashboard:       true,
    manage_users:         true,
    manage_plants:        true,
    manage_master_data:   true,
    configure_questions:  true,
    create_audit:         true,
    execute_audit:        true,
    approve_audit:        true,
    reopen_audit:         true,
    close_finding:        true,
    verify_action:        true,
    close_action:         true,
    view_reports:         true,
    export_reports:       true,
    view_all_plants:      true,
    system_settings:      true,
    view_activity_log:    true,
    manage_notifications: true
  },
  plant_admin: {
    view_dashboard:       true,
    manage_users:         true,  // within plant
    manage_plants:        false,
    manage_master_data:   true,  // within plant
    configure_questions:  true,  // within plant
    create_audit:         true,
    execute_audit:        true,
    approve_audit:        true,
    reopen_audit:         true,
    close_finding:        true,
    verify_action:        true,
    close_action:         true,
    view_reports:         true,
    export_reports:       true,
    view_all_plants:      false,
    system_settings:      false,
    view_activity_log:    false,
    manage_notifications: false
  },
  auditor: {
    view_dashboard:       true,
    manage_users:         false,
    manage_plants:        false,
    manage_master_data:   false,
    configure_questions:  false,
    create_audit:         false,
    execute_audit:        true,  // assigned audits only
    approve_audit:        false,
    reopen_audit:         false,
    close_finding:        false,
    verify_action:        false,
    close_action:         false,
    view_reports:         true,  // limited
    export_reports:       false,
    view_all_plants:      false,
    system_settings:      false,
    view_activity_log:    false,
    manage_notifications: false
  },
  management: {
    view_dashboard:       true,
    manage_users:         false,
    manage_plants:        false,
    manage_master_data:   false,
    configure_questions:  false,
    create_audit:         false,
    execute_audit:        false,
    approve_audit:        false,
    reopen_audit:         false,
    close_finding:        false,
    verify_action:        false,
    close_action:         false,
    view_reports:         true,
    export_reports:       true,
    view_all_plants:      false,
    system_settings:      false,
    view_activity_log:    false,
    manage_notifications: false
  }
};

// Current user permissions — populated at login from Firestore + defaults
let currentPermissions = {};

/**
 * Load permissions for a given role from Firestore (with defaults fallback).
 */
async function loadPermissions(role) {
  try {
    const snap = await col('settings').doc('permissions').get();
    if (snap.exists && snap.data()[role]) {
      currentPermissions = snap.data()[role];
    } else {
      currentPermissions = DEFAULT_PERMISSIONS[role] || {};
    }
  } catch (e) {
    console.warn('[Permissions] Using defaults. Firestore read failed:', e.message);
    currentPermissions = DEFAULT_PERMISSIONS[role] || {};
  }
}

/**
 * Check if the current user has a specific permission.
 * @param {string} perm - Permission key
 * @returns {boolean}
 */
function can(perm) {
  return !!currentPermissions[perm];
}

/**
 * Throw an error (friendly message) if the user lacks the permission.
 */
function requirePermission(perm) {
  if (!can(perm)) {
    throw new UserFacingError('You do not have permission to perform this action.');
  }
}

/**
 * Check if the current user's plant access includes a given plantId.
 * Super Admins pass for any plant. Plant Admins must match exactly.
 * @param {string} plantId
 * @returns {boolean}
 */
function canAccessPlant(plantId) {
  if (!window.currentUser) return false;
  if (window.currentUser.role === ROLES.SUPER_ADMIN) return true;
  return window.currentUser.plantId === plantId ||
    (Array.isArray(window.currentUser.plantIds) &&
     window.currentUser.plantIds.includes(plantId));
}

/**
 * Apply UI visibility rules based on current role.
 * Called after login to show/hide admin-only sections.
 */
function applyRoleUI(role) {
  const adminItems = document.querySelectorAll('.nav-admin-item, .nav-admin-section');
  const isAdmin = [ROLES.SUPER_ADMIN, ROLES.PLANT_ADMIN].includes(role);

  adminItems.forEach(el => {
    el.style.display = isAdmin ? '' : 'none';
  });

  // Super Admin: show plant selector, plant summary table, all-plant controls
  if (role === ROLES.SUPER_ADMIN) {
    document.getElementById('plantSelectorWrapper')?.classList.remove('hidden');
    document.getElementById('plantSummaryTable')?.classList.remove('hidden');
  }

  // Hide create buttons for management/viewer
  if (role === ROLES.MANAGEMENT) {
    document.getElementById('btnCreateAudit')?.classList.add('hidden');
  }
}

/**
 * Custom error class for user-facing errors.
 * Technical details go to the console, not the UI.
 */
class UserFacingError extends Error {
  constructor(message, technicalDetail) {
    super(message);
    this.userMessage = message;
    if (technicalDetail) console.error('[Technical]', technicalDetail);
  }
}

/**
 * Translate Firebase/Firestore error codes into friendly messages.
 * NEVER show raw Firebase error codes to end users.
 */
function friendlyFirebaseError(error) {
  console.error('[Firebase Error]', error.code, error.message);

  const map = {
    'auth/wrong-password':            'Incorrect password. Please try again.',
    'auth/user-not-found':            'No account found with this email address.',
    'auth/invalid-email':             'Please enter a valid email address.',
    'auth/user-disabled':             'This account has been disabled. Please contact your administrator.',
    'auth/too-many-requests':         'Too many failed login attempts. Please wait and try again.',
    'auth/network-request-failed':    'Network error. Please check your connection.',
    'permission-denied':              'You do not have permission to perform this action.',
    'not-found':                      'The requested record could not be found.',
    'already-exists':                 'A record with this information already exists.',
    'unavailable':                    'Service temporarily unavailable. Please try again.',
    'deadline-exceeded':              'The request timed out. Please try again.',
    'unauthenticated':                'Your session has expired. Please log in again.',
    'resource-exhausted':             'Service quota exceeded. Please contact the administrator.'
  };

  const code = error.code?.replace('auth/', '') || error.code || '';
  return map[error.code] || map[code] || 'An unexpected error occurred. Please try again.';
}
