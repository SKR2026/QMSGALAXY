/**
 * masterdata.js
 * Master data management: plants, departments, processes,
 * audit levels, LPA questions, and categories.
 */

let masterTab = 'plants';

async function initMasterData() {
  requirePermission('manage_master_data');
  await switchMasterTab('plants');

  // Populate audit level / dept filter dropdowns for questions
  await populateLevelOptions(document.getElementById('qLevelFilter'), true);
}

async function switchMasterTab(tab, btnEl) {
  masterTab = tab;

  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
  else {
    const btn = document.querySelector(`[onclick="switchMasterTab('${tab}',this)"]`);
    if (btn) btn.classList.add('active');
  }

  switch (tab) {
    case 'plants':      await renderPlantsTab();      break;
    case 'departments': await renderDepartmentsTab(); break;
    case 'processes':   await renderProcessesTab();   break;
    case 'auditLevels': await renderAuditLevelsTab(); break;
    case 'questions':   await renderQuestionsTab();   break;
    case 'categories':  await renderCategoriesTab();  break;
  }
}

/* ══════════════════════════════════════════════════════════
   PLANTS
══════════════════════════════════════════════════════════ */
async function renderPlantsTab() {
  if (window.currentUser.role !== ROLES.SUPER_ADMIN) {
    setMasterContent('<div class="alert alert-warning">Only Super Admin can manage plants.</div>');
    return;
  }

  const snap = await col('plants').orderBy('name').get();
  const rows = snap.docs.map(d => {
    const p = d.data();
    return `
      <tr>
        <td class="fw-600">${escapeHtml(p.name)}</td>
        <td>${escapeHtml(p.code || '—')}</td>
        <td>${escapeHtml(p.location || '—')}</td>
        <td>${escapeHtml(p.manager || '—')}</td>
        <td>${p.status === 'active'
              ? '<span class="badge badge-verified">Active</span>'
              : '<span class="badge badge-cancelled">Inactive</span>'}</td>
        <td>
          <div class="action-btns">
            <button class="btn btn-secondary btn-sm" onclick="openPlantModal('${d.id}')">Edit</button>
            ${p.status === 'active'
              ? `<button class="btn btn-ghost btn-sm" onclick="togglePlantStatus('${d.id}','inactive')">Deactivate</button>`
              : `<button class="btn btn-success btn-sm" onclick="togglePlantStatus('${d.id}','active')">Activate</button>`}
          </div>
        </td>
      </tr>
    `;
  });

  setMasterContent(`
    <div class="master-table-header">
      <h3 class="card-title">Plants (${snap.size})</h3>
      <button class="btn btn-primary btn-sm" onclick="openPlantModal()">+ Add Plant</button>
    </div>
    <div class="table-wrapper">
      <table class="data-table">
        <thead><tr><th>Name</th><th>Code</th><th>Location</th><th>Manager</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${rows.length ? rows.join('') : '<tr><td colspan="6" class="table-empty">No plants configured yet.</td></tr>'}</tbody>
      </table>
    </div>
  `);
}

async function openPlantModal(plantId) {
  let plant = null;
  if (plantId) {
    const doc = await col('plants').doc(plantId).get();
    plant = doc.data();
  }

  showInlineForm('plantForm', `
    <h4 style="margin-bottom:16px">${plant ? 'Edit Plant' : 'Add Plant'}</h4>
    <div class="form-grid-2">
      <div class="form-group"><label class="form-label required">Plant Name</label>
        <input type="text" id="pName" class="form-input" value="${escapeHtml(plant?.name || '')}" /></div>
      <div class="form-group"><label class="form-label">Code</label>
        <input type="text" id="pCode" class="form-input" value="${escapeHtml(plant?.code || '')}" /></div>
      <div class="form-group"><label class="form-label">Location</label>
        <input type="text" id="pLocation" class="form-input" value="${escapeHtml(plant?.location || '')}" /></div>
      <div class="form-group"><label class="form-label">Plant Manager</label>
        <input type="text" id="pManager" class="form-input" value="${escapeHtml(plant?.manager || '')}" /></div>
      <div class="form-group form-span-2"><label class="form-label">Description</label>
        <textarea id="pDesc" class="form-textarea" rows="2">${escapeHtml(plant?.description || '')}</textarea></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn btn-primary" onclick="savePlant('${plantId || ''}')">Save Plant</button>
      <button class="btn btn-secondary" onclick="renderPlantsTab()">Cancel</button>
    </div>
  `);
}

async function savePlant(plantId) {
  const name     = document.getElementById('pName')?.value.trim();
  const code     = document.getElementById('pCode')?.value.trim();
  const location = document.getElementById('pLocation')?.value.trim();
  const manager  = document.getElementById('pManager')?.value.trim();
  const desc     = document.getElementById('pDesc')?.value.trim();

  if (!name) { showToast('Plant name is required.', 'error'); return; }

  const data = {
    name, code, location, manager, description: desc,
    status:    'active',
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: window.currentUser.uid
  };

  try {
    if (plantId) {
      await col('plants').doc(plantId).update(data);
      await logActivity('system', `Plant updated: ${name}`, plantId, null);
      showToast('Plant updated', 'success');
    } else {
      const newId = generateId('PLT');
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      data.createdBy = window.currentUser.uid;
      await col('plants').doc(newId).set(data);
      await logActivity('system', `Plant created: ${name}`, newId, null);
      showToast('Plant created', 'success');
      await populatePlantSelector();
    }
    await renderPlantsTab();
  } catch (e) {
    showToast(friendlyFirebaseError(e), 'error');
  }
}

async function togglePlantStatus(plantId, status) {
  const verb = status === 'active' ? 'activate' : 'deactivate';
  const result = await confirmAction({
    title:    `${verb.charAt(0).toUpperCase() + verb.slice(1)} Plant`,
    message:  `Are you sure you want to ${verb} this plant?`,
    confirmText: verb.charAt(0).toUpperCase() + verb.slice(1),
    dangerStyle: status === 'inactive'
  });
  if (!result.confirmed) return;
  await col('plants').doc(plantId).update({ status, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
  showToast(`Plant ${verb}d`, 'success');
  await renderPlantsTab();
}

/* ══════════════════════════════════════════════════════════
   DEPARTMENTS
══════════════════════════════════════════════════════════ */
async function renderDepartmentsTab() {
  const plantId = getActivePlantId() || window.currentUser.plantId;
  const snap    = plantId
    ? await col('departments').where('plantId', '==', plantId).orderBy('name').get()
    : await col('departments').orderBy('name').limit(200).get();

  const rows = snap.docs.map(d => {
    const dept = d.data();
    return `
      <tr>
        <td class="fw-600">${escapeHtml(dept.name)}</td>
        <td>${escapeHtml(dept.plantName || '—')}</td>
        <td>${escapeHtml(dept.head || '—')}</td>
        <td>${dept.status === 'active' ? '<span class="badge badge-verified">Active</span>' : '<span class="badge badge-cancelled">Inactive</span>'}</td>
        <td><div class="action-btns">
          <button class="btn btn-secondary btn-sm" onclick="openDeptModal('${d.id}')">Edit</button>
          <button class="btn btn-ghost btn-sm" onclick="toggleStatus('departments','${d.id}','${dept.status === 'active' ? 'inactive' : 'active'}')">
            ${dept.status === 'active' ? 'Deactivate' : 'Activate'}
          </button>
        </div></td>
      </tr>
    `;
  });

  setMasterContent(`
    <div class="master-table-header">
      <h3 class="card-title">Departments (${snap.size})</h3>
      <button class="btn btn-primary btn-sm" onclick="openDeptModal()">+ Add Department</button>
    </div>
    <div class="table-wrapper">
      <table class="data-table">
        <thead><tr><th>Name</th><th>Plant</th><th>Head</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${rows.length ? rows.join('') : '<tr><td colspan="5" class="table-empty">No departments found.</td></tr>'}</tbody>
      </table>
    </div>
  `);
}

async function openDeptModal(deptId) {
  let dept = null;
  if (deptId) {
    const doc = await col('departments').doc(deptId).get();
    dept = doc.data();
  }

  let plantOpts = '';
  const plantSnap = await col('plants').where('status','==','active').orderBy('name').get();
  plantSnap.forEach(d => {
    const sel = dept?.plantId === d.id ? 'selected' : '';
    plantOpts += `<option value="${d.id}" ${sel}>${d.data().name}</option>`;
  });

  showInlineForm('deptForm', `
    <h4 style="margin-bottom:16px">${dept ? 'Edit Department' : 'Add Department'}</h4>
    <div class="form-grid-2">
      <div class="form-group"><label class="form-label required">Department Name</label>
        <input type="text" id="dName" class="form-input" value="${escapeHtml(dept?.name || '')}" /></div>
      <div class="form-group"><label class="form-label required">Plant</label>
        <select id="dPlant" class="form-select"><option value="">Select</option>${plantOpts}</select></div>
      <div class="form-group"><label class="form-label">Department Head</label>
        <input type="text" id="dHead" class="form-input" value="${escapeHtml(dept?.head || '')}" /></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn btn-primary" onclick="saveDept('${deptId || ''}')">Save</button>
      <button class="btn btn-secondary" onclick="renderDepartmentsTab()">Cancel</button>
    </div>
  `);
}

async function saveDept(deptId) {
  const name    = document.getElementById('dName')?.value.trim();
  const plantId = document.getElementById('dPlant')?.value;
  const head    = document.getElementById('dHead')?.value.trim();
  if (!name || !plantId) { showToast('Name and plant are required.', 'error'); return; }

  const plantDoc  = await col('plants').doc(plantId).get();
  const plantName = plantDoc.data()?.name || '';

  const data = { name, plantId, plantName, head, status: 'active', updatedAt: firebase.firestore.FieldValue.serverTimestamp() };

  try {
    if (deptId) {
      await col('departments').doc(deptId).update(data);
    } else {
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      await col('departments').add(data);
    }
    await logActivity('system', `Department ${deptId ? 'updated' : 'created'}: ${name}`, deptId || null, null);
    showToast('Department saved', 'success');
    await renderDepartmentsTab();
  } catch (e) {
    showToast(friendlyFirebaseError(e), 'error');
  }
}

/* ══════════════════════════════════════════════════════════
   PROCESSES
══════════════════════════════════════════════════════════ */
async function renderProcessesTab() {
  const plantId = getActivePlantId() || window.currentUser.plantId;
  const snap    = plantId
    ? await col('processes').where('plantId', '==', plantId).orderBy('name').get()
    : await col('processes').orderBy('name').limit(200).get();

  const rows = snap.docs.map(d => {
    const p = d.data();
    return `<tr>
      <td class="fw-600">${escapeHtml(p.name)}</td>
      <td>${escapeHtml(p.deptName || '—')}</td>
      <td>${escapeHtml(p.plantName || '—')}</td>
      <td>${p.status === 'active' ? '<span class="badge badge-verified">Active</span>' : '<span class="badge badge-cancelled">Inactive</span>'}</td>
      <td><button class="btn btn-secondary btn-sm" onclick="openProcessModal('${d.id}')">Edit</button></td>
    </tr>`;
  });

  setMasterContent(`
    <div class="master-table-header"><h3 class="card-title">Processes (${snap.size})</h3>
      <button class="btn btn-primary btn-sm" onclick="openProcessModal()">+ Add Process</button></div>
    <div class="table-wrapper"><table class="data-table">
      <thead><tr><th>Name</th><th>Department</th><th>Plant</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${rows.length ? rows.join('') : '<tr><td colspan="5" class="table-empty">No processes found.</td></tr>'}</tbody>
    </table></div>
  `);
}

async function openProcessModal(processId) {
  let proc = null;
  if (processId) { const doc = await col('processes').doc(processId).get(); proc = doc.data(); }

  let plantOpts = '';
  const plantSnap = await col('plants').where('status','==','active').orderBy('name').get();
  plantSnap.forEach(d => { plantOpts += `<option value="${d.id}" ${proc?.plantId===d.id?'selected':''}>${d.data().name}</option>`; });

  showInlineForm('procForm', `
    <h4 style="margin-bottom:16px">${proc ? 'Edit Process' : 'Add Process'}</h4>
    <div class="form-grid-2">
      <div class="form-group"><label class="form-label required">Process Name</label>
        <input type="text" id="prName" class="form-input" value="${escapeHtml(proc?.name||'')}" /></div>
      <div class="form-group"><label class="form-label required">Plant</label>
        <select id="prPlant" class="form-select" onchange="populateDeptOptions(document.getElementById('prDept'),this.value,false)">
          <option value="">Select</option>${plantOpts}</select></div>
      <div class="form-group"><label class="form-label">Department</label>
        <select id="prDept" class="form-select"><option value="">Select</option></select></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn btn-primary" onclick="saveProcess('${processId||''}')">Save</button>
      <button class="btn btn-secondary" onclick="renderProcessesTab()">Cancel</button>
    </div>
  `);
  if (proc?.plantId) {
    document.getElementById('prPlant').value = proc.plantId;
    await populateDeptOptions(document.getElementById('prDept'), proc.plantId, false);
    document.getElementById('prDept').value = proc.deptId || '';
  }
}

async function saveProcess(processId) {
  const name    = document.getElementById('prName')?.value.trim();
  const plantId = document.getElementById('prPlant')?.value;
  const deptId  = document.getElementById('prDept')?.value;
  if (!name || !plantId) { showToast('Name and plant required.', 'error'); return; }
  const plantDoc = await col('plants').doc(plantId).get();
  const deptDoc  = deptId ? await col('departments').doc(deptId).get() : null;
  const data = {
    name, plantId, plantName: plantDoc.data()?.name||'',
    deptId: deptId||null, deptName: deptDoc?.data()?.name||'',
    status: 'active', updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  try {
    if (processId) await col('processes').doc(processId).update(data);
    else { data.createdAt = firebase.firestore.FieldValue.serverTimestamp(); await col('processes').add(data); }
    showToast('Process saved', 'success');
    await renderProcessesTab();
  } catch (e) { showToast(friendlyFirebaseError(e), 'error'); }
}

/* ══════════════════════════════════════════════════════════
   AUDIT LEVELS
══════════════════════════════════════════════════════════ */
async function renderAuditLevelsTab() {
  const snap = await col('auditLevels').orderBy('levelNumber').get();
  const rows = snap.docs.map(d => {
    const l = d.data();
    return `<tr>
      <td>${l.levelNumber}</td><td class="fw-600">${escapeHtml(l.name)}</td>
      <td>${escapeHtml(l.responsibleRole||'—')}</td><td>${escapeHtml(l.frequency||'—')}</td>
      <td>${l.status==='active'?'<span class="badge badge-verified">Active</span>':'<span class="badge badge-cancelled">Inactive</span>'}</td>
      <td><button class="btn btn-secondary btn-sm" onclick="openLevelModal('${d.id}')">Edit</button></td>
    </tr>`;
  });

  setMasterContent(`
    <div class="master-table-header"><h3 class="card-title">Audit Levels (${snap.size})</h3>
      <button class="btn btn-primary btn-sm" onclick="openLevelModal()">+ Add Level</button></div>
    <div class="table-wrapper"><table class="data-table">
      <thead><tr><th>#</th><th>Name</th><th>Responsible Role</th><th>Frequency</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows.length?rows.join(''):'<tr><td colspan="6" class="table-empty">No audit levels configured.</td></tr>'}</tbody>
    </table></div>
  `);
}

async function openLevelModal(levelId) {
  let lv = null;
  if (levelId) { const doc = await col('auditLevels').doc(levelId).get(); lv = doc.data(); }
  showInlineForm('levelForm', `
    <h4 style="margin-bottom:16px">${lv ? 'Edit Audit Level' : 'Add Audit Level'}</h4>
    <div class="form-grid-2">
      <div class="form-group"><label class="form-label required">Level Number</label>
        <input type="number" id="lvNum" class="form-input" value="${lv?.levelNumber||''}" min="1" /></div>
      <div class="form-group"><label class="form-label required">Name</label>
        <input type="text" id="lvName" class="form-input" value="${escapeHtml(lv?.name||'')}" /></div>
      <div class="form-group"><label class="form-label">Responsible Role</label>
        <input type="text" id="lvRole" class="form-input" value="${escapeHtml(lv?.responsibleRole||'')}" placeholder="e.g. Supervisor" /></div>
      <div class="form-group"><label class="form-label">Frequency</label>
        <select id="lvFreq" class="form-select">
          <option ${lv?.frequency==='Daily'?'selected':''}>Daily</option>
          <option ${lv?.frequency==='Weekly'?'selected':''}>Weekly</option>
          <option ${lv?.frequency==='Monthly'?'selected':''}>Monthly</option>
          <option ${lv?.frequency==='Quarterly'?'selected':''}>Quarterly</option>
        </select></div>
      <div class="form-group form-span-2"><label class="form-label">Description</label>
        <textarea id="lvDesc" class="form-textarea" rows="2">${escapeHtml(lv?.description||'')}</textarea></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn btn-primary" onclick="saveLevel('${levelId||''}')">Save</button>
      <button class="btn btn-secondary" onclick="renderAuditLevelsTab()">Cancel</button>
    </div>
  `);
}

async function saveLevel(levelId) {
  const num  = parseInt(document.getElementById('lvNum')?.value);
  const name = document.getElementById('lvName')?.value.trim();
  if (!num || !name) { showToast('Level number and name are required.', 'error'); return; }
  const data = {
    levelNumber: num, name,
    responsibleRole: document.getElementById('lvRole')?.value.trim(),
    frequency: document.getElementById('lvFreq')?.value,
    description: document.getElementById('lvDesc')?.value.trim(),
    status: 'active', updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  try {
    if (levelId) await col('auditLevels').doc(levelId).update(data);
    else { data.createdAt = firebase.firestore.FieldValue.serverTimestamp(); await col('auditLevels').add(data); }
    showToast('Audit level saved', 'success');
    await renderAuditLevelsTab();
  } catch (e) { showToast(friendlyFirebaseError(e), 'error'); }
}

/* ══════════════════════════════════════════════════════════
   QUESTIONS
══════════════════════════════════════════════════════════ */
async function renderQuestionsTab() {
  setMasterContent(`
    <div class="master-table-header">
      <h3 class="card-title">Question Master</h3>
      <button class="btn btn-primary btn-sm" onclick="openQuestionModal()">+ Add Question</button>
    </div>
    <div class="filter-bar" style="padding:12px 20px 0">
      <select id="qPlantFilter" class="form-select-sm" onchange="loadQuestions()"></select>
      <select id="qLevelFilter" class="form-select-sm" onchange="loadQuestions()"><option value="">All Levels</option></select>
      <select id="qStatusFilter" class="form-select-sm" onchange="loadQuestions()">
        <option value="">All</option><option value="active">Active</option><option value="inactive">Inactive</option>
      </select>
    </div>
    <div class="table-wrapper" id="questionsTableWrapper">
      <div class="table-empty" style="padding:24px">Loading questions…</div>
    </div>
  `);

  await populatePlantOptions(document.getElementById('qPlantFilter'), true);
  await populateLevelOptions(document.getElementById('qLevelFilter'), true);
  await loadQuestions();
}

async function loadQuestions() {
  const wrapper  = document.getElementById('questionsTableWrapper');
  if (!wrapper) return;

  let query      = col('questionMasters');
  const plantId  = getActivePlantId() || document.getElementById('qPlantFilter')?.value;
  const levelId  = document.getElementById('qLevelFilter')?.value;
  const statusF  = document.getElementById('qStatusFilter')?.value;

  if (plantId)  query = query.where('plantId', '==', plantId);
  else if (window.currentUser.role !== ROLES.SUPER_ADMIN) query = query.where('plantId', '==', window.currentUser.plantId);
  if (levelId)  query = query.where('levelId', '==', levelId);
  if (statusF)  query = query.where('status', '==', statusF);

  query = query.orderBy('sortOrder').limit(200);

  try {
    const snap = await query.get();
    const rows = snap.docs.map(d => {
      const q = d.data();
      return `<tr>
        <td style="font-family:var(--font-mono);font-size:11px">${q.questionId || d.id.substring(0,8)}</td>
        <td style="max-width:280px">${escapeHtml(q.question?.substring(0,80)||'')}…</td>
        <td>${escapeHtml(q.category||'—')}</td>
        <td>${getCriticalityBadge(q.criticality)}</td>
        <td>${escapeHtml(q.questionType||'—')}</td>
        <td>${q.status==='active'?'<span class="badge badge-verified">Active</span>':'<span class="badge badge-cancelled">Inactive</span>'}</td>
        <td><div class="action-btns">
          <button class="btn btn-secondary btn-sm" onclick="openQuestionModal('${d.id}')">Edit</button>
          <button class="btn btn-ghost btn-sm" onclick="toggleStatus('questionMasters','${d.id}','${q.status==='active'?'inactive':'active'}')">
            ${q.status==='active'?'Deactivate':'Activate'}</button>
        </div></td>
      </tr>`;
    });

    wrapper.innerHTML = `
      <table class="data-table">
        <thead><tr><th>ID</th><th>Question</th><th>Category</th><th>Criticality</th><th>Type</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${rows.length?rows.join(''):'<tr><td colspan="7" class="table-empty">No questions found for the selected filters.</td></tr>'}</tbody>
      </table>
    `;
  } catch (e) {
    wrapper.innerHTML = `<div class="table-empty" style="padding:24px">${friendlyFirebaseError(e)}</div>`;
  }
}

async function openQuestionModal(questionId) {
  let q = null;
  if (questionId) { const doc = await col('questionMasters').doc(questionId).get(); q = doc.data(); }

  let plantOpts = '';
  const plantSnap = await col('plants').where('status','==','active').orderBy('name').get();
  plantSnap.forEach(d => { plantOpts += `<option value="${d.id}" ${q?.plantId===d.id?'selected':''}>${d.data().name}</option>`; });

  let levelOpts = '';
  const levelSnap = await col('auditLevels').where('status','==','active').orderBy('levelNumber').get();
  levelSnap.forEach(d => { levelOpts += `<option value="${d.id}" ${q?.levelId===d.id?'selected':''}>Level ${d.data().levelNumber} — ${d.data().name}</option>`; });

  showInlineForm('questionForm', `
    <h4 style="margin-bottom:16px">${q ? 'Edit Question' : 'Add Question'}</h4>
    <div class="form-grid-2">
      <div class="form-group"><label class="form-label required">Plant</label>
        <select id="qPlant" class="form-select"><option value="">Select</option>${plantOpts}</select></div>
      <div class="form-group"><label class="form-label required">Audit Level</label>
        <select id="qLevel" class="form-select"><option value="">Select</option>${levelOpts}</select></div>
      <div class="form-group"><label class="form-label">Category</label>
        <input type="text" id="qCat" class="form-input" value="${escapeHtml(q?.category||'')}" placeholder="e.g. Safety, Quality" /></div>
      <div class="form-group"><label class="form-label required">Criticality</label>
        <select id="qCrit" class="form-select">
          <option value="Minor" ${q?.criticality==='Minor'?'selected':''}>Minor</option>
          <option value="Major" ${q?.criticality==='Major'?'selected':''}>Major</option>
          <option value="Critical" ${q?.criticality==='Critical'?'selected':''}>Critical</option>
        </select></div>
      <div class="form-group"><label class="form-label required">Question Type</label>
        <select id="qType" class="form-select">
          ${['Yes/No','Pass/Fail','Yes/No/NA','Numeric','Text','Multiple Choice'].map(t =>
            `<option ${q?.questionType===t?'selected':''}>${t}</option>`).join('')}
        </select></div>
      <div class="form-group"><label class="form-label">Sort Order</label>
        <input type="number" id="qSort" class="form-input" value="${q?.sortOrder||100}" min="1" /></div>
      <div class="form-group form-span-2"><label class="form-label required">Question Text</label>
        <textarea id="qText" class="form-textarea" rows="3">${escapeHtml(q?.question||'')}</textarea></div>
      <div class="form-group form-span-2"><label class="form-label">Requirement / Standard</label>
        <input type="text" id="qReq" class="form-input" value="${escapeHtml(q?.requirement||'')}" placeholder="e.g. ISO 9001:2015 Clause 8.5" /></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn btn-primary" onclick="saveQuestion('${questionId||''}')">Save Question</button>
      <button class="btn btn-secondary" onclick="renderQuestionsTab()">Cancel</button>
    </div>
  `);
}

async function saveQuestion(questionId) {
  const plantId = document.getElementById('qPlant')?.value;
  const levelId = document.getElementById('qLevel')?.value;
  const question= document.getElementById('qText')?.value.trim();
  if (!plantId || !levelId || !question) { showToast('Plant, level, and question text are required.', 'error'); return; }

  const data = {
    questionId:  generateId('Q'),
    plantId, levelId, question,
    category:    document.getElementById('qCat')?.value.trim(),
    criticality: document.getElementById('qCrit')?.value,
    questionType:document.getElementById('qType')?.value,
    sortOrder:   parseInt(document.getElementById('qSort')?.value)||100,
    requirement: document.getElementById('qReq')?.value.trim(),
    status:      'active',
    revisionNumber: 1,
    updatedAt:   firebase.firestore.FieldValue.serverTimestamp()
  };

  try {
    if (questionId) {
      data.revisionNumber = firebase.firestore.FieldValue.increment(1);
      await col('questionMasters').doc(questionId).update(data);
    } else {
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      await col('questionMasters').add(data);
    }
    showToast('Question saved', 'success');
    await renderQuestionsTab();
  } catch (e) { showToast(friendlyFirebaseError(e), 'error'); }
}

/* ══════════════════════════════════════════════════════════
   CATEGORIES — simple list
══════════════════════════════════════════════════════════ */
async function renderCategoriesTab() {
  const snap = await col('categories').orderBy('name').get();
  const rows = snap.docs.map(d => `
    <tr>
      <td>${escapeHtml(d.data().name)}</td>
      <td>${escapeHtml(d.data().description||'—')}</td>
      <td><button class="btn btn-ghost btn-sm" onclick="deleteCategory('${d.id}')">Delete</button></td>
    </tr>
  `);

  setMasterContent(`
    <div class="master-table-header"><h3 class="card-title">Question Categories</h3></div>
    <div style="padding:16px 20px">
      <div style="display:flex;gap:8px;margin-bottom:16px">
        <input type="text" id="newCatName" class="form-input" placeholder="Category name" style="max-width:220px" />
        <input type="text" id="newCatDesc" class="form-input" placeholder="Description (optional)" style="max-width:280px" />
        <button class="btn btn-primary btn-sm" onclick="addCategory()">Add</button>
      </div>
    </div>
    <div class="table-wrapper"><table class="data-table">
      <thead><tr><th>Name</th><th>Description</th><th></th></tr></thead>
      <tbody>${rows.length?rows.join(''):'<tr><td colspan="3" class="table-empty">No categories yet.</td></tr>'}</tbody>
    </table></div>
  `);
}

async function addCategory() {
  const name = document.getElementById('newCatName')?.value.trim();
  const desc = document.getElementById('newCatDesc')?.value.trim();
  if (!name) { showToast('Category name required.', 'error'); return; }
  await col('categories').add({ name, description: desc, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
  showToast('Category added', 'success');
  await renderCategoriesTab();
}

async function deleteCategory(catId) {
  const result = await confirmAction({ title:'Delete Category', message:'Delete this category?', dangerStyle:true });
  if (!result.confirmed) return;
  await col('categories').doc(catId).delete();
  showToast('Category deleted', 'success');
  await renderCategoriesTab();
}

/* ── Generic Status Toggle ───────────────────────────────── */
async function toggleStatus(collectionName, docId, newStatus) {
  try {
    await col(collectionName).doc(docId).update({
      status: newStatus,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('Status updated', 'success');
    await switchMasterTab(masterTab);
  } catch (e) {
    showToast(friendlyFirebaseError(e), 'error');
  }
}

/* ── UI Helpers ──────────────────────────────────────────── */
function setMasterContent(html) {
  const el = document.getElementById('masterTabContent');
  if (el) el.innerHTML = html;
}

function showInlineForm(id, html) {
  const el = document.getElementById('masterTabContent');
  if (el) el.innerHTML = `<div style="padding:20px">${html}</div>`;
}
