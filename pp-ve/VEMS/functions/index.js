const functions = require('firebase-functions');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const { addDays, subDays, format, parseISO } = require('date-fns');

admin.initializeApp();
const db = admin.firestore();

// ─── Gmail Transporter (set these in Firebase environment config) ───────────
// Run once in Cloud Shell:
//   firebase functions:config:set gmail.user="you@gmail.com" gmail.pass="app_password"
//   firebase functions:config:set notify.to="admin@example.com"
// ─────────────────────────────────────────────────────────────────────────────
function createTransporter() {
  const cfg = functions.config();
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: cfg.gmail.user,
      pass: cfg.gmail.pass,   // Use a Gmail App Password, not your main password
    },
  });
}

async function sendEmail(subject, html) {
  const cfg = functions.config();
  const transporter = createTransporter();
  await transporter.sendMail({
    from: `"VEMS Alerts" <${cfg.gmail.user}>`,
    to: cfg.notify.to,         // recipient email(s), comma-separated for multiple
    subject,
    html,
  });
  functions.logger.info(`Email sent: ${subject}`);
}


// ─────────────────────────────────────────────────────────────────────────────
// 1. DAILY EXPIRY ALERT — every day at 7:00 AM IST
//    Checks vehicle documents (insurance, pollution, fitness, permit)
//    and emails admin if anything is expiring within 60 days or already expired.
// ─────────────────────────────────────────────────────────────────────────────
exports.dailyExpiryAlert = functions
  .region('asia-south1')
  .pubsub
  .schedule('0 7 * * *')
  .timeZone('Asia/Kolkata')
  .onRun(async () => {
    functions.logger.info('Running daily expiry alert check');

    const today = new Date();
    const threshold60 = addDays(today, 60);

    const vehiclesSnap = await db.collection('vehicles').where('status', '==', 'active').get();
    const batch = db.batch();
    const criticalAlerts = [];

    vehiclesSnap.docs.forEach(doc => {
      const v = { id: doc.id, ...doc.data() };
      const docFields = [
        { field: 'insuranceExpiry',  label: 'Insurance' },
        { field: 'pollutionExpiry',  label: 'Pollution Certificate' },
        { field: 'fitnessExpiry',    label: 'Fitness Certificate' },
        { field: 'permitExpiry',     label: 'Permit' },
      ];

      docFields.forEach(({ field, label }) => {
        if (!v[field]) return;
        const expiry = parseISO(v[field]);
        const daysLeft = Math.ceil((expiry - today) / 86400000);
        if (daysLeft > 60) return;

        const severity = daysLeft < 0 ? 'expired'
          : daysLeft <= 15 ? 'critical'
          : daysLeft <= 30 ? 'warning' : 'notice';

        const alertRef = db.collection('alerts').doc(`${v.id}_${field}_${format(today, 'yyyyMMdd')}`);
        batch.set(alertRef, {
          vehicleId: v.id, regNo: v.regNo, plantId: v.plantId,
          docType: label, expiryDate: v[field], daysLeft, severity,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          acknowledged: false,
        }, { merge: true });

        if (severity === 'expired' || severity === 'critical') {
          criticalAlerts.push({ regNo: v.regNo, docType: label, daysLeft, severity });
        }
      });
    });

    await batch.commit();

    // Send email if critical alerts exist
    if (criticalAlerts.length > 0) {
      const rows = criticalAlerts.map(a =>
        `<tr>
          <td>${a.regNo}</td>
          <td>${a.docType}</td>
          <td style="color:${a.daysLeft < 0 ? 'red' : 'orange'}">
            ${a.daysLeft < 0 ? 'EXPIRED' : a.daysLeft + ' days left'}
          </td>
        </tr>`
      ).join('');

      await sendEmail(
        `⚠️ VEMS Alert: ${criticalAlerts.length} document(s) need urgent attention`,
        `<h2>VEMS — Daily Document Expiry Alert</h2>
         <p>${criticalAlerts.length} vehicle document(s) are expired or expiring within 15 days:</p>
         <table border="1" cellpadding="6" cellspacing="0">
           <tr><th>Vehicle Reg No</th><th>Document</th><th>Status</th></tr>
           ${rows}
         </table>
         <p>Please take action immediately. Login to VEMS to acknowledge.</p>`
      );

      await db.collection('notifications').add({
        type: 'EXPIRY_ALERT',
        title: `${criticalAlerts.length} document(s) require urgent attention`,
        body: criticalAlerts.map(a => `${a.regNo}: ${a.docType} (${a.daysLeft < 0 ? 'EXPIRED' : a.daysLeft + ' days left'})`).join('\n'),
        severity: 'critical', recipients: 'all_admins',
        alerts: criticalAlerts,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        read: false,
      });
    }

    functions.logger.info(`Expiry check done. Critical: ${criticalAlerts.length}`);
    return null;
  });


// ─────────────────────────────────────────────────────────────────────────────
// 2. MONTHLY EXPENSE REPORT — 1st of every month at 8:00 AM IST
//    Aggregates last month's expenses by plant and emails summary to admin.
// ─────────────────────────────────────────────────────────────────────────────
exports.monthlyExpenseReport = functions
  .region('asia-south1')
  .pubsub
  .schedule('0 8 1 * *')
  .timeZone('Asia/Kolkata')
  .onRun(async () => {
    const today = new Date();
    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const monthStr = format(lastMonth, 'yyyy-MM');
    functions.logger.info(`Generating monthly report for ${monthStr}`);

    const snap = await db.collection('expenses')
      .where('date', '>=', `${monthStr}-01`)
      .where('date', '<=', `${monthStr}-31`)
      .get();

    const expenses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const total = expenses.reduce((s, e) => s + e.amount, 0);

    // Aggregate by plant
    const plantSummary = {};
    expenses.forEach(e => {
      if (!plantSummary[e.plantId]) plantSummary[e.plantId] = { total: 0, fuel: 0, maintenance: 0, other: 0 };
      plantSummary[e.plantId].total += e.amount;
      if (e.category === 'Fuel') plantSummary[e.plantId].fuel += e.amount;
      else if (['Maintenance', 'Repairs', 'Spare Parts'].includes(e.category)) plantSummary[e.plantId].maintenance += e.amount;
      else plantSummary[e.plantId].other += e.amount;
    });

    await db.collection('monthly_reports').doc(monthStr).set({
      month: monthStr, totalExpenses: total,
      expenseCount: expenses.length, plantSummary,
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Email monthly report
    const plantRows = Object.entries(plantSummary).map(([plant, s]) =>
      `<tr><td>${plant}</td><td>₹${s.total.toLocaleString('en-IN')}</td><td>₹${s.fuel.toLocaleString('en-IN')}</td><td>₹${s.maintenance.toLocaleString('en-IN')}</td><td>₹${s.other.toLocaleString('en-IN')}</td></tr>`
    ).join('');

    await sendEmail(
      `📊 VEMS Monthly Report — ${format(lastMonth, 'MMMM yyyy')}`,
      `<h2>VEMS — Monthly Expense Report</h2>
       <h3>${format(lastMonth, 'MMMM yyyy')}</h3>
       <p><strong>Total Expenses:</strong> ₹${total.toLocaleString('en-IN')} across ${expenses.length} records</p>
       <table border="1" cellpadding="6" cellspacing="0">
         <tr><th>Plant</th><th>Total</th><th>Fuel</th><th>Maintenance</th><th>Other</th></tr>
         ${plantRows}
       </table>`
    );

    await db.collection('notifications').add({
      type: 'MONTHLY_REPORT',
      title: `Monthly Expense Report — ${format(lastMonth, 'MMMM yyyy')}`,
      body: `Total: ₹${total.toLocaleString('en-IN')} across ${expenses.length} records`,
      month: monthStr, recipients: 'superadmin',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      read: false,
    });

    functions.logger.info(`Monthly report done. Total: ${total}`);
    return null;
  });


// ─────────────────────────────────────────────────────────────────────────────
// 3. WEEKLY MILEAGE SUMMARY — every Monday at 9:00 AM IST
//    Summarizes weekly fuel usage and flags low-mileage vehicles.
// ─────────────────────────────────────────────────────────────────────────────
exports.weeklyMileageSummary = functions
  .region('asia-south1')
  .pubsub
  .schedule('0 9 * * 1')
  .timeZone('Asia/Kolkata')
  .onRun(async () => {
    const today = new Date();
    const weekAgo = subDays(today, 7);
    const weekAgoStr = format(weekAgo, 'yyyy-MM-dd');
    const todayStr = format(today, 'yyyy-MM-dd');

    const snap = await db.collection('expenses')
      .where('category', '==', 'Fuel')
      .where('date', '>=', weekAgoStr)
      .where('date', '<=', todayStr)
      .get();

    const fuelExpenses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const totalFuel = fuelExpenses.reduce((s, e) => s + (e.fuelQty || 0), 0);
    const totalCost = fuelExpenses.reduce((s, e) => s + e.amount, 0);

    await db.collection('weekly_reports').add({
      weekStart: weekAgoStr, weekEnd: todayStr,
      totalFuel, totalFuelCost: totalCost,
      fuelRecords: fuelExpenses.length,
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await sendEmail(
      `⛽ VEMS Weekly Mileage Summary — Week of ${weekAgoStr}`,
      `<h2>VEMS — Weekly Mileage Summary</h2>
       <p><strong>Period:</strong> ${weekAgoStr} to ${todayStr}</p>
       <ul>
         <li>Total Fuel Consumed: <strong>${totalFuel.toFixed(1)} L</strong></li>
         <li>Total Fuel Cost: <strong>₹${totalCost.toLocaleString('en-IN')}</strong></li>
         <li>Fuel Records: <strong>${fuelExpenses.length}</strong></li>
       </ul>`
    );

    functions.logger.info(`Weekly mileage done. Fuel: ${totalFuel}L`);
    return null;
  });


// ─────────────────────────────────────────────────────────────────────────────
// 4. MISSING BILLS CHECK — every day at 6:00 PM IST
//    Flags yesterday's expenses with no bill attached and emails admin.
// ─────────────────────────────────────────────────────────────────────────────
exports.checkMissingBills = functions
  .region('asia-south1')
  .pubsub
  .schedule('0 18 * * *')
  .timeZone('Asia/Kolkata')
  .onRun(async () => {
    const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');

    const snap = await db.collection('expenses')
      .where('hasBill', '==', false)
      .where('date', '==', yesterday)
      .get();

    if (!snap.empty) {
      await sendEmail(
        `🧾 VEMS: ${snap.size} expense(s) missing bill attachment`,
        `<h2>VEMS — Missing Bills Alert</h2>
         <p>${snap.size} expense record(s) from <strong>${yesterday}</strong> have no bill uploaded.</p>
         <p>Please login to VEMS and attach the invoices.</p>`
      );

      await db.collection('notifications').add({
        type: 'MISSING_BILLS',
        title: `${snap.size} expense(s) missing bill attachment`,
        body: `${snap.size} expense records from yesterday have no bill uploaded.`,
        expenseIds: snap.docs.map(d => d.id),
        recipients: 'plant_admins',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        read: false,
      });

      functions.logger.info(`Flagged ${snap.size} expenses with missing bills`);
    }
    return null;
  });


// ─────────────────────────────────────────────────────────────────────────────
// 5. CLEANUP OLD ALERTS — every Sunday at 2:00 AM IST
//    Deletes acknowledged alerts older than 90 days.
// ─────────────────────────────────────────────────────────────────────────────
exports.cleanupOldAlerts = functions
  .region('asia-south1')
  .pubsub
  .schedule('0 2 * * 0')
  .timeZone('Asia/Kolkata')
  .onRun(async () => {
    const cutoff = new Date(format(subDays(new Date(), 90), 'yyyy-MM-dd'));

    const snap = await db.collection('alerts')
      .where('acknowledged', '==', true)
      .where('createdAt', '<', cutoff)
      .limit(500)
      .get();

    if (!snap.empty) {
      const batch = db.batch();
      snap.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      functions.logger.info(`Deleted ${snap.size} old alerts`);
    }
    return null;
  });


// ─────────────────────────────────────────────────────────────────────────────
// 6. FIRESTORE TRIGGER — Log new expenses to audit trail
// ─────────────────────────────────────────────────────────────────────────────
exports.onExpenseCreate = functions
  .region('asia-south1')
  .firestore
  .document('expenses/{expenseId}')
  .onCreate(async (snap, context) => {
    const expense = snap.data();
    await db.collection('audit_log').add({
      action: 'EXPENSE_CREATE',
      expenseId: context.params.expenseId,
      vehicleId: expense.vehicleId,
      plantId: expense.plantId,
      amount: expense.amount,
      category: expense.category,
      createdBy: expense.createdBy,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
  });


// ─────────────────────────────────────────────────────────────────────────────
// 7. CALLABLE — Generate report on demand from admin UI
// ─────────────────────────────────────────────────────────────────────────────
exports.generateReport = functions
  .region('asia-south1')
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated');

    const { reportType, plantId, dateFrom, dateTo } = data;
    let query = db.collection('expenses').where('date', '>=', dateFrom).where('date', '<=', dateTo);
    if (plantId) query = query.where('plantId', '==', plantId);

    const snap = await query.get();
    const expenses = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    let reportData;
    if (reportType === 'category') {
      reportData = expenses.reduce((acc, e) => { acc[e.category] = (acc[e.category] || 0) + e.amount; return acc; }, {});
    } else if (reportType === 'plant') {
      reportData = expenses.reduce((acc, e) => { acc[e.plantId] = (acc[e.plantId] || 0) + e.amount; return acc; }, {});
    } else {
      reportData = { total: expenses.reduce((s, e) => s + e.amount, 0), count: expenses.length };
    }

    await db.collection('audit_log').add({
      action: 'REPORT_GENERATED', userId: context.auth.uid,
      reportType, dateFrom, dateTo, plantId: plantId || null,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { success: true, reportType, data: reportData, recordCount: expenses.length };
  });
