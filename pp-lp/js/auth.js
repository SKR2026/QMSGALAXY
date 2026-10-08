/**
 * auth.js
 * Firebase Authentication + LPA application user profile management.
 */

window.currentUser = null;

// Suppress the auth-state listener during first-time Super Admin creation.
// createUserWithEmailAndPassword signs the new user in immediately, which
// fires onAuthStateChanged before the Firestore profile has been written.
// Without this flag the listener calls loadAppUser, finds no profile, and
// signs the user straight back out — breaking the setup flow.
let _suppressAuthListener = false;

/* ── Auth State Listener ─────────────────────────────────── */
auth.onAuthStateChanged(async (firebaseUser) => {
  if (_suppressAuthListener) return;
  if (firebaseUser) {
    try {
      await loadAppUser(firebaseUser);
    } catch (e) {
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

  btn.disabled = true;
  spinner.classList.remove('hidden');
  btnText.textContent = 'Signing in…';

  try {
    const persistence = document.getElementById('rememberMe')?.checked
      ? firebase.auth.Auth.Persistence.LOCAL
      : firebase.auth.Auth.Persistence.SESSION;
    await auth.setPersistence(persistence);
    await auth.signInWithEmailAndPassword(email, password);
  } catch (e) {
    showLoginError(friendlyFirebaseError(e));
    btn.disabled = false;
    spinner.classList.add('hidden');
    btnText.textContent = 'Sign In';
  }
}

/* ── Load App User Profile ───────────────────────────────── */
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
      'Your account is inactive. Please contact the administrator.'
    );
  }

  if (!profile.role) {
    throw new UserFacingError(
      'Your account has not been assigned a role. Please contact the administrator.'
    );
  }

  if (profile.role !== ROLES.SUPER_ADMIN && !profile.plantId) {
    throw new UserFacingError(
      'Your account has not been assigned to a plant. Please contact the administrator.'
    );
  }

  window.currentUser = {
    uid:         firebaseUser.uid,
    email:       firebaseUser.email,
    name:        profile.name || firebaseUser.email,
    empId:       profile.empId || '',
    role:        profile.role,
    plantId:     profile.plantId || null,
    plantIds:    profile.plantIds || (profile.plantId ? [profile.plantId] : []),
    deptId:      profile.deptId || null,
    designation: profile.designation || '',
    status:      profile.status || 'active',
    plantName:   profile.plantName || '',
    initials:    getInitials(profile.name || firebaseUser.email)
  };

  col('users').doc(firebaseUser.uid).update({
    lastLogin: firebase.firestore.FieldValue.serverTimestamp()
  }).catch(() => {});

  await loadPermissions(window.currentUser.role);
  await bootApp();
}

/* ── Logout ──────────────────────────────────────────────── */
async function handleLogout() {
  await logActivity('user', 'User logged out', null, null);
  await auth.signOut();
  window.currentUser = null;
  location.reload();
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
  document.getElementById('setupScreen')?.classList.add('hidden');
  checkFirstTimeSetup();
}

function showAppShell() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('appShell').classList.remove('hidden');
  document.getElementById('setupScreen')?.classList.add('hidden');
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
async function logActivity(type, action, recordId, delta) {
  if (!window.currentUser) return;
  try {
    await col('activityLogs').add({
      userId:    window.currentUser.uid,
      userName:  window.currentUser.name,
      userRole:  window.currentUser.role,
      plantId:   window.currentUser.plantId || null,
      type, action,
      recordId:  recordId || null,
      oldValue:  delta?.oldValue || null,
      newValue:  delta?.newValue || null,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      userAgent: navigator.userAgent.substring(0, 200)
    });
  } catch (e) { /* non-critical */ }
}

/* ── Helper ──────────────────────────────────────────────── */
function getInitials(name) {
  if (!name) return '??';
  const parts = name.trim().split(' ');
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* ══════════════════════════════════════════════════════════
   FIRST-TIME SETUP
   Shows a setup screen when NO super admin exists yet.
   This replaces the need to manually create the Firestore
   document through the Firebase Console.
══════════════════════════════════════════════════════════ */
async function checkFirstTimeSetup() {
  try {
    // Check if any super_admin exists
    const snap = await col('users')
      .where('role', '==', 'super_admin')
      .limit(1)
      .get();

    if (snap.empty) {
      // No super admin exists — show setup screen
      showSetupScreen();
    }
    // else: admin exists, stay on login screen normally

  } catch (e) {
    // Two possible cases:
    // 1. Rules not deployed yet (permission-denied) → show setup so user can create admin
    // 2. Config wrong (invalid-api-key etc.) → stay on login, error will show on login attempt
    const code = e.code || '';
    if (code === 'permission-denied' || code === 'PERMISSION_DENIED') {
      // Rules are blocking the query — this usually means rules ARE deployed
      // but the user is not authenticated. Stay on login screen.
      console.log('[Setup] Rules active, staying on login screen.');
    } else if (code.includes('unavailable') || code.includes('network')) {
      console.log('[Setup] Network error — staying on login screen.');
    } else {
      // Unknown error — show setup as fallback so user is not stuck
      console.log('[Setup] Unknown error, showing setup screen:', e.message);
      showSetupScreen();
    }
  }
}

function showSetupScreen() {
  // Hide login, show setup
  document.getElementById('loginScreen').classList.add('hidden');

  let setupEl = document.getElementById('setupScreen');
  if (!setupEl) {
    setupEl = document.createElement('div');
    setupEl.id = 'setupScreen';
    setupEl.className = 'login-screen';
    document.body.appendChild(setupEl);
  }

  setupEl.innerHTML = `
    <div class="login-card" style="max-width:480px">
      <div class="login-brand">
        <div class="login-logo">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <rect width="40" height="40" rx="8" fill="#1a56db"/>
            <path d="M8 28V14l8-6 8 6v4l4-3 4 3V28H8z" fill="none" stroke="white" stroke-width="2" stroke-linejoin="round"/>
            <rect x="16" y="20" width="8" height="8" rx="1" fill="white" opacity="0.9"/>
          </svg>
        </div>
        <div>
          <h1 class="login-title">First Time Setup</h1>
          <p class="login-subtitle">Create your Super Admin account</p>
        </div>
      </div>

      <div class="alert alert-info" style="margin-bottom:16px;font-size:12px">
        No administrator account found. Create one to get started.
        This setup page disappears after the first Super Admin is created.
      </div>

      <div id="setupError" class="alert alert-error hidden"></div>
      <div id="setupSuccess" class="alert alert-success hidden"></div>

      <div style="display:flex;flex-direction:column;gap:14px">
        <div class="form-group">
          <label class="form-label required">Full Name</label>
          <input type="text" id="setupName" class="form-input" placeholder="e.g. John Smith" />
        </div>
        <div class="form-group">
          <label class="form-label required">Employee ID</label>
          <input type="text" id="setupEmpId" class="form-input" placeholder="e.g. SA001" />
        </div>
        <div class="form-group">
          <label class="form-label required">Email Address</label>
          <input type="email" id="setupEmail" class="form-input" placeholder="admin@yourcompany.com" />
        </div>
        <div class="form-group">
          <label class="form-label required">Password</label>
          <input type="password" id="setupPassword" class="form-input" placeholder="Minimum 8 characters" />
        </div>
        <div class="form-group">
          <label class="form-label required">Confirm Password</label>
          <input type="password" id="setupConfirm" class="form-input" placeholder="Repeat password" />
        </div>

        <button class="btn btn-primary btn-full" id="setupBtn" onclick="createFirstSuperAdmin()">
          <span id="setupBtnText">Create Super Admin Account</span>
          <span id="setupSpinner" class="spinner hidden"></span>
        </button>

        <button class="btn btn-ghost btn-full" onclick="cancelSetup()">
          Already have an account? Sign in
        </button>
      </div>

      <p class="login-footer">LPA Management System — Initial Setup</p>
    </div>
  `;

  setupEl.classList.remove('hidden');
}

async function createFirstSuperAdmin() {
  const name     = document.getElementById('setupName').value.trim();
  const empId    = document.getElementById('setupEmpId').value.trim();
  const email    = document.getElementById('setupEmail').value.trim();
  const password = document.getElementById('setupPassword').value;
  const confirm  = document.getElementById('setupConfirm').value;
  const errDiv   = document.getElementById('setupError');
  const succDiv  = document.getElementById('setupSuccess');
  const btn      = document.getElementById('setupBtn');
  const btnText  = document.getElementById('setupBtnText');
  const spinner  = document.getElementById('setupSpinner');

  errDiv.classList.add('hidden');
  succDiv.classList.add('hidden');

  // Validation
  if (!name || !empId || !email || !password) {
    errDiv.textContent = 'All fields are required.';
    errDiv.classList.remove('hidden');
    return;
  }
  if (password.length < 8) {
    errDiv.textContent = 'Password must be at least 8 characters.';
    errDiv.classList.remove('hidden');
    return;
  }
  if (password !== confirm) {
    errDiv.textContent = 'Passwords do not match.';
    errDiv.classList.remove('hidden');
    return;
  }

  // Double-check no super admin exists (prevent race condition)
  try {
    const existing = await col('users').where('role', '==', 'super_admin').limit(1).get();
    if (!existing.empty) {
      errDiv.textContent = 'A Super Admin already exists. Please use the login screen.';
      errDiv.classList.remove('hidden');
      cancelSetup();
      return;
    }
  } catch (e) { /* continue */ }

  btn.disabled = true;
  spinner.classList.remove('hidden');
  btnText.textContent = 'Creating account…';

  // Suppress the auth-state listener while we create the user + profile.
  // Firebase signs in the new user immediately inside createUserWithEmailAndPassword,
  // which fires onAuthStateChanged before the Firestore profile is written.
  // The listener would see no profile and sign the user straight back out.
  _suppressAuthListener = true;

  try {
    // 1. Create Firebase Auth user (also signs the user in immediately)
    const credential = await auth.createUserWithEmailAndPassword(email, password);
    const uid = credential.user.uid;

    // 2. Create LPA Firestore profile
    await col('users').doc(uid).set({
      name,
      empId,
      email,
      mobile:      '',
      role:        'super_admin',
      plantId:     null,
      plantName:   '',
      deptId:      null,
      deptName:    '',
      designation: 'Super Administrator',
      status:      'active',
      initials:    getInitials(name),
      createdAt:   firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt:   firebase.firestore.FieldValue.serverTimestamp(),
      lastLogin:   null
    });

    // 3. Create default app settings
    await col('settings').doc('appSettings').set({
      companyName: 'Your Company',
      timezone:    'Asia/Kolkata',
      dateFormat:  'DD-MMM-YYYY',
      createdAt:   firebase.firestore.FieldValue.serverTimestamp()
    });

    await col('settings').doc('scoring').set({
      greenThreshold:  95,
      yellowThreshold: 90,
      criticalAutoRed: true,
      createdAt:       firebase.firestore.FieldValue.serverTimestamp()
    });

    await col('settings').doc('reminderConfiguration').set({
      auditReminder1:   7,
      auditReminder2:   3,
      auditReminder3:   1,
      escalationLevel1: 3,
      escalationLevel2: 7,
      escalationLevel3: 15,
      createdAt:        firebase.firestore.FieldValue.serverTimestamp()
    });

    succDiv.textContent = `Super Admin "${name}" created successfully! Logging you in…`;
    succDiv.classList.remove('hidden');

    // 4. Profile is now written — re-enable the listener and boot the app manually
    _suppressAuthListener = false;
    await loadAppUser(credential.user);

  } catch (e) {
    _suppressAuthListener = false; // always reset on error
    console.error('[Setup] Error:', e);
    errDiv.textContent = friendlyFirebaseError(e);
    errDiv.classList.remove('hidden');
    btn.disabled = false;
    spinner.classList.add('hidden');
    btnText.textContent = 'Create Super Admin Account';
  }
}

function cancelSetup() {
  document.getElementById('setupScreen')?.classList.add('hidden');
  document.getElementById('loginScreen').classList.remove('hidden');
}
