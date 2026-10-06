/**
 * auth.js
 * Firebase Authentication + LPA application user profile management.
 *
 * IMPORTANT: Firebase Auth handles identity (email/password).
 * The LPA application stores its own user profile in:
 *   /apps/lpa/users/{uid}
 * This profile includes role, plantId, status, etc.
 * A user account that exists ONLY in Firebase Auth (e.g. from another app)
 * will be denied LPA access because their LPA profile won't exist.
 */

// Global current user state
window.currentUser = null;

/* ── Auth State Listener ─────────────────────────────────── */
auth.onAuthStateChanged(async (firebaseUser) => {
  if (firebaseUser) {
    try {
      await loadAppUser(firebaseUser);
    } catch (e) {
      // User has Firebase Auth but no valid LPA profile
      console.warn('[Auth] LPA profile load failed:', e.message);
      showLoginError(e.userMessage || 'Could not load your account. Please contact the administrator.');
      await auth.signOut();
      showLoginScreen();
    }
  } else {
    window.currentUser = null;
    showLoginScreen();
  }
});

/**
 * Load the LPA-specific user profile from Firestore.
 * Throws UserFacingError for invalid/inactive accounts.
 */
async function loadAppUser(firebaseUser) {
  const userDoc = await col('users').doc(firebaseUser.uid).get();

  if (!userDoc.exists) {
    throw new UserFacingError(
      'Your account has not been configured for the LPA system. Please contact the administrator.',
      `No LPA user profile for UID ${firebaseUser.uid}`
    );
  }

  const profile = userDoc.data();

  if (profile.status === 'inactive' || profile.status === 'deactivated') {
    throw new UserFacingError(
      'Your account is inactive. Please contact the administrator.',
      `LPA user ${firebaseUser.uid} is deactivated`
    );
  }

  if (!profile.role) {
    throw new UserFacingError(
      'Your account has not been assigned a role. Please contact the administrator.',
      `LPA user ${firebaseUser.uid} has no role`
    );
  }

  if (profile.role !== ROLES.SUPER_ADMIN && !profile.plantId && !(profile.plantIds?.length)) {
    throw new UserFacingError(
      'Your account has not been assigned to a plant. Please contact the administrator.',
      `LPA user ${firebaseUser.uid} has no plant assignment`
    );
  }

  // Compose current user object
  window.currentUser = {
    uid:          firebaseUser.uid,
    email:        firebaseUser.email,
    name:         profile.name || firebaseUser.displayName || firebaseUser.email,
    empId:        profile.empId || '',
    role:         profile.role,
    plantId:      profile.plantId || null,
    plantIds:     profile.plantIds || (profile.plantId ? [profile.plantId] : []),
    deptId:       profile.deptId || null,
    designation:  profile.designation || '',
    status:       profile.status || 'active',
    plantName:    profile.plantName || '',
    initials:     getInitials(profile.name || firebaseUser.email)
  };

  // Update last login timestamp
  col('users').doc(firebaseUser.uid).update({
    lastLogin: firebase.firestore.FieldValue.serverTimestamp(),
    lastLoginEmail: firebaseUser.email
  }).catch(() => {/* non-critical */});

  // Load role permissions
  await loadPermissions(window.currentUser.role);

  // Boot the application
  await bootApp();
}

/* ── Login Handler ───────────────────────────────────────── */
async function handleLogin() {
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const btn      = document.getElementById('loginBtn');
  const spinner  = document.getElementById('loginSpinner');
  const btnText  = document.getElementById('loginBtnText');
  const errorDiv = document.getElementById('loginError');

  errorDiv.classList.add('hidden');

  if (!email || !password) {
    showLoginError('Please enter your email address and password.');
    return;
  }

  // Prevent double-click
  btn.disabled  = true;
  spinner.classList.remove('hidden');
  btnText.textContent = 'Signing in…';

  try {
    const persistence = document.getElementById('rememberMe')?.checked
      ? firebase.auth.Auth.Persistence.LOCAL
      : firebase.auth.Auth.Persistence.SESSION;
    await auth.setPersistence(persistence);

    await auth.signInWithEmailAndPassword(email, password);
    // onAuthStateChanged will handle the rest

  } catch (e) {
    showLoginError(friendlyFirebaseError(e));
    btn.disabled  = false;
    spinner.classList.add('hidden');
    btnText.textContent = 'Sign In';
  }
}

function showLoginError(msg) {
  const el = document.getElementById('loginError');
  el.textContent = msg;
  el.classList.remove('hidden');
}

/* ── Logout ──────────────────────────────────────────────── */
async function handleLogout() {
  await logActivity('user', 'User logged out', null, null);
  await auth.signOut();
  window.currentUser = null;
  location.reload(); // Clean state
}

/* ── Forgot Password ─────────────────────────────────────── */
function showForgotPassword() {
  document.getElementById('forgotModal').classList.remove('hidden');
}

function closeForgotPassword() {
  document.getElementById('forgotModal').classList.add('hidden');
}

async function handleForgotPassword() {
  const email   = document.getElementById('forgotEmail').value.trim();
  const errDiv  = document.getElementById('forgotError');
  const succDiv = document.getElementById('forgotSuccess');

  errDiv.classList.add('hidden');
  succDiv.classList.add('hidden');

  if (!email) {
    errDiv.textContent = 'Please enter your email address.';
    errDiv.classList.remove('hidden');
    return;
  }

  try {
    await auth.sendPasswordResetEmail(email);
    succDiv.textContent = 'Password reset email sent. Check your inbox.';
    succDiv.classList.remove('hidden');
  } catch (e) {
    errDiv.textContent = friendlyFirebaseError(e);
    errDiv.classList.remove('hidden');
  }
}

/* ── Screen Transitions ──────────────────────────────────── */
function showLoginScreen() {
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('appShell').classList.add('hidden');
}

function showAppShell() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('appShell').classList.remove('hidden');
}

function togglePassword() {
  const input = document.getElementById('loginPassword');
  const icon  = document.getElementById('eyeIcon');
  if (input.type === 'password') {
    input.type = 'text';
    icon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
  } else {
    input.type = 'password';
    icon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
  }
}

/* ── Activity Logging ────────────────────────────────────── */
/**
 * Write an immutable activity log entry.
 * @param {string} type - Category: 'audit', 'user', 'finding', 'action', 'system'
 * @param {string} action - Human-readable description
 * @param {string|null} recordId - Related record ID
 * @param {object|null} delta - { oldValue, newValue } if applicable
 */
async function logActivity(type, action, recordId, delta) {
  if (!window.currentUser) return;
  try {
    await col('activityLogs').add({
      userId:     window.currentUser.uid,
      userName:   window.currentUser.name,
      userRole:   window.currentUser.role,
      plantId:    window.currentUser.plantId || null,
      type:       type,
      action:     action,
      recordId:   recordId || null,
      oldValue:   delta?.oldValue || null,
      newValue:   delta?.newValue || null,
      timestamp:  firebase.firestore.FieldValue.serverTimestamp(),
      userAgent:  navigator.userAgent.substring(0, 200)
    });
  } catch (e) {
    console.warn('[ActivityLog] Failed to write log:', e.message);
    // Non-critical — never block the user action
  }
}

/* ── Helper ──────────────────────────────────────────────── */
function getInitials(name) {
  if (!name) return '??';
  const parts = name.trim().split(' ');
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
