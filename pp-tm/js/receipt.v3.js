// ─────────────────────────────────────────────────────────────
//  PTMS – Receipt / Incoming Vehicle Module  (Phase 3)
//  Receiving plant confirms arrival, qty received.
//  Photo evidence support for discrepancies.
// ─────────────────────────────────────────────────────────────

import { db } from "./firebase.v2.js";
import {
  collection, doc, getDocs, updateDoc, addDoc,
  query, orderBy, where, serverTimestamp, getDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { requirePlantUser } from "./auth.v2.js";
import { sendReceiptEmail } from "./email.v2.js";

const storage = getStorage();

// ── Entry point ───────────────────────────────────────────────
export async function showReceiptPage(container, user) {
  if (!requirePlantUser()) return;

  container.innerHTML = `
    <div class="page-title">📥 Incoming Vehicles</div>
    <div class="card section">
      <div class="card-header">
        <span>Awaiting Receipt Confirmation</span>
        <span class="badge badge-orange" id="pendingCount">…</span>
      </div>
      <div class="card-body" id="pendingList"><div class="spinner"></div></div>
    </div>
    <div class="card section">
      <div class="card-header"><span>Received — History</span></div>
      <div class="card-body">
        <div class="filter-bar">
          <input type="date" id="recvFilterFrom" title="From date">
          <input type="date" id="recvFilterTo"   title="To date">
          <button class="btn btn-outline btn-sm" id="recvFilterBtn">Filter</button>
        </div>
        <div id="receivedList"><div class="spinner"></div></div>
      </div>
    </div>`;

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

// ── Pending ───────────────────────────────────────────────────
async function loadPendingList(user, listEl, countEl) {
  listEl.innerHTML = `<div class="spinner"></div>`;
  const isSA = user.role === "superAdmin";
  try {
    const baseQuery = isSA
      ? query(collection(db, "dispatches"))
      : query(collection(db, "dispatches"), where("toPlantId", "==", user.plantId));
    const allSnap = await getDocs(baseQuery);
    const docs = allSnap.docs
      .filter(d => ["dispatched","in-transit"].includes(d.data().status))
      .sort((a,b) => (a.data().createdAt?.seconds||0) - (b.data().createdAt?.seconds||0));
    countEl.textContent = docs.length;
    if (!docs.length) {
      listEl.innerHTML = `<div class="empty-state"><div class="empty-icon">✅</div><p>No pending receipts. All clear!</p></div>`;
      return;
    }
    let rows = "";
    docs.forEach(d => {
      const dp = d.data();
      const dispDT=dp.createdAt?.toDate?dp.createdAt.toDate().toLocaleString("en-IN"):(dp.date||"—");
      rows += `<tr data-doc-id="${d.id}">
        ${isSA ? `<td style="width:36px;text-align:center"><input type="checkbox" class="recv-chk" data-id="${d.id}" style="width:16px;height:16px;cursor:pointer"></td>` : ""}
        <td><span class="dispatch-id">${dp.dispatchId}</span></td>
        <td>${dispDT}</td><td>${dp.fromPlantName}</td><td>${dp.material}</td>
        <td>${dp.qtyDispatched} ${dp.unit}</td><td>${dp.vehicleNo}</td><td>${dp.driverName}</td>
        <td><span class="badge status-${dp.status}">${statusLabel(dp.status)}</span></td>
        <td><button class="btn btn-success btn-sm" onclick="openReceiptModal('${d.id}')">Confirm Receipt</button></td>
      </tr>`;
    });
    listEl.innerHTML = `
      ${isSA ? `
        <div id="pendingBulkBar" style="display:none;align-items:center;gap:.7rem;margin-bottom:.6rem;padding:.5rem .75rem;background:#fff3f3;border:1.5px solid #c62828;border-radius:8px">
          <span id="pendingSelCount" style="font-weight:700;color:#c62828;font-size:.9rem">0 selected</span>
          <button id="pendingDeleteBtn" class="btn btn-sm" style="background:#c62828;color:#fff;border:none;padding:.35rem .9rem;border-radius:6px;font-weight:700;cursor:pointer">🗑 Delete Selected</button>
          <button id="pendingDeselectBtn" class="btn btn-outline btn-sm">✕ Deselect All</button>
        </div>` : ""}
      <div class="table-wrap"><table>
        <thead><tr>
          ${isSA ? `<th style="width:36px"><input type="checkbox" id="pendingSelectAll" style="width:16px;height:16px;cursor:pointer" title="Select all"></th>` : ""}
          <th>Dispatch ID</th><th>Dispatch Date/Time</th><th>From</th><th>Material</th>
          <th>Dispatched Qty</th><th>Vehicle</th><th>Driver</th><th>Status</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;

    if (isSA) {
      const bulkBar  = listEl.querySelector("#pendingBulkBar");
      const selCount = listEl.querySelector("#pendingSelCount");
      const selAll   = listEl.querySelector("#pendingSelectAll");

      function updateBar() {
        const checked = listEl.querySelectorAll(".recv-chk:checked");
        const n = checked.length;
        bulkBar.style.display = n > 0 ? "flex" : "none";
        selCount.textContent = `${n} selected`;
        if (selAll) selAll.checked = n === listEl.querySelectorAll(".recv-chk").length;
      }

      listEl.addEventListener("change", e => {
        if (e.target.classList.contains("recv-chk") || e.target.id === "pendingSelectAll") {
          if (e.target.id === "pendingSelectAll") {
            listEl.querySelectorAll(".recv-chk").forEach(c => c.checked = e.target.checked);
          }
          updateBar();
        }
      });

      listEl.querySelector("#pendingDeselectBtn").addEventListener("click", () => {
        listEl.querySelectorAll(".recv-chk").forEach(c => c.checked = false);
        if (selAll) selAll.checked = false;
        updateBar();
      });

      listEl.querySelector("#pendingDeleteBtn").addEventListener("click", async () => {
        const checked = [...listEl.querySelectorAll(".recv-chk:checked")];
        if (!checked.length) return;
        if (!confirm(`Permanently delete ${checked.length} dispatch record(s)? This cannot be undone.`)) return;
        try {
          await Promise.all(checked.map(c => deleteDoc(doc(db, "dispatches", c.dataset.id))));
          window.showToast(`${checked.length} record(s) deleted.`, "success");
          const pCnt = document.querySelector("#pendingCount");
          await loadPendingList(user, listEl, pCnt || countEl);
        } catch (e) {
          window.showToast("Delete failed: " + e.message, "error");
        }
      });
    }
  } catch(e) { listEl.innerHTML = `<div class="error-msg">Error: ${e.message}</div>`; }
}

// ── Received history ──────────────────────────────────────────
async function loadReceivedList(user, listEl, filters) {
  listEl.innerHTML = `<div class="spinner"></div>`;
  const isSA = user.role === "superAdmin";
  try {
    const baseQuery = isSA
      ? query(collection(db, "dispatches"))
      : query(collection(db, "dispatches"), where("toPlantId", "==", user.plantId));
    const allSnap = await getDocs(baseQuery);
    const docs = allSnap.docs
      .filter(d => ["received","discrepancy"].includes(d.data().status))
      .sort((a,b) => (b.data().createdAt?.seconds||0) - (a.data().createdAt?.seconds||0));
    if (!docs.length) {
      listEl.innerHTML = `<div class="empty-state"><div class="empty-icon">📦</div><p>No receipts recorded yet.</p></div>`;
      return;
    }
    let rows = "";
    docs.forEach(d => {
      const dp = d.data();
      const recvDate = dp.updatedAt?.toDate ? dp.updatedAt.toDate().toLocaleDateString("en-IN") : "—";
      const diff = dp.qtyReceived != null ? dp.qtyReceived - dp.qtyDispatched : null;
      const diffStr = diff != null
        ? `<span style="color:${diff<0?"#c62828":diff>0?"#1565c0":"#2e7d32"};font-weight:700">${diff>0?"+":""}${diff}</span>`
        : "—";
      const photoThumb = dp.photoEvidence?.length
        ? `<div style="display:flex;gap:3px;flex-wrap:wrap;margin-bottom:4px">
            ${dp.photoEvidence.map(url=>`<img src="${url}" onclick="window.open('${url}','_blank')"
              style="width:38px;height:38px;object-fit:cover;border-radius:5px;border:2px solid #c62828;cursor:pointer" title="View photo">`).join("")}
           </div>` : "";
      const dispDT2=dp.createdAt?.toDate?dp.createdAt.toDate().toLocaleString("en-IN"):(dp.date||"—");
      rows += `<tr data-doc-id="${d.id}">
        ${isSA ? `<td style="width:36px;text-align:center"><input type="checkbox" class="hist-chk" data-id="${d.id}" style="width:16px;height:16px;cursor:pointer"></td>` : ""}
        <td><span class="dispatch-id">${dp.dispatchId}</span></td>
        <td>${dispDT2}</td><td>${recvDate}</td><td>${dp.fromPlantName}</td><td>${dp.material}</td>
        <td>${dp.qtyDispatched} ${dp.unit}</td><td>${dp.qtyReceived??'—'} ${dp.unit}</td>
        <td>${diffStr}</td>
        <td><span class="badge status-${dp.status}">${statusLabel(dp.status)}</span></td>
        <td>${photoThumb}<button class="btn btn-outline btn-sm" onclick="viewDispatch('${d.id}')">View</button></td>
      </tr>`;
    });
    listEl.innerHTML = `
      ${isSA ? `
        <div id="histBulkBar" style="display:none;align-items:center;gap:.7rem;margin-bottom:.6rem;padding:.5rem .75rem;background:#fff3f3;border:1.5px solid #c62828;border-radius:8px">
          <span id="histSelCount" style="font-weight:700;color:#c62828;font-size:.9rem">0 selected</span>
          <button id="histDeleteBtn" class="btn btn-sm" style="background:#c62828;color:#fff;border:none;padding:.35rem .9rem;border-radius:6px;font-weight:700;cursor:pointer">🗑 Delete Selected</button>
          <button id="histDeselectBtn" class="btn btn-outline btn-sm">✕ Deselect All</button>
        </div>` : ""}
      <div class="table-wrap"><table>
        <thead><tr>
          ${isSA ? `<th style="width:36px"><input type="checkbox" id="histSelectAll" style="width:16px;height:16px;cursor:pointer" title="Select all"></th>` : ""}
          <th>Dispatch ID</th><th>Dispatch Date/Time</th><th>Receipt Date/Time</th><th>From</th><th>Material</th>
          <th>Dispatched</th><th>Received</th><th>Difference</th><th>Status</th><th>Photos</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;

    if (isSA) {
      const bulkBar  = listEl.querySelector("#histBulkBar");
      const selCount = listEl.querySelector("#histSelCount");
      const selAll   = listEl.querySelector("#histSelectAll");

      function updateBar() {
        const checked = listEl.querySelectorAll(".hist-chk:checked");
        const n = checked.length;
        bulkBar.style.display = n > 0 ? "flex" : "none";
        selCount.textContent = `${n} selected`;
        if (selAll) selAll.checked = n === listEl.querySelectorAll(".hist-chk").length;
      }

      listEl.addEventListener("change", e => {
        if (e.target.classList.contains("hist-chk") || e.target.id === "histSelectAll") {
          if (e.target.id === "histSelectAll") {
            listEl.querySelectorAll(".hist-chk").forEach(c => c.checked = e.target.checked);
          }
          updateBar();
        }
      });

      listEl.querySelector("#histDeselectBtn").addEventListener("click", () => {
        listEl.querySelectorAll(".hist-chk").forEach(c => c.checked = false);
        if (selAll) selAll.checked = false;
        updateBar();
      });

      listEl.querySelector("#histDeleteBtn").addEventListener("click", async () => {
        const checked = [...listEl.querySelectorAll(".hist-chk:checked")];
        if (!checked.length) return;
        if (!confirm(`Permanently delete ${checked.length} receipt record(s)? This cannot be undone.`)) return;
        try {
          await Promise.all(checked.map(c => deleteDoc(doc(db, "dispatches", c.dataset.id))));
          window.showToast(`${checked.length} record(s) deleted.`, "success");
          await loadReceivedList(user, listEl, filters);
        } catch (e) {
          window.showToast("Delete failed: " + e.message, "error");
        }
      });
    }
  } catch(e) { listEl.innerHTML = `<div class="error-msg">Error: ${e.message}</div>`; }
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
            <input type="number" id="rQtyRecv" placeholder="0.00" min="0" step="0.01" value="${dp.qtyDispatched}">
          </div>
          <div class="form-group">
            <label>No. of Boxes/Bags Received</label>
            <input type="number" id="rBoxesRecv" placeholder="0" min="0" value="${dp.boxes||0}">
          </div>
        </div>
        <div class="form-row single">
          <div class="form-group">
            <label>Remarks / Condition Notes</label>
            <textarea id="rRemarks" placeholder="Note any shortage, excess, damaged goods…"></textarea>
          </div>
        </div>

        <!-- Photo evidence -->
        <div class="form-row single">
          <div class="form-group">
            <label>📷 Photo Evidence
              <span style="font-weight:400;color:#888;font-size:.78rem"> — optional, for discrepancies (max 5)</span>
            </label>
            <div style="display:flex;gap:.6rem;flex-wrap:wrap;margin-bottom:.5rem">
              <label for="rPhotoCam" style="display:inline-flex;align-items:center;gap:.4rem;padding:.42rem 1rem;
                border-radius:8px;border:1.5px solid #1565c0;color:#1565c0;font-weight:700;font-size:.85rem;cursor:pointer;background:#fff">
                📷 Camera
                <input type="file" id="rPhotoCam" accept="image/*" capture="environment" multiple style="display:none">
              </label>
              <label for="rPhotoGal" style="display:inline-flex;align-items:center;gap:.4rem;padding:.42rem 1rem;
                border-radius:8px;border:1.5px solid #2e7d32;color:#2e7d32;font-weight:700;font-size:.85rem;cursor:pointer;background:#fff">
                🖼 Gallery
                <input type="file" id="rPhotoGal" accept="image/*" multiple style="display:none">
              </label>
            </div>
            <div id="rPhotoPreview" style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.3rem"></div>
            <div id="rPhotoCount" style="font-size:.78rem;color:#888;margin-top:.3rem"></div>
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

  // ── Photo selection ───────────────────────────────────────────
  const selectedFiles = [];
  function addFiles(files) {
    Array.from(files).forEach(file => {
      if (!file.type.startsWith("image/")) return;
      if (selectedFiles.length >= 5) { window.showToast("Max 5 photos allowed","error"); return; }
      selectedFiles.push(file);
      const reader = new FileReader();
      reader.onload = e => {
        const preview = backdrop.querySelector("#rPhotoPreview");
        const wrap = document.createElement("div");
        wrap.style.cssText = "position:relative;display:inline-block";
        const idx = selectedFiles.length - 1;
        wrap.innerHTML = `
          <img src="${e.target.result}" style="width:72px;height:72px;object-fit:cover;border-radius:8px;border:2px solid #d0d0e8">
          <button data-idx="${idx}" style="position:absolute;top:-6px;right:-6px;background:#c62828;
            color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:.7rem;cursor:pointer;line-height:1">✕</button>`;
        wrap.querySelector("button").addEventListener("click", ev => {
          const i = parseInt(ev.target.dataset.idx);
          selectedFiles.splice(i,1);
          wrap.remove();
          backdrop.querySelector("#rPhotoCount").textContent =
            selectedFiles.length ? `${selectedFiles.length} photo(s) selected` : "";
          backdrop.querySelectorAll("#rPhotoPreview button[data-idx]")
            .forEach((btn,ni) => btn.dataset.idx = ni);
        });
        preview.appendChild(wrap);
        backdrop.querySelector("#rPhotoCount").textContent = `${selectedFiles.length} photo(s) selected`;
      };
      reader.readAsDataURL(file);
    });
  }
  backdrop.querySelector("#rPhotoCam").addEventListener("change", e => addFiles(e.target.files));
  backdrop.querySelector("#rPhotoGal").addEventListener("change", e => addFiles(e.target.files));
  backdrop.__photos = selectedFiles;

  // ── Live diff calc ────────────────────────────────────────────
  const qtyEl = backdrop.querySelector("#rQtyRecv");
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

// ── Save Receipt ──────────────────────────────────────────────
async function saveReceipt(backdrop, dispatchDocId, dp, user) {
  const errEl    = backdrop.querySelector("#receiptFormError");
  const arrDate  = backdrop.querySelector("#rArrDate").value;
  const arrTime  = backdrop.querySelector("#rArrTime").value;
  const qtyRecv  = parseFloat(backdrop.querySelector("#rQtyRecv").value);
  const boxesRecv= parseInt(backdrop.querySelector("#rBoxesRecv").value||"0");
  const remarks  = backdrop.querySelector("#rRemarks").value.trim();

  errEl.classList.add("hidden");
  if (!arrDate||!arrTime) { errEl.textContent="Arrival date and time required."; errEl.classList.remove("hidden"); return; }
  if (isNaN(qtyRecv)||qtyRecv<0) { errEl.textContent="Enter a valid quantity."; errEl.classList.remove("hidden"); return; }

  const diff   = qtyRecv - dp.qtyDispatched;
  const status = Math.abs(diff) > 0.001 ? "discrepancy" : "received";

  const confirmBtn = backdrop.querySelector("#confirmReceiptBtn");
  confirmBtn.disabled = true;
  confirmBtn.textContent = "Saving…";

  try {
    // Upload photos
    const photoUrls = [];
    const photos = backdrop.__photos || [];
    for (let i = 0; i < photos.length; i++) {
      confirmBtn.textContent = `Uploading photo ${i+1}/${photos.length}…`;
      const ext = photos[i].name.split(".").pop() || "jpg";
      const storRef = ref(storage, `discrepancy-photos/${dispatchDocId}/${Date.now()}_${i}.${ext}`);
      await uploadBytes(storRef, photos[i]);
      photoUrls.push(await getDownloadURL(storRef));
    }
    confirmBtn.textContent = "Saving…";

    await updateDoc(doc(db, "dispatches", dispatchDocId), {
      status, arrivalDate:arrDate, arrivalTime:arrTime,
      qtyReceived:qtyRecv, boxesReceived:boxesRecv,
      diffQty:diff, receiptRemarks:remarks,
      receivedBy:user.uid, receivedByName:user.name,
      receivedByPlant:user.plantId,
      photoEvidence: photoUrls,
      updatedAt:serverTimestamp(),
    });

    await addDoc(collection(db,"activityLogs"),{
      action:"RECEIPT_CONFIRMED", dispatchId:dp.dispatchId,
      userId:user.uid, userName:user.name,
      plantId:user.plantId, plantName:user.plantName,
      timestamp:serverTimestamp(),
      details:`Received ${qtyRecv} ${dp.unit}. Diff: ${diff}. Status: ${status}. Photos: ${photoUrls.length}`,
    });

    window.showToast(
      status==="discrepancy" ? "⚠️ Discrepancy noted!" : "✅ Receipt confirmed!",
      status==="discrepancy" ? "error" : "success"
    );
    backdrop.remove();

    sendReceiptEmail(dp,{arrivalDate:arrDate,arrivalTime:arrTime,qtyReceived:qtyRecv,receiptRemarks:remarks},user)
      .then(r=>{ if(r.sent) window.showToast("📧 Notification sent.","info",2500); })
      .catch(()=>{});

    const user2=window.__ptmsUser;
    const pend=document.querySelector("#pendingList");
    const pCnt=document.querySelector("#pendingCount");
    const recv=document.querySelector("#receivedList");
    if(pend&&pCnt) await loadPendingList(user2,pend,pCnt);
    if(recv)       await loadReceivedList(user2,recv,{});
  } catch(e) {
    errEl.textContent=e.message;
    errEl.classList.remove("hidden");
    confirmBtn.disabled=false;
    confirmBtn.textContent="✅ Confirm Receipt";
  }
}

function statusLabel(s){
  return{dispatched:"Dispatched","in-transit":"In Transit",received:"Received",discrepancy:"Discrepancy"}[s]||s;
}
