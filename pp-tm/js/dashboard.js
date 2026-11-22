// ─────────────────────────────────────────────────────────────
//  PTMS – Dashboard Module  (Phase 4 & 5)
//  Plant user: their plant's stats.
//  Super admin: all-plant overview.
// ─────────────────────────────────────────────────────────────

import { db } from "./firebase.js";
import {
  collection, getDocs, query, where, orderBy,
  limit, serverTimestamp
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

  // Fetch dispatches FROM and TO this plant
  const [outSnap, inSnap] = await Promise.all([
    getDocs(query(collection(db, "dispatches"), where("fromPlantId", "==", plantId))),
    getDocs(query(collection(db, "dispatches"), where("toPlantId",   "==", plantId))),
  ]);

  // Counts
  const totalOut = outSnap.size;
  const pendingOut = outSnap.docs.filter(d => ["dispatched","in-transit"].includes(d.data().status)).length;
  const totalIn  = inSnap.size;
  const pendingIn = inSnap.docs.filter(d => ["dispatched","in-transit"].includes(d.data().status)).length;
  const discrepancies = [...outSnap.docs, ...inSnap.docs].filter(d => d.data().status === "discrepancy").length;

  // Recent activity (last 10)
  const recentSnap = await getDocs(query(
    collection(db, "activityLogs"),
    where("plantId", "==", plantId),
    orderBy("timestamp", "desc"),
    limit(10)
  ));

  container.innerHTML = `
    <div class="page-title">📊 ${user.plantName} — Dashboard</div>

    <div class="stat-grid">
      <div class="stat-tile">
        <div class="stat-label">Total Dispatched</div>
        <div class="stat-value">${totalOut}</div>
        <div class="stat-sub">Outgoing shipments</div>
      </div>
      <div class="stat-tile orange">
        <div class="stat-label">Pending Out</div>
        <div class="stat-value">${pendingOut}</div>
        <div class="stat-sub">Awaiting receipt</div>
      </div>
      <div class="stat-tile green">
        <div class="stat-label">Total Received</div>
        <div class="stat-value">${totalIn}</div>
        <div class="stat-sub">Incoming shipments</div>
      </div>
      <div class="stat-tile ${pendingIn > 0 ? 'orange' : ''}">
        <div class="stat-label">Pending Receipt</div>
        <div class="stat-value">${pendingIn}</div>
        <div class="stat-sub">Vehicles en route</div>
      </div>
      <div class="stat-tile ${discrepancies > 0 ? 'red' : ''}">
        <div class="stat-label">Discrepancies</div>
        <div class="stat-value">${discrepancies}</div>
        <div class="stat-sub">Qty mismatches</div>
      </div>
    </div>

    <!-- Quick actions -->
    <div style="display:flex;gap:1rem;margin-bottom:1.5rem;flex-wrap:wrap">
      <button class="btn btn-primary" onclick="navigate('dispatch')">🚚 New Dispatch</button>
      <button class="btn btn-outline" onclick="navigate('receipt')">📥 Confirm Receipt</button>
      <button class="btn btn-outline" onclick="navigate('reports')">📋 Reports</button>
    </div>

    <!-- Recent Activity -->
    <div class="card">
      <div class="card-header">Recent Activity</div>
      <div class="card-body">
        ${renderActivityLog(recentSnap)}
      </div>
    </div>

    <!-- Pending vehicles table -->
    ${pendingIn > 0 ? renderPendingAlert(inSnap.docs.filter(d => ["dispatched","in-transit"].includes(d.data().status))) : ""}
  `;

  // Wire quick-action buttons
  container.querySelectorAll("[onclick]").forEach(el => {
    const fn = el.getAttribute("onclick");
    el.removeAttribute("onclick");
    el.addEventListener("click", () => {
      const match = fn.match(/navigate\('(.+?)'\)/);
      if (match) window.navigate(match[1]);
    });
  });
}

// ══════════════════════════════════════════════════════════════
//  SUPER ADMIN DASHBOARD
// ══════════════════════════════════════════════════════════════
async function renderAdminDashboard(container, user) {
  const [allDispatch, allPlants, recentLogs] = await Promise.all([
    getDocs(query(collection(db, "dispatches"), orderBy("createdAt", "desc"))),
    getDocs(collection(db, "plants")),
    getDocs(query(collection(db, "activityLogs"), orderBy("timestamp", "desc"), limit(15))),
  ]);

  const total        = allDispatch.size;
  const dispatched   = allDispatch.docs.filter(d => d.data().status === "dispatched").length;
  const inTransit    = allDispatch.docs.filter(d => d.data().status === "in-transit").length;
  const received     = allDispatch.docs.filter(d => d.data().status === "received").length;
  const discrepancy  = allDispatch.docs.filter(d => d.data().status === "discrepancy").length;
  const plantCount   = allPlants.size;

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
        <td><span class="dispatch-id">${p.code}</span></td>
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
      <div class="stat-tile">
        <div class="stat-label">Total Shipments</div>
        <div class="stat-value">${total}</div>
        <div class="stat-sub">All time</div>
      </div>
      <div class="stat-tile orange">
        <div class="stat-label">Dispatched</div>
        <div class="stat-value">${dispatched}</div>
        <div class="stat-sub">In transit / waiting</div>
      </div>
      <div class="stat-tile green">
        <div class="stat-label">Received OK</div>
        <div class="stat-value">${received}</div>
        <div class="stat-sub">No issues</div>
      </div>
      <div class="stat-tile ${discrepancy > 0 ? 'red' : ''}">
        <div class="stat-label">Discrepancies</div>
        <div class="stat-value">${discrepancy}</div>
        <div class="stat-sub">Qty mismatches</div>
      </div>
      <div class="stat-tile">
        <div class="stat-label">Active Plants</div>
        <div class="stat-value">${plantCount}</div>
        <div class="stat-sub">In system</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;flex-wrap:wrap">
      <!-- Per-plant table -->
      <div class="card">
        <div class="card-header">Plant-wise Summary</div>
        <div class="card-body table-wrap">
          <table>
            <thead><tr>
              <th>Code</th><th>Plant</th>
              <th>Outgoing</th><th>Incoming</th>
              <th>Discrepancies</th><th>Status</th>
            </tr></thead>
            <tbody>${plantRows}</tbody>
          </table>
        </div>
      </div>

      <!-- Activity log -->
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
    return `<div class="empty-state" style="padding:1rem"><div class="empty-icon" style="font-size:1.5rem">📋</div><p>No activity yet.</p></div>`;
  }
  let html = `<div style="display:flex;flex-direction:column;gap:.5rem">`;
  snap.docs.forEach(d => {
    const a = d.data();
    const ts = a.timestamp?.toDate ? a.timestamp.toDate().toLocaleString("en-IN") : "—";
    const icon = { DISPATCH_CREATED: "🚚", RECEIPT_CONFIRMED: "✅" }[a.action] || "📌";
    html += `
      <div style="display:flex;gap:.75rem;align-items:flex-start;padding:.5rem 0;border-bottom:1px solid #eee">
        <span style="font-size:1.1rem">${icon}</span>
        <div>
          <div style="font-size:.85rem;font-weight:600">${a.details || a.action}</div>
          <div style="font-size:.75rem;color:#8e8ea8">${a.userName} · ${ts}</div>
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
    <div class="card mt-2" style="border-left:4px solid #f57c00">
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
