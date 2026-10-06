/**
 * findings.js
 * Finding list, detail view, and status management.
 */

async function loadFindings() {
  const tbody   = document.getElementById('findingsTableBody');
  const countEl = document.getElementById('findingsCount');
  const user    = window.currentUser;
  if (!user || !tbody) return;

  tbody.innerHTML = '<tr><td colspan="10" class="table-empty">Loading…</td></tr>';

  try {
    let query = col('findings');

    const plantId = getActivePlantId();
    if (plantId)                      query = query.where('plantId', '==', plantId);
    else if (user.role !== ROLES.SUPER_ADMIN) query = query.where('plantId', '==', user.plantId);

    const statusF = document.getElementById('findingStatusFilter')?.value;
    if (statusF)  query = query.where('status', '==', statusF);

    const critF = document.getElementById('findingCritFilter')?.value;
    if (critF)    query = query.where('criticality', '==', critF);

    query = query.orderBy('createdAt', 'desc').limit(PAGE_SIZE);

    const snap     = await query.get();
    const findings = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    countEl.textContent = `${findings.length} finding${findings.length !== 1 ? 's' : ''}`;

    if (findings.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" class="table-empty">No findings found.</td></tr>';
      return;
    }

    tbody.innerHTML = findings.map(f => {
      const overdueCls = f.status !== 'Closed' && isOverdue(f.targetDate) ? 'style="color:var(--color-danger)"' : '';
      return `
        <tr data-record-id="${f.id}">
          <td style="font-family:var(--font-mono);font-size:12px">${escapeHtml(f.id)}</td>
          <td style="font-family:var(--font-mono);font-size:11px">${escapeHtml(f.auditId || '—')}</td>
          <td>${escapeHtml(f.plantName || '—')}</td>
          <td>${escapeHtml(f.departmentName || '—')}</td>
          <td>${getCriticalityBadge(f.criticality)}</td>
          <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(f.description)}">${escapeHtml(f.description?.substring(0,60) || '—')}…</td>
          <td>${escapeHtml(f.responsible || '—')}</td>
          <td ${overdueCls}>${escapeHtml(f.targetDate || '—')}</td>
          <td>${getActionStatusBadge(f.status)}</td>
          <td>
            <div class="action-btns">
              <button class="btn btn-secondary btn-sm" onclick="openFindingDetail('${f.id}')">Details</button>
              ${(can('close_finding') && !['Closed','Verified'].includes(f.status)) ?
                `<button class="btn btn-ghost btn-sm" onclick="closeFinding('${f.id}')">Close</button>` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');

  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="10" class="table-empty">${friendlyFirebaseError(e)}</td></tr>`;
    console.error('[Findings] Load error:', e);
  }
}

async function openFindingDetail(findingId) {
  showLoading('Loading finding…');
  try {
    const findDoc = await col('findings').doc(findingId).get();
    if (!findDoc.exists) { showToast('Finding not found.', 'error'); return; }
    const f = { id: findDoc.id, ...findDoc.data() };

    if (!canAccessPlant(f.plantId)) {
      showToast('This finding is outside your authorized plant.', 'error');
      return;
    }

    // Load related action
    let action = null;
    if (f.actionId) {
      const actionDoc = await col('correctiveActions').doc(f.actionId).get();
      if (actionDoc.exists) action = { id: actionDoc.id, ...actionDoc.data() };
    }

    document.getElementById('findingModalTitle').textContent = `Finding — ${f.id}`;

    const body = document.getElementById('findingModalBody');
    body.innerHTML = `
      <div class="form-grid-2" style="margin-bottom:16px">
        <div><div class="exec-meta-label">Audit ID</div><div style="font-family:var(--font-mono)">${f.auditId}</div></div>
        <div><div class="exec-meta-label">Criticality</div><div>${getCriticalityBadge(f.criticality)}</div></div>
        <div><div class="exec-meta-label">Plant</div><div>${escapeHtml(f.plantName)}</div></div>
        <div><div class="exec-meta-label">Department</div><div>${escapeHtml(f.departmentName)}</div></div>
        <div><div class="exec-meta-label">Process</div><div>${escapeHtml(f.processName)}</div></div>
        <div><div class="exec-meta-label">Status</div><div>${getActionStatusBadge(f.status)}</div></div>
      </div>

      <div class="form-group" style="margin-bottom:12px">
        <label class="form-label">Non-Conformity Question</label>
        <p style="font-size:13px;color:var(--color-text-2)">${escapeHtml(f.questionText || '—')}</p>
      </div>

      <div class="form-group" style="margin-bottom:12px">
        <label class="form-label">Finding Description</label>
        <p style="font-size:13px;color:var(--color-text-2)">${escapeHtml(f.description || '—')}</p>
      </div>

      <div class="form-group" style="margin-bottom:12px">
        <label class="form-label">Immediate Containment</label>
        <p style="font-size:13px;color:var(--color-text-2)">${escapeHtml(f.containment || '—')}</p>
      </div>

      <div class="form-grid-2" style="margin-bottom:16px">
        <div><div class="exec-meta-label">Responsible Person</div><div>${escapeHtml(f.responsible)}</div></div>
        <div><div class="exec-meta-label">Target Date</div><div class="${isOverdue(f.targetDate) && f.status !== 'Closed' ? 'text-danger' : ''}">${f.targetDate || '—'}</div></div>
      </div>

      ${action ? `
        <div class="card" style="margin-top:16px;margin-bottom:0">
          <div class="card-header"><h3 class="card-title">Linked Corrective Action</h3></div>
          <div style="padding:16px">
            <div class="form-grid-2">
              <div><div class="exec-meta-label">Action ID</div><div style="font-family:var(--font-mono)">${action.id}</div></div>
              <div><div class="exec-meta-label">Status</div><div>${getActionStatusBadge(action.status)}</div></div>
              <div><div class="exec-meta-label">Root Cause</div><div>${escapeHtml(action.rootCause || '—')}</div></div>
              <div><div class="exec-meta-label">Corrective Action</div><div>${escapeHtml(action.correctiveAction || '—')}</div></div>
            </div>
            <button class="btn btn-secondary btn-sm" style="margin-top:12px" onclick="closeModal('findingModal');openActionDetail('${action.id}')">
              Open Action Details →
            </button>
          </div>
        </div>
      ` : ''}
    `;

    const footer = document.getElementById('findingModalFooter');
    footer.innerHTML = `
      <button class="btn btn-secondary" onclick="closeModal('findingModal')">Close</button>
      ${can('close_finding') && !['Closed','Verified'].includes(f.status) ?
        `<button class="btn btn-success" onclick="closeFinding('${f.id}');closeModal('findingModal')">Close Finding</button>` : ''}
    `;

    hideLoading();
    openModal('findingModal');
  } catch (e) {
    hideLoading();
    showToast(friendlyFirebaseError(e), 'error');
  }
}

async function closeFinding(findingId) {
  requirePermission('close_finding');

  const result = await confirmAction({
    title:         'Close Finding',
    message:       `Mark finding ${findingId} as Closed?`,
    requireReason: true,
    reasonLabel:   'Closure notes',
    confirmText:   'Close Finding',
    dangerStyle:   false
  });

  if (!result.confirmed) return;

  try {
    await col('findings').doc(findingId).update({
      status:    'Closed',
      closedAt:  firebase.firestore.FieldValue.serverTimestamp(),
      closedBy:  window.currentUser.uid,
      closeNotes:result.reason,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    await logActivity('finding', `Finding closed: ${findingId}`, findingId, null);
    showToast('Finding closed', 'success');
    await loadFindings();
  } catch (e) {
    showToast(friendlyFirebaseError(e), 'error');
  }
}
