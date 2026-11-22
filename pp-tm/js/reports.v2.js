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

  const thisMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  const fromDefault = `${thisMonth}-01`;
  const toDefault   = new Date().toISOString().slice(0, 10);

  container.innerHTML = `
    <div class="page-title">📋 Reports</div>

    <div class="card section">
      <div class="card-header">Generate Report</div>
      <div class="card-body">
        <div class="filter-bar" style="align-items:flex-end;flex-wrap:wrap;gap:1rem">
          <div class="form-group" style="display:inline-block">
            <label style="font-size:.8rem;font-weight:600;color:#4a4a6a">From Date</label>
            <input type="date" id="rptFrom" value="${fromDefault}">
          </div>
          <div class="form-group" style="display:inline-block">
            <label style="font-size:.8rem;font-weight:600;color:#4a4a6a">To Date</label>
            <input type="date" id="rptTo" value="${toDefault}">
          </div>
          <div class="form-group" style="display:inline-block">
            <label style="font-size:.8rem;font-weight:600;color:#4a4a6a">Type</label>
            <div id="rptType" style="display:flex;gap:0.5rem;flex-wrap:wrap">
              <button class="rpt-pill active" data-val="dispatched" style="padding:0.4rem 1rem;border-radius:999px;border:2px solid #1565c0;background:#1565c0;color:#fff;cursor:pointer;font-size:0.85rem;font-weight:600">🚚 Dispatched</button>
              <button class="rpt-pill" data-val="received" style="padding:0.4rem 1rem;border-radius:999px;border:2px solid #2e7d32;background:#fff;color:#2e7d32;cursor:pointer;font-size:0.85rem;font-weight:600">📥 Received</button>
              <button class="rpt-pill" data-val="discrepancy" style="padding:0.4rem 1rem;border-radius:999px;border:2px solid #c62828;background:#fff;color:#c62828;cursor:pointer;font-size:0.85rem;font-weight:600">⚠️ Discrepancies</button>
              <button class="rpt-pill" data-val="all" style="padding:0.4rem 1rem;border-radius:999px;border:2px solid #666;background:#fff;color:#666;cursor:pointer;font-size:0.85rem;font-weight:600">📋 All</button>
            </div>
          </div>
          ${user.role === "superAdmin" ? `
          <div class="form-group" style="display:inline-block">
            <label style="font-size:.8rem;font-weight:600;color:#4a4a6a">Plant</label>
            <select id="rptPlant"><option value="">All Plants</option></select>
          </div>` : ""}
          <div style="display:flex;gap:.5rem;align-items:flex-end">
            <button class="btn btn-primary" id="runReportBtn">▶ Run Report</button>
            <button class="btn btn-outline" id="exportCsvBtn" style="display:none">⬇ Export CSV</button>
          </div>
        </div>
      </div>
    </div>

    <div id="reportSummaryRow" class="stat-grid" style="display:none"></div>

    <div class="card section" id="reportResultCard" style="display:none">
      <div class="card-header" id="reportResultTitle">Results</div>
      <div class="card-body table-wrap" id="reportResult"></div>
    </div>
  `;

  // Load plants for super admin filter
  if (user.role === "superAdmin") {
    const pSnap = await getDocs(query(collection(db, "plants"), orderBy("name")));
    const sel   = container.querySelector("#rptPlant");
    pSnap.forEach(d => {
      const opt = document.createElement("option");
      opt.value = d.id;
      opt.textContent = d.data().name;
      sel.appendChild(opt);
    });
  }

  // Store results for CSV export
  let currentRows = [];

  // Wire type pills
  container.querySelectorAll(".rpt-pill").forEach(pill => {
    pill.addEventListener("click", () => {
      container.querySelectorAll(".rpt-pill").forEach(p => {
        p.classList.remove("active");
        const cols = {dispatched:"#1565c0", received:"#2e7d32", discrepancy:"#c62828", all:"#555"};
        p.style.background = "#fff";
        p.style.color = cols[p.dataset.val];
      });
      const cols = {dispatched:"#1565c0", received:"#2e7d32", discrepancy:"#c62828", all:"#555"};
      pill.classList.add("active");
      pill.style.background = cols[pill.dataset.val];
      pill.style.color = "#fff";
    });
  });

  container.querySelector("#runReportBtn").addEventListener("click", async () => {
    const from    = container.querySelector("#rptFrom").value;
    const to      = container.querySelector("#rptTo").value;
    const type    = container.querySelector("#rptType .rpt-pill.active")?.dataset.val || "dispatched";
    const plantId = container.querySelector("#rptPlant")?.value || "";

    const result  = await runReport({ from, to, type, plantId, user });
    currentRows   = result.rows;

    // Summary
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
      <div class="stat-tile ${result.totalQtyReceived < result.totalQtyDispatched ? 'orange' : 'green'}">
        <div class="stat-label">Qty Received</div>
        <div class="stat-value">${result.totalQtyReceived.toFixed(2)}</div>
      </div>
      <div class="stat-tile ${result.discrepancies > 0 ? 'red' : ''}">
        <div class="stat-label">Discrepancies</div>
        <div class="stat-value">${result.discrepancies}</div>
      </div>
    `;

    // Table
    const cardEl  = container.querySelector("#reportResultCard");
    const titleEl = container.querySelector("#reportResultTitle");
    const tableEl = container.querySelector("#reportResult");
    cardEl.style.display = "";
    titleEl.textContent  = `${result.total} Records`;
    tableEl.innerHTML    = renderReportTable(result.rows);

    // Show CSV button
    const csvBtn = container.querySelector("#exportCsvBtn");
    csvBtn.style.display = result.rows.length ? "" : "none";
    csvBtn.onclick = () => exportCsv(result.rows, `PTMS_Report_${from}_${to}.csv`);
  });
}

// ── Run Report Query ──────────────────────────────────────────
async function runReport({ from, to, type, plantId, user }) {
  // Fetch all dispatches with simple single-field orderBy (no composite index needed)
  // Then filter client-side for status, plant, date
  const baseQuery = plantId
    ? query(collection(db, "dispatches"), where("fromPlantId", "==", plantId))
    : query(collection(db, "dispatches"), orderBy("createdAt", "desc"));

  const snap = await getDocs(baseQuery);

  let rows = [];
  snap.forEach(d => {
    const dp = d.data();

    // Plant user: only see their outgoing or incoming
    if (user.role !== "superAdmin") {
      if (dp.fromPlantId !== user.plantId && dp.toPlantId !== user.plantId) return;
    }

    // Status filter (client-side)
    if (type === "dispatched"  && !["dispatched","in-transit"].includes(dp.status)) return;
    if (type === "received"    && dp.status !== "received")    return;
    if (type === "discrepancy" && dp.status !== "discrepancy") return;

    // Date filter (client-side)
    if (from && dp.date && dp.date < from) return;
    if (to   && dp.date && dp.date > to)   return;

    rows.push({ id: d.id, ...dp });
  });

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
        <th>Dispatch ID</th>
        <th>Date</th>
        <th>From</th>
        <th>To</th>
        <th>Material</th>
        <th>Unit</th>
        <th>Qty Dispatched</th>
        <th>Qty Received</th>
        <th>Diff</th>
        <th>Vehicle</th>
        <th>Driver</th>
        <th>Status</th>
      </tr></thead>
      <tbody>`;

  rows.forEach(r => {
    const diff = r.qtyReceived != null ? (r.qtyReceived - r.qtyDispatched) : null;
    const diffStr = diff != null ? `${diff >= 0 ? "+" : ""}${diff.toFixed(2)}` : "—";
    const diffColor = diff == null ? "" : diff < 0 ? "color:#c62828" : diff > 0 ? "color:#1565c0" : "color:#2e7d32";
    html += `
      <tr>
        <td><span class="dispatch-id">${r.dispatchId}</span></td>
        <td>${r.date || "—"}</td>
        <td>${r.fromPlantName}</td>
        <td>${r.toPlantName}</td>
        <td>${r.material}</td>
        <td>${r.unit}</td>
        <td>${r.qtyDispatched}</td>
        <td>${r.qtyReceived ?? "—"}</td>
        <td style="${diffColor}">${diffStr}</td>
        <td>${r.vehicleNo}</td>
        <td>${r.driverName}</td>
        <td><span class="badge status-${r.status}">${statusLabel(r.status)}</span></td>
      </tr>`;
  });
  html += `</tbody></table>`;
  return html;
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
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  window.showToast("CSV exported.", "success");
}

function statusLabel(s) {
  const m = { dispatched: "Dispatched", "in-transit": "In Transit", received: "Received", discrepancy: "Discrepancy" };
  return m[s] || s;
}
