const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { subDays, format, addDays, isBefore, parseISO } = require('date-fns');

admin.initializeApp();
const db = admin.firestore();

// ─────────────────────────────────────────────────────────────────
// SCHEDULED: Daily Document Expiry Alerts (runs every day at 7AM IST)
// ─────────────────────────────────────────────────────────────────
exports.dailyExpiryAlert = functions
  .region('asia-south1')
  .pubsub
  .schedule('0 7 * * *')
  .timeZone('Asia/Kolkata')
  .onRun(async (context) => {
    functions.logger.info('Running daily expiry alert check');

    const today = new Date();
    const threshold60 = addDays(today, 60);
    const threshold15 = addDays(today, 15);

    try {
      const vehiclesSnap = await db.collection('vehicles').where('status', '==', 'active').get();
      const alertsBatch = db.batch();
      const alerts = [];

      vehiclesSnap.docs.forEach(doc => {
        const v = { id: doc.id, ...doc.data() };
        const docFields = [
          { field: 'insuranceExpiry', label: 'Insurance' },
          { field: 'pollutionExpiry', label: 'Pollution Certificate' },
          { field: 'fitnessExpiry', label: 'Fitness Certificate' },
          { field: 'permitExpiry', label: 'Permit' },
        ];

        docFields.forEach(({ field, label }) => {
          if (!v[field]) return;
          const expiry = parseISO(v[field]);
          const daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));

          if (daysLeft <= 60) {
            const severity = daysLeft < 0 ? 'expired' : daysLeft <= 15 ? 'critical' : daysLeft <= 30 ? 'warning' : 'notice';
            const alertRef = db.collection('alerts').doc(`${v.id}_${field}_${format(today, 'yyyyMMdd')}`);
            alertsBatch.set(alertRef, {
              vehicleId: v.id,
              regNo: v.regNo,
              plantId: v.plantId,
              docType: label,
              expiryDate: v[field],
              daysLeft,
              severity,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              acknowledged: false,
            }, { merge: true });

            if (severity === 'expired' || severity === 'critical') {
              alerts.push({ vehicleId: v.id, regNo: v.regNo, docType: label, daysLeft, severity });
            }
          }
        });
      });

      await alertsBatch.commit();
      functions.logger.info(`Processed expiry alerts. Critical/expired: ${alerts.length}`);

      // If there are critical alerts, create a notification for all admins
      if (alerts.length > 0) {
        await db.collection('notifications').add({
          type: 'EXPIRY_ALERT',
          title: `${alerts.length} document(s) require urgent attention`,
          body: alerts.map(a => `${a.regNo}: ${a.docType} (${a.daysLeft < 0 ? 'EXPIRED' : a.daysLeft + ' days left'})`).join('\n'),
          severity: 'critical',
          recipients: 'all_admins',
          alerts,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          read: false,
        });
      }

      return null;
    } catch (err) {
      functions.logger.error('Error in dailyExpiryAlert:', err);
      throw err;
    }
  });


// ─────────────────────────────────────────────────────────────────
// SCHEDULED: Monthly Expense Summary Report (1st of every month, 8AM IST)
// ─────────────────────────────────────────────────────────────────
exports.monthlyExpenseReport = functions
  .region('asia-south1')
  .pubsub
  .schedule('0 8 1 * *')
  .timeZone('Asia/Kolkata')
  .onRun(async (context) => {
    const today = new Date();
    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const monthStr = format(lastMonth, 'yyyy-MM');
    functions.logger.info(`Generating monthly report for ${monthStr}`);

    try {
      const expensesSnap = await db.collection('expenses')
        .where('date', '>=', `${monthStr}-01`)
        .where('date', '<=', `${monthStr}-31`)
        .get();

      const expenses = expensesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      // Aggregate by plant
      const plantSummary = {};
      expenses.forEach(e => {
        if (!plantSummary[e.plantId]) {
          plantSummary[e.plantId] = { total: 0, fuel: 0, maintenance: 0, other: 0, count: 0 };
        }
        plantSummary[e.plantId].total += e.amount;
        plantSummary[e.plantId].count++;
        if (e.category === 'Fuel') plantSummary[e.plantId].fuel += e.amount;
        else if (['Maintenance', 'Repairs', 'Spare Parts'].includes(e.category)) plantSummary[e.plantId].maintenance += e.amount;
        else plantSummary[e.plantId].other += e.amount;
      });

      const total = expenses.reduce((s, e) => s + e.amount, 0);

      // Store monthly report
      await db.collection('monthly_reports').doc(monthStr).set({
        month: monthStr,
        totalExpenses: total,
        expenseCount: expenses.length,
        plantSummary,
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Notify super admins
      await db.collection('notifications').add({
        type: 'MONTHLY_REPORT',
        title: `Monthly Expense Report — ${format(lastMonth, 'MMMM yyyy')}`,
        body: `Total: ₹${total.toLocaleString('en-IN')} across ${expenses.length} records`,
        month: monthStr,
        recipients: 'superadmin',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        read: false,
      });

      functions.logger.info(`Monthly report generated. Total: ${total}, Records: ${expenses.length}`);
      return null;
    } catch (err) {
      functions.logger.error('Error in monthlyExpenseReport:', err);
      throw err;
    }
  });


// ─────────────────────────────────────────────────────────────────
// SCHEDULED: Weekly Mileage Summary (every Monday 9AM IST)
// ─────────────────────────────────────────────────────────────────
exports.weeklyMileageSummary = functions
  .region('asia-south1')
  .pubsub
  .schedule('0 9 * * 1')
  .timeZone('Asia/Kolkata')
  .onRun(async (context) => {
    const today = new Date();
    const weekAgo = subDays(today, 7);
    const weekAgoStr = format(weekAgo, 'yyyy-MM-dd');
    const todayStr = format(today, 'yyyy-MM-dd');

    functions.logger.info(`Generating weekly mileage summary for ${weekAgoStr} to ${todayStr}`);

    try {
      const fuelSnap = await db.collection('expenses')
        .where('category', '==', 'Fuel')
        .where('date', '>=', weekAgoStr)
        .where('date', '<=', todayStr)
        .get();

      const fuelExpenses = fuelSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      // Flag vehicles with unusually low mileage
      const vehicleMap = {};
      fuelExpenses.forEach(e => {
        if (!vehicleMap[e.vehicleId]) vehicleMap[e.vehicleId] = { fuel: 0, cost: 0, count: 0 };
        vehicleMap[e.vehicleId].fuel += e.fuelQty || 0;
        vehicleMap[e.vehicleId].cost += e.amount;
        vehicleMap[e.vehicleId].count++;
      });

      const mileageAlerts = [];
      await Promise.all(Object.entries(vehicleMap).map(async ([vehicleId, data]) => {
        const vDoc = await db.collection('vehicles').doc(vehicleId).get();
        if (!vDoc.exists) return;
        const v = vDoc.data();
        // Get odometer difference from last 2 fuel entries
        const mileage = data.fuel > 0 ? 8 : 0; // placeholder — real: calc from odometer diffs
        if (mileage < 5 && data.fuel > 10) {
          mileageAlerts.push({ vehicleId, regNo: v.regNo, mileage, plantId: v.plantId });
        }
      }));

      await db.collection('weekly_reports').add({
        weekStart: weekAgoStr,
        weekEnd: todayStr,
        totalFuel: fuelExpenses.reduce((s, e) => s + (e.fuelQty || 0), 0),
        totalFuelCost: fuelExpenses.reduce((s, e) => s + e.amount, 0),
        fuelRecords: fuelExpenses.length,
        mileageAlerts,
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      functions.logger.info(`Weekly mileage summary done. Fuel records: ${fuelExpenses.length}, Alerts: ${mileageAlerts.length}`);
      return null;
    } catch (err) {
      functions.logger.error('Error in weeklyMileageSummary:', err);
      throw err;
    }
  });


// ─────────────────────────────────────────────────────────────────
// HTTP: Trigger manual report generation (callable from admin UI)
// ─────────────────────────────────────────────────────────────────
exports.generateReport = functions
  .region('asia-south1')
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated');

    const { reportType, plantId, dateFrom, dateTo } = data;

    let query = db.collection('expenses')
      .where('date', '>=', dateFrom)
      .where('date', '<=', dateTo);

    if (plantId) query = query.where('plantId', '==', plantId);

    const snap = await query.get();
    const expenses = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Aggregate based on report type
    let reportData;
    switch (reportType) {
      case 'category':
        reportData = expenses.reduce((acc, e) => {
          acc[e.category] = (acc[e.category] || 0) + e.amount;
          return acc;
        }, {});
        break;
      case 'plant':
        reportData = expenses.reduce((acc, e) => {
          acc[e.plantId] = (acc[e.plantId] || 0) + e.amount;
          return acc;
        }, {});
        break;
      default:
        reportData = { total: expenses.reduce((s, e) => s + e.amount, 0), count: expenses.length };
    }

    // Log to audit
    await db.collection('audit_log').add({
      action: 'REPORT_GENERATED',
      userId: context.auth.uid,
      reportType,
      dateFrom,
      dateTo,
      plantId: plantId || null,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { success: true, reportType, data: reportData, recordCount: expenses.length };
  });


// ─────────────────────────────────────────────────────────────────
// HTTP: Purge old acknowledged alerts (runs weekly, triggered by cron)
// ─────────────────────────────────────────────────────────────────
exports.cleanupOldAlerts = functions
  .region('asia-south1')
  .pubsub
  .schedule('0 2 * * 0')  // Sunday 2AM
  .timeZone('Asia/Kolkata')
  .onRun(async () => {
    const cutoff = format(subDays(new Date(), 90), 'yyyy-MM-dd');
    functions.logger.info(`Cleaning alerts older than ${cutoff}`);

    const oldAlertsSnap = await db.collection('alerts')
      .where('acknowledged', '==', true)
      .where('createdAt', '<', new Date(cutoff))
      .limit(500)
      .get();

    if (oldAlertsSnap.empty) {
      functions.logger.info('No old alerts to clean up');
      return null;
    }

    const batch = db.batch();
    oldAlertsSnap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();

    functions.logger.info(`Deleted ${oldAlertsSnap.size} old alerts`);
    return null;
  });


// ─────────────────────────────────────────────────────────────────
// Firestore Trigger: Log expense additions to audit trail
// ─────────────────────────────────────────────────────────────────
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


// ─────────────────────────────────────────────────────────────────
// Firestore Trigger: Flag expenses missing bill after 24hrs
// ─────────────────────────────────────────────────────────────────
exports.checkMissingBills = functions
  .region('asia-south1')
  .pubsub
  .schedule('0 18 * * *')  // 6PM daily
  .timeZone('Asia/Kolkata')
  .onRun(async () => {
    const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');

    const snap = await db.collection('expenses')
      .where('hasBill', '==', false)
      .where('date', '==', yesterday)
      .get();

    if (!snap.empty) {
      await db.collection('notifications').add({
        type: 'MISSING_BILLS',
        title: `${snap.size} expense(s) missing bill attachment`,
        body: `${snap.size} expense records from yesterday have no bill uploaded. Please attach invoices.`,
        expenseIds: snap.docs.map(d => d.id),
        recipients: 'plant_admins',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        read: false,
      });
      functions.logger.info(`Flagged ${snap.size} expenses with missing bills`);
    }
    return null;
  });
