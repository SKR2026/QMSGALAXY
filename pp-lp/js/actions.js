/**
 * actions.js
 * Corrective Action workflow: submit → verify → approve/return → close.
 */

async function loadActions() {
  const tbody   = document.getElementById('actionsTableBody');
  const countEl = document.getElementById('actionsCount');
  const user    = window.currentUser;
  if (!user || !tbody) return;

  tbody.innerHTML = '<tr><td colspan="11" class="table-empty">Loading…</td></tr>';

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

    const isSA = user.role === ROLES.SUPER_ADMIN;

    // ── Toolbar: bulk-delete button (super_admin only) ──────────────────
    let toolbar = document.getElementById('actionsToolbar');
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.id = 'actionsToolbar';
      toolbar.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:10px;min-height:32px';
      const card = tbody.closest('.card');
      card.insertBefore(toolbar, card.firstChild);
    }
    if (isSA && actions.length > 0) {
      toolbar.innerHTML = `
        <label style="font-size:13px;color:var(--color-text-muted);cursor:pointer;display:flex;align-items:center;gap:6px">
          <input type="checkbox" id="actionSelectAll" onchange="toggleAllActions(this)">
          Select all
        </label>
        <button class="btn btn-danger btn-sm" id="btnDeleteSelectedActions"
                style="display:none" onclick="deleteSelectedActions()">
          🗑 Delete Selected
        </button>
        <span id="actionsSelCount" style="font-size:12px;color:var(--color-text-muted)"></span>`;
    } else {
      toolbar.innerHTML = '';
    }

    countEl.textContent = `${actions.length} action${actions.length !== 1 ? 's' : ''}`;

    if (actions.length === 0) {
      tbody.innerHTML = '<tr><td colspan="11" class="table-empty">No actions found.</td></tr>';
      return;
    }

    // Update table header to include checkbox column for super_admin
    const thead = tbody.closest('table').querySelector('thead tr');
    if (isSA && !thead.querySelector('.action-chk-th')) {
      const th = document.createElement('th');
      th.className = 'action-chk-th';
      th.style.width = '36px';
      thead.insertBefore(th, thead.firstChild);
    } else if (!isSA) {
      const chkTh = thead.querySelector('.action-chk-th');
      if (chkTh) chkTh.remove();
    }

    tbody.innerHTML = actions.map(a => {
      const overdue  = a.status !== 'Closed' && a.status !== 'Verified' && isOverdue(a.targetDate);
      const daysDiff = daysUntil(a.targetDate);
      let dueCls = '';
      if (overdue) dueCls = 'color:var(--color-danger);font-weight:600';
      else if (daysDiff !== null && daysDiff <= 3) dueCls = 'color:var(--color-warning);font-weight:600';

      const chkCell = isSA
        ? `<td style="width:36px;text-align:center"><input type="checkbox" class="action-row-chk"
            data-id="${a.id}" onchange="onActionCheckChange()"></td>`
        : '';

      return `
        <tr data-record-id="${a.id}">
          ${chkCell}
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
    tbody.innerHTML = `<tr><td colspan="11" class="table-empty">${friendlyFirebaseError(e)}</td></tr>`;
    console.error('[Actions] Load error:', e);
  }
}

/* ── Bulk-select helpers (super_admin only) ──────────────────────────────── */
function onActionCheckChange() {
  const checked = document.querySelectorAll('.action-row-chk:checked');
  const all     = document.querySelectorAll('.action-row-chk');
  const selAll  = document.getElementById('actionSelectAll');
  const btn     = document.getElementById('btnDeleteSelectedActions');
  const cntEl   = document.getElementById('actionsSelCount');

  if (selAll) selAll.checked = (checked.length === all.length && all.length > 0);
  if (btn)    btn.style.display = checked.length > 0 ? '' : 'none';
  if (cntEl)  cntEl.textContent = checked.length > 0 ? `${checked.length} selected` : '';
}

function toggleAllActions(masterChk) {
  document.querySelectorAll('.action-row-chk').forEach(c => { c.checked = masterChk.checked; });
  onActionCheckChange();
}

async function deleteSelectedActions() {
  const checked = [...document.querySelectorAll('.action-row-chk:checked')];
  if (!checked.length) return;

  const ids = checked.map(c => c.dataset.id);
  const result = await confirmAction({
    title:       'Delete Corrective Actions',
    message:     `Permanently delete ${ids.length} corrective action${ids.length > 1 ? 's' : ''}? This cannot be undone.`,
    confirmText: 'Delete',
    dangerStyle: true
  });
  if (!result.confirmed) return;

  showLoading('Deleting…');
  let failed = 0;
  for (const id of ids) {
    try {
      await col('correctiveActions').doc(id).delete();
      await logActivity('action', `Action deleted: ${id}`, id, null);
    } catch (e) {
      console.error('[Actions] Delete failed for', id, e);
      failed++;
    }
  }
  hideLoading();
  if (failed > 0) showToast(`${ids.length - failed} deleted, ${failed} failed.`, 'warning');
  else            showToast(`${ids.length} action${ids.length > 1 ? 's' : ''} deleted.`, 'success');
  await loadActions();
}

/* ── Action buttons per row ──────────────────────────────────────────────── */
function buildActionButtons(action, user) {
  const btns = [];

  // Responsible person / anyone can submit their action
  if (['Open','Assigned','In Progress','Returned'].includes(action.status)) {
    btns.push(`<button class="btn btn-primary btn-sm" onclick="submitActionUpdate('${action.id}')">Update</button>`);
  }

  // Auditor / plant admin / super admin can verify submitted actions
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

    // Notify plant admin AND auditor assigned to this finding's audit
    await notifyVerifiers(actionId, 'action_submitted',
      'Action Plan Submitted',
      `Action ${actionId} has been submitted for verification.`);

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

    // Notify submitter / creator
    if (action?.createdBy) {
      await createNotification(
        action.createdBy, 'action_verified',
        'Action Approved', `Your corrective action ${actionId} has been approved and verified.`,
        'action', actionId, action.plantId,
        `action_verified_${actionId}`
      );
    }
    // Also notify responsible person if different from creator
    if (action?.responsibleUserId && action.responsibleUserId !== action?.createdBy) {
      await createNotification(
        action.responsibleUserId, 'action_verified',
        'Action Approved', `Corrective action ${actionId} you are responsible for has been approved.`,
        'action', actionId, action.plantId,
        `action_verified_resp_${actionId}`
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

    // Notify creator
    if (action?.createdBy) {
      await createNotification(
        action.createdBy, 'action_returned',
        'Action Returned', `Action ${actionId} was returned: ${result.reason}`,
        'action', actionId, action.plantId,
        `action_returned_${actionId}_${Date.now()}`
      );
    }
    // Also notify responsible person if different from creator
    if (action?.responsibleUserId && action.responsibleUserId !== action?.createdBy) {
      await createNotification(
        action.responsibleUserId, 'action_returned',
        'Action Returned', `Action ${actionId} you are responsible for was returned: ${result.reason}`,
        'action', actionId, action.plantId,
        `action_returned_resp_${actionId}_${Date.now()}`
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

/* ── Notification Helpers ────────────────────────────────── */

/**
 * Notify everyone who needs to verify this action:
 *  - plant_admin(s) for this plant
 *  - the auditor assigned to the audit that generated this finding
 *  - super_admin(s)
 */
async function notifyVerifiers(actionId, type, title, message) {
  try {
    const actionDoc = await col('correctiveActions').doc(actionId).get();
    const actionData = actionDoc.data();
    if (!actionData) return;

    const plantId   = actionData.plantId;
    const findingId = actionData.findingId;

    // Collect recipient UIDs (deduplicated)
    const recipientIds = new Set();

    // 1. Plant admins + super admins
    if (plantId) {
      const adminsSnap = await col('users')
        .where('plantId', '==', plantId)
        .where('role', 'in', [ROLES.PLANT_ADMIN, ROLES.SUPER_ADMIN])
        .where('status', '==', 'active')
        .get();
      adminsSnap.docs.forEach(d => recipientIds.add(d.id));
    }

    // 2. Auditor from the audit linked to this finding
    if (findingId) {
      try {
        const findingDoc = await col('findings').doc(findingId).get();
        const auditId    = findingDoc.exists ? findingDoc.data()?.auditId : null;
        if (auditId) {
          const auditDoc = await col('audits').doc(auditId).get();
          const auditorId = auditDoc.exists ? auditDoc.data()?.auditorId : null;
          if (auditorId) recipientIds.add(auditorId);
        }
      } catch (e) {
        console.warn('[Actions] Could not resolve auditor for finding', findingId, e.message);
      }
    }

    // 3. Also try auditId directly on the action (if stored)
    if (actionData.auditId) {
      try {
        const auditDoc  = await col('audits').doc(actionData.auditId).get();
        const auditorId = auditDoc.exists ? auditDoc.data()?.auditorId : null;
        if (auditorId) recipientIds.add(auditorId);
      } catch (_) {}
    }

    // Send in-app notification to all recipients
    for (const uid of recipientIds) {
      await createNotification(
        uid, type, title, message, 'action', actionId, plantId,
        `${type}_${actionId}_${uid}`
      );
    }
  } catch (e) {
    console.warn('[Actions] notifyVerifiers error:', e.message);
  }
}

/** Legacy alias kept for backward compat */
async function notifyPlantAdmins(recordId, type, title, message) {
  return notifyVerifiers(recordId, type, title, message);
}
