// ─────────────────────────────────────────────────────────────
//  PTMS – Admin Module
//  Super Admin only: manage plants, manage users.
// ─────────────────────────────────────────────────────────────

import { db, auth } from "./firebase.js";
import {
  collection, doc, getDocs, addDoc, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  createUserWithEmailAndPassword, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { requireSuperAdmin } from "./auth.js";
import { getEmailConfig, saveEmailConfig, loadEmailConfig } from "./email.js";

// ── Entry point ───────────────────────────────────────────────
export async function showAdminPage(container, user) {
  if (!requireSuperAdmin()) return;
  container.innerHTML = `
    <div class="page-title">⚙️ Admin Panel</div>
    <div class="tab-bar">
      <button class="tab-btn active" data-tab="plants">🏭 Plants</button>
      <button class="tab-btn" data-tab="users">👥 Users</button>
      <button class="tab-btn" data-tab="email">📧 Email Settings</button>
    </div>
    <div id="tabPlants" class="tab-panel active"></div>
    <div id="tabUsers"  class="tab-panel"></div>
    <div id="tabEmail"  class="tab-panel"></div>
  `;

  // Tab switching
  container.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      container.querySelectorAll(".tab-btn, .tab-panel").forEach(el => el.classList.remove("active"));
      btn.classList.add("active");
      container.querySelector(`#tab${capitalize(btn.dataset.tab)}`).classList.add("active");
    });
  });

  await Promise.all([
    renderPlantsTab(container.querySelector("#tabPlants")),
    renderUsersTab(container.querySelector("#tabUsers")),
    renderEmailTab(container.querySelector("#tabEmail")),
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
            <input type="password" id="uPassword" placeholder="Min 8 characters">
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
  const errEl    = backdrop.querySelector("#userFormError");
  const name     = backdrop.querySelector("#uName").value.trim();
  const email    = backdrop.querySelector("#uEmail").value.trim();
  const role     = backdrop.querySelector("#uRole").value;
  const plantId  = backdrop.querySelector("#uPlant").value;
  const pwd      = backdrop.querySelector("#uPassword").value;
  const pwd2     = backdrop.querySelector("#uPassword2").value;

  errEl.classList.add("hidden");

  if (!name || !email || !pwd) { errEl.textContent = "All fields are required."; errEl.classList.remove("hidden"); return; }
  if (pwd !== pwd2)             { errEl.textContent = "Passwords do not match."; errEl.classList.remove("hidden"); return; }
  if (pwd.length < 8)           { errEl.textContent = "Password must be at least 8 characters."; errEl.classList.remove("hidden"); return; }
  if (role === "plantUser" && !plantId) { errEl.textContent = "Please assign a plant."; errEl.classList.remove("hidden"); return; }

  try {
    // Create Firebase Auth user
    const cred = await createUserWithEmailAndPassword(auth, email, pwd);
    // Write Firestore profile
    await updateDoc(doc(db, "users", cred.user.uid), {
      name, email, role,
      plantId: role === "plantUser" ? plantId : null,
      isActive: true,
      createdAt: serverTimestamp(),
    }).catch(async () => {
      // Document may not exist yet — use setDoc
      const { setDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
      await setDoc(doc(db, "users", cred.user.uid), {
        name, email, role,
        plantId: role === "plantUser" ? plantId : null,
        isActive: true,
        createdAt: serverTimestamp(),
      });
    });
    window.showToast("User created successfully.", "success");
    backdrop.remove();
    const wrap = document.querySelector("#usersTableWrap");
    if (wrap) await loadUsersTable(wrap);
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove("hidden");
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
          Emails are sent via <strong>EmailJS</strong> connected to your Gmail account using a
          <strong>16-digit App Password</strong>. Configure the EmailJS credentials inside
          <code>js/email.js</code>. Here you define <em>who receives</em> each type of notification.
          Separate multiple addresses with commas.
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

    <!-- EmailJS Setup Guide -->
    <div class="card section">
      <div class="card-header">🔧 EmailJS + Gmail Setup Guide</div>
      <div class="card-body" style="font-size:.88rem;line-height:1.8">
        <ol style="padding-left:1.25rem">
          <li>
            Go to <a href="https://www.emailjs.com" target="_blank">emailjs.com</a> → Sign up (free — 200 emails/month)
          </li>
          <li>
            Click <strong>Email Services</strong> → <strong>Add New Service</strong> → choose <strong>Gmail</strong><br>
            Enter your Gmail address. When prompted for password, use your
            <strong>16-digit App Password</strong> (not your regular Gmail password).
          </li>
          <li>
            Get Gmail App Password:<br>
            &nbsp;• Google Account → Security → 2-Step Verification (enable if not done)<br>
            &nbsp;• Security → <strong>App Passwords</strong> → Select app: Mail → Select device → Generate<br>
            &nbsp;• Copy the <strong>16-character password</strong> (shown once — save it!)
          </li>
          <li>
            In EmailJS → <strong>Email Templates</strong> → Create two templates:
            <ul style="margin:.5rem 0 .5rem 1rem">
              <li><strong>Dispatch Template</strong> — use variables like <code>{{dispatch_id}}</code>, <code>{{from_plant}}</code>, <code>{{material}}</code>, <code>{{qty_dispatched}}</code>, <code>{{vehicle_no}}</code>, <code>{{driver_name}}</code>, <code>{{departure_time}}</code></li>
              <li><strong>Receipt Template</strong> — use <code>{{dispatch_id}}</code>, <code>{{qty_dispatched}}</code>, <code>{{qty_received}}</code>, <code>{{difference}}</code>, <code>{{status}}</code>, <code>{{arrival_date}}</code>, <code>{{receipt_remarks}}</code></li>
            </ul>
            Set <strong>To Email</strong> field in template to: <code>{{to_email}}</code><br>
            Set <strong>CC</strong> field to: <code>{{cc_email}}</code>
          </li>
          <li>
            Go to EmailJS → <strong>Account</strong> → copy your <strong>Public Key</strong>
          </li>
          <li>
            Open <code>js/email.js</code> and paste:<br>
            <code style="display:block;background:#f4f6fb;padding:.5rem;border-radius:4px;margin:.25rem 0">
              EMAILJS_PUBLIC_KEY = "your_public_key"<br>
              EMAILJS_SERVICE_ID = "service_xxxxxx"<br>
              EMAILJS_DISPATCH_TMPL = "template_xxxxxx"<br>
              EMAILJS_RECEIPT_TMPL  = "template_xxxxxx"
            </code>
          </li>
          <li>Redeploy: <code>firebase deploy --only hosting</code></li>
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

// ── Helpers ───────────────────────────────────────────────────
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
