/**
 * CDRTS - Firebase Cloud Functions
 * Corporate Document Registration & Tracking System
 *
 * Deploy:  firebase deploy --only functions
 * Or via GitHub Actions CI/CD (see .github/workflows/deploy.yml)
 */

const functionsBase = require("firebase-functions");
const admin         = require("firebase-admin");
const nodemailer    = require("nodemailer");

// Regional builder for defining functions (asia-south1 = Mumbai)
const functions = functionsBase.region("asia-south1");

// HttpsError lives on the base module, not the regional builder
const HttpsError = functionsBase.https.HttpsError;

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
    try {
      await db.collection("notificationLogs").add({
        to, subject,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        status: "failed",
        error:  err.message,
      });
    } catch (_) { /* ignore log failure */ }
    // Re-throw plain Error (not HttpsError) so callers can catch and continue
    throw new Error(`Email failed: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Get Corporate MR emails
// ─────────────────────────────────────────────────────────────────────────────
async function getCorporateMREmails() {
  // Single where clause only — avoids composite index requirement.
  // Filter active status in memory.
  const snap = await db.collection("users")
    .where("role", "==", "corporate_mr")
    .get();
  return snap.docs
    .map((d) => d.data())
    .filter((u) => u.active !== false)   // include if active is true or missing
    .map((u) => u.email)
    .filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Verify caller is superadmin
// ─────────────────────────────────────────────────────────────────────────────
async function requireSuperadmin(context) {
  if (!context.auth) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  const userDoc = await db.collection("users").doc(context.auth.uid).get();
  if (!userDoc.exists || userDoc.data().role !== "superadmin") {
    throw new HttpsError("permission-denied", "Superadmin access required.");
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
  if (!context.auth) throw new HttpsError("unauthenticated", "Login required.");

  const uid     = context.auth.uid;
  const userDoc = await db.collection("users").doc(uid).get();
  const user    = userDoc.data();
  if (!user) throw new HttpsError("not-found", "User not found.");

  const settingsSnap     = await db.collection("appSettings").doc("notifications").get();
  const settings         = settingsSnap.exists ? settingsSnap.data() : {};
  const cooldownMinutes  = settings.notificationCooldownMinutes || 120;

  // Cooldown check — single where only to avoid composite index requirement
  // Filter by type in memory
  let lastNotifTime = null;
  try {
    const lastNotifSnap = await db.collection("notificationQueue")
      .where("userId", "==", uid)
      .get();
    const sorted = lastNotifSnap.docs
      .map((d) => d.data())
      .filter((d) => d.createdAt)
      .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
    if (sorted.length > 0) lastNotifTime = sorted[0].createdAt;
  } catch (_) { /* skip cooldown check if query fails */ }

  if (lastNotifTime) {
    const diffMins = (Date.now() - lastNotifTime.toMillis()) / 60000;
    if (diffMins < cooldownMinutes) {
      const remaining = Math.ceil(cooldownMinutes - diffMins);
      throw new HttpsError(
        "resource-exhausted",
        `Please wait ${remaining} more minute(s) before sending another notification.`
      );
    }
  }

  const isMR = user.role === "corporate_mr" || user.role === "superadmin";

  if (isMR) {
    // ── Corporate MR / Superadmin ────────────────────────────────────────────
    // Fetch all completed docs then email each submitter their DMS numbers.
    try {
      // Get completed docs — fetch all then filter in memory to avoid index issues
      const allDocsSnap = await db.collection("documents").get();
      const completedDocs = allDocsSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((d) => d.status === "completed" || d.status === "number_assigned");

      if (!completedDocs.length) {
        return { success: false, message: "No completed documents found to notify about." };
      }

      // Fetch all users once so we can look up emails reliably
      const usersSnap = await db.collection("users").get();
      const usersMap  = {};
      usersSnap.docs.forEach(d => { usersMap[d.id] = d.data(); });

      // Group completed docs by submitter uid
      const bySubmitter = {};
      completedDocs.forEach((doc) => {
        const submitterUid = doc.submittedBy;
        if (!submitterUid) return;
        if (!bySubmitter[submitterUid]) {
          // Prefer email from users collection; fall back to doc field
          const submitterUser = usersMap[submitterUid];
          bySubmitter[submitterUid] = {
            name:  submitterUser?.displayName || doc.submittedByName || submitterUser?.email || submitterUid,
            email: submitterUser?.email || doc.submittedByEmail || null,
            docs:  [],
          };
        }
        bySubmitter[submitterUid].docs.push(doc);
      });

      const appUrl = settings.appUrl || "https://your-app.web.app";
      let totalEmailsSent = 0;
      const errors = [];

      for (const [submitterUid, info] of Object.entries(bySubmitter)) {
        if (!info.email) {
          console.warn(`No email found for submitter ${submitterUid}, skipping.`);
          continue;
        }

        const rows = info.docs.map((doc) => `
          <tr>
            <td>${doc.submissionRefNo || "-"}</td>
            <td>${doc.documentTitle || "-"}</td>
            <td>${doc.categoryName || "-"}</td>
            <td>${doc.plantName || "-"}</td>
            <td>${doc.departmentName || "-"}</td>
            <td><strong>${doc.officialDocNumber || "-"}</strong></td>
            <td>${doc.assignmentDateIST || "-"}</td>
          </tr>
        `).join("");

        const html = emailWrapper(
          "DMS Document Numbers Assigned",
          `<p>Dear ${info.name},</p>
           <p>Your document(s) have been successfully processed by Corporate MR and official DMS numbers have been assigned.</p>
           <table>
             <thead>
               <tr>
                 <th>Ref. No.</th><th>Document Title</th><th>Category</th>
                 <th>Plant</th><th>Department</th><th>DMS Number</th><th>Assigned On (IST)</th>
               </tr>
             </thead>
             <tbody>${rows}</tbody>
           </table>
           <p>Please keep these DMS numbers for your records.</p>
           <a class="btn" href="${appUrl}">View in CDRTS</a>`
        );

        try {
          await sendEmail(
            info.email,
            `[CDRTS] DMS Number(s) Assigned – ${info.docs.length} document(s) completed`,
            html
          );
          totalEmailsSent++;
        } catch (mailErr) {
          console.error(`Failed to email ${info.email}:`, mailErr.message);
          errors.push(mailErr.message);
        }
      }

      // Store only first 100 doc IDs to stay within Firestore 1MB doc limit
      await db.collection("notificationQueue").add({
        userId: uid,
        type:   "mr_completion_summary",
        documentIds: completedDocs.slice(0, 100).map((d) => d.id),
        docCount: completedDocs.length,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        status: "sent",
        recipientCount: totalEmailsSent,
      });

      await logActivity({
        userId:   uid,
        userName: user.displayName || user.email,
        activity: "sent_completion_notification",
        details:  `Sent DMS assignment summary to ${totalEmailsSent} submitter(s) covering ${completedDocs.length} document(s)`,
      });

      if (totalEmailsSent === 0) {
        return {
          success: false,
          message: errors.length
            ? `Emails failed to send. Check Gmail credentials in Settings → Email Configuration. Error: ${errors[0]}`
            : "No submitter emails found.",
        };
      }

      return { success: true, count: completedDocs.length, emailsSent: totalEmailsSent };

    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error("sendUserNotification MR branch error:", err);
      throw new HttpsError("internal", `Failed to send notifications: ${err.message}`);
    }

  } else {
    // ── Regular user ─────────────────────────────────────────────────────────
    // Send reminder to Corporate MR about their own pending docs
    try {
    const pendingStatuses = ["submitted", "pending_with_mr", "under_process", "resubmitted"];
    // Single where only — avoid composite index requirement; filter status in memory
    const docsSnap = await db.collection("documents")
      .where("submittedBy", "==", uid)
      .get();

    const docs = docsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((d) => pendingStatuses.includes(d.status));

    if (!docs.length) return { success: false, message: "No pending documents found." };

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
    if (!mrEmails.length) return { success: false, message: "No Corporate MR users found. Add a Corporate MR account first." };

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

    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error("sendUserNotification user branch error:", err);
      throw new HttpsError("internal", `Failed to send notification: ${err.message}`);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: Assign official document number (Corporate MR)
// ─────────────────────────────────────────────────────────────────────────────
exports.assignDocumentNumber = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new HttpsError("unauthenticated", "Login required.");

  const { documentId, officialDocNumber, dmsUploadDate, dmsUploadTime, remarks } = data;
  if (!documentId || !officialDocNumber) {
    throw new HttpsError("invalid-argument", "documentId and officialDocNumber are required.");
  }

  const normalizedDocNumber = officialDocNumber.trim().toUpperCase().replace(/\s+/g, "");

  const uid     = context.auth.uid;
  const userDoc = await db.collection("users").doc(uid).get();
  const mrUser  = userDoc.data();

  if (!mrUser || mrUser.role !== "corporate_mr") {
    throw new HttpsError("permission-denied", "Only Corporate MR can assign document numbers.");
  }

  const docRef      = db.collection("documents").doc(documentId);
  const registryRef = db.collection("documentNumberRegistry").doc(normalizedDocNumber);

  try {
    await db.runTransaction(async (transaction) => {
      const docSnap      = await transaction.get(docRef);
      const registrySnap = await transaction.get(registryRef);

      if (!docSnap.exists) throw new HttpsError("not-found", "Document not found.");

      const doc = docSnap.data();
      if (!["submitted", "pending_with_mr", "under_process", "resubmitted"].includes(doc.status)) {
        throw new HttpsError("failed-precondition", `Cannot assign number to document with status: ${doc.status}`);
      }

      if (registrySnap.exists) {
        const existing = registrySnap.data();
        throw new HttpsError(
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
        status:             "completed",
        updatedAt:          now,
        statusHistory: admin.firestore.FieldValue.arrayUnion({
          status:        "completed",
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
    if (err instanceof HttpsError) throw err;
    throw new HttpsError("internal", err.message);
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
    activity:          "completed",
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
  if (!context.auth) throw new HttpsError("unauthenticated", "Login required.");

  const { documentId, remarks } = data;
  if (!documentId || !remarks) {
    throw new HttpsError("invalid-argument", "documentId and remarks are required.");
  }

  const uid     = context.auth.uid;
  const userDoc = await db.collection("users").doc(uid).get();
  const mrUser  = userDoc.data();

  if (!mrUser || mrUser.role !== "corporate_mr") {
    throw new HttpsError("permission-denied", "Only Corporate MR can return documents.");
  }

  const docRef  = db.collection("documents").doc(documentId);
  const docSnap = await docRef.get();
  if (!docSnap.exists) throw new HttpsError("not-found", "Document not found.");

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
  if (!context.auth) throw new HttpsError("unauthenticated", "Login required.");

  const uid     = context.auth.uid;
  const { documentId } = data;
  if (!documentId) throw new HttpsError("invalid-argument", "documentId required.");

  const userDoc = await db.collection("users").doc(uid).get();
  const user    = userDoc.data();

  if (!user || !["user", "superadmin"].includes(user.role)) {
    throw new HttpsError("permission-denied", "Only plant/department users or admins can submit documents.");
  }

  const docRef  = db.collection("documents").doc(documentId);
  const docSnap = await docRef.get();
  if (!docSnap.exists) throw new HttpsError("not-found", "Document not found.");

  const doc = docSnap.data();
  if (doc.submittedBy !== uid) {
    throw new HttpsError("permission-denied", "You can only submit your own documents.");
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

  // ── Notification queue entry removed: emails are sent ONLY when user
  //    clicks "Send Notification" (sendUserNotification callable).
  //    Auto-queuing on submit caused unintended mail on every upload.

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
// REMOVED: sendConsolidatedMRNotification (scheduled every 30 min)
// Reason: This caused emails to send automatically after every document upload.
// Notifications are now sent ONLY when user explicitly clicks "Send Notification"
// via the sendUserNotification callable function.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: Create user (Superadmin)
// ─────────────────────────────────────────────────────────────────────────────
exports.createUser = functions.https.onCall(async (data, context) => {
  const caller = await requireSuperadmin(context);

  const { email, password, displayName, role, plantId, plantName, departmentId, departmentName } = data;
  if (!email || !password || !displayName || !role) {
    throw new HttpsError("invalid-argument", "Missing required fields.");
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
    throw new HttpsError("invalid-argument", "documentIds and reason are required.");
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
  if (!context.auth) throw new HttpsError("unauthenticated", "Login required.");

  const { docNumber } = data;
  if (!docNumber) throw new HttpsError("invalid-argument", "docNumber required.");

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
  if (!context.auth) throw new HttpsError("unauthenticated", "Login required.");

  const { to, subject, html, text } = data;
  if (!to || !subject) {
    throw new HttpsError("invalid-argument", "to and subject are required.");
  }

  try {
    await sendEmail(to, subject, html || text || "(no body)");
    return { success: true };
  } catch (e) {
    console.error("sendTestEmail error:", e);
    throw new HttpsError("internal", e.message || "Email send failed.");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: Wipe app data (Superadmin)
// mode = "docs"  → delete documents + logs + reset ref counter
// mode = "full"  → above + plants, departments, categories
// ─────────────────────────────────────────────────────────────────────────────
exports.wipeAppData = functions.https.onCall(async (data, context) => {
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
exports.runRetentionDelete = functions.https.onCall(async (data, context) => {
  await requireSuperadmin(context);
  return doRetentionDelete();
});

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULED: Daily auto-retention delete at 1:00 AM IST (19:30 UTC)
// ─────────────────────────────────────────────────────────────────────────────
exports.dailyRetentionDelete = functionsBase
  .region("asia-south1")
  .pubsub.schedule("30 19 * * *")
  .timeZone("Asia/Kolkata")
  .onRun(async () => {
    const result = await doRetentionDelete();
    console.log("dailyRetentionDelete result:", JSON.stringify(result));
    return null;
  });
