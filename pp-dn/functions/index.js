/**
 * CDRTS - Firebase Cloud Functions
 * Corporate Document Registration & Tracking System
 *
 * Deploy:  firebase deploy --only functions
 * Or via GitHub Actions CI/CD (see .github/workflows/deploy.yml)
 */

const functions = require("firebase-functions");
const admin     = require("firebase-admin");
const nodemailer = require("nodemailer");

admin.initializeApp();
const db      = admin.firestore();
const storage = admin.storage();

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL TRANSPORT (Gmail SMTP via Secret Manager / Firestore)
// ─────────────────────────────────────────────────────────────────────────────
let transporter    = null;
let cachedGmailUser = null;

async function getTransporter() {
  let gmailUser, gmailPass;

  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    gmailUser = process.env.GMAIL_USER;
    gmailPass = process.env.GMAIL_APP_PASSWORD;
  } else if (functions.config().gmail?.user) {
    gmailUser = functions.config().gmail.user;
    gmailPass = functions.config().gmail.app_password;
  } else {
    const credSnap = await db.collection("appSettings").doc("emailCredentials").get();
    if (credSnap.exists) {
      gmailUser = credSnap.data().gmailUser;
      gmailPass = credSnap.data().gmailAppPassword;
    }
  }

  if (!gmailUser || !gmailPass) {
    throw new Error("Gmail credentials not configured. Set them in Settings → Email Configuration.");
  }

  if (cachedGmailUser !== gmailUser) {
    transporter     = null;
    cachedGmailUser = gmailUser;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host:   "smtp.gmail.com",
      port:   465,
      secure: true,
      auth: { user: gmailUser, pass: gmailPass },
    });
  }

  return transporter;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Log activity
// ─────────────────────────────────────────────────────────────────────────────
async function logActivity(data) {
  await db.collection("activityLogs").add({
    ...data,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Send email
// ─────────────────────────────────────────────────────────────────────────────
async function sendEmail(to, subject, html) {
  try {
    const t = await getTransporter();
    const [credSnap, notifSnap] = await Promise.all([
      db.collection("appSettings").doc("emailCredentials").get(),
      db.collection("appSettings").doc("notifications").get(),
    ]);
    const gmailUser = process.env.GMAIL_USER || credSnap.data()?.gmailUser || "";
    const fromName  = notifSnap.data()?.fromName || "CDRTS System";

    await t.sendMail({ from: `"${fromName}" <${gmailUser}>`, to, subject, html });

    await db.collection("notificationLogs").add({
      to, subject,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      status: "sent",
    });

    return { success: true };
  } catch (err) {
    console.error("Email send error:", err);
    await db.collection("notificationLogs").add({
      to, subject,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      status: "failed",
      error:  err.message,
    });
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Get Corporate MR emails
// ─────────────────────────────────────────────────────────────────────────────
async function getCorporateMREmails() {
  const snap = await db.collection("users")
    .where("role",   "==", "corporate_mr")
    .where("active", "==", true)
    .get();
  return snap.docs.map((d) => d.data().email).filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Verify caller is superadmin
// ─────────────────────────────────────────────────────────────────────────────
async function requireSuperadmin(context) {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Sign in required.");
  }
  const userDoc = await db.collection("users").doc(context.auth.uid).get();
  if (!userDoc.exists || userDoc.data().role !== "superadmin") {
    throw new functions.https.HttpsError("permission-denied", "Superadmin access required.");
  }
  return userDoc.data();
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Delete a Storage file by download URL (best-effort)
// ─────────────────────────────────────────────────────────────────────────────
async function deleteStorageFile(fileUrl) {
  if (!fileUrl) return;
  try {
    const match = fileUrl.match(/\/o\/([^?]+)/);
    if (!match) return;
    const filePath = decodeURIComponent(match[1]);
    await storage.bucket().file(filePath).delete();
  } catch (e) {
    console.warn("deleteStorageFile skipped:", e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Delete an entire Firestore collection in batches
// ─────────────────────────────────────────────────────────────────────────────
async function deleteCollection(collectionPath, batchSize = 400) {
  const colRef = db.collection(collectionPath);
  let deleted = 0;
  while (true) {
    const snap = await colRef.limit(batchSize).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += snap.size;
  }
  return deleted;
}

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL TEMPLATES
// ─────────────────────────────────────────────────────────────────────────────
function emailWrapper(title, body) {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <style>
      body { font-family: Arial, sans-serif; background: #f4f6f8; margin: 0; padding: 20px; }
      .container { max-width: 680px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
      .header { background: #1a3c5e; color: white; padding: 24px 32px; }
      .header h1 { margin: 0; font-size: 20px; font-weight: 600; }
      .header p { margin: 4px 0 0; font-size: 13px; opacity: 0.8; }
      .body { padding: 24px 32px; color: #333; }
      .body p { line-height: 1.6; }
      table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; }
      th { background: #1a3c5e; color: white; padding: 10px 12px; text-align: left; }
      td { padding: 10px 12px; border-bottom: 1px solid #e0e0e0; }
      tr:nth-child(even) td { background: #f9fafb; }
      .badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; }
      .badge-pending  { background: #fff3cd; color: #856404; }
      .badge-assigned { background: #d1f7c4; color: #1b5e20; }
      .badge-returned { background: #fde8e8; color: #c62828; }
      .btn { display: inline-block; background: #1a3c5e; color: white; padding: 10px 24px; border-radius: 6px; text-decoration: none; font-size: 14px; margin-top: 16px; }
      .footer { background: #f4f6f8; padding: 16px 32px; text-align: center; font-size: 12px; color: #666; border-top: 1px solid #e0e0e0; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>CDRTS – Corporate Document Registration &amp; Tracking</h1>
        <p>${title}</p>
      </div>
      <div class="body">${body}</div>
      <div class="footer">
        This is an automated notification from CDRTS. Please do not reply to this email.<br>
        &copy; ${new Date().getFullYear()} Corporate Management Representative System
      </div>
    </div>
  </body>
  </html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: Send consolidated notification to Corporate MR
// ─────────────────────────────────────────────────────────────────────────────
exports.sendUserNotification = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Login required.");

  const uid     = context.auth.uid;
  const userDoc = await db.collection("users").doc(uid).get();
  const user    = userDoc.data();
  if (!user) throw new functions.https.HttpsError("not-found", "User not found.");

  const settingsSnap     = await db.collection("appSettings").doc("notifications").get();
  const settings         = settingsSnap.exists ? settingsSnap.data() : {};
  const cooldownMinutes  = settings.notificationCooldownMinutes || 120;

  const lastNotifSnap = await db.collection("notificationQueue")
    .where("userId", "==", uid)
    .where("type",   "==", "user_consolidated")
    .orderBy("createdAt", "desc")
    .limit(1)
    .get();

  if (!lastNotifSnap.empty) {
    const lastNotif = lastNotifSnap.docs[0].data();
    if (lastNotif.createdAt) {
      const diffMins = (Date.now() - lastNotif.createdAt.toMillis()) / 60000;
      if (diffMins < cooldownMinutes) {
        const remaining = Math.ceil(cooldownMinutes - diffMins);
        throw new functions.https.HttpsError(
          "resource-exhausted",
          `Please wait ${remaining} more minute(s) before sending another notification.`
        );
      }
    }
  }

  const pendingStatuses = ["submitted", "pending_with_mr", "under_process", "resubmitted"];
  const docsSnap = await db.collection("documents")
    .where("submittedBy", "==", uid)
    .where("status", "in", pendingStatuses)
    .get();

  if (docsSnap.empty) return { success: false, message: "No pending documents found." };

  const docs = docsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const rows = docs.map((doc) => `
    <tr>
      <td>${doc.submissionRefNo || doc.id}</td>
      <td>${doc.documentTitle || "-"}</td>
      <td>${doc.categoryName || "-"}</td>
      <td>${doc.plantName || "-"}</td>
      <td>${doc.departmentName || "-"}</td>
      <td>${doc.submissionDate ? new Date(doc.submissionDate.toDate()).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "-"}</td>
      <td><span class="badge badge-pending">${(doc.status || "").replace(/_/g, " ").toUpperCase()}</span></td>
    </tr>
  `).join("");

  const html = emailWrapper(
    "Pending Document Reminder",
    `<p>Dear Corporate MR,</p>
     <p><strong>${user.displayName || user.email}</strong> from <strong>${user.plantName || "N/A"}</strong>
     – <strong>${user.departmentName || "N/A"}</strong> has <strong>${docs.length}</strong> document(s) awaiting your action.</p>
     <table>
       <thead><tr><th>Ref. No.</th><th>Document Title</th><th>Category</th><th>Plant</th><th>Department</th><th>Submitted On (IST)</th><th>Status</th></tr></thead>
       <tbody>${rows}</tbody>
     </table>
     <p>Please log in to CDRTS to process the above documents.</p>
     <a class="btn" href="${settings.appUrl || "https://your-app.web.app"}">Open CDRTS</a>`
  );

  const mrEmails = await getCorporateMREmails();
  if (!mrEmails.length) throw new functions.https.HttpsError("not-found", "No Corporate MR users found.");

  await sendEmail(mrEmails.join(","), `[CDRTS] Pending Documents Reminder – ${user.displayName || user.email}`, html);

  await db.collection("notificationQueue").add({
    userId: uid,
    type:   "user_consolidated",
    documentIds: docs.map((d) => d.id),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    status: "sent",
  });

  await logActivity({
    userId:   uid,
    userName: user.displayName || user.email,
    activity: "sent_notification",
    details:  `Sent consolidated notification for ${docs.length} pending documents`,
  });

  return { success: true, count: docs.length };
});

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: Assign official document number (Corporate MR)
// ─────────────────────────────────────────────────────────────────────────────
exports.assignDocumentNumber = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Login required.");

  const { documentId, officialDocNumber, dmsUploadDate, dmsUploadTime, remarks } = data;
  if (!documentId || !officialDocNumber) {
    throw new functions.https.HttpsError("invalid-argument", "documentId and officialDocNumber are required.");
  }

  const normalizedDocNumber = officialDocNumber.trim().toUpperCase().replace(/\s+/g, "");

  const uid     = context.auth.uid;
  const userDoc = await db.collection("users").doc(uid).get();
  const mrUser  = userDoc.data();

  if (!mrUser || mrUser.role !== "corporate_mr") {
    throw new functions.https.HttpsError("permission-denied", "Only Corporate MR can assign document numbers.");
  }

  const docRef      = db.collection("documents").doc(documentId);
  const registryRef = db.collection("documentNumberRegistry").doc(normalizedDocNumber);

  try {
    await db.runTransaction(async (transaction) => {
      const docSnap      = await transaction.get(docRef);
      const registrySnap = await transaction.get(registryRef);

      if (!docSnap.exists) throw new functions.https.HttpsError("not-found", "Document not found.");

      const doc = docSnap.data();
      if (!["submitted", "pending_with_mr", "under_process", "resubmitted"].includes(doc.status)) {
        throw new functions.https.HttpsError("failed-precondition", `Cannot assign number to document with status: ${doc.status}`);
      }

      if (registrySnap.exists) {
        const existing = registrySnap.data();
        throw new functions.https.HttpsError(
          "already-exists",
          `Document number ${officialDocNumber} is already assigned to: ${existing.documentTitle} (Ref: ${existing.submissionRefNo}) – Plant: ${existing.plantName}, Dept: ${existing.departmentName}`
        );
      }

      const now            = admin.firestore.FieldValue.serverTimestamp();
      const assignmentTime = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

      transaction.update(docRef, {
        officialDocNumber:  officialDocNumber.trim(),
        normalizedDocNumber,
        dmsUploadDate:      dmsUploadDate || null,
        dmsUploadTime:      dmsUploadTime || null,
        corporateMRRemarks: remarks || "",
        processedBy:        uid,
        processedByName:    mrUser.displayName || mrUser.email,
        assignmentDate:     now,
        assignmentDateIST:  assignmentTime,
        status:             "number_assigned",
        updatedAt:          now,
        statusHistory: admin.firestore.FieldValue.arrayUnion({
          status:        "number_assigned",
          changedBy:     uid,
          changedByName: mrUser.displayName || mrUser.email,
          changedAt:     assignmentTime,
          remarks:       remarks || "",
        }),
      });

      transaction.set(registryRef, {
        documentId,
        submissionRefNo:  doc.submissionRefNo,
        documentTitle:    doc.documentTitle,
        plantId:          doc.plantId,
        plantName:        doc.plantName,
        departmentId:     doc.departmentId,
        departmentName:   doc.departmentName,
        categoryId:       doc.categoryId,
        categoryName:     doc.categoryName,
        assignedBy:       uid,
        assignedByName:   mrUser.displayName || mrUser.email,
        assignedAt:       now,
        officialDocNumber: officialDocNumber.trim(),
      });
    });
  } catch (err) {
    if (err instanceof functions.https.HttpsError) throw err;
    throw new functions.https.HttpsError("internal", err.message);
  }

  const updatedDoc    = (await docRef.get()).data();
  const submitterDoc  = await db.collection("users").doc(updatedDoc.submittedBy).get();
  const submitter     = submitterDoc.data();

  if (submitter && submitter.email) {
    const settingsSnap = await db.collection("appSettings").doc("notifications").get();
    const settings     = settingsSnap.exists ? settingsSnap.data() : {};

    const html = emailWrapper(
      "Document Number Assigned",
      `<p>Dear ${submitter.displayName || submitter.email},</p>
       <p>Your document has been successfully processed and an official DMS number has been assigned.</p>
       <table>
         <tr><th>Field</th><th>Value</th></tr>
         <tr><td>Submission Ref. No.</td><td>${updatedDoc.submissionRefNo}</td></tr>
         <tr><td>Document Title</td><td>${updatedDoc.documentTitle}</td></tr>
         <tr><td>Category</td><td>${updatedDoc.categoryName}</td></tr>
         <tr><td>Plant</td><td>${updatedDoc.plantName}</td></tr>
         <tr><td>Department</td><td>${updatedDoc.departmentName}</td></tr>
         <tr><td><strong>Official DMS Number</strong></td><td><strong>${updatedDoc.officialDocNumber}</strong></td></tr>
         <tr><td>DMS Upload Date</td><td>${updatedDoc.dmsUploadDate || "-"}</td></tr>
         <tr><td>Assignment Date (IST)</td><td>${updatedDoc.assignmentDateIST}</td></tr>
         <tr><td>Processed By</td><td>${mrUser.displayName || mrUser.email}</td></tr>
         ${updatedDoc.corporateMRRemarks ? `<tr><td>Remarks</td><td>${updatedDoc.corporateMRRemarks}</td></tr>` : ""}
       </table>
       <a class="btn" href="${settings.appUrl || "https://your-app.web.app"}">View Record in CDRTS</a>`
    );

    await sendEmail(submitter.email, `[CDRTS] Document Number Assigned – ${updatedDoc.submissionRefNo}`, html);
  }

  await logActivity({
    userId:            uid,
    userName:          mrUser.displayName || mrUser.email,
    activity:          "number_assigned",
    documentId,
    submissionRefNo:   updatedDoc.submissionRefNo,
    officialDocNumber: officialDocNumber.trim(),
    details:           `Assigned DMS number ${officialDocNumber.trim()} to ${updatedDoc.submissionRefNo}`,
  });

  return { success: true, officialDocNumber: officialDocNumber.trim() };
});

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: Return document for correction
// ─────────────────────────────────────────────────────────────────────────────
exports.returnDocumentForCorrection = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Login required.");

  const { documentId, remarks } = data;
  if (!documentId || !remarks) {
    throw new functions.https.HttpsError("invalid-argument", "documentId and remarks are required.");
  }

  const uid     = context.auth.uid;
  const userDoc = await db.collection("users").doc(uid).get();
  const mrUser  = userDoc.data();

  if (!mrUser || mrUser.role !== "corporate_mr") {
    throw new functions.https.HttpsError("permission-denied", "Only Corporate MR can return documents.");
  }

  const docRef  = db.collection("documents").doc(documentId);
  const docSnap = await docRef.get();
  if (!docSnap.exists) throw new functions.https.HttpsError("not-found", "Document not found.");

  const doc    = docSnap.data();
  const now    = admin.firestore.FieldValue.serverTimestamp();
  const nowIST = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

  await docRef.update({
    status:             "returned_for_correction",
    corporateMRRemarks: remarks,
    returnedBy:         uid,
    returnedByName:     mrUser.displayName || mrUser.email,
    returnedAt:         now,
    updatedAt:          now,
    statusHistory: admin.firestore.FieldValue.arrayUnion({
      status:        "returned_for_correction",
      changedBy:     uid,
      changedByName: mrUser.displayName || mrUser.email,
      changedAt:     nowIST,
      remarks,
    }),
  });

  const submitterDoc = await db.collection("users").doc(doc.submittedBy).get();
  const submitter    = submitterDoc.data();

  if (submitter && submitter.email) {
    const settingsSnap = await db.collection("appSettings").doc("notifications").get();
    const settings     = settingsSnap.exists ? settingsSnap.data() : {};

    const html = emailWrapper(
      "Document Returned for Correction",
      `<p>Dear ${submitter.displayName || submitter.email},</p>
       <p>Your document has been reviewed by Corporate MR and returned for correction.</p>
       <table>
         <tr><th>Field</th><th>Value</th></tr>
         <tr><td>Submission Ref. No.</td><td>${doc.submissionRefNo}</td></tr>
         <tr><td>Document Title</td><td>${doc.documentTitle}</td></tr>
         <tr><td>Category</td><td>${doc.categoryName}</td></tr>
         <tr><td>Returned By</td><td>${mrUser.displayName || mrUser.email}</td></tr>
         <tr><td>Returned On (IST)</td><td>${nowIST}</td></tr>
         <tr><td><strong>Correction Remarks</strong></td><td><strong>${remarks}</strong></td></tr>
       </table>
       <p>Please log in to CDRTS, correct the document, and resubmit.</p>
       <a class="btn" href="${settings.appUrl || "https://your-app.web.app"}">Open CDRTS</a>`
    );

    await sendEmail(submitter.email, `[CDRTS] Document Returned for Correction – ${doc.submissionRefNo}`, html);
  }

  await logActivity({
    userId:         uid,
    userName:       mrUser.displayName || mrUser.email,
    activity:       "returned_for_correction",
    documentId,
    submissionRefNo: doc.submissionRefNo,
    details:        `Returned with remarks: ${remarks}`,
  });

  return { success: true };
});

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: Submit document (generates ref number)
// ─────────────────────────────────────────────────────────────────────────────
exports.submitDocument = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Login required.");

  const uid     = context.auth.uid;
  const { documentId } = data;
  if (!documentId) throw new functions.https.HttpsError("invalid-argument", "documentId required.");

  const userDoc = await db.collection("users").doc(uid).get();
  const user    = userDoc.data();

  if (!user || !["user", "superadmin"].includes(user.role)) {
    throw new functions.https.HttpsError("permission-denied", "Only plant/department users or admins can submit documents.");
  }

  const docRef  = db.collection("documents").doc(documentId);
  const docSnap = await docRef.get();
  if (!docSnap.exists) throw new functions.https.HttpsError("not-found", "Document not found.");

  const doc = docSnap.data();
  if (doc.submittedBy !== uid) {
    throw new functions.https.HttpsError("permission-denied", "You can only submit your own documents.");
  }

  const year       = new Date().getFullYear();
  const counterRef = db.collection("appSettings").doc("refCounter");

  let refNo;
  await db.runTransaction(async (transaction) => {
    const counterSnap = await transaction.get(counterRef);
    const current     = counterSnap.exists ? (counterSnap.data()[`refCount_${year}`] || 0) : 0;
    const next        = current + 1;
    refNo = `CDRTS-${year}-${String(next).padStart(5, "0")}`;
    transaction.set(counterRef, { [`refCount_${year}`]: next }, { merge: true });
  });

  const now    = admin.firestore.FieldValue.serverTimestamp();
  const nowIST = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

  const isResubmission = doc.status === "returned_for_correction";
  const newStatus      = isResubmission ? "resubmitted" : "submitted";

  await docRef.update({
    submissionRefNo:    refNo,
    status:             newStatus,
    submissionDate:     now,
    submissionDateIST:  nowIST,
    updatedAt:          now,
    statusHistory: admin.firestore.FieldValue.arrayUnion({
      status:        newStatus,
      changedBy:     uid,
      changedByName: user.displayName || user.email,
      changedAt:     nowIST,
    }),
  });

  await db.collection("notificationQueue").add({
    type:           "new_submission",
    documentId,
    submissionRefNo: refNo,
    userId:         uid,
    userName:       user.displayName || user.email,
    plantName:      user.plantName,
    departmentName: user.departmentName,
    documentTitle:  doc.documentTitle,
    categoryName:   doc.categoryName,
    createdAt:      now,
    emailSent:      false,
  });

  await logActivity({
    userId:         uid,
    userName:       user.displayName || user.email,
    activity:       isResubmission ? "document_resubmitted" : "document_submitted",
    documentId,
    submissionRefNo: refNo,
    details:        `Document "${doc.documentTitle}" submitted with ref ${refNo}`,
  });

  return { success: true, submissionRefNo: refNo };
});

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULED: Send consolidated MR notification (every 30 min)
// ─────────────────────────────────────────────────────────────────────────────
exports.sendConsolidatedMRNotification = functions.pubsub
  .schedule("every 30 minutes")
  .onRun(async () => {
    const queueSnap = await db.collection("notificationQueue")
      .where("type",      "==", "new_submission")
      .where("emailSent", "==", false)
      .get();

    if (queueSnap.empty) { console.log("No pending notifications."); return null; }

    const pending  = queueSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const mrEmails = await getCorporateMREmails();
    if (!mrEmails.length) { console.log("No Corporate MR users found."); return null; }

    const settingsSnap = await db.collection("appSettings").doc("notifications").get();
    const settings     = settingsSnap.exists ? settingsSnap.data() : {};

    const rows = pending.map((item) => `
      <tr>
        <td>${item.submissionRefNo || item.documentId}</td>
        <td>${item.documentTitle || "-"}</td>
        <td>${item.categoryName || "-"}</td>
        <td>${item.plantName || "-"}</td>
        <td>${item.departmentName || "-"}</td>
        <td>${item.userName || "-"}</td>
        <td>${item.createdAt ? new Date(item.createdAt.toDate()).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "-"}</td>
      </tr>
    `).join("");

    const html = emailWrapper(
      "New Document Submissions – Action Required",
      `<p>Dear Corporate MR,</p>
       <p>The following <strong>${pending.length}</strong> document(s) have been submitted and are awaiting your review and DMS numbering:</p>
       <table>
         <thead><tr><th>Ref. No.</th><th>Document Title</th><th>Category</th><th>Plant</th><th>Department</th><th>Submitted By</th><th>Submitted On (IST)</th></tr></thead>
         <tbody>${rows}</tbody>
       </table>
       <a class="btn" href="${settings.appUrl || "https://your-app.web.app"}">Review in CDRTS</a>`
    );

    await sendEmail(mrEmails.join(","), `[CDRTS] ${pending.length} New Document(s) Awaiting Numbering`, html);

    const batch = db.batch();
    pending.forEach((item) => {
      batch.update(db.collection("notificationQueue").doc(item.id), {
        emailSent:    true,
        emailSentAt:  admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();

    return null;
  });

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: Create user (Superadmin)
// ─────────────────────────────────────────────────────────────────────────────
exports.createUser = functions.https.onCall(async (data, context) => {
  const caller = await requireSuperadmin(context);

  const { email, password, displayName, role, plantId, plantName, departmentId, departmentName } = data;
  if (!email || !password || !displayName || !role) {
    throw new functions.https.HttpsError("invalid-argument", "Missing required fields.");
  }

  const userRecord = await admin.auth().createUser({ email, password, displayName });

  await db.collection("users").doc(userRecord.uid).set({
    uid:            userRecord.uid,
    email,
    displayName,
    role,
    plantId:        plantId        || null,
    plantName:      plantName      || null,
    departmentId:   departmentId   || null,
    departmentName: departmentName || null,
    active:         true,
    createdAt:      admin.firestore.FieldValue.serverTimestamp(),
    createdBy:      context.auth.uid,
  });

  await logActivity({
    userId:   context.auth.uid,
    userName: caller.displayName || caller.email,
    activity: "user_created",
    details:  `Created user ${email} with role ${role}`,
  });

  return { success: true, uid: userRecord.uid };
});

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: Delete records (Superadmin – soft delete / archive)
// ─────────────────────────────────────────────────────────────────────────────
exports.deleteRecords = functions.https.onCall(async (data, context) => {
  const caller = await requireSuperadmin(context);

  const { documentIds, reason } = data;
  if (!documentIds || !documentIds.length || !reason) {
    throw new functions.https.HttpsError("invalid-argument", "documentIds and reason are required.");
  }

  const batch  = db.batch();
  const now    = admin.firestore.FieldValue.serverTimestamp();
  const nowIST = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

  for (const docId of documentIds) {
    const docSnap = await db.collection("documents").doc(docId).get();
    if (!docSnap.exists) continue;
    const doc = docSnap.data();

    batch.set(db.collection("deletedRecords").doc(docId), {
      ...doc,
      deletedBy:       context.auth.uid,
      deletedByName:   caller.displayName || caller.email,
      deletedAt:       now,
      deletedAtIST:    nowIST,
      deletionReason:  reason,
      originalId:      docId,
    });

    batch.update(db.collection("documents").doc(docId), {
      status:          "deleted",
      deletedBy:       context.auth.uid,
      deletedByName:   caller.displayName || caller.email,
      deletedAt:       now,
      deletionReason:  reason,
    });
  }

  await batch.commit();

  await logActivity({
    userId:        context.auth.uid,
    userName:      caller.displayName || caller.email,
    activity:      "records_deleted",
    details:       `Soft-deleted ${documentIds.length} records. Reason: ${reason}`,
    documentIds,
    deletionReason: reason,
  });

  return { success: true, count: documentIds.length };
});

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: Check document number uniqueness
// ─────────────────────────────────────────────────────────────────────────────
exports.checkDocumentNumber = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Login required.");

  const { docNumber } = data;
  if (!docNumber) throw new functions.https.HttpsError("invalid-argument", "docNumber required.");

  const normalized = docNumber.trim().toUpperCase().replace(/\s+/g, "");
  const snap       = await db.collection("documentNumberRegistry").doc(normalized).get();

  if (snap.exists) {
    const existing = snap.data();
    return {
      exists: true,
      existingRecord: {
        documentId:      existing.documentId,
        submissionRefNo: existing.submissionRefNo,
        documentTitle:   existing.documentTitle,
        plantName:       existing.plantName,
        departmentName:  existing.departmentName,
        assignedAt:      existing.assignedAt,
      },
    };
  }

  return { exists: false };
});

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: Send test / transactional email
// ─────────────────────────────────────────────────────────────────────────────
exports.sendTestEmail = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Login required.");

  const { to, subject, html, text } = data;
  if (!to || !subject) {
    throw new functions.https.HttpsError("invalid-argument", "to and subject are required.");
  }

  try {
    await sendEmail(to, subject, html || text || "(no body)");
    return { success: true };
  } catch (e) {
    console.error("sendTestEmail error:", e);
    throw new functions.https.HttpsError("internal", e.message || "Email send failed.");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: Wipe app data (Superadmin)
// mode = "docs"  → delete documents + logs + reset ref counter
// mode = "full"  → above + plants, departments, categories
// ─────────────────────────────────────────────────────────────────────────────
exports.wipeAppData = functions
  .runWith({ timeoutSeconds: 300, memory: "512MB" })
  .https.onCall(async (data, context) => {
    const caller = await requireSuperadmin(context);
    const mode   = data?.mode || "docs";

    // 1. Delete Storage files for all documents
    let filesDeleted = 0;
    const docsSnap   = await db.collection("documents").get();
    for (const d of docsSnap.docs) {
      if (d.data().fileUrl) {
        await deleteStorageFile(d.data().fileUrl);
        filesDeleted++;
      }
    }

    // 2. Delete documents + activity logs
    const docsDeleted = await deleteCollection("documents");
    await deleteCollection("activityLogs");
    await deleteCollection("notificationQueue");

    // 3. Reset reference counter
    await db.collection("appSettings").doc("refCounter").set(
      { counter: 0, lastReset: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );

    // 4. Full reset: also wipe master data
    let masterDeleted = 0;
    if (mode === "full") {
      masterDeleted += await deleteCollection("plants");
      masterDeleted += await deleteCollection("departments");
      masterDeleted += await deleteCollection("categories");
      masterDeleted += await deleteCollection("documentNumberRegistry");
    }

    // 5. Write a wipe audit log
    await db.collection("activityLogs").add({
      activity:     mode === "full" ? "full_app_reset" : "wipe_documents",
      performedBy:  context.auth.uid,
      performedByName: caller.displayName || caller.email,
      docsDeleted,
      filesDeleted,
      masterDeleted,
      timestamp:    admin.firestore.FieldValue.serverTimestamp(),
    });

    return { success: true, deleted: docsDeleted, files: filesDeleted, master: masterDeleted };
  });

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Core retention-delete logic (shared by callable + scheduled)
// ─────────────────────────────────────────────────────────────────────────────
async function doRetentionDelete() {
  const retSnap = await db.collection("appSettings").doc("retention").get();
  if (!retSnap.exists) return { deleted: 0, files: 0 };

  const { days = 90, statuses = ["submitted", "returned", "completed"] } = retSnap.data();
  if (!days || days <= 0) return { deleted: 0, files: 0, skipped: "disabled" };

  const cutoff = admin.firestore.Timestamp.fromDate(
    new Date(Date.now() - days * 86_400_000)
  );

  let deleted = 0, files = 0;

  for (const status of statuses) {
    // Try submittedAt first, fall back to submissionDate field name used in older docs
    for (const dateField of ["submittedAt", "submissionDate"]) {
      const snap = await db.collection("documents")
        .where("status",    "==", status)
        .where(dateField,   "<",  cutoff)
        .get()
        .catch(() => ({ empty: true, docs: [] }));

      for (const d of snap.docs) {
        const fileUrl = d.data().fileUrl;
        if (fileUrl) { await deleteStorageFile(fileUrl); files++; }
        await d.ref.delete();
        deleted++;

        await db.collection("activityLogs").add({
          activity:        "auto_retention_delete",
          documentId:      d.id,
          submissionRefNo: d.data().submissionRefNo,
          reason:          `Auto-deleted: older than ${days} days (status: ${status})`,
          timestamp:       admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }
  }

  await db.collection("appSettings").doc("retention").update({
    lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { deleted, files };
}

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: Run retention delete now (Superadmin)
// ─────────────────────────────────────────────────────────────────────────────
exports.runRetentionDelete = functions
  .runWith({ timeoutSeconds: 300, memory: "512MB" })
  .https.onCall(async (data, context) => {
    await requireSuperadmin(context);
    return doRetentionDelete();
  });

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULED: Daily auto-retention delete at 1:00 AM IST (19:30 UTC)
// ─────────────────────────────────────────────────────────────────────────────
exports.dailyRetentionDelete = functions.pubsub
  .schedule("30 19 * * *")
  .timeZone("Asia/Kolkata")
  .onRun(async () => {
    const result = await doRetentionDelete();
    console.log("dailyRetentionDelete result:", JSON.stringify(result));
    return null;
  });
