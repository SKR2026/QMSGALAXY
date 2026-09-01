/**
 * VEMS — Vehicle Expense Management System
 * Cloud Functions: Gmail Notifications via Cloud Scheduler
 *
 * Functions included:
 *  1. dailyCriticalAlerts     → Every day 8 AM IST — expired/critical documents
 *  2. weeklySummaryReport     → Every Monday 8 AM IST — full weekly summary
 *  3. missingInvoiceReminder  → Every day 9 AM IST — expenses without invoices
 *  4. abnormalFuelAlert       → Triggered on new fuel expense write
 *  5. invoiceExceptionAlert   → Triggered when exception request is created
 *  6. highExpenseAlert        → Triggered when expense exceeds threshold
 *
 * Setup required:
 *  firebase functions:secrets:set GMAIL_USER
 *  firebase functions:secrets:set GMAIL_APP_PASSWORD
 *  firebase functions:secrets:set SUPERADMIN_EMAIL
 */

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentCreated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const nodemailer = require("nodemailer");

initializeApp();
const db = getFirestore();

// ── SECRETS (set via: firebase functions:secrets:set SECRET_NAME) ──
const GMAIL_USER = defineSecret("GMAIL_USER");
const GMAIL_APP_PASSWORD = defineSecret("GMAIL_APP_PASSWORD");
const SUPERADMIN_EMAIL = defineSecret("SUPERADMIN_EMAIL");

// ── CONFIG ────────────────────────────────────────────────────────
const HIGH_EXPENSE_THRESHOLD = 50000; // ₹ — alert if single expense > this
const POOR_MILEAGE_THRESHOLD = 5;     // km/L — alert if mileage < this
const ALERT_DAYS = 60;                // days — warn if doc expires within this

// ── EMAIL TRANSPORTER ─────────────────────────────────────────────
function createTransporter(gmailUser, gmailPass) {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: gmailUser,
      pass: gmailPass,    // Gmail App Password (not your Gmail password)
    },
  });
}

// ── HELPERS ───────────────────────────────────────────────────────
function daysLeft(dateStr) {
  if (!dateStr) return 9999;
  return Math.ceil((new Date(dateStr) - new Date()) / 86400000);
}

function severityLabel(dl) {
  if (dl < 0) return "EXPIRED";
  if (dl <= 15) return "CRITICAL";
  if (dl <= 30) return "WARNING";
  if (dl <= 60) return "NOTICE";
  return "OK";
}

function severityColor(dl) {
  if (dl < 0) return "#dc2626";
  if (dl <= 15) return "#ea580c";
  if (dl <= 30) return "#d97706";
  if (dl <= 60) return "#0ea5e9";
  return "#16a34a";
}

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function fmtR(n) {
  return "₹" + Number(n || 0).toLocaleString("en-IN");
}

// ── EMAIL HTML WRAPPER ────────────────────────────────────────────
function emailWrapper(title, subtitle, bodyHTML, footerNote = "") {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  body{margin:0;padding:0;background:#f0f2f7;font-family:'Segoe UI',Arial,sans-serif;font-size:14px;color:#1a1f36}
  .wrap{max-width:640px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.09)}
  .header{background:linear-gradient(135deg,#0f1724,#1a56a0);padding:28px 32px;color:#fff}
  .header-logo{font-size:28px;margin-bottom:6px}
  .header-title{font-size:20px;font-weight:700;margin:0}
  .header-sub{font-size:13px;color:rgba(255,255,255,.65);margin-top:4px}
  .body{padding:28px 32px}
  .section-title{font-size:15px;font-weight:700;color:#0f1724;margin:20px 0 10px;border-bottom:2px solid #e5e7eb;padding-bottom:6px}
  table{width:100%;border-collapse:collapse;margin-bottom:16px}
  th{background:#f3f4f6;text-align:left;padding:9px 12px;font-size:12px;font-weight:600;color:#6b7280;border-bottom:1px solid #e5e7eb}
  td{padding:9px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;vertical-align:middle}
  tr:hover td{background:#fafbff}
  .badge{display:inline-block;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700}
  .kpi-row{display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap}
  .kpi{flex:1;min-width:120px;background:#f9fafb;border-radius:10px;padding:14px 16px;border-left:4px solid #1a56a0}
  .kpi-label{font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.4px}
  .kpi-val{font-size:20px;font-weight:700;color:#0f1724;margin-top:4px}
  .alert-box{border-radius:10px;padding:12px 16px;margin-bottom:10px;border-left:4px solid #dc2626;background:#fef2f2}
  .alert-box.warning{border-color:#d97706;background:#fffbeb}
  .alert-box.info{border-color:#0ea5e9;background:#eff6ff}
  .btn{display:inline-block;background:#1a56a0;color:#fff;text-decoration:none;padding:10px 22px;border-radius:8px;font-weight:600;font-size:13px;margin-top:8px}
  .footer{background:#f9fafb;padding:18px 32px;font-size:12px;color:#9ca3af;text-align:center;border-top:1px solid #e5e7eb}
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="header-logo">🚛</div>
    <div class="header-title">VEMS — ${title}</div>
    <div class="header-sub">${subtitle}</div>
  </div>
  <div class="body">${bodyHTML}</div>
  <div class="footer">
    ${footerNote || "This is an automated alert from VEMS · Vehicle Expense Management System · Polyplastics India Ltd"}
    <br/>Please do not reply to this email. Login to VEMS to take action.
  </div>
</div>
</body>
</html>`;
}

// ── SEND EMAIL ────────────────────────────────────────────────────
async function sendEmail(transporter, { to, subject, html }) {
  await transporter.sendMail({
    from: `"VEMS Alerts 🚛" <${transporter.options.auth.user}>`,
    to,
    subject,
    html,
  });
  console.log(`✅ Email sent to ${to}: ${subject}`);
}

// ── LOG NOTIFICATION TO FIRESTORE ────────────────────────────────
async function logNotification(type, title, recipients, data = {}) {
  await db.collection("notifications").add({
    type,
    title,
    recipients,
    data,
    sentAt: Timestamp.now(),
    read: false,
  });
}

// ══════════════════════════════════════════════════════════════════
// 1. DAILY CRITICAL ALERTS — Every day at 8:00 AM IST
//    Sends: expired/critical Insurance & PUC alerts
// ══════════════════════════════════════════════════════════════════
exports.dailyCriticalAlerts = onSchedule(
  {
    schedule: "0 2 * * *",        // 2:30 UTC = 8:00 AM IST
    timeZone: "Asia/Kolkata",
    region: "asia-south1",
    secrets: [GMAIL_USER, GMAIL_APP_PASSWORD, SUPERADMIN_EMAIL],
  },
  async () => {
    const gmailUser = GMAIL_USER.value();
    const gmailPass = GMAIL_APP_PASSWORD.value();
    const superadminEmail = SUPERADMIN_EMAIL.value();
    const transporter = createTransporter(gmailUser, gmailPass);

    // Fetch all vehicles and plants
    const [vehiclesSnap, plantsSnap, usersSnap] = await Promise.all([
      db.collection("vehicles").get(),
      db.collection("plants").get(),
      db.collection("users").where("role", "==", "plant_admin").get(),
    ]);

    const vehicles = vehiclesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const plants = plantsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const plantAdmins = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Build alerts
    const allAlerts = [];
    vehicles.forEach((v) => {
      [["insuranceExpiry", "Insurance"], ["pucExpiry", "PUC Certificate"]].forEach(([field, label]) => {
        const dl = daysLeft(v[field]);
        if (dl <= ALERT_DAYS) {
          allAlerts.push({
            vehicleId: v.id,
            regNo: v.regNo,
            make: v.make,
            model: v.model,
            driverName: v.driverName || "—",
            docType: label,
            expiryDate: v[field],
            daysLeft: dl,
            severity: severityLabel(dl),
            plantId: v.plantId,
          });
        }
      });
    });

    const critical = allAlerts.filter((a) => a.daysLeft <= 15);
    const expired = allAlerts.filter((a) => a.daysLeft < 0);

    if (allAlerts.length === 0) {
      console.log("✅ No document alerts today.");
      return;
    }

    // ── Build alert table HTML ──
    function alertTable(alerts) {
      if (!alerts.length) return "<p style='color:#6b7280'>None</p>";
      return `<table>
        <thead><tr><th>Vehicle</th><th>Make/Model</th><th>Document</th><th>Expiry</th><th>Days Left</th><th>Driver</th><th>Plant</th></tr></thead>
        <tbody>${alerts.map((a) => {
          const plant = plants.find((p) => p.id === a.plantId);
          const color = severityColor(a.daysLeft);
          return `<tr>
            <td><b>${a.regNo}</b></td>
            <td>${a.make} ${a.model}</td>
            <td>${a.docType}</td>
            <td>${fmtDate(a.expiryDate)}</td>
            <td style="color:${color};font-weight:700">${a.daysLeft < 0 ? "EXPIRED (" + Math.abs(a.daysLeft) + "d ago)" : a.daysLeft + " days"}</td>
            <td>${a.driverName}</td>
            <td>${plant?.code || "—"}</td>
          </tr>`;
        }).join("")}</tbody>
      </table>`;
    }

    // ── Send Superadmin consolidated email ──
    const superAdminHTML = `
      <div class="kpi-row">
        <div class="kpi" style="border-color:#dc2626"><div class="kpi-label">Expired</div><div class="kpi-val" style="color:#dc2626">${expired.length}</div></div>
        <div class="kpi" style="border-color:#ea580c"><div class="kpi-label">Critical (≤15d)</div><div class="kpi-val" style="color:#ea580c">${critical.filter((a) => a.daysLeft >= 0).length}</div></div>
        <div class="kpi" style="border-color:#d97706"><div class="kpi-label">Total Alerts</div><div class="kpi-val" style="color:#d97706">${allAlerts.length}</div></div>
        <div class="kpi"><div class="kpi-label">Plants</div><div class="kpi-val">${plants.length}</div></div>
      </div>
      ${expired.length ? `<div class="section-title" style="color:#dc2626">❌ Expired Documents (${expired.length})</div>${alertTable(expired)}` : ""}
      ${critical.filter((a) => a.daysLeft >= 0).length ? `<div class="section-title" style="color:#ea580c">🔴 Critical — Expiring within 15 days</div>${alertTable(critical.filter((a) => a.daysLeft >= 0))}` : ""}
      ${allAlerts.filter((a) => a.daysLeft >= 15 && a.daysLeft <= 30).length ? `<div class="section-title" style="color:#d97706">🟡 Warning — Expiring within 30 days</div>${alertTable(allAlerts.filter((a) => a.daysLeft >= 15 && a.daysLeft <= 30))}` : ""}
      <a href="https://www.qmsgalaxy.com/pp-ve/" class="btn">Open VEMS Dashboard →</a>
    `;

    await sendEmail(transporter, {
      to: superadminEmail,
      subject: `🚨 VEMS Daily Alert — ${expired.length} Expired, ${critical.filter((a) => a.daysLeft >= 0).length} Critical | ${new Date().toLocaleDateString("en-IN")}`,
      html: emailWrapper(
        "Daily Document Alert",
        `${new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · All Plants`,
        superAdminHTML
      ),
    });

    // ── Send per-Plant Admin emails ──
    for (const admin of plantAdmins) {
      const plantAlerts = allAlerts.filter((a) => a.plantId === admin.plantId);
      if (!plantAlerts.length) continue;
      const plant = plants.find((p) => p.id === admin.plantId);
      const plantHTML = `
        <div class="kpi-row">
          <div class="kpi" style="border-color:#dc2626"><div class="kpi-label">Expired</div><div class="kpi-val" style="color:#dc2626">${plantAlerts.filter((a) => a.daysLeft < 0).length}</div></div>
          <div class="kpi" style="border-color:#ea580c"><div class="kpi-label">Critical</div><div class="kpi-val" style="color:#ea580c">${plantAlerts.filter((a) => a.daysLeft >= 0 && a.daysLeft <= 15).length}</div></div>
          <div class="kpi"><div class="kpi-label">Total</div><div class="kpi-val">${plantAlerts.length}</div></div>
        </div>
        <div class="section-title">Document Alerts — ${plant?.name || admin.plantId}</div>
        ${alertTable(plantAlerts)}
        <p style="color:#6b7280;font-size:12px">Please renew these documents immediately to ensure compliance.</p>
        <a href="https://www.qmsgalaxy.com/pp-ve/" class="btn">Open VEMS →</a>
      `;
      await sendEmail(transporter, {
        to: admin.email,
        subject: `⚠️ VEMS Alert — ${plantAlerts.length} document(s) require attention | ${plant?.name || ""}`,
        html: emailWrapper("Document Alert", `${plant?.name || ""} · ${new Date().toLocaleDateString("en-IN")}`, plantHTML),
      });
    }

    // Save alerts to Firestore
    const batch = db.batch();
    allAlerts.filter((a) => a.daysLeft <= 15).forEach((a) => {
      const ref = db.collection("alerts").doc(`${a.vehicleId}_${a.docType.replace(/ /g, "_")}`);
      batch.set(ref, { ...a, notifiedAt: Timestamp.now(), acknowledged: false }, { merge: true });
    });
    await batch.commit();
    await logNotification("document_alert", "Daily Document Alerts", [superadminEmail], { count: allAlerts.length });

    console.log(`✅ Daily alerts: ${allAlerts.length} total, emails sent.`);
  }
);

// ══════════════════════════════════════════════════════════════════
// 2. WEEKLY SUMMARY REPORT — Every Monday at 8:00 AM IST
//    Sends: full fleet summary, expenses, CO₂, top vehicles
// ══════════════════════════════════════════════════════════════════
exports.weeklySummaryReport = onSchedule(
  {
    schedule: "0 2 * * 1",        // Monday 2:30 UTC = 8:00 AM IST
    timeZone: "Asia/Kolkata",
    region: "asia-south1",
    secrets: [GMAIL_USER, GMAIL_APP_PASSWORD, SUPERADMIN_EMAIL],
  },
  async () => {
    const gmailUser = GMAIL_USER.value();
    const gmailPass = GMAIL_APP_PASSWORD.value();
    const superadminEmail = SUPERADMIN_EMAIL.value();
    const transporter = createTransporter(gmailUser, gmailPass);

    // Date range: last 7 days
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoStr = weekAgo.toISOString().slice(0, 10);

    const [vehiclesSnap, plantsSnap, expensesSnap, usersSnap] = await Promise.all([
      db.collection("vehicles").get(),
      db.collection("plants").get(),
      db.collection("expenses").where("date", ">=", weekAgoStr).get(),
      db.collection("users").where("role", "==", "plant_admin").get(),
    ]);

    const vehicles = vehiclesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const plants = plantsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const expenses = expensesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const plantAdmins = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const totalExp = expenses.reduce((s, e) => s + (e.amount || 0), 0);
    const totalFuel = expenses.filter((e) => e.category === "Fuel").reduce((s, e) => s + (e.fuelQty || 0), 0);
    const totalCO2 = expenses.reduce((s, e) => s + (e.co2Emission || 0), 0);
    const withBill = expenses.filter((e) => e.hasBill).length;
    const noBill = expenses.length - withBill;

    // Per-plant breakdown
    const plantBreakdown = plants.map((p) => {
      const pExp = expenses.filter((e) => e.plantId === p.id);
      return {
        ...p,
        expenses: pExp.length,
        total: pExp.reduce((s, e) => s + (e.amount || 0), 0),
        fuel: pExp.filter((e) => e.category === "Fuel").reduce((s, e) => s + (e.fuelQty || 0), 0),
        co2: pExp.reduce((s, e) => s + (e.co2Emission || 0), 0),
      };
    });

    // Top 5 expensive vehicles this week
    const vehicleExp = vehicles.map((v) => ({
      ...v,
      weekTotal: expenses.filter((e) => e.vehicleId === v.id).reduce((s, e) => s + (e.amount || 0), 0),
    })).sort((a, b) => b.weekTotal - a.weekTotal).slice(0, 5);

    // Alert summary
    const alerts = [];
    vehicles.forEach((v) => {
      [["insuranceExpiry", "Insurance"], ["pucExpiry", "PUC"]].forEach(([f, l]) => {
        const dl = daysLeft(v[f]);
        if (dl <= 30) alerts.push({ regNo: v.regNo, docType: l, daysLeft: dl, plantId: v.plantId });
      });
    });

    const superAdminHTML = `
      <p>Here is your weekly fleet summary for <b>${weekAgoStr}</b> to <b>${new Date().toISOString().slice(0, 10)}</b>.</p>
      <div class="kpi-row">
        <div class="kpi"><div class="kpi-label">Total Expenses</div><div class="kpi-val">${fmtR(totalExp)}</div></div>
        <div class="kpi" style="border-color:#d97706"><div class="kpi-label">Fuel Consumed</div><div class="kpi-val">${totalFuel.toFixed(0)} L</div></div>
        <div class="kpi" style="border-color:#dc2626"><div class="kpi-label">CO₂ Emitted</div><div class="kpi-val">${totalCO2.toFixed(0)} kg</div></div>
        <div class="kpi" style="border-color:${noBill > 0 ? "#d97706" : "#16a34a"}"><div class="kpi-label">Missing Bills</div><div class="kpi-val" style="color:${noBill > 0 ? "#d97706" : "#16a34a"}">${noBill}</div></div>
      </div>
      <div class="section-title">Plant-wise Breakdown</div>
      <table>
        <thead><tr><th>Plant</th><th>Expenses</th><th>Total Cost</th><th>Fuel (L)</th><th>CO₂ (kg)</th></tr></thead>
        <tbody>${plantBreakdown.map((p) => `<tr>
          <td><b>${p.name}</b></td>
          <td>${p.expenses}</td>
          <td class="font-semibold">${fmtR(p.total)}</td>
          <td>${p.fuel.toFixed(1)}</td>
          <td>${p.co2.toFixed(1)}</td>
        </tr>`).join("")}</tbody>
      </table>
      <div class="section-title">Top 5 High-Expense Vehicles This Week</div>
      <table>
        <thead><tr><th>Vehicle</th><th>Make/Model</th><th>Plant</th><th>This Week</th></tr></thead>
        <tbody>${vehicleExp.map((v) => {
          const plant = plants.find((p) => p.id === v.plantId);
          return `<tr>
            <td><b>${v.regNo}</b></td>
            <td>${v.make} ${v.model}</td>
            <td>${plant?.code || "—"}</td>
            <td><b>${fmtR(v.weekTotal)}</b></td>
          </tr>`;
        }).join("")}</tbody>
      </table>
      ${alerts.length ? `
        <div class="section-title" style="color:#d97706">⚠️ Documents Expiring in 30 Days (${alerts.length})</div>
        <table>
          <thead><tr><th>Vehicle</th><th>Document</th><th>Days Left</th><th>Plant</th></tr></thead>
          <tbody>${alerts.map((a) => {
            const plant = plants.find((p) => p.id === a.plantId);
            return `<tr>
              <td><b>${a.regNo}</b></td>
              <td>${a.docType}</td>
              <td style="color:${severityColor(a.daysLeft)};font-weight:700">${a.daysLeft < 0 ? "EXPIRED" : a.daysLeft + " days"}</td>
              <td>${plant?.code || "—"}</td>
            </tr>`;
          }).join("")}</tbody>
        </table>` : ""}
      ${noBill > 0 ? `<div class="alert-box warning">⚠️ <b>${noBill} expense entries</b> this week are missing invoices. Please ensure all bills are uploaded.</div>` : ""}
      <a href="https://www.qmsgalaxy.com/pp-ve/" class="btn">Open VEMS Dashboard →</a>
    `;

    await sendEmail(transporter, {
      to: superadminEmail,
      subject: `📊 VEMS Weekly Summary — ${fmtR(totalExp)} expenses, ${totalCO2.toFixed(0)}kg CO₂ | Week of ${weekAgoStr}`,
      html: emailWrapper("Weekly Fleet Summary", `${weekAgoStr} to ${new Date().toISOString().slice(0, 10)} · All Plants`, superAdminHTML),
    });

    // ── Per-Plant Admin weekly summary ──
    for (const admin of plantAdmins) {
      const pExp = expenses.filter((e) => e.plantId === admin.plantId);
      if (!pExp.length) continue;
      const plant = plants.find((p) => p.id === admin.plantId);
      const pTotal = pExp.reduce((s, e) => s + (e.amount || 0), 0);
      const pFuel = pExp.filter((e) => e.category === "Fuel").reduce((s, e) => s + (e.fuelQty || 0), 0);
      const pCO2 = pExp.reduce((s, e) => s + (e.co2Emission || 0), 0);
      const pNoBill = pExp.filter((e) => !e.hasBill).length;
      const pAlerts = alerts.filter((a) => a.plantId === admin.plantId);

      const plantHTML = `
        <p>Your weekly fleet summary for <b>${plant?.name || ""}</b>.</p>
        <div class="kpi-row">
          <div class="kpi"><div class="kpi-label">Total Expenses</div><div class="kpi-val">${fmtR(pTotal)}</div></div>
          <div class="kpi" style="border-color:#d97706"><div class="kpi-label">Fuel</div><div class="kpi-val">${pFuel.toFixed(0)} L</div></div>
          <div class="kpi" style="border-color:#dc2626"><div class="kpi-label">CO₂</div><div class="kpi-val">${pCO2.toFixed(0)} kg</div></div>
          <div class="kpi" style="border-color:${pNoBill > 0 ? "#d97706" : "#16a34a"}"><div class="kpi-label">Missing Bills</div><div class="kpi-val">${pNoBill}</div></div>
        </div>
        ${pAlerts.length ? `<div class="alert-box warning">⚠️ <b>${pAlerts.length} documents</b> expiring within 30 days. Please renew immediately.</div>` : ""}
        ${pNoBill > 0 ? `<div class="alert-box warning">⚠️ <b>${pNoBill} expenses</b> are missing invoices. Upload bills in VEMS.</div>` : ""}
        <a href="https://www.qmsgalaxy.com/pp-ve/" class="btn">Open VEMS →</a>
      `;
      await sendEmail(transporter, {
        to: admin.email,
        subject: `📊 VEMS Weekly Summary — ${plant?.name || ""} | ${fmtR(pTotal)} this week`,
        html: emailWrapper("Weekly Summary", `${plant?.name || ""} · ${weekAgoStr} to ${new Date().toISOString().slice(0, 10)}`, plantHTML),
      });
    }

    await logNotification("weekly_summary", "Weekly Fleet Summary", [superadminEmail], { totalExp, totalFuel, totalCO2 });
    console.log("✅ Weekly summary sent.");
  }
);

// ══════════════════════════════════════════════════════════════════
// 3. MISSING INVOICE REMINDER — Every day 9:00 AM IST
//    Sends: list of expenses with no invoice uploaded
// ══════════════════════════════════════════════════════════════════
exports.missingInvoiceReminder = onSchedule(
  {
    schedule: "30 3 * * *",       // 3:30 UTC = 9:00 AM IST
    timeZone: "Asia/Kolkata",
    region: "asia-south1",
    secrets: [GMAIL_USER, GMAIL_APP_PASSWORD, SUPERADMIN_EMAIL],
  },
  async () => {
    const gmailUser = GMAIL_USER.value();
    const gmailPass = GMAIL_APP_PASSWORD.value();
    const superadminEmail = SUPERADMIN_EMAIL.value();
    const transporter = createTransporter(gmailUser, gmailPass);

    // Last 30 days expenses with no bill
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const cutoff = thirtyDaysAgo.toISOString().slice(0, 10);

    const [expSnap, vehiclesSnap, plantsSnap, usersSnap] = await Promise.all([
      db.collection("expenses").where("hasBill", "==", false).where("date", ">=", cutoff).get(),
      db.collection("vehicles").get(),
      db.collection("plants").get(),
      db.collection("users").where("role", "==", "plant_admin").get(),
    ]);

    const missingBill = expSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const vehicles = vehiclesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const plants = plantsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const plantAdmins = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (!missingBill.length) {
      console.log("✅ All expenses have invoices. No reminder needed.");
      return;
    }

    function buildMissingTable(exps) {
      return `<table>
        <thead><tr><th>Date</th><th>Vehicle</th><th>Category</th><th>Amount</th><th>Vendor</th><th>Plant</th></tr></thead>
        <tbody>${exps.map((e) => {
          const v = vehicles.find((x) => x.id === e.vehicleId);
          const p = plants.find((x) => x.id === e.plantId);
          return `<tr>
            <td>${fmtDate(e.date)}</td>
            <td><b>${v?.regNo || "—"}</b></td>
            <td>${e.category}</td>
            <td>${fmtR(e.amount)}</td>
            <td>${e.vendor || "—"}</td>
            <td>${p?.code || "—"}</td>
          </tr>`;
        }).join("")}</tbody>
      </table>`;
    }

    // Superadmin consolidated
    const saHTML = `
      <div class="alert-box">🚨 <b>${missingBill.length} expense records</b> in the last 30 days are missing invoices. Invoice upload is mandatory.</div>
      <div class="section-title">Expenses Without Invoices</div>
      ${buildMissingTable(missingBill.slice(0, 30))}
      ${missingBill.length > 30 ? `<p style="color:#6b7280">...and ${missingBill.length - 30} more. Login to VEMS for full list.</p>` : ""}
      <a href="https://www.qmsgalaxy.com/pp-ve/" class="btn">Upload Invoices in VEMS →</a>
    `;

    await sendEmail(transporter, {
      to: superadminEmail,
      subject: `📎 VEMS Invoice Reminder — ${missingBill.length} expenses missing bills | ${new Date().toLocaleDateString("en-IN")}`,
      html: emailWrapper("Missing Invoice Reminder", `Last 30 days · All Plants · ${new Date().toLocaleDateString("en-IN")}`, saHTML),
    });

    // Per-plant admin
    for (const admin of plantAdmins) {
      const plantMissing = missingBill.filter((e) => e.plantId === admin.plantId);
      if (!plantMissing.length) continue;
      const plant = plants.find((p) => p.id === admin.plantId);
      const plantHTML = `
        <div class="alert-box">⚠️ <b>${plantMissing.length} expenses</b> in your plant are missing invoices. Please upload immediately.</div>
        ${buildMissingTable(plantMissing)}
        <a href="https://www.qmsgalaxy.com/pp-ve/" class="btn">Upload Invoices →</a>
      `;
      await sendEmail(transporter, {
        to: admin.email,
        subject: `📎 VEMS — ${plantMissing.length} invoices pending | ${plant?.name || ""}`,
        html: emailWrapper("Invoice Reminder", `${plant?.name || ""} · ${new Date().toLocaleDateString("en-IN")}`, plantHTML),
      });
    }

    console.log(`✅ Invoice reminder sent for ${missingBill.length} records.`);
  }
);

// ══════════════════════════════════════════════════════════════════
// 4. ABNORMAL FUEL / HIGH EXPENSE ALERT — Triggered on expense write
//    Fires when: poor mileage OR expense > threshold
// ══════════════════════════════════════════════════════════════════
exports.expenseAlertTrigger = onDocumentCreated(
  {
    document: "expenses/{expenseId}",
    region: "asia-south1",
    secrets: [GMAIL_USER, GMAIL_APP_PASSWORD, SUPERADMIN_EMAIL],
  },
  async (event) => {
    const expense = event.data.data();
    const gmailUser = GMAIL_USER.value();
    const gmailPass = GMAIL_APP_PASSWORD.value();
    const superadminEmail = SUPERADMIN_EMAIL.value();
    const transporter = createTransporter(gmailUser, gmailPass);

    const [vehicleDoc, plantAdminsSnap] = await Promise.all([
      expense.vehicleId ? db.collection("vehicles").doc(expense.vehicleId).get() : Promise.resolve(null),
      db.collection("users").where("plantId", "==", expense.plantId).where("role", "==", "plant_admin").get(),
    ]);

    const vehicle = vehicleDoc?.exists ? vehicleDoc.data() : null;
    const plantAdmin = plantAdminsSnap.docs[0]?.data();
    const recipients = [superadminEmail];
    if (plantAdmin?.email) recipients.push(plantAdmin.email);

    let shouldAlert = false;
    let alertMessages = [];

    // Check high expense
    if ((expense.amount || 0) > HIGH_EXPENSE_THRESHOLD) {
      shouldAlert = true;
      alertMessages.push(`💰 <b>High Expense Alert:</b> ${fmtR(expense.amount)} — ${expense.category} for ${vehicle?.regNo || "vehicle"}.`);
    }

    // Check poor mileage (Fuel entries only)
    if (expense.category === "Fuel" && expense.fuelQty && expense.distanceTravelled) {
      const mileage = expense.distanceTravelled / expense.fuelQty;
      if (mileage < POOR_MILEAGE_THRESHOLD) {
        shouldAlert = true;
        alertMessages.push(`⛽ <b>Poor Mileage Alert:</b> ${mileage.toFixed(1)} km/L (threshold: ${POOR_MILEAGE_THRESHOLD} km/L) for ${vehicle?.regNo || "vehicle"}.`);
      }
    }

    if (!shouldAlert) return;

    const alertHTML = `
      ${alertMessages.map((m) => `<div class="alert-box">${m}</div>`).join("")}
      <div class="section-title">Expense Details</div>
      <table>
        <thead><tr><th>Field</th><th>Value</th></tr></thead>
        <tbody>
          <tr><td>Vehicle</td><td><b>${vehicle?.regNo || "—"}</b> — ${vehicle?.make || ""} ${vehicle?.model || ""}</td></tr>
          <tr><td>Date</td><td>${fmtDate(expense.date)}</td></tr>
          <tr><td>Category</td><td>${expense.category}</td></tr>
          <tr><td>Amount</td><td><b>${fmtR(expense.amount)}</b></td></tr>
          <tr><td>Vendor</td><td>${expense.vendor || "—"}</td></tr>
          <tr><td>Odometer</td><td>${expense.odometer ? expense.odometer + " km" : "—"}</td></tr>
          ${expense.fuelQty ? `<tr><td>Fuel Qty</td><td>${expense.fuelQty} L</td></tr>` : ""}
          ${expense.distanceTravelled ? `<tr><td>Distance</td><td>${expense.distanceTravelled} km</td></tr>` : ""}
          ${expense.fuelQty && expense.distanceTravelled ? `<tr><td>Mileage</td><td><b style="color:#dc2626">${(expense.distanceTravelled / expense.fuelQty).toFixed(1)} km/L</b></td></tr>` : ""}
          <tr><td>CO₂ Emission</td><td>${expense.co2Emission ? expense.co2Emission + " kg" : "—"}</td></tr>
          <tr><td>Entered By</td><td>${expense.enteredBy || "—"}</td></tr>
        </tbody>
      </table>
      <a href="https://www.qmsgalaxy.com/pp-ve/" class="btn">Review in VEMS →</a>
    `;

    await sendEmail(transporter, {
      to: recipients.join(","),
      subject: `🚨 VEMS Alert — ${expense.amount > HIGH_EXPENSE_THRESHOLD ? "High Expense" : "Poor Mileage"} | ${vehicle?.regNo || "Vehicle"} | ${fmtDate(expense.date)}`,
      html: emailWrapper("Expense Alert", `${vehicle?.regNo || "Vehicle"} · ${fmtDate(expense.date)}`, alertHTML),
    });

    await logNotification("expense_alert", "High Expense / Poor Mileage Alert", recipients, { vehicleId: expense.vehicleId, amount: expense.amount });
    console.log(`✅ Expense alert sent for ${vehicle?.regNo}: ${fmtR(expense.amount)}`);
  }
);

// ══════════════════════════════════════════════════════════════════
// 5. INVOICE EXCEPTION ALERT — When exception request is created
//    Sends: Superadmin approval request email
// ══════════════════════════════════════════════════════════════════
exports.invoiceExceptionAlert = onDocumentWritten(
  {
    document: "expenses/{expenseId}",
    region: "asia-south1",
    secrets: [GMAIL_USER, GMAIL_APP_PASSWORD, SUPERADMIN_EMAIL],
  },
  async (event) => {
    const newData = event.data.after?.data();
    const oldData = event.data.before?.data();
    if (!newData?.invoiceException) return;
    if (oldData?.invoiceException) return; // already processed

    const gmailUser = GMAIL_USER.value();
    const gmailPass = GMAIL_APP_PASSWORD.value();
    const superadminEmail = SUPERADMIN_EMAIL.value();
    const transporter = createTransporter(gmailUser, gmailPass);

    const vehicleDoc = newData.vehicleId ? await db.collection("vehicles").doc(newData.vehicleId).get() : null;
    const vehicle = vehicleDoc?.exists ? vehicleDoc.data() : null;

    const exceptionHTML = `
      <div class="alert-box">🔔 A new <b>Invoice Exception Request</b> requires your approval.</div>
      <div class="section-title">Exception Details</div>
      <table>
        <thead><tr><th>Field</th><th>Value</th></tr></thead>
        <tbody>
          <tr><td>Vehicle</td><td><b>${vehicle?.regNo || "—"}</b></td></tr>
          <tr><td>Date</td><td>${fmtDate(newData.date)}</td></tr>
          <tr><td>Category</td><td>${newData.category}</td></tr>
          <tr><td>Amount</td><td><b>${fmtR(newData.amount)}</b></td></tr>
          <tr><td>Vendor</td><td>${newData.vendor || "—"}</td></tr>
          <tr><td>Reason</td><td>${newData.exceptionReason || "Not provided"}</td></tr>
          <tr><td>Submitted By</td><td>${newData.enteredBy || "—"}</td></tr>
          <tr><td>Status</td><td><span style="color:#d97706;font-weight:700">PENDING APPROVAL</span></td></tr>
        </tbody>
      </table>
      <p>Please login to VEMS to <b>Approve</b> or <b>Reject</b> this exception request.</p>
      <a href="https://www.qmsgalaxy.com/pp-ve/" class="btn">Review & Approve in VEMS →</a>
    `;

    await sendEmail(transporter, {
      to: superadminEmail,
      subject: `🔔 VEMS Invoice Exception — Approval Required | ${vehicle?.regNo || "Vehicle"} | ${fmtR(newData.amount)}`,
      html: emailWrapper("Invoice Exception Request", `Pending Approval · ${fmtDate(newData.date)}`, exceptionHTML),
    });

    console.log(`✅ Invoice exception alert sent for expense ${event.params.expenseId}`);
  }
);
