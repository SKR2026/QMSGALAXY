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

    const snap = await query.orderBy('name').get();
    allUsers   = snap.docs.map(d => ({ id: d.id, ...d.data() }));

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
    const statusBadge = u.status === 'active'
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

    if (user.status === 'active') {
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

  // Populate dept options
  const deptSel = document.getElementById('userDept');
  deptSel.innerHTML = '<option value="">None</option>';

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
  plantSel.value = u.plantId || '';

  if (u.plantId) {
    const deptSel = document.getElementById('userDept');
    await populateDeptOptions(deptSel, u.plantId, false);
    deptSel.value = u.deptId || '';
  }

  onUserRoleChange(u.role);

  openModal('userModal');
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
      // CREATE: Call Cloud Function or provide instructions
      // The Cloud Function `createLPAUser` accepts { email, password, profile }
      // and creates both the Firebase Auth user and the Firestore profile atomically.
      //
      // If Cloud Functions are not yet deployed, we create the Firestore profile
      // and instruct the Super Admin to also create the Auth account separately.

      // Check for duplicate email in Firestore
      const existing = await col('users').where('email', '==', email).limit(1).get();
      if (!existing.empty) {
        throw new UserFacingError('A user with this email already exists in the LPA system.');
      }

      const profileData = {
        name, empId, email, mobile, role,
        plantId: plantId || null, plantName,
        deptId: deptId || null, deptName, designation,
        status:    'active',
        createdBy: window.currentUser.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastLogin: null,
        initials:  getInitials(name)
      };

      // Try Cloud Function first, fall back to client-side creation guide
      try {
        const fn = firebase.functions?.().httpsCallable('createLPAUser');
        if (fn) {
          await fn({ email, password, profile: profileData });
          showToast(`User ${name} created successfully`, 'success');
        } else {
          // No Functions SDK loaded — store profile with a pending UID placeholder
          // Admin must create the Firebase Auth account manually
          const tempDocId = `pending_${Date.now()}`;
          profileData.status  = 'pending_auth';
          profileData.tempRef = tempDocId;
          await col('users').doc(tempDocId).set(profileData);

          showToast(`Profile saved. IMPORTANT: Create the Firebase Auth account for ${email} in the Firebase Console with the same UID, then update the document ID.`, 'warning', 10000);
        }
      } catch (fnErr) {
        console.warn('[Users] Cloud Function unavailable, saving profile only:', fnErr.message);
        // Save profile anyway — when the user signs in via Firebase Auth the profile will be found by UID
        const tempDocId = `profile_${email.replace(/[^a-z0-9]/gi,'_')}`;
        await col('users').doc(tempDocId).set(profileData);
        showToast(`Profile saved for ${name}. Note: Firebase Auth account must be created separately.`, 'info', 8000);
      }

      await logActivity('user', `User created: ${email} / ${role}`, null, { newValue: { name, email, role } });
    }

    closeModal('userModal');
    await loadUsers();

  } catch (e) {
    errorDiv.textContent = e.userMessage || friendlyFirebaseError(e);
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
