/**
 * actions.js
 * Corrective Action workflow: submit → verify → approve/return → close.
 */

async function loadActions() {
  const tbody   = document.getElementById('actionsTableBody');
  const countEl = document.getElementById('actionsCount');
  const user    = window.currentUser;
  if (!user || !tbody) return;

  tbody.innerHTML = '<tr><td colspan="10" class="table-empty">Loading…</td></tr>';

  try {
    let query = col('correctiveActions');

    const plantId = getActivePlantId();
    if (plantId)                      query = query.where('plantId', '==', plantId);
    else if (user.role !== ROLES.SUPER_ADMIN) query = query.where('plantId', '==', user.plantId);

    const statusF = document.getElementById('actionStatusFilter')?.value;
    if (statusF)  query = query.where('status', '==', statusF);

    const priorF = document.getElementById('actionPriorityFilter')?.value;
    if (priorF)   query = query.where('priority', '==', priorF);

    query = query.orderBy('createdAt', 'desc').limit(PAGE_SIZE);

    const snap    = await query.get();
    const actions = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    countEl.textContent = `${actions.length} action${actions.length !== 1 ? 's' : ''}`;

    if (actions.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" class="table-empty">No actions found.</td></tr>';
      return;
    }

    tbody.innerHTML = actions.map(a => {
      const overdue    = a.status !== 'Closed' && a.status !== 'Verified' && isOverdue(a.targetDate);
      const daysDiff   = daysUntil(a.targetDate);
      let dueCls = '';
      if (overdue) dueCls = 'color:var(--color-danger);font-weight:600';
      else if (daysDiff !== null && daysDiff <= 3) dueCls = 'color:var(--color-warning);font-weight:600';

      return `
        <tr data-record-id="${a.id}">
          <td style="font-family:var(--font-mono);font-size:12px">${escapeHtml(a.id)}</td>
          <td style="font-family:var(--font-mono);font-size:11px">${escapeHtml(a.findingId || '—')}</td>
          <td>${escapeHtml(a.plantName || '—')}</td>
          <td>${escapeHtml(a.processName || '—')}</td>
          <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
              title="${escapeHtml(a.description)}">${escapeHtml(a.description?.substring(0,60) || '—')}</td>
          <td>${escapeHtml(a.responsible || '—')}</td>
          <td style="${dueCls}">${a.targetDate || '—'}${overdue ? ' ⚠' : ''}</td>
          <td>${getPriorityBadge(a.priority)}</td>
          <td>${getActionStatusBadge(a.status)}</td>
          <td>
            <div class="action-btns">
              <button class="btn btn-secondary btn-sm" onclick="openActionDetail('${a.id}')">Details</button>
              ${buildActionButtons(a, user)}
            </div>
          </td>
        </tr>
      `;
    }).join('');

  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="10" class="table-empty">${friendlyFirebaseError(e)}</td></tr>`;
    console.error('[Actions] Load error:', e);
  }
}

function buildActionButtons(action, user) {
  const btns = [];

  // Responsible person / anyone can submit their action
  if (['Open','Assigned','In Progress','Returned'].includes(action.status)) {
    btns.push(`<button class="btn btn-primary btn-sm" onclick="submitActionUpdate('${action.id}')">Update</button>`);
  }

  // Plant admin / super admin can verify
  if (action.status === 'Submitted' && can('verify_action')) {
    btns.push(`<button class="btn btn-success btn-sm" onclick="approveAction('${action.id}')">Approve</button>`);
    btns.push(`<button class="btn btn-ghost btn-sm" onclick="returnAction('${action.id}')">Return</button>`);
  }

  // Close
  if (action.status === 'Verified' && can('close_action')) {
    btns.push(`<button class="btn btn-ghost btn-sm" onclick="closeAction('${action.id}')">Close</button>`);
  }

  return btns.join('');
}

function getPriorityBadge(priority) {
  const map = {
    'Critical': 'badge-critical',
    'High':     'badge-major',
    'Medium':   'badge-minor',
    'Low':      'badge-planned'
  };
  return `<span class="badge ${map[priority] || 'badge-minor'}">${priority || '—'}</span>`;
}

/* ── Action Detail Modal ─────────────────────────────────── */
async function openActionDetail(actionId) {
  showLoading('Loading action…');
  try {
    const actionDoc = await col('correctiveActions').doc(actionId).get();
    if (!actionDoc.exists) { showToast('Action not found.', 'error'); return; }
    const a = { id: actionDoc.id, ...actionDoc.data() };

    if (!canAccessPlant(a.plantId)) {
      showToast('This action is outside your authorized plant.', 'error');
      return;
    }

    document.getElementById('actionModalTitle').textContent = `Action — ${a.id}`;

    const body = document.getElementById('actionModalBody');
    body.innerHTML = `
      <div class="form-grid-2" style="margin-bottom:16px">
        <div><div class="exec-meta-label">Finding ID</div><div style="font-family:var(--font-mono)">${a.findingId || '—'}</div></div>
        <div><div class="exec-meta-label">Status</div><div>${getActionStatusBadge(a.status)}</div></div>
        <div><div class="exec-meta-label">Plant</div><div>${escapeHtml(a.plantName)}</div></div>
        <div><div class="exec-meta-label">Priority</div><div>${getPriorityBadge(a.priority)}</div></div>
        <div><div class="exec-meta-label">Responsible</div><div>${escapeHtml(a.responsible)}</div></div>
        <div><div class="exec-meta-label">Target Date</div>
          <div class="${isOverdue(a.targetDate) && !['Closed','Verified'].includes(a.status) ? 'text-danger fw-600' : ''}">${a.targetDate || '—'}</div>
        </div>
      </div>

      <div class="form-group" style="margin-bottom:12px">
        <label class="form-label">Finding Description</label>
        <p style="font-size:13px">${escapeHtml(a.description || '—')}</p>
      </div>

      <!-- Editable fields if action can be updated -->
      ${['Open','Assigned','In Progress','Returned'].includes(a.status) ? `
        <div style="border:1px solid var(--color-border);border-radius:8px;padding:16px;background:var(--color-surface-2)">
          <h4 style="margin-bottom:12px;font-size:13px;font-weight:700">Update Action</h4>
          ${a.returnReason ? `<div class="alert alert-warning">Returned: ${escapeHtml(a.returnReason)}</div>` : ''}
          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label">Root Cause</label>
              <textarea class="form-textarea" id="actionRootCause" rows="2">${escapeHtml(a.rootCause || '')}</textarea>
            </div>
            <div class="form-group">
              <label class="form-label">Corrective Action</label>
              <textarea class="form-textarea" id="actionCorrectiveAction" rows="2">${escapeHtml(a.correctiveAction || '')}</textarea>
            </div>
            <div class="form-group form-span-2">
              <label class="form-label">Preventive Action</label>
              <textarea class="form-textarea" id="actionPreventiveAction" rows="2">${escapeHtml(a.preventiveAction || '')}</textarea>
            </div>
          </div>
          <button class="btn btn-primary" style="margin-top:8px" onclick="submitActionUpdate('${a.id}', true)">
            Submit for Verification
          </button>
        </div>
      ` : `
        <div class="form-grid-2">
          <div class="form-group">
            <label class="form-label">Root Cause</label>
            <p style="font-size:13px">${escapeHtml(a.rootCause || '—')}</p>
          </div>
          <div class="form-group">
            <label class="form-label">Corrective Action</label>
            <p style="font-size:13px">${escapeHtml(a.correctiveAction || '—')}</p>
          </div>
          <div class="form-group">
            <label class="form-label">Preventive Action</label>
            <p style="font-size:13px">${escapeHtml(a.preventiveAction || '—')}</p>
          </div>
        </div>
      `}

      ${a.returnReason && !['Open','Assigned','In Progress','Returned'].includes(a.status) ? `
        <div class="alert alert-warning" style="margin-top:12px">Return Reason: ${escapeHtml(a.returnReason)}</div>
      ` : ''}

      <!-- Timeline -->
      <div style="margin-top:20px">
        <h4 style="font-size:13px;font-weight:700;margin-bottom:8px">Action Timeline</h4>
        <div class="text-muted text-sm">Created: ${formatDateTime(a.createdAt)}</div>
        ${a.submittedAt ? `<div class="text-muted text-sm">Submitted: ${formatDateTime(a.submittedAt)}</div>` : ''}
        ${a.verificationDate ? `<div class="text-muted text-sm">Verified: ${formatDateTime(a.verificationDate)} by ${escapeHtml(a.verifiedBy || '—')}</div>` : ''}
        ${a.closedAt ? `<div class="text-muted text-sm">Closed: ${formatDateTime(a.closedAt)}</div>` : ''}
      </div>
    `;

    const footer = document.getElementById('actionModalFooter');
    footer.innerHTML = `
      <button class="btn btn-secondary" onclick="closeModal('actionModal')">Close</button>
      ${a.status === 'Submitted' && can('verify_action') ? `
        <button class="btn btn-ghost btn-sm" onclick="returnAction('${a.id}');closeModal('actionModal')">Return</button>
        <button class="btn btn-success" onclick="approveAction('${a.id}');closeModal('actionModal')">Approve & Verify</button>
      ` : ''}
      ${a.status === 'Verified' && can('close_action') ? `
        <button class="btn btn-primary" onclick="closeAction('${a.id}');closeModal('actionModal')">Close Action</button>
      ` : ''}
    `;

    hideLoading();
    openModal('actionModal');
  } catch (e) {
    hideLoading();
    showToast(friendlyFirebaseError(e), 'error');
  }
}

/* ── Action Workflow ─────────────────────────────────────── */
async function submitActionUpdate(actionId, fromModal = false) {
  const rootCause        = document.getElementById('actionRootCause')?.value?.trim() || '';
  const correctiveAction = document.getElementById('actionCorrectiveAction')?.value?.trim() || '';
  const preventiveAction = document.getElementById('actionPreventiveAction')?.value?.trim() || '';

  if (!rootCause || !correctiveAction) {
    showToast('Root cause and corrective action are required.', 'error');
    return;
  }

  try {
    await col('correctiveActions').doc(actionId).update({
      status:          'Submitted',
      rootCause,
      correctiveAction,
      preventiveAction,
      submittedAt:     firebase.firestore.FieldValue.serverTimestamp(),
      submittedBy:     window.currentUser.uid,
      returnReason:    '',
      updatedAt:       firebase.firestore.FieldValue.serverTimestamp()
    });

    // Notify plant admin
    await notifyPlantAdmins(actionId, 'action_submitted', 'Action Submitted', `Action ${actionId} has been submitted for verification.`);

    await logActivity('action', `Action submitted: ${actionId}`, actionId, null);
    showToast('Action submitted for verification', 'success');

    if (fromModal) closeModal('actionModal');
    await loadActions();
  } catch (e) {
    showToast(friendlyFirebaseError(e), 'error');
  }
}

async function approveAction(actionId) {
  requirePermission('verify_action');

  const result = await confirmAction({
    title:       'Approve Action',
    message:     'Approve and mark this action as Verified?',
    confirmText: 'Approve',
    dangerStyle: false
  });

  if (!result.confirmed) return;

  try {
    const actionDoc = await col('correctiveActions').doc(actionId).get();
    const action    = actionDoc.data();

    await col('correctiveActions').doc(actionId).update({
      status:          'Verified',
      verifiedBy:      window.currentUser.name,
      verifiedById:    window.currentUser.uid,
      verificationDate:firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt:       firebase.firestore.FieldValue.serverTimestamp()
    });

    // Notify submitter
    if (action?.createdBy) {
      await createNotification(
        action.createdBy, 'action_verified',
        'Action Approved', `Your corrective action ${actionId} has been approved.`,
        'action', actionId, action.plantId,
        `action_verified_${actionId}`
      );
    }

    await logActivity('action', `Action approved: ${actionId}`, actionId, null);
    showToast('Action approved and marked as Verified', 'success');
    await loadActions();
  } catch (e) {
    showToast(friendlyFirebaseError(e), 'error');
  }
}

async function returnAction(actionId) {
  requirePermission('verify_action');

  const result = await confirmAction({
    title:         'Return Action',
    message:       `Return action ${actionId} for correction?`,
    requireReason: true,
    reasonLabel:   'Reason for return',
    confirmText:   'Return',
    dangerStyle:   true
  });

  if (!result.confirmed) return;

  try {
    const actionDoc = await col('correctiveActions').doc(actionId).get();
    const action    = actionDoc.data();

    await col('correctiveActions').doc(actionId).update({
      status:       'Returned',
      returnReason: result.reason,
      returnedAt:   firebase.firestore.FieldValue.serverTimestamp(),
      returnedBy:   window.currentUser.uid,
      updatedAt:    firebase.firestore.FieldValue.serverTimestamp()
    });

    // Notify action creator/responsible
    if (action?.createdBy) {
      await createNotification(
        action.createdBy, 'action_returned',
        'Action Returned', `Action ${actionId} was returned: ${result.reason}`,
        'action', actionId, action.plantId,
        `action_returned_${actionId}_${Date.now()}`
      );
    }

    await logActivity('action', `Action returned: ${actionId}. Reason: ${result.reason}`, actionId, null);
    showToast('Action returned for correction', 'warning');
    await loadActions();
  } catch (e) {
    showToast(friendlyFirebaseError(e), 'error');
  }
}

async function closeAction(actionId) {
  requirePermission('close_action');

  const result = await confirmAction({
    title:       'Close Action',
    message:     `Close action ${actionId}? This action must be verified before closing.`,
    confirmText: 'Close Action',
    dangerStyle: false
  });

  if (!result.confirmed) return;

  try {
    await col('correctiveActions').doc(actionId).update({
      status:   'Closed',
      closedAt: firebase.firestore.FieldValue.serverTimestamp(),
      closedBy: window.currentUser.uid,
      updatedAt:firebase.firestore.FieldValue.serverTimestamp()
    });

    await logActivity('action', `Action closed: ${actionId}`, actionId, null);
    showToast('Action closed', 'success');
    await loadActions();
  } catch (e) {
    showToast(friendlyFirebaseError(e), 'error');
  }
}

/* ── Notification Helper ─────────────────────────────────── */
async function notifyPlantAdmins(recordId, type, title, message) {
  try {
    const actionDoc  = await col('correctiveActions').doc(recordId).get();
    const plantId    = actionDoc.data()?.plantId;
    if (!plantId) return;

    const adminsSnap = await col('users')
      .where('plantId', '==', plantId)
      .where('role', 'in', [ROLES.PLANT_ADMIN, ROLES.SUPER_ADMIN])
      .where('status', '==', 'active')
      .get();

    for (const doc of adminsSnap.docs) {
      await createNotification(
        doc.id, type, title, message, 'action', recordId, plantId,
        `${type}_${recordId}_${doc.id}`
      );
    }
  } catch (e) {
    console.warn('[Actions] notifyPlantAdmins error:', e.message);
  }
}
