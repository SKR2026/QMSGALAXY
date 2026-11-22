// v1795361569
// cache-bust-v3
// ─────────────────────────────────────────────────────────────
//  PTMS – Receipt / Incoming Vehicle Module  (Phase 3)
//  Receiving plant confirms arrival, qty received.
//  Only the receiving plant can confirm receipt.
// ─────────────────────────────────────────────────────────────

import { db } from "./firebase.js";
import {
  collection, doc, getDocs, updateDoc, addDoc,
  query, orderBy, where, serverTimestamp, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { requirePlantUser } from "./auth.js";
import { sendReceiptEmail } from "./email.js";

// ── Entry point ───────────────────────────────────────────────
export async function showReceiptPage(container, user) {
  if (!requirePlantUser()) return;

  container.innerHTML = `
    <div class="page-title">📥 Incoming Vehicles</div>

    <!-- Pending receipts -->
    <div class="card section">
      <div class="card-header">
        <span>Awaiting Receipt Confirmation</span>
        <span class="badge badge-orange" id="pendingCount">…</span>
      </div>
      <div class="card-body" id="pendingList">
        <div class="spinner"></div>
      </div>
    </div>

    <!-- All received -->
    <div class="card section">
      <div class="card-header">
        <span>Received — History</span>
      </div>
      <div class="card-body">
        <div class="filter-bar">
          <input type="date" id="recvFilterFrom" title="From date">
          <input type="date" id="recvFilterTo"   title="To date">
          <button class="btn btn-outline btn-sm" id="recvFilterBtn">Filter</button>
        </div>
        <div id="receivedList"><div class="spinner"></div></div>
      </div>
    </div>
  `;

  container.querySelector("#recvFilterBtn").addEventListener("click", () => {
    loadReceivedList(user, container.querySelector("#receivedList"), {
      from: container.querySelector("#recvFilterFrom").value,
      to:   container.querySelector("#recvFilterTo").value,
    });
  });

  await Promise.all([
    loadPendingList(user, container.querySelector("#pendingList"),
                        container.querySelector("#pendingCount")),
    loadReceivedList(user, container.querySelector("#receivedList"), {}),
  ]);
}

// ── Pending (dispatched / in-transit) ────────────────────────
async function loadPendingList(user, listEl, countEl) {
  listEl.innerHTML = `<div class="spinner"></div>`;
  try {
    // Use simple query + client-side filter to avoid composite index requirement
    const baseQuery = user.role === "superAdmin"
      ? query(collection(db, "dispatches"))
      : query(collection(db, "dispatches"),
          where("toPlantId", "==", user.plantId))
    const allSnap = await getDocs(baseQuery);
    // Filter client-side for pending statuses
    const snap = {
      size: 0,
      empty: true,
      docs: allSnap.docs.filter(d => ["dispatched","in-transit"].includes(d.data().status)),
      forEach: function(fn) { this.docs.forEach(fn); }
    };
    snap.size = snap.docs.length;
    snap.empty = snap.size === 0;
    countEl.textContent = snap.size;

    if (snap.empty) {
      listEl.innerHTML = `<div class="empty-state"><div class="empty-icon">✅</div><p>No pending receipts. All clear!</p></div>`;
      return;
    }

    let rows = "";
    snap.forEach(d => {
      const dp = d.data();
      const dDate = dp.date || "—";
      rows += `
        <tr>
          <td><span class="dispatch-id">${dp.dispatchId}</span></td>
          <td>${dDate}</td>
          <td>${dp.fromPlantName}</td>
          <td>${dp.material}</td>
          <td>${dp.qtyDispatched} ${dp.unit}</td>
          <td>${dp.vehicleNo}</td>
          <td>${dp.driverName}</td>
          <td><span class="badge status-${dp.status}">${statusLabel(dp.status)}</span></td>
          <td>
            <button class="btn btn-success btn-sm" onclick="openReceiptModal('${d.id}')">Confirm Receipt</button>
          </td>
        </tr>`;
    });

    listEl.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Dispatch ID</th><th>Dispatch Date</th><th>From</th><th>Material</th>
            <th>Dispatched Qty</th><th>Vehicle No.</th><th>Driver</th>
            <th>Status</th><th></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  } catch (e) {
    listEl.innerHTML = `<div class="error-msg">Error: ${e.message}</div>`;
  }
}

// ── Received history ──────────────────────────────────────────
async function loadReceivedList(user, listEl, filters) {
  listEl.innerHTML = `<div class="spinner"></div>`;
  try {
    // Simple query + client-side filter to avoid composite index requirement
    const baseQuery = user.role === "superAdmin"
      ? query(collection(db, "dispatches"))
      : query(collection(db, "dispatches"),
          where("toPlantId", "==", user.plantId))


    const allSnap = await getDocs(baseQuery);
    // Filter client-side for received/discrepancy statuses
    const filteredDocs = allSnap.docs.filter(d =>
      ["received","discrepancy"].includes(d.data().status)
    );
    const snap = {
      size: filteredDocs.length,
      empty: filteredDocs.length === 0,
      docs: filteredDocs,
      forEach: function(fn) { this.docs.forEach(fn); }
    };

    if (snap.empty) {
      listEl.innerHTML = `<div class="empty-state"><div class="empty-icon">📦</div><p>No receipts recorded yet.</p></div>`;
      return;
    }

    let rows = "";
    snap.forEach(d => {
      const dp = d.data();
      const recvDate = dp.updatedAt?.toDate ? dp.updatedAt.toDate().toLocaleDateString("en-IN") : "—";
      const diff = dp.qtyReceived != null ? (dp.qtyReceived - dp.qtyDispatched) : null;
      const diffStr = diff != null
        ? `<span style="color:${diff < 0 ? '#c62828' : diff > 0 ? '#1565c0' : '#2e7d32'}">${diff > 0 ? "+" : ""}${diff}</span>`
        : "—";
      rows += `
        <tr>
          <td><span class="dispatch-id">${dp.dispatchId}</span></td>
          <td>${recvDate}</td>
          <td>${dp.fromPlantName}</td>
          <td>${dp.material}</td>
          <td>${dp.qtyDispatched} ${dp.unit}</td>
          <td>${dp.qtyReceived ?? "—"} ${dp.unit}</td>
          <td>${diffStr}</td>
          <td><span class="badge status-${dp.status}">${statusLabel(dp.status)}</span></td>
          <td>
            <button class="btn btn-outline btn-sm" onclick="viewDispatch('${d.id}')">View</button>
          </td>
        </tr>`;
    });

    listEl.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Dispatch ID</th><th>Received Date</th><th>From</th><th>Material</th>
            <th>Dispatched</th><th>Received</th><th>Difference</th>
            <th>Status</th><th></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  } catch (e) {
    listEl.innerHTML = `<div class="error-msg">Error: ${e.message}</div>`;
  }
}

// ── Confirm Receipt Modal ─────────────────────────────────────
window.openReceiptModal = async (dispatchDocId) => {
  const snap = await getDoc(doc(db, "dispatches", dispatchDocId));
  if (!snap.exists()) return;
  const dp = snap.data();

  const today = new Date().toISOString().split("T")[0];
  const now   = new Date().toTimeString().slice(0,5);

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <span>📥 Confirm Receipt — <span class="dispatch-id">${dp.dispatchId}</span></span>
        <button class="btn-close">✕</button>
      </div>
      <div class="modal-body">
        <!-- Dispatch summary (read-only) -->
        <div class="card mb-2" style="background:#f4f6fb">
          <div class="card-body" style="padding:.75rem 1rem">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem 1rem;font-size:.88rem">
              <div><strong>From:</strong> ${dp.fromPlantName}</div>
              <div><strong>Material:</strong> ${dp.material}</div>
              <div><strong>Dispatched Qty:</strong> <strong>${dp.qtyDispatched} ${dp.unit}</strong></div>
              <div><strong>Vehicle:</strong> ${dp.vehicleNo}</div>
              <div><strong>Driver:</strong> ${dp.driverName}</div>
              <div><strong>Dispatch Date:</strong> ${dp.date}</div>
            </div>
          </div>
        </div>

        <!-- Receipt form -->
        <div class="form-row">
          <div class="form-group">
            <label>Arrival Date *</label>
            <input type="date" id="rArrDate" value="${today}">
          </div>
          <div class="form-group">
            <label>Arrival Time *</label>
            <input type="time" id="rArrTime" value="${now}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Quantity Received *</label>
            <input type="number" id="rQtyRecv" placeholder="0.00" min="0" step="0.01"
              value="${dp.qtyDispatched}">
          </div>
          <div class="form-group">
            <label>No. of Boxes/Bags Received</label>
            <input type="number" id="rBoxesRecv" placeholder="0" min="0" value="${dp.boxes || 0}">
          </div>
        </div>
        <div class="form-row single">
          <div class="form-group">
            <label>Remarks / Condition Notes</label>
            <textarea id="rRemarks" placeholder="Note any shortage, excess, damaged goods…"></textarea>
          </div>
        </div>

        <div id="receiptCalc" class="card mt-1" style="background:#e3f2fd;border:1px solid #90caf9;display:none">
          <div class="card-body" style="padding:.6rem 1rem;font-size:.88rem" id="receiptCalcContent"></div>
        </div>

        <div id="receiptFormError" class="error-msg hidden mt-1"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" id="cancelReceiptBtn">Cancel</button>
        <button class="btn btn-success" id="confirmReceiptBtn">✅ Confirm Receipt</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  backdrop.querySelector(".btn-close").onclick       = () => backdrop.remove();
  backdrop.querySelector("#cancelReceiptBtn").onclick = () => backdrop.remove();

  // Live difference calc
  const qtyEl  = backdrop.querySelector("#rQtyRecv");
  const calcEl = backdrop.querySelector("#receiptCalc");
  const calcContent = backdrop.querySelector("#receiptCalcContent");
  qtyEl.addEventListener("input", () => {
    const recv = parseFloat(qtyEl.value);
    if (!isNaN(recv)) {
      const diff = recv - dp.qtyDispatched;
      const color = diff < 0 ? "#c62828" : diff > 0 ? "#1565c0" : "#2e7d32";
      const label = diff < 0 ? "⚠️ Shortage" : diff > 0 ? "ℹ️ Excess" : "✅ Exact Match";
      calcContent.innerHTML = `${label}: <strong style="color:${color}">${Math.abs(diff)} ${dp.unit}</strong>`;
      calcEl.style.display = "";
    }
  });

  backdrop.querySelector("#confirmReceiptBtn").onclick = async () => {
    await saveReceipt(backdrop, dispatchDocId, dp, window.__ptmsUser);
  };
};

async function saveReceipt(backdrop, dispatchDocId, dp, user) {
  const errEl    = backdrop.querySelector("#receiptFormError");
  const arrDate  = backdrop.querySelector("#rArrDate").value;
  const arrTime  = backdrop.querySelector("#rArrTime").value;
  const qtyRecv  = parseFloat(backdrop.querySelector("#rQtyRecv").value);
  const boxesRecv = parseInt(backdrop.querySelector("#rBoxesRecv").value || "0");
  const remarks  = backdrop.querySelector("#rRemarks").value.trim();

  errEl.classList.add("hidden");
  if (!arrDate || !arrTime) {
    errEl.textContent = "Arrival date and time are required.";
    errEl.classList.remove("hidden");
    return;
  }
  if (isNaN(qtyRecv) || qtyRecv < 0) {
    errEl.textContent = "Please enter a valid quantity received.";
    errEl.classList.remove("hidden");
    return;
  }

  const diff   = qtyRecv - dp.qtyDispatched;
  const status = Math.abs(diff) > 0.001 ? "discrepancy" : "received";

  const confirmBtn = backdrop.querySelector("#confirmReceiptBtn");
  confirmBtn.disabled = true;
  confirmBtn.textContent = "Saving…";

  try {
    await updateDoc(doc(db, "dispatches", dispatchDocId), {
      status,
      arrivalDate:    arrDate,
      arrivalTime:    arrTime,
      qtyReceived:    qtyRecv,
      boxesReceived:  boxesRecv,
      diffQty:        diff,
      receiptRemarks: remarks,
      receivedBy:     user.uid,
      receivedByName: user.name,
      receivedByPlant: user.plantId,
      updatedAt:      serverTimestamp(),
    });

    // Activity log
    await addDoc(collection(db, "activityLogs"), {
      action:     "RECEIPT_CONFIRMED",
      dispatchId: dp.dispatchId,
      userId:     user.uid,
      userName:   user.name,
      plantId:    user.plantId,
      plantName:  user.plantName,
      timestamp:  serverTimestamp(),
      details:    `Received ${qtyRecv} ${dp.unit}. Diff: ${diff}. Status: ${status}`,
    });

    window.showToast(`Receipt confirmed — ${status === "discrepancy" ? "Discrepancy noted!" : "All good!"}`,
                     status === "discrepancy" ? "error" : "success");
    backdrop.remove();

    // Send receipt / discrepancy email (non-blocking)
    sendReceiptEmail(dp, { arrivalDate: arrDate, arrivalTime: arrTime,
                           qtyReceived: qtyRecv, receiptRemarks: remarks }, user)
      .then(r => { if (r.sent) window.showToast("📧 Notification email sent.", "info", 2500); })
      .catch(() => {});

    // Refresh lists
    const user2 = window.__ptmsUser;
    const pend = document.querySelector("#pendingList");
    const pCnt = document.querySelector("#pendingCount");
    const recv = document.querySelector("#receivedList");
    if (pend && pCnt) await loadPendingList(user2, pend, pCnt);
    if (recv)         await loadReceivedList(user2, recv, {});
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove("hidden");
    confirmBtn.disabled = false;
    confirmBtn.textContent = "✅ Confirm Receipt";
  }
}

// ── Helpers ───────────────────────────────────────────────────
function statusLabel(s) {
  const m = { dispatched: "Dispatched", "in-transit": "In Transit", received: "Received", discrepancy: "Discrepancy" };
  return m[s] || s;
}

