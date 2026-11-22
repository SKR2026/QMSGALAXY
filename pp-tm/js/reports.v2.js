// ─────────────────────────────────────────────────────────────
//  PTMS – Reports Module  (Phase 5)
//  Filterable dispatch & receipt reports, CSV export.
// ─────────────────────────────────────────────────────────────

import { db } from "./firebase.v2.js";
import {
  collection, getDocs, query, where, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { requirePlantUser } from "./auth.v2.js";

export async function showReportsPage(container, user) {
  if (!requirePlantUser()) return;

  const thisMonth   = new Date().toISOString().slice(0, 7);
  const fromDefault = `${thisMonth}-01`;
  const toDefault   = new Date().toISOString().slice(0, 10);

  const pillDefs = [
    { val: "all",         label: "All",          color: "#555"    },
    { val: "dispatched",  label: "Dispatched",    color: "#1565c0" },
    { val: "received",    label: "Received",      color: "#2e7d32" },
    { val: "discrepancy", label: "Discrepancies", color: "#c62828" },
  ];

  container.innerHTML = `
    <div class="page-title">📋 Reports</div>

    <div class="card section">
      <div class="card-body">
        <div class="filter-bar" style="align-items:flex-start;gap:1rem;flex-wrap:wrap">

          <div>
            <div style="font-size:.78rem;font-weight:700;color:#4a4a6a;margin-bottom:.4rem">TYPE</div>
            <div id="rptPills" style="display:flex;gap:.5rem;flex-wrap:wrap">
              ${pillDefs.map(p => `
                <button class="rpt-pill${p.val==="all"?" active":""}" data-val="${p.val}"
                  style="padding:.38rem 1rem;border-radius:999px;border:2px solid ${p.color};
                         background:${p.val==="all"?p.color:"#fff"};
                         color:${p.val==="all"?"#fff":p.color};
                         font-weight:700;font-size:.82rem;cursor:pointer;transition:all .15s">
                  ${p.label}
                </button>`).join("")}
            </div>
          </div>

          <div>
            <div style="font-size:.78rem;font-weight:700;color:#4a4a6a;margin-bottom:.4rem">PLANT</div>
            <div id="rptPlantPills" style="display:flex;gap:.5rem;flex-wrap:wrap">
              <button class="rpt-plant-pill active" data-plant="" data-color="#4a4a6a"
                style="padding:.38rem 1rem;border-radius:999px;border:2px solid #4a4a6a;
                       background:#4a4a6a;color:#fff;font-weight:700;font-size:.82rem;cursor:pointer;transition:all .15s">
                🏭 All Plants
              </button>
            </div>
          </div>

          <div style="display:flex;gap:.7rem;align-items:flex-end;flex-wrap:wrap">
            <div>
              <label style="font-size:.78rem;font-weight:700;color:#4a4a6a;display:block;margin-bottom:.3rem">FROM</label>
              <input type="date" id="rptFrom" value="${fromDefault}" style="padding:.38rem .7rem;border:1.5px solid #d0d0e8;border-radius:8px;font-size:.85rem">
            </div>
            <div>
              <label style="font-size:.78rem;font-weight:700;color:#4a4a6a;display:block;margin-bottom:.3rem">TO</label>
              <input type="date" id="rptTo" value="${toDefault}" style="padding:.38rem .7rem;border:1.5px solid #d0d0e8;border-radius:8px;font-size:.85rem">
            </div>
            <button class="btn btn-outline" id="exportCsvBtn" style="display:none">⬇ Export CSV</button>
          </div>

        </div>
      </div>
    </div>

    <div id="reportSummaryRow" class="stat-grid" style="display:none"></div>

    <div class="card section" id="reportResultCard" style="display:none">
      <div class="card-header" id="reportResultTitle">Results</div>
      <div class="card-body table-wrap" id="reportResult"><div class="spinner">Loading…</div></div>
    </div>
  `;

  // ── Load plant pills for ALL users ────────────────────────────
  const plantColors = ["#1565c0","#2e7d32","#6a1b9a","#e65100","#00695c","#c62828","#4527a0","#558b2f","#00838f","#ad1457"];
  const pSnap = await getDocs(collection(db, "plants"));
  const plantPillBox = container.querySelector("#rptPlantPills");
  pSnap.docs
    .sort((a,b) => a.data().name.localeCompare(b.data().name))
    .forEach((d, i) => {
      const c = plantColors[i % plantColors.length];
      const btn = document.createElement("button");
      btn.className = "rpt-plant-pill";
      btn.dataset.plant = d.id;
      btn.dataset.color = c;
      btn.textContent = d.data().code || d.data().name;
      btn.title = d.data().name;
      Object.assign(btn.style, {
        padding:".38rem 1rem", borderRadius:"999px", border:`2px solid ${c}`,
        background:"#fff", color:c, fontWeight:"700", fontSize:".82rem",
        cursor:"pointer", transition:"all .15s"
      });
      plantPillBox.appendChild(btn);
    });

  let currentRows = [];

  // ── Shared refresh ────────────────────────────────────────────
  async function refresh() {
    const from    = container.querySelector("#rptFrom").value;
    const to      = container.querySelector("#rptTo").value;
    const type    = container.querySelector(".rpt-pill.active")?.dataset.val || "all";
    const plantId = container.querySelector(".rpt-plant-pill.active")?.dataset.plant || "";

    container.querySelector("#reportResultCard").style.display = "";
    container.querySelector("#reportResult").innerHTML = `<div class="spinner">Loading…</div>`;

    const result = await runReport({ from, to, type, plantId, user });
    currentRows  = result.rows;

    const summaryEl = container.querySelector("#reportSummaryRow");
    summaryEl.style.display = "";
    summaryEl.innerHTML = `
      <div class="stat-tile">
        <div class="stat-label">Total Records</div>
        <div class="stat-value">${result.total}</div>
      </div>
      <div class="stat-tile green">
        <div class="stat-label">Qty Dispatched</div>
        <div class="stat-value">${result.totalQtyDispatched.toFixed(2)}</div>
        <div class="stat-sub">all units combined</div>
      </div>
      <div class="stat-tile ${result.totalQtyReceived < result.totalQtyDispatched ? "orange" : "green"}">
        <div class="stat-label">Qty Received</div>
        <div class="stat-value">${result.totalQtyReceived.toFixed(2)}</div>
      </div>
      <div class="stat-tile ${result.discrepancies > 0 ? "red" : ""}">
        <div class="stat-label">Discrepancies</div>
        <div class="stat-value">${result.discrepancies}</div>
      </div>
    `;

    container.querySelector("#reportResultTitle").textContent = `${result.total} Records`;
    container.querySelector("#reportResult").innerHTML = renderReportTable(result.rows);

    const csvBtn = container.querySelector("#exportCsvBtn");
    csvBtn.style.display = result.rows.length ? "" : "none";
    csvBtn.onclick = () => exportCsv(result.rows, `PTMS_Report_${from}_${to}.csv`);
  }

  // ── Type pill clicks ──────────────────────────────────────────
  const typePillColors = { all:"#555", dispatched:"#1565c0", received:"#2e7d32", discrepancy:"#c62828" };
  container.querySelectorAll(".rpt-pill").forEach(pill => {
    pill.addEventListener("click", () => {
      container.querySelectorAll(".rpt-pill").forEach(p => {
        const c = typePillColors[p.dataset.val];
        p.style.background = "#fff"; p.style.color = c; p.style.borderColor = c;
        p.classList.remove("active");
      });
      const c = typePillColors[pill.dataset.val];
      pill.style.background = c; pill.style.color = "#fff"; pill.style.borderColor = c;
      pill.classList.add("active");
      refresh();
    });
  });

  // ── Plant pill clicks ─────────────────────────────────────────
  plantPillBox.addEventListener("click", e => {
    const pill = e.target.closest(".rpt-plant-pill");
    if (!pill) return;
    container.querySelectorAll(".rpt-plant-pill").forEach(p => {
      const c = p.dataset.color || "#4a4a6a";
      p.style.background = "#fff"; p.style.color = c; p.style.borderColor = c;
      p.classList.remove("active");
    });
    const c = pill.dataset.color || "#4a4a6a";
    pill.style.background = c; pill.style.color = "#fff"; pill.style.borderColor = c;
    pill.classList.add("active");
    refresh();
  });

  // ── Date changes ──────────────────────────────────────────────
  container.querySelector("#rptFrom").addEventListener("change", refresh);
  container.querySelector("#rptTo").addEventListener("change", refresh);

  // ── Auto-load on open ─────────────────────────────────────────
  refresh();
}

// ── Run Report Query ──────────────────────────────────────────
async function runReport({ from, to, type, plantId, user }) {
  const snap = await getDocs(collection(db, "dispatches"));

  let rows = [];
  snap.forEach(d => {
    const dp = d.data();

    // Plant user: only their outgoing or incoming
    if (user.role !== "superAdmin") {
      if (dp.fromPlantId !== user.plantId && dp.toPlantId !== user.plantId) return;
    }

    // Plant pill filter
    if (plantId && dp.fromPlantId !== plantId && dp.toPlantId !== plantId) return;

    // Status filter
    if (type === "dispatched"  && !["dispatched","in-transit"].includes(dp.status)) return;
    if (type === "received"    && dp.status !== "received")    return;
    if (type === "discrepancy" && dp.status !== "discrepancy") return;

    // Date filter
    if (from && dp.date && dp.date < from) return;
    if (to   && dp.date && dp.date > to)   return;

    rows.push({ id: d.id, ...dp });
  });

  rows.sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));

  const totalQtyDispatched = rows.reduce((s, r) => s + (r.qtyDispatched || 0), 0);
  const totalQtyReceived   = rows.reduce((s, r) => s + (r.qtyReceived   || 0), 0);
  const discrepancies      = rows.filter(r => r.status === "discrepancy").length;

  return { rows, total: rows.length, totalQtyDispatched, totalQtyReceived, discrepancies };
}

// ── Render Table ──────────────────────────────────────────────
function renderReportTable(rows) {
  if (!rows.length) return `<div class="empty-state"><div class="empty-icon">📋</div><p>No records for the selected criteria.</p></div>`;

  let html = `
    <table>
      <thead><tr>
        <th>Dispatch ID</th><th>Date</th><th>From</th><th>To</th>
        <th>Material</th><th>Unit</th><th>Qty Dispatched</th>
        <th>Qty Received</th><th>Diff</th><th>Vehicle</th><th>Driver</th><th>Status</th>
      </tr></thead><tbody>`;

  rows.forEach(r => {
    const diff = r.qtyReceived != null ? (r.qtyReceived - r.qtyDispatched) : null;
    const diffStr = diff != null ? `${diff >= 0 ? "+" : ""}${diff.toFixed(2)}` : "—";
    const diffColor = diff == null ? "" : diff < 0 ? "color:#c62828" : diff > 0 ? "color:#1565c0" : "color:#2e7d32";
    html += `<tr>
      <td><span class="dispatch-id">${r.dispatchId}</span></td>
      <td>${r.date || "—"}</td>
      <td>${r.fromPlantName}</td><td>${r.toPlantName}</td>
      <td>${r.material}</td><td>${r.unit}</td>
      <td>${r.qtyDispatched}</td><td>${r.qtyReceived ?? "—"}</td>
      <td style="${diffColor}">${diffStr}</td>
      <td>${r.vehicleNo}</td><td>${r.driverName}</td>
      <td><span class="badge status-${r.status}">${statusLabel(r.status)}</span></td>
    </tr>`;
  });
  return html + `</tbody></table>`;
}

// ── CSV Export ────────────────────────────────────────────────
function exportCsv(rows, filename) {
  const headers = [
    "Dispatch ID","Date","From Plant","To Plant","Material","Unit",
    "Qty Dispatched","Qty Received","Difference",
    "Vehicle No.","Vehicle Type","Driver Name","Driver Phone",
    "Departure Time","Arrival Date","Arrival Time",
    "E-Way Bill","Batch","Status","Remarks","Receipt Remarks"
  ];
  const csvLines = [headers.join(",")];
  rows.forEach(r => {
    const diff = r.qtyReceived != null ? (r.qtyReceived - r.qtyDispatched) : "";
    const fields = [
      r.dispatchId, r.date, r.fromPlantName, r.toPlantName,
      r.material, r.unit, r.qtyDispatched, r.qtyReceived ?? "",
      diff, r.vehicleNo, r.vehicleType, r.driverName, r.driverPhone,
      r.departureTime, r.arrivalDate ?? "", r.arrivalTime ?? "",
      r.ewayBill ?? "", r.batch ?? "", r.status,
      (r.remarks ?? "").replace(/,/g, ";"), (r.receiptRemarks ?? "").replace(/,/g, ";")
    ];
    csvLines.push(fields.map(f => `"${f ?? ""}"`).join(","));
  });
  const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  window.showToast("CSV exported.", "success");
}

function statusLabel(s) {
  return { dispatched:"Dispatched", "in-transit":"In Transit", received:"Received", discrepancy:"Discrepancy" }[s] || s;
}
