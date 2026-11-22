// v1795361569
// v2-nav-fix
// ─────────────────────────────────────────────────────────────
//  PTMS – Dashboard Module
//  Plant user: their plant's stats.
//  Super admin: all-plant overview.
// ─────────────────────────────────────────────────────────────

import { db } from "./firebase.js";
import {
  collection, getDocs, query, where, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export async function showDashboardPage(container, user) {
  container.innerHTML = `<div class="spinner"></div>`;
  try {
    if (user.role === "superAdmin") {
      await renderAdminDashboard(container, user);
    } else {
      await renderPlantDashboard(container, user);
    }
  } catch (e) {
    container.innerHTML = `<div class="error-msg">Dashboard error: ${e.message}</div>`;
  }
}

// ══════════════════════════════════════════════════════════════
//  PLANT USER DASHBOARD
// ══════════════════════════════════════════════════════════════
async function renderPlantDashboard(container, user) {
  const plantId = user.plantId;

  // Simple queries — no composite index needed
  const [outSnap, inSnap] = await Promise.all([
    getDocs(query(collection(db, "dispatches"), where("fromPlantId", "==", plantId))),
    getDocs(query(collection(db, "dispatches"), where("toPlantId",   "==", plantId))),
  ]);

  const totalOut      = outSnap.size;
  const pendingOut    = outSnap.docs.filter(d => d.data().status === "dispatched").length;
  const totalIn       = inSnap.size;
  const pendingIn     = inSnap.docs.filter(d => d.data().status === "dispatched").length;
  const discrepancies = [...outSnap.docs, ...inSnap.docs]
                          .filter(d => d.data().status === "discrepancy").length;

  // Recent activity — simple orderBy on single field, no composite needed
  let recentSnap = null;
  try {
    recentSnap = await getDocs(query(
      collection(db, "activityLogs"),
      where("plantId", "==", plantId),
      orderBy("timestamp", "desc"),
      limit(10)
    ));
  } catch (e) {
    // Index may still be building — show empty gracefully
    recentSnap = null;
  }

  // Pending vehicles for alert table
  const pendingDocs = inSnap.docs.filter(d => d.data().status === "dispatched");

  container.innerHTML = `
    <div class="page-title">📊 ${user.plantName || "Plant"} — Dashboard</div>

    <div class="stat-grid">
      <div class="stat-tile" style="cursor:pointer" onclick="window.dispatchEvent(new CustomEvent('ptms-navigate',{detail:'dispatch'}))">
        <div class="stat-label">TOTAL DISPATCHED</div>
        <div class="stat-value">${totalOut}</div>
        <div class="stat-sub">Outgoing shipments</div>
      </div>
      <div class="stat-tile orange" style="cursor:pointer" onclick="window.dispatchEvent(new CustomEvent('ptms-navigate',{detail:'dispatch'}))">
        <div class="stat-label">PENDING OUT</div>
        <div class="stat-value">${pendingOut}</div>
        <div class="stat-sub">Awaiting receipt</div>
      </div>
      <div class="stat-tile green" style="cursor:pointer" onclick="window.dispatchEvent(new CustomEvent('ptms-navigate',{detail:'receipt'}))">
        <div class="stat-label">TOTAL RECEIVED</div>
        <div class="stat-value">${totalIn}</div>
        <div class="stat-sub">Incoming shipments</div>
      </div>
      <div class="stat-tile ${pendingIn > 0 ? 'orange' : ''}" style="cursor:pointer" onclick="window.dispatchEvent(new CustomEvent('ptms-navigate',{detail:'receipt'}))">
        <div class="stat-label">PENDING RECEIPT</div>
        <div class="stat-value">${pendingIn}</div>
        <div class="stat-sub">Vehicles en route</div>
      </div>
      <div class="stat-tile ${discrepancies > 0 ? 'red' : ''}" style="cursor:pointer" onclick="window.dispatchEvent(new CustomEvent('ptms-navigate',{detail:'reports'}))">
        <div class="stat-label">DISCREPANCIES</div>
        <div class="stat-value">${discrepancies}</div>
        <div class="stat-sub">Qty mismatches</div>
      </div>
    </div>

    <!-- Quick actions -->
    <div style="display:flex;gap:1rem;margin-bottom:1.5rem;flex-wrap:wrap">
      <button class="btn btn-primary" data-nav="dispatch">🚚 New Dispatch</button>
      <button class="btn btn-outline" data-nav="receipt">📥 Confirm Receipt</button>
      <button class="btn btn-outline" data-nav="reports">📋 Reports</button>
    </div>

    <!-- Recent Activity -->
    <div class="card">
      <div class="card-header">Recent Activity</div>
      <div class="card-body">
        ${renderActivityLog(recentSnap)}
      </div>
    </div>

    ${pendingIn > 0 ? renderPendingAlert(pendingDocs) : ""}
  `;

  // Wire quick-action buttons
  container.querySelectorAll("[data-nav]").forEach(el => {
    el.addEventListener("click", () => window.dispatchEvent(new CustomEvent("ptms-navigate", { detail: el.dataset.nav })));
  });
}

// ══════════════════════════════════════════════════════════════
//  SUPER ADMIN DASHBOARD
// ══════════════════════════════════════════════════════════════
async function renderAdminDashboard(container, user) {

  // Fetch all dispatches ordered by createdAt — single field index, no composite needed
  const [allDispatch, allPlants] = await Promise.all([
    getDocs(query(collection(db, "dispatches"), orderBy("createdAt", "desc"))),
    getDocs(collection(db, "plants")),
  ]);

  // Fetch recent logs — single field orderBy, no composite needed
  let recentLogs = null;
  try {
    recentLogs = await getDocs(query(
      collection(db, "activityLogs"),
      orderBy("timestamp", "desc"),
      limit(15)
    ));
  } catch(e) {
    recentLogs = null;
  }

  const total       = allDispatch.size;
  const dispatched  = allDispatch.docs.filter(d => d.data().status === "dispatched").length;
  const received    = allDispatch.docs.filter(d => d.data().status === "received").length;
  const discrepancy = allDispatch.docs.filter(d => d.data().status === "discrepancy").length;
  const plantCount  = allPlants.size;

  // Per-plant breakdown
  const plantMap = {};
  allPlants.forEach(d => { plantMap[d.id] = { ...d.data(), out: 0, inbound: 0, disc: 0 }; });
  allDispatch.docs.forEach(d => {
    const dp = d.data();
    if (plantMap[dp.fromPlantId]) plantMap[dp.fromPlantId].out++;
    if (plantMap[dp.toPlantId])   plantMap[dp.toPlantId].inbound++;
    if (dp.status === "discrepancy") {
      if (plantMap[dp.fromPlantId]) plantMap[dp.fromPlantId].disc++;
    }
  });

  let plantRows = "";
  Object.values(plantMap).forEach(p => {
    plantRows += `
      <tr>
        <td><span class="dispatch-id">${p.code || "—"}</span></td>
        <td><strong>${p.name}</strong></td>
        <td>${p.out}</td>
        <td>${p.inbound}</td>
        <td>${p.disc > 0 ? `<span class="badge badge-red">${p.disc}</span>` : "0"}</td>
        <td><span class="badge ${p.isActive ? 'badge-green' : 'badge-grey'}">${p.isActive ? 'Active' : 'Inactive'}</span></td>
      </tr>`;
  });

  container.innerHTML = `
    <div class="page-title">📊 System Overview — Super Admin</div>

    <div class="stat-grid">
      <div class="stat-tile" style="cursor:pointer" onclick="window.dispatchEvent(new CustomEvent('ptms-navigate',{detail:'dispatch'}))">
        <div class="stat-label">TOTAL SHIPMENTS</div>
        <div class="stat-value">${total}</div>
        <div class="stat-sub">All time</div>
      </div>
      <div class="stat-tile orange" style="cursor:pointer" onclick="window.dispatchEvent(new CustomEvent('ptms-navigate',{detail:'dispatch'}))">
        <div class="stat-label">DISPATCHED</div>
        <div class="stat-value">${dispatched}</div>
        <div class="stat-sub">In transit / waiting</div>
      </div>
      <div class="stat-tile green" style="cursor:pointer" onclick="window.dispatchEvent(new CustomEvent('ptms-navigate',{detail:'receipt'}))">
        <div class="stat-label">RECEIVED OK</div>
        <div class="stat-value">${received}</div>
        <div class="stat-sub">No issues</div>
      </div>
      <div class="stat-tile ${discrepancy > 0 ? 'red' : ''}">
        <div class="stat-label">DISCREPANCIES</div>
        <div class="stat-value">${discrepancy}</div>
        <div class="stat-sub">Qty mismatches</div>
      </div>
      <div class="stat-tile" style="cursor:pointer" onclick="window.dispatchEvent(new CustomEvent('ptms-navigate',{detail:'dispatch'}))">
        <div class="stat-label">ACTIVE PLANTS</div>
        <div class="stat-value">${plantCount}</div>
        <div class="stat-sub">In system</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;flex-wrap:wrap">
      <div class="card">
        <div class="card-header">Plant-wise Summary</div>
        <div class="card-body table-wrap">
          <table>
            <thead><tr>
              <th>Code</th><th>Plant</th>
              <th>Outgoing</th><th>Incoming</th>
              <th>Discrepancies</th><th>Status</th>
            </tr></thead>
            <tbody>${plantRows || '<tr><td colspan="6" style="text-align:center;color:#8e8ea8">No plants added yet</td></tr>'}</tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-header">Recent Activity</div>
        <div class="card-body">
          ${renderActivityLog(recentLogs)}
        </div>
      </div>
    </div>
  `;
}

// ── Helpers ───────────────────────────────────────────────────
function renderActivityLog(snap) {
  if (!snap || snap.empty) {
    return `<div class="empty-state" style="padding:1rem">
      <div class="empty-icon" style="font-size:1.5rem">📋</div>
      <p>No activity yet.</p>
    </div>`;
  }
  let html = `<div style="display:flex;flex-direction:column;gap:.5rem">`;
  snap.docs.forEach(d => {
    const a  = d.data();
    const ts = a.timestamp?.toDate
      ? a.timestamp.toDate().toLocaleString("en-IN")
      : "—";
    const icon = {
      DISPATCH_CREATED:  "🚚",
      RECEIPT_CONFIRMED: "✅",
      DISCREPANCY:       "⚠️",
    }[a.action] || "📌";
    html += `
      <div style="display:flex;gap:.75rem;align-items:flex-start;padding:.5rem 0;border-bottom:1px solid #eee">
        <span style="font-size:1.1rem">${icon}</span>
        <div>
          <div style="font-size:.85rem;font-weight:600">${a.details || a.action}</div>
          <div style="font-size:.75rem;color:#8e8ea8">${a.userName || "—"} · ${ts}</div>
        </div>
      </div>`;
  });
  html += `</div>`;
  return html;
}

function renderPendingAlert(docs) {
  if (!docs.length) return "";
  let rows = "";
  docs.forEach(d => {
    const dp = d.data();
    rows += `<tr>
      <td><span class="dispatch-id">${dp.dispatchId}</span></td>
      <td>${dp.fromPlantName}</td>
      <td>${dp.material}</td>
      <td>${dp.qtyDispatched} ${dp.unit}</td>
      <td>${dp.vehicleNo}</td>
      <td>${dp.driverPhone}</td>
    </tr>`;
  });
  return `
    <div class="card" style="margin-top:1.5rem;border-left:4px solid #f57c00">
      <div class="card-header" style="color:#f57c00">🚛 Vehicles En Route to Your Plant</div>
      <div class="card-body table-wrap">
        <table>
          <thead><tr>
            <th>Dispatch ID</th><th>From</th><th>Material</th>
            <th>Qty</th><th>Vehicle</th><th>Driver Phone</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

