// ─────────────────────────────────────────────────────────────
//  PTMS – Dispatch Module  (Phase 2)
//  Plant users create outgoing dispatches.
//  Dispatch ID format: PTMS-YYYY-00001
// ─────────────────────────────────────────────────────────────

import { db } from "./firebase.v2.js";
import {
  collection, doc, getDocs, addDoc, query,
  orderBy, where, serverTimestamp, getDoc,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { requirePlantUser } from "./auth.v2.js";
import { sendDispatchEmail } from "./email.v2.js";

// ── Entry point ───────────────────────────────────────────────
export async function showDispatchPage(container, user) {
  if (!requirePlantUser()) return;

  container.innerHTML = `
    <div class="page-title">🚚 New Dispatch</div>

    <!-- My recent dispatches -->
    <div class="card section">
      <div class="card-header">
        <span>My Plant's Dispatches</span>
        <button class="btn btn-primary btn-sm" id="openDispatchFormBtn">+ Create Dispatch</button>
      </div>
      <div class="card-body">
        <div class="filter-bar">
          <input type="date" id="dispatchFilterFrom" title="From date">
          <input type="date" id="dispatchFilterTo"   title="To date">
          <select id="dispatchFilterStatus">
            <option value="">All Statuses</option>
            <option value="dispatched">Dispatched</option>
            <option value="in-transit">In Transit</option>
            <option value="received">Received</option>
            <option value="discrepancy">Discrepancy</option>
          </select>
          <button class="btn btn-outline btn-sm" id="dispatchFilterBtn">Filter</button>
        </div>
        <div id="dispatchList"><div class="spinner"></div></div>
      </div>
    </div>
  `;

  container.querySelector("#openDispatchFormBtn").addEventListener("click", () => {
    openDispatchModal(user);
  });
  container.querySelector("#dispatchFilterBtn").addEventListener("click", () => {
    loadDispatchList(user, container.querySelector("#dispatchList"), {
      from:   container.querySelector("#dispatchFilterFrom").value,
      to:     container.querySelector("#dispatchFilterTo").value,
      status: container.querySelector("#dispatchFilterStatus").value,
    });
  });

  await loadDispatchList(user, container.querySelector("#dispatchList"), {});
}

// ── Load list ─────────────────────────────────────────────────
async function loadDispatchList(user, listEl, filters = {}) {
  listEl.innerHTML = `<div class="spinner"></div>`;
  try {
    let q = query(
      collection(db, "dispatches"),
      where("fromPlantId", "==", user.plantId || "__sa__"),
      orderBy("createdAt", "desc")
    );
    // For superAdmin show all
    if (user.role === "superAdmin") {
      q = query(collection(db, "dispatches"), orderBy("createdAt", "desc"));
    }

    const snap = await getDocs(q);
    if (snap.empty) {
      listEl.innerHTML = `<div class="empty-state"><div class="empty-icon">🚚</div><p>No dispatches yet. Click "Create Dispatch" to begin.</p></div>`;
      return;
    }

    let rows = "";
    snap.forEach(d => {
      const dp = d.data();
      const created = dp.createdAt?.toDate ? dp.createdAt.toDate().toLocaleDateString("en-IN") : "—";
      const photoThumb = dp.photoEvidence?.length
        ? `<div style="display:flex;gap:3px;flex-wrap:wrap;margin-bottom:4px">${dp.photoEvidence.map(url=>`<img src="${url}" onclick="window.open('${url}','_blank')" style="width:38px;height:38px;object-fit:cover;border-radius:5px;border:2px solid #c62828;cursor:pointer" title="View photo">`).join("")}</div>`
        : "";
      rows += `
        <tr>
          <td><span class="dispatch-id">${dp.dispatchId}</span></td>
          <td>${created}</td>
          <td>${dp.material}</td>
          <td>${dp.qtyDispatched} ${dp.unit}</td>
          <td>${dp.vehicleNo}</td>
          <td>${dp.toPlantName || "—"}</td>
          <td><span class="badge status-${dp.status}">${statusLabel(dp.status)}</span></td>
          <td>${photoThumb}<button class="btn btn-outline btn-sm" onclick="viewDispatch('${d.id}')">View</button></td>
        </tr>`;
    });

    listEl.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Dispatch ID</th><th>Date</th><th>Material</th>
            <th>Qty</th><th>Vehicle No.</th><th>To Plant</th>
            <th>Status</th><th></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  } catch (e) {
    listEl.innerHTML = `<div class="error-msg">Error loading dispatches: ${e.message}</div>`;
  }
}

// ── Create Dispatch Modal ─────────────────────────────────────
async function openDispatchModal(user) {
  // Load destination plants (excluding current plant)
  const plantSnap = await getDocs(query(collection(db, "plants"), orderBy("name")));
  let plantOptions = `<option value="">— Select Destination Plant —</option>`;
  plantSnap.forEach(d => {
    if (d.id !== user.plantId) {
      plantOptions += `<option value="${d.id}" data-name="${d.data().name}">${d.data().name} (${d.data().code})</option>`;
    }
  });

  const today = new Date().toISOString().split("T")[0];
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <span>🚚 Create Dispatch</span>
        <button class="btn-close">✕</button>
      </div>
      <div class="modal-body">
        <!-- Section: Shipment Info -->
        <p class="text-muted mb-2">From: <strong>${user.plantName}</strong></p>
        <div class="form-row">
          <div class="form-group">
            <label>Dispatch Date *</label>
            <input type="date" id="dDate" value="${today}">
          </div>
          <div class="form-group">
            <label>Destination Plant *</label>
            <select id="dToPlant">${plantOptions}</select>
          </div>
        </div>

        <!-- Section: Material -->
        <div class="form-row">
          <div class="form-group">
            <label>Material Description *</label>
            <input type="text" id="dMaterial" placeholder="e.g. HDPE Granules">
          </div>
          <div class="form-group">
            <label>Unit *</label>
            <select id="dUnit">
              <option value="Kg">Kg</option>
              <option value="MT">MT</option>
              <option value="Nos">Nos</option>
              <option value="Boxes">Boxes</option>
              <option value="Bags">Bags</option>
              <option value="Ltrs">Ltrs</option>
            </select>
          </div>
        </div>
        <div class="form-row triple">
          <div class="form-group">
            <label>Quantity Dispatched *</label>
            <input type="number" id="dQty" placeholder="0.00" min="0" step="0.01">
          </div>
          <div class="form-group">
            <label>No. of Boxes/Bags</label>
            <input type="number" id="dBoxes" placeholder="0" min="0">
          </div>
          <div class="form-group">
            <label>Batch / Lot No.</label>
            <input type="text" id="dBatch" placeholder="LOT-001">
          </div>
        </div>

        <!-- Section: Vehicle -->
        <div class="form-row">
          <div class="form-group">
            <label>Vehicle Number *</label>
            <input type="text" id="dVehicleNo" placeholder="GJ 01 AB 1234">
          </div>
          <div class="form-group">
            <label>Vehicle Type *</label>
            <select id="dVehicleType">
              <option value="Truck">Truck</option>
              <option value="Mini Truck">Mini Truck</option>
              <option value="Tempo">Tempo</option>
              <option value="Container">Container</option>
              <option value="Two-Wheeler">Two-Wheeler</option>
              <option value="Other">Other</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Driver Name *</label>
            <input type="text" id="dDriverName" placeholder="Full name">
          </div>
          <div class="form-group">
            <label>Driver Contact No. *</label>
            <input type="tel" id="dDriverPhone" placeholder="+91 00000 00000">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Departure Time *</label>
            <input type="time" id="dDepartureTime">
          </div>
          <div class="form-group">
            <label>E-Way Bill No.</label>
            <input type="text" id="dEwayBill" placeholder="Optional">
          </div>
        </div>
        <div class="form-row single">
          <div class="form-group">
            <label>Remarks</label>
            <textarea id="dRemarks" placeholder="Optional notes"></textarea>
          </div>
        </div>

        <div id="dispatchFormError" class="error-msg hidden"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" id="cancelDispatchBtn">Cancel</button>
        <button class="btn btn-primary" id="saveDispatchBtn">🚚 Confirm Dispatch</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  backdrop.querySelector(".btn-close").onclick = () => backdrop.remove();
  backdrop.querySelector("#cancelDispatchBtn").onclick = () => backdrop.remove();
  backdrop.querySelector("#saveDispatchBtn").onclick = async () => {
    await saveDispatch(backdrop, user);
  };
}

// ── Generate Dispatch ID ──────────────────────────────────────
async function generateDispatchId() {
  const year = new Date().getFullYear();
  const counterRef = doc(db, "counters", `dispatch_${year}`);
  let newNum;
  await runTransaction(db, async tx => {
    const snap = await tx.get(counterRef);
    newNum = (snap.exists() ? snap.data().last : 0) + 1;
    tx.set(counterRef, { last: newNum });
  });
  return `PTMS-${year}-${String(newNum).padStart(5, "0")}`;
}

// ── Save Dispatch ─────────────────────────────────────────────
async function saveDispatch(backdrop, user) {
  const errEl = backdrop.querySelector("#dispatchFormError");
  errEl.classList.add("hidden");

  const toPlantEl = backdrop.querySelector("#dToPlant");
  const toPlantId = toPlantEl.value;
  const toPlantName = toPlantEl.selectedOptions[0]?.dataset.name || "";

  const fields = {
    date:          backdrop.querySelector("#dDate").value,
    toPlantId,
    toPlantName,
    material:      backdrop.querySelector("#dMaterial").value.trim(),
    unit:          backdrop.querySelector("#dUnit").value,
    qtyDispatched: parseFloat(backdrop.querySelector("#dQty").value),
    boxes:         parseInt(backdrop.querySelector("#dBoxes").value || "0"),
    batch:         backdrop.querySelector("#dBatch").value.trim(),
    vehicleNo:     backdrop.querySelector("#dVehicleNo").value.trim().toUpperCase(),
    vehicleType:   backdrop.querySelector("#dVehicleType").value,
    driverName:    backdrop.querySelector("#dDriverName").value.trim(),
    driverPhone:   backdrop.querySelector("#dDriverPhone").value.trim(),
    departureTime: backdrop.querySelector("#dDepartureTime").value,
    ewayBill:      backdrop.querySelector("#dEwayBill").value.trim(),
    remarks:       backdrop.querySelector("#dRemarks").value.trim(),
  };

  // Validation
  const required = ["date", "toPlantId", "material", "vehicleNo", "driverName", "driverPhone", "departureTime"];
  for (const f of required) {
    if (!fields[f]) {
      errEl.textContent = "Please fill all required fields (marked *).";
      errEl.classList.remove("hidden");
      return;
    }
  }
  if (isNaN(fields.qtyDispatched) || fields.qtyDispatched <= 0) {
    errEl.textContent = "Quantity dispatched must be greater than 0.";
    errEl.classList.remove("hidden");
    return;
  }

  const saveBtn = backdrop.querySelector("#saveDispatchBtn");
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";

  try {
    const dispatchId = await generateDispatchId();
    await addDoc(collection(db, "dispatches"), {
      dispatchId,
      fromPlantId:   user.plantId,
      fromPlantName: user.plantName,
      dispatchedBy:  user.uid,
      dispatchedByName: user.name,
      status:        "dispatched",
      createdAt:     serverTimestamp(),
      updatedAt:     serverTimestamp(),
      ...fields,
    });

    // Activity log
    await addDoc(collection(db, "activityLogs"), {
      action:      "DISPATCH_CREATED",
      dispatchId,
      userId:      user.uid,
      userName:    user.name,
      plantId:     user.plantId,
      plantName:   user.plantName,
      timestamp:   serverTimestamp(),
      details:     `${fields.material} – ${fields.qtyDispatched} ${fields.unit} dispatched to ${toPlantName}`,
    });

    window.showToast(`Dispatch ${dispatchId} created!`, "success");
    backdrop.remove();

    // Send email notification (non-blocking — don't fail dispatch on email error)
    sendDispatchEmail({ dispatchId, ...fields, fromPlantName: user.plantName }, user)
      .then(r => { if (r.sent) window.showToast("📧 Notification email sent.", "info", 2500); })
      .catch(() => {});

    // Refresh list
    const listEl = document.querySelector("#dispatchList");
    if (listEl) await loadDispatchList(user, listEl, {});
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove("hidden");
    saveBtn.disabled = false;
    saveBtn.textContent = "🚚 Confirm Dispatch";
  }
}

// ── View Dispatch (read-only detail) ─────────────────────────
window.viewDispatch = async (id) => {
  const snap = await getDoc(doc(db, "dispatches", id));
  if (!snap.exists()) return;
  const dp = snap.data();
  const created = dp.createdAt?.toDate ? dp.createdAt.toDate().toLocaleString("en-IN") : "—";

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <span>Dispatch Details — <span class="dispatch-id">${dp.dispatchId}</span></span>
        <button class="btn-close">✕</button>
      </div>
      <div class="modal-body">
        <table style="width:100%;font-size:.9rem;border-collapse:collapse">
          ${row("Status", `<span class="badge status-${dp.status}">${statusLabel(dp.status)}</span>`)}
          ${row("Created", created)}
          ${row("From Plant", dp.fromPlantName)}
          ${row("To Plant",   dp.toPlantName)}
          ${row("Material",   dp.material)}
          ${row("Qty Dispatched", `${dp.qtyDispatched} ${dp.unit}`)}
          ${row("Boxes/Bags", dp.boxes || "—")}
          ${row("Batch/Lot",  dp.batch  || "—")}
          ${row("Vehicle No", dp.vehicleNo)}
          ${row("Vehicle Type", dp.vehicleType)}
          ${row("Driver", dp.driverName)}
          ${row("Driver Phone", dp.driverPhone)}
          ${row("Departure Time", dp.departureTime)}
          ${row("E-Way Bill", dp.ewayBill || "—")}
          ${dp.qtyReceived != null ? row("Qty Received", `${dp.qtyReceived} ${dp.unit}`) : ""}
          ${dp.arrivalDate  ? row("Arrival Date", dp.arrivalDate) : ""}
          ${dp.arrivalTime  ? row("Arrival Time", dp.arrivalTime) : ""}
          ${dp.receivedByName ? row("Received By", dp.receivedByName) : ""}
          ${dp.receiptRemarks ? row("Receipt Remarks", dp.receiptRemarks) : ""}
          ${row("Remarks", dp.remarks || "—")}
        </table>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="this.closest('.modal-backdrop').remove()">Close</button>
      </div>
    </div>`;
  backdrop.querySelector(".btn-close").onclick = () => backdrop.remove();
  document.body.appendChild(backdrop);
};

function row(label, val) {
  return `<tr style="border-bottom:1px solid #eee">
    <td style="padding:.5rem .75rem;font-weight:600;color:#4a4a6a;width:40%">${label}</td>
    <td style="padding:.5rem .75rem">${val}</td>
  </tr>`;
}

function statusLabel(s) {
  const m = { dispatched: "Dispatched", "in-transit": "In Transit", received: "Received", discrepancy: "Discrepancy" };
  return m[s] || s;
}

