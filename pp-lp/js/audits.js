/**
 * audits.js
 * Audit list, create, execute, submit, and history.
 */

let auditsPage = 1;
let currentAuditData = null; // Audit being executed
let auditResponses = {};     // { questionId: { response, comment, findingDesc, ... } }

/* ── Audit List ──────────────────────────────────────────── */
async function loadAudits() {
  const tbody    = document.getElementById('auditsTableBody');
  const countEl  = document.getElementById('auditsCount');
  const user     = window.currentUser;
  if (!user || !tbody) return;

  tbody.innerHTML = '<tr><td colspan="10" class="table-empty">Loading…</td></tr>';

  try {
    let query = col('audits');

    // Plant filter
    const plantId = getActivePlantId();
    if (plantId)                      query = query.where('plantId', '==', plantId);
    else if (user.role !== ROLES.SUPER_ADMIN) query = query.where('plantId', '==', user.plantId);

    // Auditors see only their own audits
    if (user.role === ROLES.AUDITOR) query = query.where('auditorId', '==', user.uid);

    // Status filter
    const statusF = document.getElementById('auditStatusFilter')?.value;
    if (statusF) query = query.where('status', '==', statusF);

    // Dept filter
    const deptF = document.getElementById('auditDeptFilter')?.value;
    if (deptF) query = query.where('departmentId', '==', deptF);

    // Level filter
    const levelF = document.getElementById('auditLevelFilter')?.value;
    if (levelF) query = query.where('levelId', '==', levelF);

    // Date range
    const dateFrom = document.getElementById('auditDateFrom')?.value;
    const dateTo   = document.getElementById('auditDateTo')?.value;
    if (dateFrom) query = query.where('plannedDate', '>=', dateFrom);
    if (dateTo)   query = query.where('plannedDate', '<=', dateTo);

    query = query.orderBy('plannedDate', 'desc').limit(PAGE_SIZE);

    const snap   = await query.get();
    const audits = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    countEl.textContent = `${audits.length} audit${audits.length !== 1 ? 's' : ''}`;

    if (audits.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" class="table-empty">No audits found matching the selected filters.</td></tr>';
      return;
    }

    tbody.innerHTML = audits.map(a => {
      const actions = buildAuditActions(a, user);
      return `
        <tr data-record-id="${a.id}">
          <td><span class="text-sm" style="font-family:var(--font-mono)">${escapeHtml(a.id)}</span></td>
          <td>${escapeHtml(a.plantName || '—')}</td>
          <td>${escapeHtml(a.departmentName || '—')}</td>
          <td>${escapeHtml(a.processName || '—')}</td>
          <td><span class="badge badge-assigned">L${a.levelNumber || '?'}</span></td>
          <td>${escapeHtml(a.auditorName || '—')}</td>
          <td>${escapeHtml(a.plannedDate || '—')}</td>
          <td>${getScoreBadge(a.score)}</td>
          <td>${getAuditStatusBadge(a.status)}</td>
          <td><div class="action-btns">${actions}</div></td>
        </tr>
      `;
    }).join('');

  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="10" class="table-empty">${friendlyFirebaseError(e)}</td></tr>`;
    console.error('[Audits] Load error:', e);
  }
}

function buildAuditActions(audit, user) {
  const btns = [];

  // View/Start execution
  if (['Assigned', 'In Progress'].includes(audit.status) &&
      (user.role !== ROLES.AUDITOR || audit.auditorId === user.uid)) {
    btns.push(`<button class="btn btn-primary btn-sm" onclick="openAuditExecution('${audit.id}')">Execute</button>`);
  } else if (['Submitted','Under Review','Action Required','Verified','Closed'].includes(audit.status)) {
    btns.push(`<button class="btn btn-secondary btn-sm" onclick="viewAuditReport('${audit.id}')">View</button>`);
  } else if (audit.status === 'Planned' && user.role !== ROLES.AUDITOR) {
    btns.push(`<button class="btn btn-secondary btn-sm" onclick="assignAudit('${audit.id}')">Assign</button>`);
  }

  // Reopen (plant admin / super admin)
  if (['Submitted','Verified','Closed'].includes(audit.status) && can('reopen_audit')) {
    btns.push(`<button class="btn btn-ghost btn-sm" onclick="reopenAudit('${audit.id}')">Reopen</button>`);
  }

  // Print
  btns.push(`<button class="btn btn-ghost btn-sm" title="Print" onclick="printAuditReport('${audit.id}')">🖨</button>`);

  return btns.join('');
}

function clearAuditFilters() {
  ['auditStatusFilter','auditDeptFilter','auditLevelFilter','auditDateFrom','auditDateTo']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  loadAudits();
}

/* ── Create Audit — opens bulk planning table ────────────── */
async function openCreateAuditModal(auditId) {
  // For edits, use the original single-audit modal
  if (auditId) {
    _openSingleAuditModal(auditId);
    return;
  }
  // For new audits, open the full-screen bulk planning table
  if (typeof openAuditBulkModal === 'function') {
    await openAuditBulkModal();
  }
}

async function _openSingleAuditModal(auditId) {
  if (!can('create_audit') && !can('execute_audit')) {
    showToast('You do not have permission to create audits.', 'error');
    return;
  }

  const title = document.getElementById('auditModalTitle');
  title.textContent = auditId ? 'Edit Audit' : 'New Audit';

  document.getElementById('auditModalError').classList.add('hidden');
  document.getElementById('btnSaveAudit').textContent = auditId ? 'Save Changes' : 'Create Audit';
  document.getElementById('btnSaveAudit').dataset.editId = auditId || '';

  const plantSel = document.getElementById('auditPlant');
  await populatePlantOptions(plantSel, false);

  const levelSel = document.getElementById('auditLevel');
  await populateLevelOptions(levelSel, false);

  if (window.currentUser.role !== ROLES.SUPER_ADMIN) {
    plantSel.value = window.currentUser.plantId;
    plantSel.disabled = true;
    await onAuditPlantChange(window.currentUser.plantId);
  } else {
    plantSel.disabled = false;
  }

  const auditorSel = document.getElementById('auditAuditor');
  const plantId = plantSel.value;
  if (plantId) await populateUserOptions(auditorSel, plantId, ROLES.AUDITOR);

  document.getElementById('auditPlannedDate').value = todayISO();
  openModal('auditModal');
}

async function onAuditPlantChange(plantId) {
  if (!plantId) return;
  await populateDeptOptions(document.getElementById('auditDept'), plantId, false);
  await populateUserOptions(document.getElementById('auditAuditor'), plantId, ROLES.AUDITOR);
  document.getElementById('auditProcess').innerHTML = '<option value="">Select Department first</option>';
}

async function onAuditDeptChange(deptId) {
  await populateProcessOptions(document.getElementById('auditProcess'), deptId, false);
}

async function onAuditLevelChange(levelId) {
  if (!levelId) return;
  try {
    // Count questions for this level
    const snap = await col('questionMasters').where('levelId', '==', levelId).where('status', '==', 'active').get();
    const preview = document.getElementById('auditQuestionPreview');
    const qcount  = document.getElementById('auditQCount');
    qcount.textContent = snap.size;
    preview.classList.remove('hidden');
  } catch (e) { /* non-critical */ }
}

async function saveAudit() {
  const btn      = document.getElementById('btnSaveAudit');
  const errorDiv = document.getElementById('auditModalError');
  errorDiv.classList.add('hidden');

  const plantId  = document.getElementById('auditPlant').value;
  const deptId   = document.getElementById('auditDept').value;
  const processId= document.getElementById('auditProcess').value;
  const levelId  = document.getElementById('auditLevel').value;
  const auditorId= document.getElementById('auditAuditor').value;
  const date     = document.getElementById('auditPlannedDate').value;

  if (!plantId || !deptId || !processId || !levelId || !auditorId || !date) {
    errorDiv.textContent = 'Please fill in all required fields.';
    errorDiv.classList.remove('hidden');
    return;
  }

  if (!canAccessPlant(plantId)) {
    errorDiv.textContent = 'You are not authorized to create audits for this plant.';
    errorDiv.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    // Fetch plant, dept, process, level, auditor names for denormalized storage
    const [plantDoc, deptDoc, processDoc, levelDoc, auditorDoc] = await Promise.all([
      col('plants').doc(plantId).get(),
      col('departments').doc(deptId).get(),
      col('processes').doc(processId).get(),
      col('auditLevels').doc(levelId).get(),
      col('users').doc(auditorId).get()
    ]);

    const auditId = generateId('AUD');

    const auditData = {
      id:              auditId,
      plantId,
      plantName:       plantDoc.data()?.name || '',
      departmentId:    deptId,
      departmentName:  deptDoc.data()?.name || '',
      processId,
      processName:     processDoc.data()?.name || '',
      levelId,
      levelNumber:     levelDoc.data()?.levelNumber || '',
      levelName:       levelDoc.data()?.name || '',
      auditorId,
      auditorName:     auditorDoc.data()?.name || '',
      auditee:         document.getElementById('auditAuditee').value.trim(),
      plannedDate:     date,
      actualDate:      null,
      shift:           document.getElementById('auditShift').value,
      area:            document.getElementById('auditArea').value.trim(),
      notes:           document.getElementById('auditNotes').value.trim(),
      status:          'Assigned',
      score:           null,
      result:          null,
      submittedAt:     null,
      closedAt:        null,
      createdBy:       window.currentUser.uid,
      createdAt:       firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt:       firebase.firestore.FieldValue.serverTimestamp(),
      searchTokens:    buildSearchTokens(auditId, plantDoc.data()?.name, deptDoc.data()?.name, processDoc.data()?.name, auditorDoc.data()?.name)
    };

    await col('audits').doc(auditId).set(auditData);

    // Notify auditor
    await createNotification(
      auditorId,
      'audit_assigned',
      'New Audit Assigned',
      `You have been assigned an audit: ${processDoc.data()?.name} on ${date}`,
      'audit', auditId, plantId,
      `audit_assigned_${auditId}`
    );

    await logActivity('audit', `Audit created: ${auditId}`, auditId, null);

    closeModal('auditModal');
    showToast(`Audit ${auditId} created successfully`, 'success');
    await loadAudits();

  } catch (e) {
    errorDiv.textContent = friendlyFirebaseError(e);
    errorDiv.classList.remove('hidden');
    console.error('[Audits] Save error:', e);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Audit';
  }
}

/* ── Audit Execution ─────────────────────────────────────── */
async function openAuditExecution(auditId) {
  showLoading('Loading audit questions…');
  try {
    const auditDoc = await col('audits').doc(auditId).get();
    if (!auditDoc.exists) throw new UserFacingError('Audit not found.');

    const audit = { id: auditDoc.id, ...auditDoc.data() };

    // Security: ensure auditor can access this audit
    if (window.currentUser.role === ROLES.AUDITOR && audit.auditorId !== window.currentUser.uid) {
      throw new UserFacingError('You are not the assigned auditor for this audit.');
    }

    if (!canAccessPlant(audit.plantId)) {
      throw new UserFacingError('This audit is outside your authorized plant.');
    }

    // Load questions for this audit level
    const qSnap = await col('questionMasters')
      .where('levelId', '==', audit.levelId)
      .where('plantId', '==', audit.plantId)
      .where('status', '==', 'active')
      .orderBy('sortOrder')
      .get();

    if (qSnap.empty) {
      showToast('No active questions found for this audit level and plant.', 'warning');
      hideLoading();
      return;
    }

    const questions = qSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    currentAuditData = audit;
    auditResponses   = {};

    // Load any saved draft responses
    const draftSnap = await col('auditDrafts').doc(auditId).get();
    if (draftSnap.exists) auditResponses = draftSnap.data().responses || {};

    // Update audit status to In Progress
    if (audit.status === 'Assigned') {
      await col('audits').doc(auditId).update({
        status:     'In Progress',
        actualDate: todayISO(),
        updatedAt:  firebase.firestore.FieldValue.serverTimestamp()
      });
    }

    renderAuditExecution(audit, questions);
    navigate('audit-execute');
    document.getElementById('breadcrumbSub').classList.remove('hidden');
    document.getElementById('breadcrumbSubText').textContent = auditId;

  } catch (e) {
    showToast(e.userMessage || friendlyFirebaseError(e), 'error');
    console.error('[Audits] Execution open error:', e);
  } finally {
    hideLoading();
  }
}

function renderAuditExecution(audit, questions) {
  const container = document.getElementById('auditExecContent');
  if (!container) return;

  container.dataset.auditId = audit.id;
  container.dataset.questions = JSON.stringify(questions);

  const completed = questions.filter(q => auditResponses[q.id]?.response).length;
  const pct       = Math.round((completed / questions.length) * 100);

  container.innerHTML = `
    <!-- Audit Header -->
    <div class="audit-exec-header">
      <div class="exec-meta-item">
        <div class="exec-meta-label">Plant</div>
        <div class="exec-meta-value">${escapeHtml(audit.plantName)}</div>
      </div>
      <div class="exec-meta-item">
        <div class="exec-meta-label">Department</div>
        <div class="exec-meta-value">${escapeHtml(audit.departmentName)}</div>
      </div>
      <div class="exec-meta-item">
        <div class="exec-meta-label">Process</div>
        <div class="exec-meta-value">${escapeHtml(audit.processName)}</div>
      </div>
      <div class="exec-meta-item">
        <div class="exec-meta-label">Audit Level</div>
        <div class="exec-meta-value">Level ${audit.levelNumber} — ${escapeHtml(audit.levelName)}</div>
      </div>
      <div class="exec-meta-item">
        <div class="exec-meta-label">Auditor</div>
        <div class="exec-meta-value">${escapeHtml(audit.auditorName)}</div>
      </div>
      <div class="exec-meta-item">
        <div class="exec-meta-label">Date</div>
        <div class="exec-meta-value">${audit.actualDate || audit.plannedDate}</div>
      </div>
      <div class="exec-meta-item">
        <div class="exec-meta-label">Shift</div>
        <div class="exec-meta-value">${audit.shift || 'General'}</div>
      </div>
      <div class="exec-meta-item">
        <div class="exec-meta-label">Audit ID</div>
        <div class="exec-meta-value" style="font-family:var(--font-mono);font-size:12px">${audit.id}</div>
      </div>
    </div>

    <!-- Progress -->
    <div class="card" style="padding:16px 20px;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span class="fw-600" id="execProgressLabel">${completed} / ${questions.length} Questions Completed</span>
        <span class="fw-600" style="color:var(--color-primary)">${pct}%</span>
      </div>
      <div class="audit-progress-bar">
        <div class="audit-progress-fill" id="execProgressFill" style="width:${pct}%"></div>
      </div>
    </div>

    <!-- Questions -->
    <div id="questionsContainer">
      ${questions.map((q, idx) => renderQuestion(q, idx)).join('')}
    </div>
  `;
}

function renderQuestion(q, idx) {
  const saved    = auditResponses[q.id] || {};
  const response = saved.response || '';

  const typeOptions = {
    'Yes/No':      ['Yes', 'No'],
    'Pass/Fail':   ['Pass', 'Fail'],
    'Yes/No/NA':   ['Yes', 'No', 'NA'],
  };

  let responseHtml = '';
  if (['Yes/No', 'Pass/Fail', 'Yes/No/NA'].includes(q.questionType)) {
    const opts = typeOptions[q.questionType];
    responseHtml = `
      <div class="question-response">
        ${opts.map(opt => {
          const isPass = ['Yes','Pass'].includes(opt);
          const isNA   = opt === 'NA';
          const cls    = response === opt ? (isNA ? 'selected-na' : isPass ? 'selected-pass' : 'selected-fail') : '';
          return `<button class="response-btn ${cls}" onclick="setResponse('${q.id}','${opt}',this)">${opt}</button>`;
        }).join('')}
      </div>
    `;
  } else if (q.questionType === 'Numeric') {
    responseHtml = `
      <div class="question-response">
        <input type="number" class="form-input" style="max-width:160px" value="${saved.response || ''}"
          onchange="setNumericResponse('${q.id}',this.value)"
          placeholder="Enter value" />
      </div>
    `;
  } else {
    responseHtml = `
      <div class="question-response">
        <textarea class="form-textarea" style="flex:1" rows="2"
          onchange="setTextResponse('${q.id}',this.value)"
          placeholder="Enter response">${escapeHtml(saved.response || '')}</textarea>
      </div>
    `;
  }

  const isFail     = isFailing(q, response);
  const critClass  = q.criticality === 'Critical' ? 'question-crit' : '';
  const stateClass = !response ? '' : isFail ? 'question-fail' : response === 'NA' ? 'question-na' : 'question-pass';

  return `
    <div class="question-card ${stateClass} ${critClass}" id="qcard-${q.id}">
      <div class="question-header">
        <div>
          <div class="question-num">Q${idx + 1} · ${escapeHtml(q.category || '')} · ${getCriticalityBadge(q.criticality)}</div>
          <div class="question-text">${escapeHtml(q.question)}</div>
          ${q.requirement ? `<div class="question-req">Requirement: ${escapeHtml(q.requirement)}</div>` : ''}
          ${q.referenceStandard ? `<div class="question-req">Reference: ${escapeHtml(q.referenceStandard)}</div>` : ''}
        </div>
      </div>

      ${responseHtml}

      <!-- Comment -->
      <div style="margin-top:10px">
        <textarea class="form-textarea" rows="1" placeholder="Comment (optional)"
          onchange="setComment('${q.id}',this.value)"
          style="font-size:12px">${escapeHtml(saved.comment || '')}</textarea>
      </div>

      <!-- Non-conformity form (shown when failing) -->
      <div id="ncform-${q.id}" class="${isFail ? '' : 'hidden'}">
        <div class="finding-form">
          <div class="finding-form-title">
            ⚠ Non-Conformity / Action Required
          </div>
          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label required">Finding Description</label>
              <textarea class="form-textarea" rows="2" id="findDesc-${q.id}"
                onchange="setFindingField('${q.id}','findingDesc',this.value)"
                placeholder="Describe the non-conformity">${escapeHtml(saved.findingDesc || '')}</textarea>
            </div>
            <div class="form-group">
              <label class="form-label required">Immediate Containment</label>
              <textarea class="form-textarea" rows="2" id="containment-${q.id}"
                onchange="setFindingField('${q.id}','containment',this.value)"
                placeholder="Immediate action taken">${escapeHtml(saved.containment || '')}</textarea>
            </div>
            <div class="form-group">
              <label class="form-label required">Responsible Person</label>
              <input type="text" class="form-input" id="responsible-${q.id}"
                value="${escapeHtml(saved.responsible || '')}"
                onchange="setFindingField('${q.id}','responsible',this.value)"
                placeholder="Name" />
            </div>
            <div class="form-group">
              <label class="form-label required">Target Date</label>
              <input type="date" class="form-input" id="targetDate-${q.id}"
                value="${saved.targetDate || ''}"
                onchange="setFindingField('${q.id}','targetDate',this.value)" />
            </div>
          </div>
          ${q.criticality === 'Critical' ? `<div class="alert alert-warning" style="margin-top:8px">⚡ Critical question — photo evidence is mandatory before submission.</div>` : ''}
        </div>
      </div>
    </div>
  `;
}

function isFailing(q, response) {
  if (!response) return false;
  const failMap = { 'Yes/No': 'No', 'Pass/Fail': 'Fail', 'Yes/No/NA': 'No' };
  return response === failMap[q.questionType];
}

function setResponse(questionId, response, btnEl) {
  if (!auditResponses[questionId]) auditResponses[questionId] = {};
  auditResponses[questionId].response = response;

  // Update button styles
  const card = document.getElementById(`qcard-${questionId}`);
  if (!card) return;

  card.querySelectorAll('.response-btn').forEach(b => {
    b.className = 'response-btn';
  });

  const isPass = ['Yes','Pass'].includes(response);
  const isNA   = response === 'NA';
  btnEl.classList.add(isNA ? 'selected-na' : isPass ? 'selected-pass' : 'selected-fail');

  // Toggle card state
  card.classList.remove('question-pass','question-fail','question-na');
  card.classList.add(isNA ? 'question-na' : isPass ? 'question-pass' : 'question-fail');

  // Show/hide NC form
  const ncForm = document.getElementById(`ncform-${questionId}`);
  if (ncForm) {
    if (!isPass && !isNA) ncForm.classList.remove('hidden');
    else ncForm.classList.add('hidden');
  }

  updateExecProgress();
}

function setNumericResponse(questionId, value) {
  if (!auditResponses[questionId]) auditResponses[questionId] = {};
  auditResponses[questionId].response = value;
  updateExecProgress();
}

function setTextResponse(questionId, value) {
  if (!auditResponses[questionId]) auditResponses[questionId] = {};
  auditResponses[questionId].response = value;
  updateExecProgress();
}

function setComment(questionId, value) {
  if (!auditResponses[questionId]) auditResponses[questionId] = {};
  auditResponses[questionId].comment = value;
}

function setFindingField(questionId, field, value) {
  if (!auditResponses[questionId]) auditResponses[questionId] = {};
  auditResponses[questionId][field] = value;
}

function updateExecProgress() {
  const container = document.getElementById('questionsContainer');
  if (!container) return;
  const questions = JSON.parse(document.getElementById('auditExecContent')?.dataset?.questions || '[]');
  const completed = questions.filter(q => auditResponses[q.id]?.response).length;
  const pct       = Math.round((completed / Math.max(questions.length, 1)) * 100);

  const label = document.getElementById('execProgressLabel');
  const fill  = document.getElementById('execProgressFill');
  if (label) label.textContent = `${completed} / ${questions.length} Questions Completed`;
  if (fill)  fill.style.width  = pct + '%';
}

async function saveAuditDraft() {
  const auditId = document.getElementById('auditExecContent')?.dataset?.auditId;
  if (!auditId) return;
  try {
    await col('auditDrafts').doc(auditId).set({
      auditId,
      responses: auditResponses,
      savedAt:   firebase.firestore.FieldValue.serverTimestamp(),
      savedBy:   window.currentUser.uid
    });
    showToast('Draft saved', 'success', 2000);
  } catch (e) {
    showToast(friendlyFirebaseError(e), 'error');
  }
}

async function submitAudit() {
  const auditId   = document.getElementById('auditExecContent')?.dataset?.auditId;
  const questions = JSON.parse(document.getElementById('auditExecContent')?.dataset?.questions || '[]');
  if (!auditId || !currentAuditData) return;

  // Validate all questions have responses
  const unanswered = questions.filter(q => !auditResponses[q.id]?.response);
  if (unanswered.length > 0) {
    const result = await confirmAction({
      title:       'Unanswered Questions',
      message:     `${unanswered.length} question(s) have not been answered. Submit anyway?`,
      confirmText: 'Submit Anyway'
    });
    if (!result.confirmed) return;
  }

  // Validate NC forms for failed questions
  for (const q of questions) {
    const resp = auditResponses[q.id];
    if (!resp) continue;
    if (isFailing(q, resp.response)) {
      if (!resp.findingDesc || !resp.responsible || !resp.targetDate) {
        showToast(`Question "${q.question.substring(0,40)}…" is failing but has incomplete non-conformity details.`, 'error');
        document.getElementById(`ncform-${q.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }
  }

  showLoading('Submitting audit…');

  try {
    // ── Calculate Score ────────────────────────────────────
    const applicableQs = questions.filter(q => auditResponses[q.id]?.response && auditResponses[q.id]?.response !== 'NA');
    const passedQs     = applicableQs.filter(q => {
      const r = auditResponses[q.id]?.response;
      return ['Yes','Pass'].includes(r);
    });

    const score    = applicableQs.length > 0 ? (passedQs.length / applicableQs.length) * 100 : 0;
    const roundedScore = parseFloat(score.toFixed(2));

    // Critical failure check
    const critFailed = questions.some(q => q.criticality === 'Critical' && isFailing(q, auditResponses[q.id]?.response));

    let result;
    if (critFailed)        result = 'RED/CRITICAL';
    else if (score >= 95)  result = 'GREEN';
    else if (score >= 90)  result = 'YELLOW';
    else                   result = 'RED';

    const batch = db.batch();

    // ── Update Audit Document ──────────────────────────────
    const auditRef = col('audits').doc(auditId);
    batch.update(auditRef, {
      status:      'Submitted',
      score:       roundedScore,
      result,
      actualDate:  todayISO(),
      submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
      submittedBy: window.currentUser.uid,
      updatedAt:   firebase.firestore.FieldValue.serverTimestamp(),
      responses:   auditResponses
    });

    // ── Create Findings and Actions for Failed Questions ───
    const failedQs = questions.filter(q => isFailing(q, auditResponses[q.id]?.response));

    for (const q of failedQs) {
      const resp     = auditResponses[q.id];
      const findId   = generateId('FIND');
      const actionId = generateId('ACT');

      const findingData = {
        id:              findId,
        auditId,
        plantId:         currentAuditData.plantId,
        plantName:       currentAuditData.plantName,
        departmentId:    currentAuditData.departmentId,
        departmentName:  currentAuditData.departmentName,
        processId:       currentAuditData.processId,
        processName:     currentAuditData.processName,
        questionId:      q.id,
        questionText:    q.question,
        criticality:     q.criticality,
        description:     resp.findingDesc || '',
        containment:     resp.containment || '',
        responsible:     resp.responsible || '',
        targetDate:      resp.targetDate || '',
        comment:         resp.comment || '',
        status:          'Open',
        actionId,
        createdBy:       window.currentUser.uid,
        createdAt:       firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt:       firebase.firestore.FieldValue.serverTimestamp(),
        searchTokens:    buildSearchTokens(findId, currentAuditData.plantName, currentAuditData.departmentName, resp.findingDesc)
      };

      const actionData = {
        id:              actionId,
        findingId:       findId,
        auditId,
        plantId:         currentAuditData.plantId,
        plantName:       currentAuditData.plantName,
        departmentId:    currentAuditData.departmentId,
        processId:       currentAuditData.processId,
        processName:     currentAuditData.processName,
        description:     resp.findingDesc || '',
        responsible:     resp.responsible || '',
        targetDate:      resp.targetDate || '',
        priority:        q.criticality === 'Critical' ? 'Critical' : q.criticality === 'Major' ? 'High' : 'Medium',
        status:          'Open',
        rootCause:       '',
        correctiveAction:'',
        preventiveAction:'',
        evidence:        [],
        returnReason:    '',
        verifiedBy:      null,
        verificationDate:null,
        closedAt:        null,
        createdBy:       window.currentUser.uid,
        createdAt:       firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt:       firebase.firestore.FieldValue.serverTimestamp(),
        searchTokens:    buildSearchTokens(actionId, currentAuditData.plantName, resp.findingDesc, resp.responsible)
      };

      batch.set(col('findings').doc(findId), findingData);
      batch.set(col('correctiveActions').doc(actionId), actionData);
    }

    await batch.commit();

    // Update audit status based on whether there are findings
    const newStatus = failedQs.length > 0 ? 'Action Required' : 'Verified';
    await col('audits').doc(auditId).update({ status: newStatus, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });

    // Clean up draft
    col('auditDrafts').doc(auditId).delete().catch(() => {});

    await logActivity('audit', `Audit submitted: ${auditId}. Score: ${roundedScore}%. Findings: ${failedQs.length}`, auditId, null);

    hideLoading();
    showToast(`Audit submitted. Score: ${roundedScore}%. ${failedQs.length} finding(s) created.`, 'success', 6000);
    navigate('audits');

  } catch (e) {
    hideLoading();
    showToast(e.userMessage || friendlyFirebaseError(e), 'error');
    console.error('[Audits] Submit error:', e);
  }
}

/* ── Reopen Audit ────────────────────────────────────────── */
async function reopenAudit(auditId) {
  requirePermission('reopen_audit');

  const result = await confirmAction({
    title:         'Reopen Audit',
    message:       `Reopen audit ${auditId}? This will allow the auditor to modify responses. All changes will be logged.`,
    requireReason: true,
    reasonLabel:   'Reason for reopening',
    confirmText:   'Reopen Audit',
    dangerStyle:   true
  });

  if (!result.confirmed) return;

  try {
    await col('audits').doc(auditId).update({
      status:       'In Progress',
      reopenedAt:   firebase.firestore.FieldValue.serverTimestamp(),
      reopenedBy:   window.currentUser.uid,
      reopenReason: result.reason,
      updatedAt:    firebase.firestore.FieldValue.serverTimestamp()
    });
    await logActivity('audit', `Audit reopened: ${auditId}. Reason: ${result.reason}`, auditId, null);
    showToast('Audit reopened successfully', 'success');
    await loadAudits();
  } catch (e) {
    showToast(friendlyFirebaseError(e), 'error');
  }
}

/* ── Assign Audit ────────────────────────────────────────── */
async function assignAudit(auditId) {
  showToast('Audit is already assigned. Use Execute to start it.', 'info');
}

/* ── View Audit Report ───────────────────────────────────── */
async function viewAuditReport(auditId) {
  navigate('audits');
  setTimeout(() => {
    showToast(`Audit ${auditId} — use the print button for the full report.`, 'info');
  }, 200);
}

async function printAuditReport(auditId) {
  showLoading('Generating report…');
  try {
    const auditDoc = await col('audits').doc(auditId).get();
    if (!auditDoc.exists) { showToast('Audit not found.', 'error'); return; }
    const audit = auditDoc.data();

    if (!canAccessPlant(audit.plantId)) {
      showToast('You do not have permission to view this audit.', 'error');
      return;
    }

    const findSnap = await col('findings').where('auditId', '==', auditId).get();
    const findings = findSnap.docs.map(d => d.data());

    const html = buildPrintReport(audit, findings);
    const win  = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
    win.print();
  } catch (e) {
    showToast(friendlyFirebaseError(e), 'error');
  } finally {
    hideLoading();
  }
}

function buildPrintReport(audit, findings) {
  const scoreColor = audit.score >= 95 ? '#059669' : audit.score >= 90 ? '#d97706' : '#dc2626';
  return `
<!DOCTYPE html><html><head>
<meta charset="UTF-8">
<title>Audit Report — ${audit.id}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 12px; color: #111; margin: 0; }
  .header { border-bottom: 3px solid #0f1f3d; padding: 20px; display: flex; justify-content: space-between; }
  .logo-area h1 { font-size: 18px; color: #0f1f3d; margin: 0; }
  .logo-area p { color: #666; margin: 2px 0 0; font-size: 11px; }
  .score-box { text-align: center; background: ${scoreColor}; color: white; padding: 12px 20px; border-radius: 8px; }
  .score-box .num { font-size: 28px; font-weight: 700; }
  .score-box .lbl { font-size: 11px; }
  .meta-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 12px; padding: 16px 20px; background: #f8f9fc; border-bottom: 1px solid #eee; }
  .meta-item label { font-size: 10px; text-transform: uppercase; color: #666; font-weight: 600; display: block; }
  .meta-item span { font-size: 13px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin: 16px 20px; width: calc(100% - 40px); }
  th { background: #0f1f3d; color: white; padding: 8px; text-align: left; font-size: 11px; }
  td { padding: 7px 8px; border-bottom: 1px solid #eee; font-size: 11px; }
  .finding-section { padding: 16px 20px; }
  h3 { color: #0f1f3d; font-size: 14px; margin: 0 0 10px; }
  .sig-row { display: flex; gap: 40px; padding: 20px; border-top: 1px solid #eee; margin-top: 20px; }
  .sig-box { flex: 1; border-top: 1px solid #333; padding-top: 8px; font-size: 11px; }
  @media print { body { margin: 0; } }
</style>
</head><body>
<div class="header">
  <div class="logo-area">
    <h1>🏭 LPA Audit Report</h1>
    <p>Layered Process Audit Management System</p>
    <p style="margin-top:8px;font-weight:600">Audit ID: ${audit.id}</p>
  </div>
  <div class="score-box">
    <div class="num">${audit.score?.toFixed(1) ?? '—'}%</div>
    <div class="lbl">Score</div>
    <div style="font-size:13px;font-weight:700;margin-top:4px">${audit.result || '—'}</div>
  </div>
</div>
<div class="meta-grid">
  <div class="meta-item"><label>Plant</label><span>${audit.plantName}</span></div>
  <div class="meta-item"><label>Department</label><span>${audit.departmentName}</span></div>
  <div class="meta-item"><label>Process</label><span>${audit.processName}</span></div>
  <div class="meta-item"><label>Audit Level</label><span>Level ${audit.levelNumber} — ${audit.levelName}</span></div>
  <div class="meta-item"><label>Auditor</label><span>${audit.auditorName}</span></div>
  <div class="meta-item"><label>Auditee</label><span>${audit.auditee || '—'}</span></div>
  <div class="meta-item"><label>Planned Date</label><span>${audit.plannedDate}</span></div>
  <div class="meta-item"><label>Actual Date</label><span>${audit.actualDate || '—'}</span></div>
  <div class="meta-item"><label>Status</label><span>${audit.status}</span></div>
</div>

${findings.length > 0 ? `
<div class="finding-section">
  <h3>Findings (${findings.length})</h3>
  <table>
    <tr>
      <th>Finding ID</th><th>Question</th><th>Criticality</th>
      <th>Description</th><th>Responsible</th><th>Target Date</th><th>Status</th>
    </tr>
    ${findings.map(f => `
      <tr>
        <td>${f.id}</td>
        <td>${f.questionText?.substring(0,60) || ''}…</td>
        <td>${f.criticality}</td>
        <td>${f.description?.substring(0,80) || ''}…</td>
        <td>${f.responsible}</td>
        <td>${f.targetDate}</td>
        <td>${f.status}</td>
      </tr>
    `).join('')}
  </table>
</div>
` : '<p style="padding:16px 20px;color:#666">No findings recorded for this audit.</p>'}

<div class="sig-row">
  <div class="sig-box">Auditor Signature<br><br>${audit.auditorName}</div>
  <div class="sig-box">Auditee Signature<br><br>${audit.auditee || '—'}</div>
  <div class="sig-box">Approved By<br><br>&nbsp;</div>
</div>
<p style="padding:8px 20px;color:#999;font-size:10px">Generated: ${new Date().toLocaleString('en-IN')} | LPA Management System</p>
</body></html>`;
}
