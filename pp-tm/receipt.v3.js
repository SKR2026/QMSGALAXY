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
    <div class="modal" style="max-width:900px;width:96vw">
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
        <!-- Item-wise receipt table -->
        <div class="form-row single" style="margin-bottom:.5rem">
          <div class="form-group">
            <label style="font-weight:700;color:#1565c0">📋 Item-wise Receipt</label>
            <div style="margin-top:.4rem;overflow-x:visible">
              <table id="rItemsTable" style="width:100%;border-collapse:collapse;font-size:.86rem;table-layout:fixed">
                <thead>
                  <tr style="background:#e3f2fd">
                    <th style="padding:.4rem .5rem;text-align:center;border:1px solid #90caf9;width:36px">#</th>
                    <th style="padding:.4rem .5rem;text-align:left;border:1px solid #90caf9;width:90px">Part No.</th>
                    <th style="padding:.4rem .5rem;text-align:left;border:1px solid #90caf9">Part Name</th>
                    <th style="padding:.4rem .5rem;text-align:center;border:1px solid #90caf9;width:80px">Dispatched</th>
                    <th style="padding:.4rem .5rem;text-align:center;border:1px solid #90caf9;width:55px">Unit</th>
                    <th style="padding:.4rem .5rem;text-align:center;border:1px solid #90caf9;width:75px">Boxes Sent</th>
                    <th style="padding:.4rem .5rem;text-align:center;border:1px solid #90caf9;width:110px">Qty Received *</th>
                    <th style="padding:.4rem .5rem;text-align:center;border:1px solid #90caf9;width:85px">Boxes Recd</th>
                    <th style="padding:.4rem .5rem;text-align:center;border:1px solid #90caf9;width:70px">Diff</th>
                  </tr>
                </thead>
                <tbody id="rItemsBody">
                ${(() => {
                  const items = dp.items && dp.items.length
                    ? dp.items
                    : [{ partNo: "—", partName: dp.material || "—", qty: dp.qtyDispatched, unit: dp.unit, boxes: dp.boxes || 0 }];
                  return items.map((it, i) => `
                    <tr data-idx="${i}" style="${i%2===1?'background:#f8fbff':''}">
                      <td style="padding:.4rem .6rem;border:1px solid #d0dff0;text-align:center;color:#666">${i+1}</td>
                      <td style="padding:.4rem .6rem;border:1px solid #d0dff0;font-weight:600;color:#1565c0">${it.partNo||'—'}</td>
                      <td style="padding:.4rem .6rem;border:1px solid #d0dff0">${it.partName||it.description||'—'}</td>
                      <td style="padding:.4rem .6rem;border:1px solid #d0dff0;text-align:center;font-weight:700">${it.qty}</td>
                      <td style="padding:.4rem .6rem;border:1px solid #d0dff0;text-align:center;color:#555">${it.unit||dp.unit||''}</td>
                      <td style="padding:.4rem .6rem;border:1px solid #d0dff0;text-align:center;color:#555">${it.boxes||0}</td>
                      <td style="padding:.4rem .6rem;border:1px solid #d0dff0;text-align:center">
                        <input type="number" class="ri-qty" data-disp="${it.qty}" data-unit="${it.unit||dp.unit||''}"
                          value="${it.qty}" min="0" step="0.01"
                          style="width:80px;padding:.3rem .4rem;border:1.5px solid #90caf9;border-radius:6px;text-align:center;font-size:.87rem">
                      </td>
                      <td style="padding:.4rem .6rem;border:1px solid #d0dff0;text-align:center">
                        <input type="number" class="ri-boxes" value="${it.boxes||0}" min="0"
                          style="width:65px;padding:.3rem .4rem;border:1.5px solid #cde;border-radius:6px;text-align:center;font-size:.87rem">
                      </td>
                      <td class="ri-diff" style="padding:.4rem .6rem;border:1px solid #d0dff0;text-align:center;font-weight:700;color:#2e7d32">0</td>
                    </tr>`).join("");
                })()}
                </tbody>
                <tfoot>
                  <tr style="background:#e8f5e9;font-weight:700">
                    <td colspan="3" style="padding:.5rem .6rem;border:1px solid #90caf9;text-align:right;color:#1b5e20">Total</td>
                    <td id="rTotalDisp" style="padding:.5rem .6rem;border:1px solid #90caf9;text-align:center">${
                      (dp.items && dp.items.length ? dp.items.reduce((s,it)=>s+(parseFloat(it.qty)||0),0) : dp.qtyDispatched)
                    }</td>
                    <td style="padding:.5rem .6rem;border:1px solid #90caf9"></td>
                    <td style="padding:.5rem .6rem;border:1px solid #90caf9"></td>
                    <td id="rTotalRecv" style="padding:.5rem .6rem;border:1px solid #90caf9;text-align:center">${
                      (dp.items && dp.items.length ? dp.items.reduce((s,it)=>s+(parseFloat(it.qty)||0),0) : dp.qtyDispatched)
                    }</td>
                    <td style="padding:.5rem .6rem;border:1px solid #90caf9"></td>
                    <td id="rTotalDiff" style="padding:.5rem .6rem;border:1px solid #90caf9;text-align:center;color:#2e7d32">0</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>

        <div class="form-row single" style="margin-bottom:.35rem">
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

  // ── Live item-wise diff calc ──────────────────────────────────
  function recalcItemDiffs() {
    let totalDisp = 0, totalRecv = 0;
    backdrop.querySelectorAll("#rItemsBody tr[data-idx]").forEach(row => {
      const disp = parseFloat(row.querySelector(".ri-qty").dataset.disp) || 0;
      const recv = parseFloat(row.querySelector(".ri-qty").value) || 0;
      const diff = recv - disp;
      const diffCell = row.querySelector(".ri-diff");
      if (Math.abs(diff) < 0.001) {
        diffCell.textContent = "✅";
        diffCell.style.color = "#2e7d32";
      } else {
        diffCell.textContent = (diff > 0 ? "+" : "") + diff.toFixed(2);
        diffCell.style.color = diff < 0 ? "#c62828" : "#1565c0";
      }
      totalDisp += disp;
      totalRecv += recv;
    });
    const totalDiff = totalRecv - totalDisp;
    const tDiffEl = backdrop.querySelector("#rTotalDiff");
    backdrop.querySelector("#rTotalRecv").textContent = totalRecv.toFixed(2);
    if (Math.abs(totalDiff) < 0.001) {
      tDiffEl.textContent = "✅";
      tDiffEl.style.color = "#2e7d32";
    } else {
      tDiffEl.textContent = (totalDiff > 0 ? "+" : "") + totalDiff.toFixed(2);
      tDiffEl.style.color = totalDiff < 0 ? "#c62828" : "#1565c0";
    }
  }
  backdrop.querySelector("#rItemsBody").addEventListener("input", e => {
    if (e.target.classList.contains("ri-qty")) recalcItemDiffs();
  });
  recalcItemDiffs();

  backdrop.querySelector("#confirmReceiptBtn").onclick = async () => {
    await saveReceipt(backdrop, dispatchDocId, dp, window.__ptmsUser);
  };
};

// ── Save Receipt ──────────────────────────────────────────────
async function saveReceipt(backdrop, dispatchDocId, dp, user) {
  const errEl   = backdrop.querySelector("#receiptFormError");
  const arrDate = backdrop.querySelector("#rArrDate").value;
  const arrTime = backdrop.querySelector("#rArrTime").value;
  const remarks = backdrop.querySelector("#rRemarks").value.trim();

  errEl.classList.add("hidden");
  if (!arrDate||!arrTime) { errEl.textContent="Arrival date and time required."; errEl.classList.remove("hidden"); return; }

  // Collect item-wise received quantities
  const sourceItems = dp.items && dp.items.length
    ? dp.items
    : [{ partNo: "—", partName: dp.material || "—", qty: dp.qtyDispatched, unit: dp.unit, boxes: dp.boxes || 0 }];

  const itemsReceived = [];
  let totalQtyRecv = 0, totalBoxesRecv = 0;
  let hasInvalidQty = false;

  backdrop.querySelectorAll("#rItemsBody tr[data-idx]").forEach((row, i) => {
    const src = sourceItems[i] || {};
    const qtyRecv  = parseFloat(row.querySelector(".ri-qty").value);
    const boxesRecv = parseInt(row.querySelector(".ri-boxes").value || "0");
    if (isNaN(qtyRecv) || qtyRecv < 0) { hasInvalidQty = true; return; }
    const dispQty = parseFloat(src.qty) || 0;
    itemsReceived.push({
      partNo:      src.partNo  || "—",
      partName:    src.partName || src.description || "—",
      unit:        src.unit    || dp.unit || "",
      qtyDispatched: dispQty,
      boxesDispatched: src.boxes || 0,
      qtyReceived: qtyRecv,
      boxesReceived: boxesRecv,
      diffQty:     qtyRecv - dispQty,
    });
    totalQtyRecv   += qtyRecv;
    totalBoxesRecv += boxesRecv;
  });

  if (hasInvalidQty) { errEl.textContent="Enter valid quantities for all items."; errEl.classList.remove("hidden"); return; }

  const totalQtyDisp = sourceItems.reduce((s, it) => s + (parseFloat(it.qty)||0), 0);
  const diff   = totalQtyRecv - totalQtyDisp;
  const qtyRecv = totalQtyRecv;
  const boxesRecv = totalBoxesRecv;
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
      itemsReceived,                                  // ← item-wise receipt detail
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

    // Collect notifyPersons emails from both from-plant and to-plant
    (async () => {
      try {
        const plantNotifyEmails = [];
        const plantIds = [dp.fromPlantId, dp.toPlantId].filter(Boolean);
        await Promise.all(plantIds.map(async (pid) => {
          const pSnap = await getDoc(doc(db, "plants", pid));
          if (!pSnap.exists()) return;
          const persons = pSnap.data().notifyPersons || [];
          persons.forEach(p => {
            (p.emails || []).forEach(e => {
              if (e && !plantNotifyEmails.includes(e)) plantNotifyEmails.push(e);
            });
          });
        }));
        return sendReceiptEmail(
          dp,
          { arrivalDate:arrDate, arrivalTime:arrTime, qtyReceived:qtyRecv, receiptRemarks:remarks, plantNotifyEmails },
          user
        );
      } catch(err) {
        console.warn("Plant notify fetch failed, sending without plant contacts:", err);
        return sendReceiptEmail(dp,{arrivalDate:arrDate,arrivalTime:arrTime,qtyReceived:qtyRecv,receiptRemarks:remarks},user);
      }
    })().then(r=>{ if(r&&r.sent) window.showToast("📧 Notification sent.","info",2500); }).catch(()=>{});

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

// ── Dispatch Detail / View modal ──────────────────────────────
window.viewDispatch = async (dispatchDocId) => {
  const snap = await getDoc(doc(db, "dispatches", dispatchDocId));
  if (!snap.exists()) return;
  const dp = snap.data();

  // Build item-wise comparison table
  const dispItems = dp.items && dp.items.length
    ? dp.items
    : [{ partNo:"—", partName: dp.material||"—", qty: dp.qtyDispatched, unit: dp.unit, boxes: dp.boxes||0 }];

  const recvItems = dp.itemsReceived && dp.itemsReceived.length ? dp.itemsReceived : null;

  const itemRows = dispItems.map((it, i) => {
    const rv = recvItems ? (recvItems[i] || {}) : null;
    const dispQty  = parseFloat(it.qty) || 0;
    const recvQty  = rv ? (parseFloat(rv.qtyReceived) ?? "—") : "—";
    const diff     = rv ? (parseFloat(rv.qtyReceived) - dispQty) : null;
    const diffStr  = diff == null ? "—"
      : Math.abs(diff) < 0.001
        ? `<span style="color:#2e7d32">✅ Match</span>`
        : `<span style="color:${diff<0?"#c62828":"#1565c0"};font-weight:700">${diff>0?"+":""}${diff}</span>`;
    const rowBg = diff != null && Math.abs(diff) > 0.001
      ? (diff < 0 ? "background:#fff5f5" : "background:#f0f4ff")
      : (i%2===1 ? "background:#f8fbff" : "");
    return `<tr style="${rowBg}">
      <td style="padding:.4rem .6rem;border:1px solid #d0dff0;text-align:center;color:#666">${i+1}</td>
      <td style="padding:.4rem .6rem;border:1px solid #d0dff0;font-weight:600;color:#1565c0">${it.partNo||"—"}</td>
      <td style="padding:.4rem .6rem;border:1px solid #d0dff0">${it.partName||it.description||"—"}</td>
      <td style="padding:.4rem .6rem;border:1px solid #d0dff0;text-align:center">${it.unit||dp.unit||""}</td>
      <td style="padding:.4rem .6rem;border:1px solid #d0dff0;text-align:center;font-weight:700">${dispQty}</td>
      <td style="padding:.4rem .6rem;border:1px solid #d0dff0;text-align:center;color:#555">${it.boxes||0}</td>
      <td style="padding:.4rem .6rem;border:1px solid #d0dff0;text-align:center;font-weight:700;color:#333">${recvQty !== "—" ? recvQty : "—"}</td>
      <td style="padding:.4rem .6rem;border:1px solid #d0dff0;text-align:center;color:#555">${rv ? (rv.boxesReceived||0) : "—"}</td>
      <td style="padding:.4rem .6rem;border:1px solid #d0dff0;text-align:center">${diffStr}</td>
    </tr>`;
  }).join("");

  const totalDispQty = dispItems.reduce((s,it)=>s+(parseFloat(it.qty)||0),0);
  const totalRecvQty = recvItems ? recvItems.reduce((s,it)=>s+(parseFloat(it.qtyReceived)||0),0) : null;
  const totalDiff    = totalRecvQty != null ? totalRecvQty - totalDispQty : null;
  const totalDiffStr = totalDiff == null ? "—"
    : Math.abs(totalDiff) < 0.001
      ? `<span style="color:#2e7d32">✅ Match</span>`
      : `<span style="color:${totalDiff<0?"#c62828":"#1565c0"};font-weight:700">${totalDiff>0?"+":""}${totalDiff}</span>`;

  const photoHtml = dp.photoEvidence?.length
    ? dp.photoEvidence.map(url=>`<img src="${url}" onclick="window.open('${url}','_blank')"
        style="width:72px;height:72px;object-fit:cover;border-radius:8px;border:2px solid #c62828;cursor:pointer;margin:3px" title="Click to view">`).join("")
    : `<span style="color:#aaa;font-size:.85rem">None</span>`;

  const statusColor = {received:"#2e7d32",discrepancy:"#c62828",dispatched:"#1565c0","in-transit":"#e65100"}[dp.status]||"#555";

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal" style="max-width:860px;width:96vw">
      <div class="modal-header">
        <span>📋 Dispatch Details — <span class="dispatch-id">${dp.dispatchId}</span></span>
        <button class="btn-close" onclick="this.closest('.modal-backdrop').remove()">✕</button>
      </div>
      <div class="modal-body" style="padding:1rem 1.25rem">

        <!-- Summary info grid -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.45rem 1.5rem;font-size:.87rem;
          background:#f4f6fb;border-radius:10px;padding:.85rem 1rem;margin-bottom:1rem">
          <div><span style="color:#666">From Plant</span><br><strong>${dp.fromPlantName||"—"}</strong></div>
          <div><span style="color:#666">To Plant</span><br><strong>${dp.toPlantName||"—"}</strong></div>
          <div><span style="color:#666">Vehicle No</span><br><strong>${dp.vehicleNo||"—"}</strong></div>
          <div><span style="color:#666">Driver</span><br><strong>${dp.driverName||"—"}${dp.driverContact||dp.driverPhone ? ` · <span style="color:#555">${dp.driverContact||dp.driverPhone}</span>` : ""}</strong></div>
          <div><span style="color:#666">Dispatch Date</span><br><strong>${dp.date||"—"}</strong></div>
          <div><span style="color:#666">Departure Time</span><br><strong>${dp.departureTime||"—"}</strong></div>
          <div><span style="color:#666">Status</span><br><strong style="color:${statusColor}">${statusLabel(dp.status)}</strong></div>
          <div><span style="color:#666">E-Way Bill</span><br><strong>${dp.ewayBill||"—"}</strong></div>
          ${dp.remarks ? `<div style="grid-column:1/-1"><span style="color:#666">Dispatch Remarks</span><br><strong>${dp.remarks}</strong></div>` : ""}
        </div>

        <!-- Item-wise comparison table -->
        <div style="font-weight:700;color:#1565c0;margin-bottom:.5rem;font-size:.93rem">📋 Item-wise Details</div>
        <div style="overflow-x:auto;margin-bottom:1rem">
          <table style="width:100%;border-collapse:collapse;font-size:.86rem;table-layout:fixed">
            <thead>
              <tr style="background:#1a2b4a;color:#fff">
                <th style="padding:.45rem .5rem;border:1px solid #2d4070;width:36px;text-align:center">#</th>
                <th style="padding:.45rem .5rem;border:1px solid #2d4070;width:95px;text-align:left">Part No.</th>
                <th style="padding:.45rem .5rem;border:1px solid #2d4070;text-align:left">Part Name</th>
                <th style="padding:.45rem .5rem;border:1px solid #2d4070;width:50px;text-align:center">Unit</th>
                <th style="padding:.45rem .5rem;border:1px solid #2d4070;width:80px;text-align:center">Dispatched</th>
                <th style="padding:.45rem .5rem;border:1px solid #2d4070;width:70px;text-align:center">Boxes Sent</th>
                <th style="padding:.45rem .5rem;border:1px solid #2d4070;width:80px;text-align:center">Received</th>
                <th style="padding:.45rem .5rem;border:1px solid #2d4070;width:70px;text-align:center">Boxes Recd</th>
                <th style="padding:.45rem .5rem;border:1px solid #2d4070;width:90px;text-align:center">Difference</th>
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
            <tfoot>
              <tr style="background:#e8f5e9;font-weight:700">
                <td colspan="4" style="padding:.5rem .6rem;border:1px solid #90caf9;text-align:right;color:#1b5e20">Total</td>
                <td style="padding:.5rem .6rem;border:1px solid #90caf9;text-align:center">${totalDispQty}</td>
                <td style="padding:.5rem .6rem;border:1px solid #90caf9"></td>
                <td style="padding:.5rem .6rem;border:1px solid #90caf9;text-align:center">${totalRecvQty??'—'}</td>
                <td style="padding:.5rem .6rem;border:1px solid #90caf9"></td>
                <td style="padding:.5rem .6rem;border:1px solid #90caf9;text-align:center">${totalDiffStr}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <!-- Receipt info (if confirmed) -->
        ${dp.arrivalDate ? `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.45rem 1.5rem;font-size:.87rem;
          background:${dp.status==="discrepancy"?"#fff5f5":"#f1f8e9"};border-radius:10px;padding:.85rem 1rem;margin-bottom:1rem;
          border:1px solid ${dp.status==="discrepancy"?"#ffcdd2":"#c5e1a5"}">
          <div style="grid-column:1/-1;font-weight:700;color:${statusColor};margin-bottom:.3rem">
            ${dp.status==="discrepancy"?"⚠️ Discrepancy Recorded":"✅ Receipt Confirmed"}
          </div>
          <div><span style="color:#666">Arrival Date</span><br><strong>${dp.arrivalDate}</strong></div>
          <div><span style="color:#666">Arrival Time</span><br><strong>${dp.arrivalTime||"—"}</strong></div>
          <div><span style="color:#666">Received By</span><br><strong>${dp.receivedByName||"—"}</strong></div>
          <div><span style="color:#666">Total Received</span><br><strong>${dp.qtyReceived??'—'} ${dp.unit||""}</strong></div>
          ${dp.receiptRemarks ? `<div style="grid-column:1/-1"><span style="color:#666">Receipt Remarks</span><br><strong>${dp.receiptRemarks}</strong></div>` : ""}
        </div>` : ""}

        <!-- Photo evidence -->
        ${dp.photoEvidence?.length ? `
        <div style="margin-bottom:.5rem">
          <div style="font-weight:700;color:#c62828;margin-bottom:.4rem;font-size:.88rem">📷 Photo Evidence</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">${photoHtml}</div>
        </div>` : ""}

      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="this.closest('.modal-backdrop').remove()">Close</button>
      </div>
    </div>`;

  document.body.appendChild(backdrop);
  backdrop.querySelector(".btn-close").onclick = () => backdrop.remove();
};
