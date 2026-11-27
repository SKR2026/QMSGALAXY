// ─────────────────────────────────────────────────────────────
//  PTMS – Dispatch Detail Modal
//  Shared by management.html and index.html
//
//  Usage (management.html / any page with its own Firebase db):
//    import { initDispatchDetail } from "./js/dispatch-detail.js";
//    initDispatchDetail(db);   // sets window.showDispatchDetail
//
//  Usage (index.html via firebase.v2.js):
//    import { initDispatchDetail } from "./js/dispatch-detail.js?v=1";
//    import { db } from "./firebase.v2.js?v=1";
//    initDispatchDetail(db);
// ─────────────────────────────────────────────────────────────

import { doc, getDoc }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const SC = { received:"#2e7d32", discrepancy:"#c62828", dispatched:"#1565c0", "in-transit":"#e65100" };
const SL = { dispatched:"Dispatched", "in-transit":"In Transit", received:"Received", discrepancy:"Discrepancy" };

export function initDispatchDetail(db) {
  window.showDispatchDetail = async (docId) => {
    const snap = await getDoc(doc(db, "dispatches", docId));
    if (!snap.exists()) return;
    const dp = snap.data();

    const dispItems = dp.items && dp.items.length
      ? dp.items
      : [{ partNo:"—", partName: dp.material||"—", qty: dp.qtyDispatched, unit: dp.unit||"", boxes: dp.boxes||0 }];
    const recvItems = dp.itemsReceived && dp.itemsReceived.length ? dp.itemsReceived : null;

    const itemRows = dispItems.map((it, i) => {
      const rv      = recvItems ? (recvItems[i] || {}) : null;
      const dispQty = parseFloat(it.qty) || 0;
      const recvQty = rv ? (parseFloat(rv.qtyReceived) ?? "—") : "—";
      const diff    = rv ? (parseFloat(rv.qtyReceived) - dispQty) : null;
      const diffStr = diff == null ? "—"
        : Math.abs(diff) < 0.001
          ? `<span style="color:#2e7d32;font-weight:700">✅ Match</span>`
          : `<span style="color:${diff<0?"#c62828":"#1565c0"};font-weight:700">${diff>0?"+":""}${diff}</span>`;
      const bg = diff != null && Math.abs(diff) > 0.001
        ? (diff < 0 ? "#fff5f5" : "#f0f4ff") : (i%2 ? "#f8fbff" : "#fff");
      return `<tr style="background:${bg}">
        <td style="padding:.4rem .5rem;border:1px solid #d0dff0;text-align:center;color:#666">${i+1}</td>
        <td style="padding:.4rem .5rem;border:1px solid #d0dff0;font-weight:600;color:#1565c0">${it.partNo||"—"}</td>
        <td style="padding:.4rem .5rem;border:1px solid #d0dff0">${it.partName||it.description||"—"}</td>
        <td style="padding:.4rem .5rem;border:1px solid #d0dff0;text-align:center">${it.unit||dp.unit||""}</td>
        <td style="padding:.4rem .5rem;border:1px solid #d0dff0;text-align:center;font-weight:700">${dispQty}</td>
        <td style="padding:.4rem .5rem;border:1px solid #d0dff0;text-align:center">${it.boxes||0}</td>
        <td style="padding:.4rem .5rem;border:1px solid #d0dff0;text-align:center;font-weight:700">${recvQty !== "—" ? recvQty : "—"}</td>
        <td style="padding:.4rem .5rem;border:1px solid #d0dff0;text-align:center">${rv ? (rv.boxesReceived||0) : "—"}</td>
        <td style="padding:.4rem .5rem;border:1px solid #d0dff0;text-align:center">${diffStr}</td>
      </tr>`;
    }).join("");

    const totalDisp    = dispItems.reduce((s,it) => s + (parseFloat(it.qty)||0), 0);
    const totalRecv    = recvItems ? recvItems.reduce((s,it) => s + (parseFloat(it.qtyReceived)||0), 0) : null;
    const totalDiff    = totalRecv != null ? totalRecv - totalDisp : null;
    const totalDiffStr = totalDiff == null ? "—"
      : Math.abs(totalDiff) < 0.001
        ? `<span style="color:#2e7d32;font-weight:700">✅ Match</span>`
        : `<span style="color:${totalDiff<0?"#c62828":"#1565c0"};font-weight:700">${totalDiff>0?"+":""}${totalDiff}</span>`;

    const photoHtml = dp.photoEvidence?.length
      ? dp.photoEvidence.map(u => `<img src="${u}" onclick="window.open('${u}','_blank')"
          style="width:72px;height:72px;object-fit:cover;border-radius:8px;border:2px solid #c62828;cursor:pointer;margin:3px">`).join("")
      : "";

    document.querySelector(".vd-bd")?.remove();
    const bd = document.createElement("div");
    bd.className = "vd-bd";
    bd.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem";
    bd.innerHTML = `
      <div style="background:#fff;border-radius:14px;width:96vw;max-width:860px;max-height:90vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,.25)">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:.85rem 1.25rem;border-bottom:1px solid #e0e0e0">
          <span style="font-weight:700;font-size:1rem">📋 Dispatch Details —
            <span style="font-family:monospace;background:#f0f2f8;padding:.2rem .5rem;border-radius:4px;font-size:.82rem">${dp.dispatchId}</span>
          </span>
          <button class="vd-close" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:#666">✕</button>
        </div>
        <div style="padding:1rem 1.25rem">

          <!-- Summary grid -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:.45rem 1.5rem;font-size:.87rem;
            background:#f4f6fb;border-radius:10px;padding:.85rem 1rem;margin-bottom:1rem">
            <div><span style="color:#666">From Plant</span><br><strong>${dp.fromPlantName||"—"}</strong></div>
            <div><span style="color:#666">To Plant</span><br><strong>${dp.toPlantName||"—"}</strong></div>
            <div><span style="color:#666">Vehicle No</span><br><strong>${dp.vehicleNo||"—"}</strong></div>
            <div><span style="color:#666">Driver</span><br><strong>${dp.driverName||"—"}${dp.driverContact||dp.driverPhone?" · "+(dp.driverContact||dp.driverPhone):""}</strong></div>
            <div><span style="color:#666">Dispatch Date</span><br><strong>${dp.date||"—"}</strong></div>
            <div><span style="color:#666">Departure Time</span><br><strong>${dp.departureTime||"—"}</strong></div>
            <div><span style="color:#666">Status</span><br><strong style="color:${SC[dp.status]||"#555"}">${SL[dp.status]||dp.status}</strong></div>
            <div><span style="color:#666">E-Way Bill</span><br><strong>${dp.ewayBill||"—"}</strong></div>
            ${dp.remarks?`<div style="grid-column:1/-1"><span style="color:#666">Remarks</span><br><strong>${dp.remarks}</strong></div>`:""}
          </div>

          <!-- Item-wise table -->
          <div style="font-weight:700;color:#1565c0;margin-bottom:.5rem">📋 Item-wise Details</div>
          <div style="overflow-x:auto;margin-bottom:1rem">
            <table style="width:100%;border-collapse:collapse;font-size:.86rem;table-layout:fixed">
              <thead><tr style="background:#1a2b4a;color:#fff">
                <th style="padding:.4rem .5rem;border:1px solid #2d4070;width:36px;text-align:center">#</th>
                <th style="padding:.4rem .5rem;border:1px solid #2d4070;width:90px;text-align:left">Part No.</th>
                <th style="padding:.4rem .5rem;border:1px solid #2d4070;text-align:left">Part Name</th>
                <th style="padding:.4rem .5rem;border:1px solid #2d4070;width:50px;text-align:center">Unit</th>
                <th style="padding:.4rem .5rem;border:1px solid #2d4070;width:78px;text-align:center">Dispatched</th>
                <th style="padding:.4rem .5rem;border:1px solid #2d4070;width:68px;text-align:center">Boxes Sent</th>
                <th style="padding:.4rem .5rem;border:1px solid #2d4070;width:78px;text-align:center">Received</th>
                <th style="padding:.4rem .5rem;border:1px solid #2d4070;width:68px;text-align:center">Boxes Recd</th>
                <th style="padding:.4rem .5rem;border:1px solid #2d4070;width:88px;text-align:center">Difference</th>
              </tr></thead>
              <tbody>${itemRows}</tbody>
              <tfoot><tr style="background:#e8f5e9;font-weight:700">
                <td colspan="4" style="padding:.5rem .6rem;border:1px solid #90caf9;text-align:right;color:#1b5e20">Total</td>
                <td style="padding:.5rem .6rem;border:1px solid #90caf9;text-align:center">${totalDisp}</td>
                <td style="padding:.5rem .6rem;border:1px solid #90caf9"></td>
                <td style="padding:.5rem .6rem;border:1px solid #90caf9;text-align:center">${totalRecv??'—'}</td>
                <td style="padding:.5rem .6rem;border:1px solid #90caf9"></td>
                <td style="padding:.5rem .6rem;border:1px solid #90caf9;text-align:center">${totalDiffStr}</td>
              </tr></tfoot>
            </table>
          </div>

          <!-- Receipt info -->
          ${dp.arrivalDate ? `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:.45rem 1.5rem;font-size:.87rem;
            background:${dp.status==="discrepancy"?"#fff5f5":"#f1f8e9"};border-radius:10px;padding:.85rem 1rem;margin-bottom:1rem;
            border:1px solid ${dp.status==="discrepancy"?"#ffcdd2":"#c5e1a5"}">
            <div style="grid-column:1/-1;font-weight:700;color:${SC[dp.status]||"#555"};margin-bottom:.3rem">
              ${dp.status==="discrepancy"?"⚠️ Discrepancy Recorded":"✅ Receipt Confirmed"}
            </div>
            <div><span style="color:#666">Arrival Date</span><br><strong>${dp.arrivalDate}</strong></div>
            <div><span style="color:#666">Arrival Time</span><br><strong>${dp.arrivalTime||"—"}</strong></div>
            <div><span style="color:#666">Received By</span><br><strong>${dp.receivedByName||"—"}</strong></div>
            <div><span style="color:#666">Total Received</span><br><strong>${dp.qtyReceived??'—'} ${dp.unit||""}</strong></div>
            ${dp.receiptRemarks?`<div style="grid-column:1/-1"><span style="color:#666">Receipt Remarks</span><br><strong>${dp.receiptRemarks}</strong></div>`:""}
          </div>` : ""}

          <!-- Photos -->
          ${photoHtml ? `
          <div>
            <div style="font-weight:700;color:#c62828;margin-bottom:.4rem;font-size:.88rem">📷 Photo Evidence</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px">${photoHtml}</div>
          </div>` : ""}

        </div>
        <div style="padding:.75rem 1.25rem;border-top:1px solid #e0e0e0;text-align:right">
          <button class="vd-close" style="padding:.45rem 1.4rem;border:1.5px solid #ccc;border-radius:8px;background:#fff;cursor:pointer;font-weight:600">Close</button>
        </div>
      </div>`;

    document.body.appendChild(bd);
    bd.querySelectorAll(".vd-close").forEach(b => b.addEventListener("click", () => bd.remove()));
    bd.addEventListener("click", e => { if (e.target === bd) bd.remove(); });
  };
}
