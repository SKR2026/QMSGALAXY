// ─────────────────────────────────────────────────────────────
//  PTMS – Admin Module
//  Super Admin only: manage plants, manage users.
// ─────────────────────────────────────────────────────────────

import { db, auth, app } from "./firebase.v2.js";
import {
  collection, doc, getDocs, addDoc, updateDoc, deleteDoc, setDoc,
  query, orderBy, serverTimestamp, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { sendPasswordResetEmail }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFunctions, httpsCallable }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";
import { requireSuperAdmin } from "./auth.v2.js";
import { getEmailConfig, saveEmailConfig, loadEmailConfig } from "./email.v2.js";

// ── Cloud Functions client ────────────────────────────────────
const fns = getFunctions(app, "asia-south1");

// ── Entry point ───────────────────────────────────────────────
export async function showAdminPage(container, user) {
  if (!requireSuperAdmin()) return;
  container.innerHTML = `
    <div class="page-title">⚙️ Admin Panel</div>
    <div class="tab-bar">
      <button class="tab-btn active" data-tab="plants">🏭 Plants</button>
      <button class="tab-btn" data-tab="users">👥 Users</button>
      <button class="tab-btn" data-tab="email">📧 Email Settings</button>
      <button class="tab-btn" data-tab="gmail">🔑 Gmail Credentials</button>
      <button class="tab-btn" data-tab="danger" style="color:#c62828">🗑️ Danger Zone</button>
    </div>
    <div id="tabPlants" class="tab-panel active"></div>
    <div id="tabUsers"  class="tab-panel"></div>
    <div id="tabEmail"  class="tab-panel"></div>
    <div id="tabGmail"  class="tab-panel"></div>
    <div id="tabDanger" class="tab-panel"></div>
  `;

  // Tab switching
  container.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      container.querySelectorAll(".tab-btn, .tab-panel").forEach(el => el.classList.remove("active"));
      btn.classList.add("active");
      container.querySelector(`#tab${capitalize(btn.dataset.tab)}`).classList.add("active");
    });
  });

  // Run each tab independently so one failure doesn't block others
  await Promise.allSettled([
    renderPlantsTab(container.querySelector("#tabPlants")),
    renderUsersTab(container.querySelector("#tabUsers")),
    renderEmailTab(container.querySelector("#tabEmail")),
    renderGmailTab(container.querySelector("#tabGmail")),
    renderDangerTab(container.querySelector("#tabDanger"), user),
  ]);
}

// ══════════════════════════════════════════════════════════════
//  PLANTS TAB
// ══════════════════════════════════════════════════════════════
async function renderPlantsTab(el) {
  el.innerHTML = `
    <div class="page-actions">
      <button class="btn btn-primary" id="addPlantBtn">+ Add Plant</button>
    </div>
    <div class="card">
      <div class="card-header">Plants Master</div>
      <div class="card-body table-wrap" id="plantsTableWrap">
        <div class="spinner"></div>
      </div>
    </div>
  `;
  el.querySelector("#addPlantBtn").addEventListener("click", () => openPlantModal());
  await loadPlantsTable(el.querySelector("#plantsTableWrap"));
}

async function loadPlantsTable(wrap) {
  const snap = await getDocs(query(collection(db, "plants"), orderBy("code")));
  if (snap.empty) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">🏭</div><p>No plants added yet.</p></div>`;
    return;
  }
  let rows = "";
  snap.forEach(d => {
    const p = d.data();
    rows += `
      <tr>
        <td><span class="dispatch-id">${p.code}</span></td>
        <td><strong>${p.name}</strong></td>
        <td>${p.location || "—"}</td>
        <td>${p.contactPerson || "—"}</td>
        <td>${p.phone || "—"}</td>
        <td><span class="badge ${p.isActive ? 'badge-green' : 'badge-grey'}">${p.isActive ? 'Active' : 'Inactive'}</span></td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="editPlant('${d.id}')">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="togglePlant('${d.id}', ${p.isActive})">
            ${p.isActive ? 'Deactivate' : 'Activate'}
          </button>
        </td>
      </tr>`;
  });
  wrap.innerHTML = `
    <table>
      <thead><tr>
        <th>Code</th><th>Name</th><th>Location</th>
        <th>Contact</th><th>Phone</th><th>Status</th><th>Actions</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function openPlantModal(existingId = null, existing = null) {
  const title = existingId ? "Edit Plant" : "Add New Plant";
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <span>${title}</span>
        <button class="btn-close">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-row">
          <div class="form-group">
            <label>Plant Code *</label>
            <input type="text" id="pCode" placeholder="e.g. PA" maxlength="10"
              value="${existing?.code || ''}" ${existingId ? 'readonly' : ''}>
          </div>
          <div class="form-group">
            <label>Plant Name *</label>
            <input type="text" id="pName" placeholder="Plant A – Ahmedabad" value="${existing?.name || ''}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Location</label>
            <input type="text" id="pLocation" placeholder="City, State" value="${existing?.location || ''}">
          </div>
          <div class="form-group">
            <label>Contact Person</label>
            <input type="text" id="pContact" placeholder="Name" value="${existing?.contactPerson || ''}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Phone</label>
            <input type="text" id="pPhone" placeholder="+91 00000 00000" value="${existing?.phone || ''}">
          </div>
          <div class="form-group">
            <label>Email</label>
            <input type="email" id="pEmail" placeholder="plant@company.com" value="${existing?.email || ''}">
          </div>
        </div>
        <div class="form-row single">
          <div class="form-group">
            <label>Notes</label>
            <textarea id="pNotes" placeholder="Optional remarks">${existing?.notes || ''}</textarea>
          </div>
        </div>
        <div id="plantFormError" class="error-msg hidden"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" id="cancelPlantBtn">Cancel</button>
        <button class="btn btn-primary" id="savePlantBtn">💾 Save Plant</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  backdrop.querySelector(".btn-close").onclick = () => backdrop.remove();
  backdrop.querySelector("#cancelPlantBtn").onclick  = () => backdrop.remove();
  backdrop.querySelector("#savePlantBtn").onclick = async () => {
    await savePlant(backdrop, existingId);
  };
}

async function savePlant(backdrop, existingId) {
  const errEl = backdrop.querySelector("#plantFormError");
  const code  = backdrop.querySelector("#pCode").value.trim().toUpperCase();
  const name  = backdrop.querySelector("#pName").value.trim();
  if (!code || !name) {
    errEl.textContent = "Plant Code and Name are required.";
    errEl.classList.remove("hidden");
    return;
  }
  const data = {
    code,
    name,
    location:      backdrop.querySelector("#pLocation").value.trim(),
    contactPerson: backdrop.querySelector("#pContact").value.trim(),
    phone:         backdrop.querySelector("#pPhone").value.trim(),
    email:         backdrop.querySelector("#pEmail").value.trim(),
    notes:         backdrop.querySelector("#pNotes").value.trim(),
    isActive:      true,
    updatedAt:     serverTimestamp(),
  };
  try {
    if (existingId) {
      await updateDoc(doc(db, "plants", existingId), data);
      window.showToast("Plant updated.", "success");
    } else {
      data.createdAt = serverTimestamp();
      await addDoc(collection(db, "plants"), data);
      window.showToast("Plant added.", "success");
    }
    backdrop.remove();
    // Refresh table
    const wrap = document.querySelector("#plantsTableWrap");
    if (wrap) await loadPlantsTable(wrap);
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove("hidden");
  }
}

// Global handlers for inline buttons
window.editPlant = async (plantId) => {
  const snap = await getDoc(doc(db, "plants", plantId));
  if (snap.exists()) openPlantModal(plantId, snap.data());
};

window.togglePlant = async (plantId, currentlyActive) => {
  if (!confirm(`${currentlyActive ? 'Deactivate' : 'Activate'} this plant?`)) return;
  await updateDoc(doc(db, "plants", plantId), {
    isActive: !currentlyActive,
    updatedAt: serverTimestamp()
  });
  window.showToast(`Plant ${currentlyActive ? 'deactivated' : 'activated'}.`, "info");
  const wrap = document.querySelector("#plantsTableWrap");
  if (wrap) await loadPlantsTable(wrap);
};

// ══════════════════════════════════════════════════════════════
//  USERS TAB
// ══════════════════════════════════════════════════════════════
async function renderUsersTab(el) {
  el.innerHTML = `
    <div class="page-actions">
      <button class="btn btn-primary" id="addUserBtn">+ Add User</button>
    </div>
    <div class="card">
      <div class="card-header">System Users</div>
      <div class="card-body table-wrap" id="usersTableWrap">
        <div class="spinner"></div>
      </div>
    </div>
  `;
  el.querySelector("#addUserBtn").addEventListener("click", () => openUserModal());
  await loadUsersTable(el.querySelector("#usersTableWrap"));
}

async function loadUsersTable(wrap) {
  const [userSnap, plantSnap] = await Promise.all([
    getDocs(query(collection(db, "users"), orderBy("name"))),
    getDocs(collection(db, "plants"))
  ]);
  const plantMap = {};
  plantSnap.forEach(d => { plantMap[d.id] = d.data().name; });

  if (userSnap.empty) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">👥</div><p>No users yet.</p></div>`;
    return;
  }
  let rows = "";
  userSnap.forEach(d => {
    const u = d.data();
    rows += `
      <tr>
        <td><strong>${u.name}</strong></td>
        <td>${u.email}</td>
        <td><span class="badge ${u.role === 'superAdmin' ? 'badge-orange' : 'badge-blue'}">${u.role}</span></td>
        <td>${u.plantId ? (plantMap[u.plantId] || u.plantId) : '—'}</td>
        <td><span class="badge ${u.isActive ? 'badge-green' : 'badge-grey'}">${u.isActive ? 'Active' : 'Inactive'}</span></td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="resetPassword('${u.email}')">Reset Pwd</button>
          <button class="btn btn-danger btn-sm" onclick="toggleUser('${d.id}', ${u.isActive})">
            ${u.isActive ? 'Deactivate' : 'Activate'}
          </button>
        </td>
      </tr>`;
  });
  wrap.innerHTML = `
    <table>
      <thead><tr>
        <th>Name</th><th>Email</th><th>Role</th>
        <th>Plant</th><th>Status</th><th>Actions</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function openUserModal() {
  // Load plants for dropdown
  const plantSnap = await getDocs(query(collection(db, "plants"), orderBy("name")));
  let plantOptions = `<option value="">— Select Plant —</option>`;
  plantSnap.forEach(d => {
    plantOptions += `<option value="${d.id}">${d.data().name} (${d.data().code})</option>`;
  });

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <span>Add New User</span>
        <button class="btn-close">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-row">
          <div class="form-group">
            <label>Full Name *</label>
            <input type="text" id="uName" placeholder="John Doe">
          </div>
          <div class="form-group">
            <label>Email *</label>
            <input type="email" id="uEmail" placeholder="user@company.com">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Role *</label>
            <select id="uRole">
              <option value="plantUser">Plant User</option>
              <option value="superAdmin">Super Admin</option>
            </select>
          </div>
          <div class="form-group" id="plantGroup">
            <label>Assigned Plant *</label>
            <select id="uPlant">${plantOptions}</select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Temporary Password *</label>
            <input type="password" id="uPassword" placeholder="Min 6 characters">
          </div>
          <div class="form-group">
            <label>Confirm Password *</label>
            <input type="password" id="uPassword2" placeholder="Repeat password">
          </div>
        </div>
        <p class="text-muted mt-1">User will be prompted to change their password on first login.</p>
        <div id="userFormError" class="error-msg hidden mt-1"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" id="cancelUserBtn">Cancel</button>
        <button class="btn btn-primary" id="saveUserBtn">Create User</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  const roleSelect = backdrop.querySelector("#uRole");
  const plantGroup = backdrop.querySelector("#plantGroup");
  roleSelect.addEventListener("change", () => {
    plantGroup.style.display = roleSelect.value === "superAdmin" ? "none" : "";
  });
  backdrop.querySelector(".btn-close").onclick       = () => backdrop.remove();
  backdrop.querySelector("#cancelUserBtn").onclick   = () => backdrop.remove();
  backdrop.querySelector("#saveUserBtn").onclick = async () => {
    await createUser(backdrop);
  };
}

async function createUser(backdrop) {
  const errEl   = backdrop.querySelector("#userFormError");
  const saveBtn = backdrop.querySelector("#saveUserBtn");
  const name    = backdrop.querySelector("#uName").value.trim();
  const email   = backdrop.querySelector("#uEmail").value.trim();
  const role    = backdrop.querySelector("#uRole").value;
  const plantId = backdrop.querySelector("#uPlant").value;
  const pwd     = backdrop.querySelector("#uPassword").value;
  const pwd2    = backdrop.querySelector("#uPassword2").value;

  const showErr = msg => {
    errEl.textContent = msg;
    errEl.classList.remove("hidden");
  };
  errEl.classList.add("hidden");

  if (!name || !email || !pwd)                       return showErr("All fields are required.");
  if (pwd !== pwd2)                                  return showErr("Passwords do not match.");
  if (pwd.length < 6)                                return showErr("Password must be at least 6 characters.");
  if (role === "plantUser" && !plantId)              return showErr("Please assign a plant.");

  saveBtn.disabled = true;
  saveBtn.textContent = "Creating…";

  try {
    // ── Call Cloud Function (uses Admin SDK — no permission issues) ──
    const createPtmsUser = httpsCallable(fns, "createPtmsUser");
    await createPtmsUser({ name, email, password: pwd, role, plantId: plantId || null });

    window.showToast("User created successfully.", "success");
    backdrop.remove();
    const wrap = document.querySelector("#usersTableWrap");
    if (wrap) await loadUsersTable(wrap);
  } catch (e) {
    // HttpsError surfaces as e.message; raw Firebase errors as e.message too
    showErr(e?.message || "Failed to create user.");
    saveBtn.disabled = false;
    saveBtn.textContent = "Create User";
  }
}

window.resetPassword = async (email) => {
  if (!confirm(`Send password reset email to ${email}?`)) return;
  await sendPasswordResetEmail(auth, email);
  window.showToast("Password reset email sent.", "info");
};

window.toggleUser = async (userId, currentlyActive) => {
  if (!confirm(`${currentlyActive ? 'Deactivate' : 'Activate'} this user?`)) return;
  await updateDoc(doc(db, "users", userId), { isActive: !currentlyActive, updatedAt: serverTimestamp() });
  window.showToast(`User ${currentlyActive ? 'deactivated' : 'activated'}.`, "info");
  const wrap = document.querySelector("#usersTableWrap");
  if (wrap) await loadUsersTable(wrap);
};

// ══════════════════════════════════════════════════════════════
//  EMAIL SETTINGS TAB
// ══════════════════════════════════════════════════════════════
async function renderEmailTab(el) {
  await loadEmailConfig();
  const cfg = getEmailConfig();

  el.innerHTML = `
    <div class="card section">
      <div class="card-header">📧 Email Notification Settings</div>
      <div class="card-body">
        <p class="text-muted mb-2" style="font-size:.88rem;line-height:1.6">
          Emails are sent via <strong>Gmail SMTP</strong> using your 16-digit App Password,
          securely stored in Firebase Cloud Functions (never in the browser).
          Configure who receives each notification type below — separate multiple addresses with commas.
        </p>

        <!-- On Dispatch -->
        <div class="card mb-2" style="border-left:4px solid #1e88e5">
          <div class="card-header" style="font-size:.88rem">🚚 On Dispatch Created</div>
          <div class="card-body">
            <div class="form-row">
              <div class="form-group">
                <label>To (required recipients)</label>
                <input type="text" id="eDispTo"
                  placeholder="manager@company.com, logistics@company.com"
                  value="${(cfg.onDispatch?.to || []).join(", ")}">
              </div>
              <div class="form-group">
                <label>CC (optional)</label>
                <input type="text" id="eDispCc"
                  placeholder="gm@company.com"
                  value="${(cfg.onDispatch?.cc || []).join(", ")}">
              </div>
            </div>
          </div>
        </div>

        <!-- On Receipt -->
        <div class="card mb-2" style="border-left:4px solid #2e7d32">
          <div class="card-header" style="font-size:.88rem">✅ On Receipt Confirmed (no discrepancy)</div>
          <div class="card-body">
            <div class="form-row">
              <div class="form-group">
                <label>To</label>
                <input type="text" id="eRecvTo"
                  placeholder="manager@company.com"
                  value="${(cfg.onReceipt?.to || []).join(", ")}">
              </div>
              <div class="form-group">
                <label>CC</label>
                <input type="text" id="eRecvCc"
                  placeholder=""
                  value="${(cfg.onReceipt?.cc || []).join(", ")}">
              </div>
            </div>
          </div>
        </div>

        <!-- On Discrepancy -->
        <div class="card mb-2" style="border-left:4px solid #c62828">
          <div class="card-header" style="font-size:.88rem">⚠️ On Discrepancy Detected</div>
          <div class="card-body">
            <div class="form-row">
              <div class="form-group">
                <label>To (escalation recipients)</label>
                <input type="text" id="eDiscTo"
                  placeholder="gm@company.com, quality@company.com"
                  value="${(cfg.onDiscrepancy?.to || []).join(", ")}">
              </div>
              <div class="form-group">
                <label>CC</label>
                <input type="text" id="eDiscCc"
                  placeholder="manager@company.com"
                  value="${(cfg.onDiscrepancy?.cc || []).join(", ")}">
              </div>
            </div>
          </div>
        </div>

        <div id="emailSaveStatus" class="hidden"></div>
        <div style="display:flex;gap:.75rem;flex-wrap:wrap">
          <button class="btn btn-primary" id="saveEmailCfgBtn">💾 Save Email Settings</button>
          <button class="btn btn-outline" id="testEmailBtn">🧪 Send Test Email</button>
        </div>
      </div>
    </div>

    <!-- Gmail Setup Guide -->
    <div class="card section">
      <div class="card-header">🔧 Gmail SMTP Setup Guide</div>
      <div class="card-body" style="font-size:.88rem;line-height:1.8">
        <ol style="padding-left:1.25rem">
          <li>
            <strong>Enable 2-Step Verification</strong> on your Google Account:<br>
            myaccount.google.com → Security → 2-Step Verification
          </li>
          <li>
            <strong>Generate an App Password</strong>:<br>
            myaccount.google.com → Security → App Passwords<br>
            → Select app: <em>Mail</em>, device: <em>Other</em> → Generate<br>
            → Copy the <strong>16-character password</strong> (shown once — save it!)
          </li>
          <li>
            <strong>Set credentials in Firebase</strong> (run once from your terminal):<br>
            <code style="display:block;background:#f4f6fb;padding:.5rem;border-radius:4px;margin:.25rem 0;word-break:break-all">
              firebase functions:config:set gmail.user="you@gmail.com" gmail.pass="xxxx xxxx xxxx xxxx"
            </code>
          </li>
          <li>
            <strong>Deploy the Cloud Function</strong>:<br>
            <code style="display:block;background:#f4f6fb;padding:.5rem;border-radius:4px;margin:.25rem 0">
              firebase deploy --only functions
            </code>
          </li>
          <li>
            Come back here and configure the recipient email addresses above, then click
            <strong>Send Test Email</strong> to verify everything works.
          </li>
        </ol>
      </div>
    </div>
  `;

  el.querySelector("#saveEmailCfgBtn").addEventListener("click", async () => {
    const parseEmails = id => el.querySelector(id).value
      .split(",").map(e => e.trim()).filter(Boolean);

    const config = {
      onDispatch:    { to: parseEmails("#eDispTo"), cc: parseEmails("#eDispCc") },
      onReceipt:     { to: parseEmails("#eRecvTo"), cc: parseEmails("#eRecvCc") },
      onDiscrepancy: { to: parseEmails("#eDiscTo"), cc: parseEmails("#eDiscCc") },
    };

    try {
      await saveEmailConfig(config);
      window.showToast("Email settings saved.", "success");
    } catch (e) {
      window.showToast("Error saving: " + e.message, "error");
    }
  });

  el.querySelector("#testEmailBtn").addEventListener("click", async () => {
    const { sendDispatchEmail } = await import("./email.js");
    const result = await sendDispatchEmail({
      dispatchId:    "PTMS-TEST-00001",
      date:          new Date().toISOString().slice(0,10),
      fromPlantName: "Plant A (Test)",
      toPlantName:   "Plant B (Test)",
      material:      "Test Material",
      qtyDispatched: 100,
      unit:          "Kg",
      boxes:         5,
      batch:         "TEST-LOT",
      vehicleNo:     "GJ 01 AB 1234",
      vehicleType:   "Truck",
      driverName:    "Test Driver",
      driverPhone:   "+91 00000 00000",
      departureTime: "10:00",
      ewayBill:      "—",
      remarks:       "This is a test dispatch email from PTMS.",
    }, { name: "Super Admin", email: "admin@company.com" });

    if (result.sent) {
      window.showToast("✅ Test email sent! Check inbox.", "success");
    } else {
      window.showToast("Test email failed: " + result.reason, "error");
    }
  });
}

// ══════════════════════════════════════════════════════════════
//  GMAIL CREDENTIALS TAB
// ══════════════════════════════════════════════════════════════
async function renderGmailTab(el) {
  // Load existing config (show user/pass already saved if any)
  let savedUser = "";
  try {
    const snap = await getDoc(doc(db, "settings", "gmailConfig"));
    if (snap.exists()) savedUser = snap.data().user || "";
  } catch (e) { /* ignore */ }

  el.innerHTML = `
    <div class="card section">
      <div class="card-header">🔑 Gmail SMTP Credentials</div>
      <div class="card-body">

        ${savedUser
          ? `<div style="margin-bottom:1rem;padding:.65rem 1rem;background:#e8f5e9;border-radius:6px;font-size:.88rem;color:#2e7d32;font-weight:500">
              ✅ Credentials saved for <strong>${savedUser}</strong> — update below to change.
             </div>`
          : `<div style="margin-bottom:1rem;padding:.65rem 1rem;background:#fff3e0;border-radius:6px;font-size:.88rem;color:#e65100;font-weight:500">
              ⚠️ No Gmail credentials saved yet. Fill in both fields below and click Save.
             </div>`}

        <div class="form-group" style="margin-bottom:1rem">
          <label>Gmail Address *</label>
          <input type="email" id="gmailUser"
            placeholder="yourname@gmail.com"
            value="${savedUser}"
            autocomplete="off"
            style="max-width:380px">
        </div>

        <div class="form-group" style="margin-bottom:.5rem">
          <label>16-Digit App Password *</label>
          <div style="display:flex;gap:.5rem;align-items:center;max-width:380px">
            <input type="text" id="gmailPass"
              placeholder="xxxx xxxx xxxx xxxx"
              autocomplete="new-password"
              style="flex:1;letter-spacing:.08em;font-family:monospace">
            <button type="button" class="btn btn-outline btn-sm" id="clearPassBtn"
              title="Clear field">✕</button>
          </div>
          <div style="font-size:.78rem;color:var(--text-light);margin-top:.35rem">
            ${savedUser ? "Leave <strong>blank</strong> to keep the existing saved password." : ""}
            Spaces in the 16-digit password are fine.
          </div>
        </div>

        <div id="gmailSaveStatus" style="margin:0 0 .75rem;font-size:.88rem"></div>

        <div style="display:flex;gap:.75rem;flex-wrap:wrap;align-items:center">
          <button class="btn btn-primary" id="saveGmailBtn">💾 Save Credentials</button>
          <button class="btn btn-outline" id="testGmailBtn">🧪 Send Test Email</button>
          <span style="font-size:.8rem;color:var(--text-light)">
            (sends to recipients in Email Settings)
          </span>
        </div>
      </div>
    </div>

    <div class="card section">
      <div class="card-header">🖼️ Company Logo</div>
      <div class="card-body">
        <p class="text-muted mb-2" style="font-size:.88rem;line-height:1.6">
          Upload your company logo — it appears on the login page and sidebar.
          Recommended: PNG with transparent background, max 400×120 px.
        </p>
        <div style="display:flex;align-items:center;gap:1.5rem;flex-wrap:wrap;margin-bottom:1rem">
          <!-- Preview box -->
          <div style="background:#f4f6fb;border:1.5px dashed var(--border);border-radius:8px;padding:1rem 1.5rem;text-align:center;min-width:200px">
            <img id="logoPreview" src="images/logo.png" alt="Current Logo"
              style="max-width:180px;max-height:56px;object-fit:contain;display:block;margin:0 auto"
              onerror="this.style.display='none';document.getElementById('logoNone').style.display='block'">
            <span id="logoNone" style="display:none;font-size:.82rem;color:var(--text-light)">No logo uploaded</span>
            <div style="font-size:.75rem;color:var(--text-light);margin-top:.4rem">Current logo</div>
          </div>
          <!-- Controls -->
          <div style="flex:1;min-width:200px;display:flex;flex-direction:column;gap:.6rem">
            <div style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap">
              <label class="btn btn-outline btn-sm" style="cursor:pointer;display:inline-flex;align-items:center;gap:.4rem;margin:0">
                📁 Choose File
                <input type="file" id="logoFileInput" accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  style="display:none">
              </label>
              <button class="btn btn-primary btn-sm" id="logoUploadBtn" disabled>⬆️ Upload Logo</button>
              <button class="btn btn-danger btn-sm" id="logoRemoveBtn">🗑 Remove Logo</button>
            </div>
            <div style="font-size:.78rem;color:var(--text-light)">
              PNG, JPG or SVG · Max 500 KB · Transparent background recommended
            </div>
            <div id="logoUploadStatus" style="font-size:.85rem"></div>
          </div>
        </div>
      </div>
    </div>

    <div class="card section">
      <div class="card-header">ℹ️ How to Get a Gmail App Password</div>
      <div class="card-body" style="font-size:.88rem;line-height:1.9">
        <ol style="padding-left:1.25rem">
          <li>Go to <strong>myaccount.google.com</strong> → <strong>Security</strong></li>
          <li>Enable <strong>2-Step Verification</strong> (required for App Passwords)</li>
          <li>Search <strong>"App Passwords"</strong> in the search bar → Click it</li>
          <li>Select app: <em>Mail</em> &nbsp;|&nbsp; Select device: <em>Other</em> → type "PTMS"</li>
          <li>Click <strong>Generate</strong> — copy the <strong>16-character password</strong></li>
          <li>Paste it above (spaces are fine) and click <strong>Save Credentials</strong></li>
        </ol>
      </div>
    </div>
  `;

  const statusEl = el.querySelector("#gmailSaveStatus");

  // ── Logo: file select → preview + enable upload btn ──────────
  let _logoFile = null;
  const logoInfo    = el.querySelector("#logoUploadStatus");
  const logoUpBtn   = el.querySelector("#logoUploadBtn");
  const logoRemBtn  = el.querySelector("#logoRemoveBtn");
  const logoPreview = el.querySelector("#logoPreview");
  const logoNone    = el.querySelector("#logoNone");

  el.querySelector("#logoFileInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 512 * 1024) {
      logoInfo.style.cssText = "color:var(--danger)";
      logoInfo.textContent = "⚠️ File too large (max 500 KB). Please resize.";
      logoUpBtn.disabled = true;
      return;
    }
    _logoFile = file;
    // Show local preview immediately
    const reader = new FileReader();
    reader.onload = (ev) => {
      logoPreview.src = ev.target.result;
      logoPreview.style.display = "block";
      logoNone.style.display = "none";
    };
    reader.readAsDataURL(file);
    logoInfo.style.cssText = "color:var(--text-mid)";
    logoInfo.textContent = `"${file.name}" selected — click Upload Logo to save.`;
    logoUpBtn.disabled = false;
  });

  // ── Upload button ─────────────────────────────────────────────
  logoUpBtn.addEventListener("click", async () => {
    if (!_logoFile) return;
    logoUpBtn.disabled = true;
    logoUpBtn.textContent = "Uploading…";
    logoInfo.style.cssText = "";
    logoInfo.textContent = "";
    try {
      const storage = getStorage(app);
      const storageRef = ref(storage, "branding/logo.png");
      await uploadBytes(storageRef, _logoFile, { contentType: _logoFile.type });
      const url = await getDownloadURL(storageRef);

      // Persist URL to Firestore so app reads it on load
      await setDoc(doc(db, "settings", "branding"), { logoUrl: url, updatedAt: serverTimestamp() }, { merge: true });

      // Update live logos across the page
      [document.getElementById("loginLogoImg"), document.getElementById("sidebarLogoImg")].forEach(img => {
        if (img) { img.src = url; img.closest("[style*='display:none']") && (img.closest("[style*='display:none']").style.display = "flex"); }
      });

      logoInfo.style.cssText = "color:var(--success);font-weight:500";
      logoInfo.textContent = "✅ Logo uploaded and saved successfully!";
      window.showToast("Logo updated.", "success");
      _logoFile = null;
    } catch (err) {
      logoInfo.style.cssText = "color:var(--danger)";
      logoInfo.textContent = "❌ Upload failed: " + err.message;
    } finally {
      logoUpBtn.textContent = "⬆️ Upload Logo";
      logoUpBtn.disabled = true;
    }
  });

  // ── Remove button ─────────────────────────────────────────────
  logoRemBtn.addEventListener("click", async () => {
    if (!confirm("Remove the company logo? The app will show no logo until a new one is uploaded.")) return;
    logoRemBtn.disabled = true;
    logoRemBtn.textContent = "Removing…";
    try {
      const storage = getStorage(app);
      try { await deleteObject(ref(storage, "branding/logo.png")); } catch (_) { /* may not exist */ }
      await setDoc(doc(db, "settings", "branding"), { logoUrl: "", updatedAt: serverTimestamp() }, { merge: true });

      logoPreview.src = "";
      logoPreview.style.display = "none";
      logoNone.style.display = "block";
      [document.getElementById("loginLogoImg"), document.getElementById("sidebarLogoImg")].forEach(img => {
        if (img) img.closest(".login-company-logo,.sidebar-company-logo") && (img.closest(".login-company-logo,.sidebar-company-logo").style.display = "none");
      });

      logoInfo.style.cssText = "color:var(--text-mid)";
      logoInfo.textContent = "Logo removed.";
      window.showToast("Logo removed.", "info");
    } catch (err) {
      logoInfo.style.cssText = "color:var(--danger)";
      logoInfo.textContent = "❌ Remove failed: " + err.message;
    } finally {
      logoRemBtn.disabled = false;
      logoRemBtn.textContent = "🗑 Remove Logo";
    }
  });

  el.querySelector("#clearPassBtn").addEventListener("click", () => {
    el.querySelector("#gmailPass").value = "";
    el.querySelector("#gmailPass").focus();
  });

  el.querySelector("#saveGmailBtn").addEventListener("click", async () => {
    const user    = el.querySelector("#gmailUser").value.trim();
    const pass    = el.querySelector("#gmailPass").value.trim();
    const btn     = el.querySelector("#saveGmailBtn");

    statusEl.textContent = "";
    statusEl.style.cssText = "";

    if (!user) {
      statusEl.textContent = "⚠️ Gmail address is required.";
      statusEl.style.cssText = "color:var(--danger);padding:.5rem .75rem;background:var(--danger-bg);border-radius:6px";
      return;
    }

    btn.disabled = true;
    btn.textContent = "Saving…";

    try {
      const data = { user, updatedAt: serverTimestamp() };
      if (pass) data.pass = pass.replace(/\s+/g, ""); // strip spaces before saving
      await setDoc(doc(db, "settings", "gmailConfig"), data, { merge: true });
      statusEl.textContent = "✅ Credentials saved successfully!";
      statusEl.style.cssText = "color:#2e7d32;padding:.5rem .75rem;background:#e8f5e9;border-radius:6px;font-weight:500";
      el.querySelector("#gmailPass").value = "";
      window.showToast("Gmail credentials saved.", "success");
    } catch (e) {
      statusEl.textContent = "❌ Error: " + e.message;
      statusEl.style.cssText = "color:var(--danger);padding:.5rem .75rem;background:var(--danger-bg);border-radius:6px";
    } finally {
      btn.disabled = false;
      btn.textContent = "💾 Save Credentials";
    }
  });

  el.querySelector("#testGmailBtn").addEventListener("click", async () => {
    const btn = el.querySelector("#testGmailBtn");
    btn.disabled = true;
    btn.textContent = "Sending…";
    try {
      const { sendDispatchEmail } = await import("./email.js");
      const result = await sendDispatchEmail({
        dispatchId: "PTMS-TEST-00001",
        date: new Date().toISOString().slice(0, 10),
        fromPlantName: "Plant A (Test)",
        toPlantName:   "Plant B (Test)",
        material:      "Test Material",
        qtyDispatched: 100, unit: "Kg", boxes: 5,
        batch: "TEST-LOT", vehicleNo: "GJ 01 AB 1234",
        vehicleType: "Truck", driverName: "Test Driver",
        driverPhone: "+91 00000 00000", departureTime: "10:00",
        ewayBill: "—", remarks: "Test email from PTMS Admin panel.",
      }, { name: "Super Admin" });

      if (result.sent) {
        window.showToast("✅ Test email sent! Check inbox.", "success");
      } else {
        window.showToast("Failed: " + result.reason, "error");
      }
    } catch (e) {
      window.showToast("Error: " + e.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "🧪 Send Test Email";
    }
  });
}

// ── Helpers ───────────────────────────────────────────────────
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }


// ── Danger Zone Tab ──────────────────────────────────────────
async function renderDangerTab(el, user) {
  if (user.role !== "superAdmin") {
    el.innerHTML = `<div class="card"><p style="color:#666">Access restricted to Super Admin.</p></div>`;
    return;
  }
  el.innerHTML = `
    <div class="card" style="border:2px solid #c62828">
      <div class="card-header" style="background:#c62828;color:#fff">⚠️ Danger Zone — Irreversible Actions</div>
      <div style="padding:1.5rem">
        <p style="color:#c62828;font-weight:600">These actions permanently delete data and cannot be undone.</p>
        <hr style="margin:1rem 0">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:1rem;background:#fff3f3;border-radius:8px;margin-bottom:1rem">
          <div>
            <strong>Wipe All Dispatches & Logs</strong>
            <p style="margin:0.3rem 0 0;color:#666;font-size:0.9rem">Permanently deletes all dispatch records and activity logs. Plants and users are kept.</p>
          </div>
          <button class="btn" style="background:#c62828;color:#fff;white-space:nowrap" onclick="wipeAllData()">🗑️ Wipe Data</button>
        </div>
      </div>
    </div>`;
}

// ── Wipe All Data (superAdmin only) ──────────────────────────
export async function wipeAllData() {
  if (!confirm("⚠️ WARNING: This will permanently delete ALL dispatches and activity logs. This cannot be undone.\n\nType 'WIPE' to confirm:")) return;
  const input = prompt("Type WIPE to confirm permanent deletion:");
  if (input !== "WIPE") { alert("Cancelled."); return; }
  
  const batch1 = [];
  const dispSnap = await getDocs(collection(db, "dispatches"));
  dispSnap.forEach(d => batch1.push(deleteDoc(doc(db, "dispatches", d.id))));
  const logSnap = await getDocs(collection(db, "activityLogs"));
  logSnap.forEach(d => batch1.push(deleteDoc(doc(db, "activityLogs", d.id))));
  
  await Promise.all(batch1);
  alert("✅ All dispatches and logs have been wiped.");
  location.reload();
}
window.wipeAllData = wipeAllData;
