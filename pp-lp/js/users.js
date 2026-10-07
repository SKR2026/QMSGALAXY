/**
 * users.js
 * User management — create, edit, activate/deactivate, role/plant assignment.
 *
 * NOTE: Creating a Firebase Auth user from the client requires Admin SDK or
 * a Cloud Function. The recommended pattern here uses Cloud Function
 * `createLPAUser` (see functions/index.js). The UI sends the request to the
 * function which creates the Auth user and the Firestore profile atomically.
 *
 * For demonstration without Cloud Functions, a simplified path that directs
 * Super Admin to Firebase Console for Auth creation + manual Firestore write
 * is provided, along with an invite-by-email flow.
 */

let allUsers = []; // cached for client-side search

async function loadUsers() {
  requirePermission('manage_users');

  const tbody   = document.getElementById('usersTableBody');
  const countEl = document.getElementById('usersCount');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="9" class="table-empty">Loading…</td></tr>';

  try {
    let query = col('users');

    // Plant admins see only their plant's users
    if (window.currentUser.role === ROLES.PLANT_ADMIN) {
      query = query.where('plantId', '==', window.currentUser.plantId);
    }

    const docs = await fetchSorted(query, 'name');
    allUsers   = docs.map(d => ({ id: d.id, ...d.data() }));

    renderUsersTable(allUsers);
    countEl.textContent = `${allUsers.length} user${allUsers.length !== 1 ? 's' : ''}`;

  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="9" class="table-empty">${friendlyFirebaseError(e)}</td></tr>`;
    console.error('[Users] Load error:', e);
  }
}

function renderUsersTable(users) {
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;

  if (users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="table-empty">No users found.</td></tr>';
    return;
  }

  tbody.innerHTML = users.map(u => {
    const statusBadge = (u.status === 'active' || u.active === true)
      ? '<span class="badge badge-verified">Active</span>'
      : '<span class="badge badge-cancelled">Inactive</span>';

    const actions = buildUserActions(u);

    return `
      <tr data-record-id="${u.id}">
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <div class="user-avatar" style="width:28px;height:28px;font-size:10px">${getInitials(u.name)}</div>
            <div>
              <div class="fw-600">${escapeHtml(u.name || '—')}</div>
              ${u.designation ? `<div class="text-muted text-sm">${escapeHtml(u.designation)}</div>` : ''}
            </div>
          </div>
        </td>
        <td style="font-family:var(--font-mono);font-size:12px">${escapeHtml(u.empId || '—')}</td>
        <td>${escapeHtml(u.email || '—')}</td>
        <td>${getRoleBadge(u.role)}</td>
        <td>${escapeHtml(u.plantName || '—')}</td>
        <td>${escapeHtml(u.deptName || '—')}</td>
        <td>${statusBadge}</td>
        <td class="text-muted text-sm">${u.lastLogin ? formatDateTime(u.lastLogin) : 'Never'}</td>
        <td><div class="action-btns">${actions}</div></td>
      </tr>
    `;
  }).join('');
}

function buildUserActions(user) {
  const cu = window.currentUser;
  const btns = [];

  // Can't edit yourself through the user table (use profile)
  if (user.id !== cu.uid) {
    btns.push(`<button class="btn btn-secondary btn-sm" onclick="openEditUserModal('${user.id}')">Edit</button>`);

    if (user.status === 'active' || user.active === true) {
      btns.push(`<button class="btn btn-ghost btn-sm" onclick="deactivateUser('${user.id}')">Deactivate</button>`);
    } else {
      btns.push(`<button class="btn btn-success btn-sm" onclick="activateUser('${user.id}')">Activate</button>`);
    }

    if (cu.role === ROLES.SUPER_ADMIN) {
      btns.push(`<button class="btn btn-ghost btn-sm" onclick="resetUserAccess('${user.id}')">Reset</button>`);
    }
  }

  return btns.join('');
}

function getRoleBadge(role) {
  const map = {
    'super_admin': 'badge-critical',
    'plant_admin': 'badge-assigned',
    'auditor':     'badge-progress',
    'management':  'badge-planned'
  };
  const label = ROLE_LABELS[role] || role;
  return `<span class="badge ${map[role] || 'badge-planned'}">${label}</span>`;
}

function filterUsers(query) {
  if (!query) { renderUsersTable(allUsers); return; }
  const q       = query.toLowerCase();
  const filtered = allUsers.filter(u =>
    (u.name || '').toLowerCase().includes(q) ||
    (u.email || '').toLowerCase().includes(q) ||
    (u.empId || '').toLowerCase().includes(q) ||
    (u.plantName || '').toLowerCase().includes(q)
  );
  renderUsersTable(filtered);
}

/* ── Create User Modal ───────────────────────────────────── */
async function openCreateUserModal() {
  requirePermission('manage_users');

  document.getElementById('userModalTitle').textContent = 'Add User';
  document.getElementById('btnSaveUser').textContent    = 'Create User';
  document.getElementById('btnSaveUser').dataset.editId = '';
  document.getElementById('userModalError').classList.add('hidden');
  document.getElementById('userPasswordGroup').classList.remove('hidden');

  // Clear form
  ['userFullName','userEmpId','userEmail','userMobile','userDesignation','userPassword']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('userRole').value = '';

  // Populate plant options
  const plantSel = document.getElementById('userPlant');
  await populatePlantOptions(plantSel, false);
  wireUserPlantChange();

  // Populate dept options (for the pre-selected plant of a plant admin, if any)
  const deptSel = document.getElementById('userDept');
  deptSel.innerHTML = '<option value="">None</option>';
  if (plantSel.value) await populateDeptOptions(deptSel, plantSel.value, false);

  if (plantSel.options.length <= 1) {
    showToast('No active plants found. Add a plant in Master Data first.', 'warning');
  }

  openModal('userModal');
}

async function openEditUserModal(userId) {
  requirePermission('manage_users');

  const userDoc = await col('users').doc(userId).get();
  if (!userDoc.exists) { showToast('User not found.', 'error'); return; }
  const u = userDoc.data();

  if (!canAccessPlant(u.plantId) && window.currentUser.role !== ROLES.SUPER_ADMIN) {
    showToast('This user is outside your authorized plant.', 'error');
    return;
  }

  document.getElementById('userModalTitle').textContent = 'Edit User';
  document.getElementById('btnSaveUser').textContent    = 'Save Changes';
  document.getElementById('btnSaveUser').dataset.editId = userId;
  document.getElementById('userPasswordGroup').classList.add('hidden'); // No password change in edit
  document.getElementById('userModalError').classList.add('hidden');

  document.getElementById('userFullName').value  = u.name || '';
  document.getElementById('userEmpId').value     = u.empId || '';
  document.getElementById('userEmail').value     = u.email || '';
  document.getElementById('userMobile').value    = u.mobile || '';
  document.getElementById('userDesignation').value = u.designation || '';
  document.getElementById('userRole').value      = u.role || '';

  const plantSel = document.getElementById('userPlant');
  await populatePlantOptions(plantSel, false);
  wireUserPlantChange();
  plantSel.value = u.plantId || '';

  if (u.plantId) {
    const deptSel = document.getElementById('userDept');
    await populateDeptOptions(deptSel, u.plantId, false);
    deptSel.value = u.deptId || '';
  }

  onUserRoleChange(u.role);

  openModal('userModal');
}

/** Reload the Department list whenever the Plant dropdown changes. */
function wireUserPlantChange() {
  const plantSel = document.getElementById('userPlant');
  const deptSel  = document.getElementById('userDept');
  plantSel.onchange = async () => {
    deptSel.innerHTML = '<option value="">None</option>';
    if (plantSel.value) await populateDeptOptions(deptSel, plantSel.value, false);
  };
}

/** Secondary Firebase app so creating an Auth user doesn't sign the admin out. */
function getSecondaryAuth() {
  let app;
  try { app = firebase.app('lpaSecondary'); }
  catch (e) { app = firebase.initializeApp(firebaseConfig, 'lpaSecondary'); }
  return app.auth();
}

function onUserRoleChange(role) {
  const plantGroup = document.getElementById('userPlantGroup');
  if (role === ROLES.SUPER_ADMIN) {
    plantGroup.style.opacity = '.5';
  } else {
    plantGroup.style.opacity = '1';
  }
}

async function saveUser() {
  const btn      = document.getElementById('btnSaveUser');
  const errorDiv = document.getElementById('userModalError');
  const editId   = btn.dataset.editId;
  errorDiv.classList.add('hidden');

  const name        = document.getElementById('userFullName').value.trim();
  const empId       = document.getElementById('userEmpId').value.trim();
  const email       = document.getElementById('userEmail').value.trim();
  const mobile      = document.getElementById('userMobile').value.trim();
  const role        = document.getElementById('userRole').value;
  const plantId     = document.getElementById('userPlant').value;
  const deptId      = document.getElementById('userDept').value;
  const designation = document.getElementById('userDesignation').value.trim();
  const password    = document.getElementById('userPassword')?.value;

  if (!name || !email || !role) {
    errorDiv.textContent = 'Name, email, and role are required.';
    errorDiv.classList.remove('hidden');
    return;
  }

  if (!editId && (!password || password.length < 8)) {
    errorDiv.textContent = 'Password must be at least 8 characters.';
    errorDiv.classList.remove('hidden');
    return;
  }

  if (role !== ROLES.SUPER_ADMIN && !plantId) {
    errorDiv.textContent = 'Please assign a plant for this user.';
    errorDiv.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    // Get plant name for denormalization
    let plantName = '';
    let deptName  = '';
    if (plantId) {
      const plantDoc = await col('plants').doc(plantId).get();
      plantName = plantDoc.data()?.name || '';
    }
    if (deptId) {
      const deptDoc = await col('departments').doc(deptId).get();
      deptName = deptDoc.data()?.name || '';
    }

    if (editId) {
      // Update existing user profile
      await col('users').doc(editId).update({
        name, empId, mobile, role, plantId: plantId || null, plantName,
        deptId: deptId || null, deptName, designation,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedBy: window.currentUser.uid
      });

      await logActivity('user', `User updated: ${email}`, editId, { oldValue: 'profile', newValue: role });
      showToast('User updated successfully', 'success');
    } else {
      // CREATE: create the Firebase Auth account (via a secondary app so the
      // admin stays signed in), then write the profile at users/{uid}.
      const cu = window.currentUser;
      if (cu.role === ROLES.PLANT_ADMIN) {
        if (role === ROLES.SUPER_ADMIN) throw new UserFacingError('Plant Admins cannot create Super Admins.');
        if (plantId !== cu.plantId)     throw new UserFacingError('You can only create users for your own plant.');
      }

      const profileData = {
        name, empId, email, mobile, role,
        plantId: plantId || null, plantName,
        deptId: deptId || null, deptName, designation,
        status:    'active',
        active:    true,
        createdBy: cu.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastLogin: null,
        initials:  getInitials(name)
      };

      const sAuth = getSecondaryAuth();
      let uid;
      try {
        const cred = await sAuth.createUserWithEmailAndPassword(email, password);
        uid = cred.user.uid;
      } finally {
        try { await sAuth.signOut(); } catch (_) {}
      }

      try {
        profileData.uid = uid;
        await col('users').doc(uid).set(profileData);
      } catch (profileErr) {
        console.error('[Users] Auth user created but profile write failed:', profileErr);
        throw new UserFacingError(`Login account for ${email} was created, but saving the profile failed (${friendlyFirebaseError(profileErr)}). Fix the cause and add the profile at apps/lpa/users/${uid}.`);
      }

      try { await logActivity('user', `User created: ${email} / ${role}`, uid, { newValue: { name, email, role } }); } catch (_) {}
      showToast(`User ${name} created successfully`, 'success');
    }

    closeModal('userModal');
    await loadUsers();

  } catch (e) {
    const authMsgs = {
      'auth/email-already-in-use': 'A login account with this email already exists.',
      'auth/weak-password':        'Password is too weak. Use at least 8 characters.',
      'auth/invalid-email':        'Please enter a valid email address.',
      'auth/operation-not-allowed':'Email/Password sign-in is not enabled in Firebase Authentication.'
    };
    errorDiv.textContent = e.userMessage || authMsgs[e.code] || friendlyFirebaseError(e);
    errorDiv.classList.remove('hidden');
    console.error('[Users] Save error:', e);
  } finally {
    btn.disabled = false;
    btn.textContent = editId ? 'Save Changes' : 'Create User';
  }
}

/* ── Activate / Deactivate ───────────────────────────────── */
async function deactivateUser(userId) {
  requirePermission('manage_users');

  const result = await confirmAction({
    title:       'Deactivate User',
    message:     'Deactivate this user? They will be unable to log in to the LPA system.',
    confirmText: 'Deactivate',
    dangerStyle: true
  });

  if (!result.confirmed) return;

  try {
    await col('users').doc(userId).update({
      status:        'inactive',
      deactivatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      deactivatedBy: window.currentUser.uid,
      updatedAt:     firebase.firestore.FieldValue.serverTimestamp()
    });
    await logActivity('user', `User deactivated: ${userId}`, userId, null);
    showToast('User deactivated', 'success');
    await loadUsers();
  } catch (e) {
    showToast(friendlyFirebaseError(e), 'error');
  }
}

async function activateUser(userId) {
  requirePermission('manage_users');

  try {
    await col('users').doc(userId).update({
      status:      'active',
      activatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      activatedBy: window.currentUser.uid,
      updatedAt:   firebase.firestore.FieldValue.serverTimestamp()
    });
    await logActivity('user', `User activated: ${userId}`, userId, null);
    showToast('User activated', 'success');
    await loadUsers();
  } catch (e) {
    showToast(friendlyFirebaseError(e), 'error');
  }
}

async function resetUserAccess(userId) {
  requirePermission('manage_users');

  const result = await confirmAction({
    title:       'Reset User Access',
    message:     'This will send a password reset email to the user. Continue?',
    confirmText: 'Send Reset Email',
    dangerStyle: false
  });

  if (!result.confirmed) return;

  try {
    const userDoc = await col('users').doc(userId).get();
    const email   = userDoc.data()?.email;
    if (email) {
      await auth.sendPasswordResetEmail(email);
      await logActivity('user', `Password reset sent: ${email}`, userId, null);
      showToast(`Password reset email sent to ${email}`, 'success');
    }
  } catch (e) {
    showToast(friendlyFirebaseError(e), 'error');
  }
}
