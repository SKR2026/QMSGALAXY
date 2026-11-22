// ─────────────────────────────────────────────────────────────
//  PTMS – Firebase Cloud Functions  (Gen 2 / firebase-functions v4+)
//
//  1. createPtmsUser  – creates Firebase Auth user + Firestore
//                       profile (requires superAdmin caller)
//  2. sendPtmsEmail   – sends Gmail via Nodemailer
//
//  Gmail credentials are stored in Firestore settings/gmailConfig
//  (set them via Admin → 🔑 Gmail Credentials in the app).
// ─────────────────────────────────────────────────────────────

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions }   = require("firebase-functions/v2");
const admin                  = require("firebase-admin");
const nodemailer             = require("nodemailer");

admin.initializeApp();
const db = admin.firestore();

// Set region + allow all origins for CORS (site hosted on custom domain qmsgalaxy.com)
setGlobalOptions({ region: "asia-south1", cors: true });

// ═════════════════════════════════════════════════════════════
//  HTTPS callable: createPtmsUser
//  Creates a Firebase Auth user + Firestore profile.
//  Only a verified superAdmin may call this.
// ═════════════════════════════════════════════════════════════
exports.createPtmsUser = onCall(async (request) => {

  // ── Must be signed-in ─────────────────────────────────────
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }

  // ── Caller must be superAdmin ─────────────────────────────
  const callerDoc = await db.doc(`users/${request.auth.uid}`).get();
  if (!callerDoc.exists || callerDoc.data().role !== "superAdmin") {
    throw new HttpsError("permission-denied", "Only Super Admins can create users.");
  }

  const { name, email, password, role, plantId } = request.data;

  // ── Basic validation ──────────────────────────────────────
  if (!name || !email || !password || !role) {
    throw new HttpsError("invalid-argument", "name, email, password and role are required.");
  }
  if (password.length < 6) {
    throw new HttpsError("invalid-argument", "Password must be at least 6 characters.");
  }
  if (role === "plantUser" && !plantId) {
    throw new HttpsError("invalid-argument", "plantId is required for Plant User role.");
  }

  // ── Create Auth user ──────────────────────────────────────
  let userRecord;
  try {
    userRecord = await admin.auth().createUser({ email, password, displayName: name });
  } catch (e) {
    if (e.code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "Email already in use.");
    }
    throw new HttpsError("internal", e.message);
  }

  // ── Write Firestore profile ───────────────────────────────
  await db.doc(`users/${userRecord.uid}`).set({
    name,
    email,
    role,
    plantId: role === "plantUser" ? (plantId || null) : null,
    isActive: true,
    mustChangePassword: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: request.auth.uid,
  });

  console.log(`✅ User created: ${email} (${role}) by ${request.auth.uid}`);
  return { uid: userRecord.uid };
});

// ── Gmail transporter (credentials from Firestore settings/gmailConfig) ──
async function createTransporter() {
  const snap = await db.doc("settings/gmailConfig").get();
  if (!snap.exists) {
    throw new Error("Gmail credentials not configured. Please set them in Admin → Gmail Credentials.");
  }
  const cfg = snap.data();
  if (!cfg.user || !cfg.pass) {
    throw new Error("Gmail user/password missing in settings/gmailConfig.");
  }
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: cfg.user,
      pass: cfg.pass.replace(/\s+/g, ""), // strip spaces from 16-digit app password
    },
  });
}

// ═════════════════════════════════════════════════════════════
//  HTTPS callable: sendPtmsEmail
//  Called from browser via Firebase Functions SDK.
//  Requires authenticated user (Firebase Auth token validated).
// ═════════════════════════════════════════════════════════════
exports.sendPtmsEmail = onCall(async (request) => {

  // ── Auth check: must be signed-in plant user or superAdmin ─
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be logged in to send notifications.");
  }

  const { type, dispatchData, receiptData } = request.data;
  if (!type || !dispatchData) {
    throw new HttpsError("invalid-argument", "Missing email data.");
  }

  // ── Load recipient config from Firestore ──────────────────
  let emailConfig = {
    onDispatch: { to: [], cc: [] },
    onReceipt:  { to: [], cc: [] },
    onDiscrepancy: { to: [], cc: [] },
  };
  try {
    const cfgSnap = await db.doc("settings/emailConfig").get();
    if (cfgSnap.exists) emailConfig = { ...emailConfig, ...cfgSnap.data() };
  } catch (e) {
    console.warn("Could not load emailConfig from Firestore:", e.message);
  }

  // ── Build email content ───────────────────────────────────
  let subject, htmlBody, cfg;

  if (type === "dispatch") {
    cfg = emailConfig.onDispatch;
    subject = `🚚 New Dispatch: ${dispatchData.dispatchId} | ${dispatchData.fromPlantName} → ${dispatchData.toPlantName}`;
    htmlBody = buildDispatchEmail(dispatchData);

  } else if (type === "receipt") {
    const isDiscrep = receiptData && Math.abs(receiptData.qtyReceived - dispatchData.qtyDispatched) > 0.001;
    cfg = isDiscrep ? emailConfig.onDiscrepancy : emailConfig.onReceipt;
    if (isDiscrep && emailConfig.onReceipt.to?.length) {
      cfg = {
        to: cfg.to || [],
        cc: [...new Set([...(cfg.cc || []), ...(emailConfig.onReceipt.to || [])])],
      };
    }
    subject = isDiscrep
      ? `⚠️ Discrepancy Alert: ${dispatchData.dispatchId} | ${dispatchData.fromPlantName} → ${dispatchData.toPlantName}`
      : `✅ Receipt Confirmed: ${dispatchData.dispatchId} | ${dispatchData.fromPlantName} → ${dispatchData.toPlantName}`;
    htmlBody = buildReceiptEmail(dispatchData, receiptData, isDiscrep);

  } else {
    throw new HttpsError("invalid-argument", `Unknown email type: ${type}`);
  }

  // ── Validate recipients ───────────────────────────────────
  const toList = (cfg.to || []).filter(Boolean);
  const ccList = (cfg.cc || []).filter(Boolean);
  if (toList.length === 0) {
    console.log(`No recipients configured for type "${type}" — skipping email.`);
    return { sent: false, reason: "No recipients configured" };
  }

  // ── Send via Gmail ────────────────────────────────────────
  const transporter = await createTransporter();
  const gmailSnap   = await db.doc("settings/gmailConfig").get();
  const gmailUser   = gmailSnap.data().user;

  const mailOptions = {
    from:    `"PTMS Notifications" <${gmailUser}>`,
    to:      toList.join(", "),
    cc:      ccList.length ? ccList.join(", ") : undefined,
    subject,
    html:    htmlBody,
  };

  await transporter.sendMail(mailOptions);
  console.log(`✅ Email sent [${type}] to: ${toList.join(", ")}`);
  return { sent: true };
});


// ═════════════════════════════════════════════════════════════
//  EMAIL TEMPLATES
// ═════════════════════════════════════════════════════════════

function emailWrapper(title, accentColor, bodyHtml) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Segoe UI,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:32px 0">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.1)">

      <!-- Header -->
      <tr><td style="background:${accentColor};padding:24px 32px">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td>
              <div style="color:#fff;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.8">PTMS Notification</div>
              <div style="color:#fff;font-size:20px;font-weight:700;margin-top:4px">${title}</div>
            </td>
            <td align="right" style="color:#fff;font-size:28px">🏭</td>
          </tr>
        </table>
      </td></tr>

      <!-- Body -->
      <tr><td style="padding:28px 32px">${bodyHtml}</td></tr>

      <!-- Footer -->
      <tr><td style="background:#f4f6fb;padding:16px 32px;border-top:1px solid #e0e4ed">
        <div style="font-size:11px;color:#8e8ea8;text-align:center">
          Plant Transport &amp; Material Tracking System (PTMS) &nbsp;|&nbsp; This is an automated notification. Do not reply.
        </div>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;
}

function row(label, value, highlight) {
  return `<tr>
    <td style="padding:8px 12px;font-size:13px;color:#4a4a6a;font-weight:600;width:40%;border-bottom:1px solid #f0f0f0">${label}</td>
    <td style="padding:8px 12px;font-size:13px;color:#1a1a2e;border-bottom:1px solid #f0f0f0${highlight ? ';font-weight:700;color:' + highlight : ''}">${value ?? "—"}</td>
  </tr>`;
}

function section(title, rows) {
  return `
    <div style="font-size:11px;font-weight:700;color:#8e8ea8;text-transform:uppercase;letter-spacing:.06em;margin:20px 0 8px">${title}</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e0e4ed;border-radius:6px;overflow:hidden">
      ${rows}
    </table>`;
}

function buildDispatchEmail(d) {
  return emailWrapper(
    `Dispatch Created — ${d.dispatchId}`,
    "#0d2137",
    `
    <div style="background:#e3f2fd;border-left:4px solid #1e88e5;padding:12px 16px;border-radius:4px;margin-bottom:20px;font-size:14px;color:#0d47a1">
      <strong>${d.fromPlantName}</strong> has dispatched material to <strong>${d.toPlantName}</strong>
    </div>

    ${section("Dispatch Details",
      row("Dispatch ID",    `<span style="font-family:monospace;font-weight:700;color:#1565c0">${d.dispatchId}</span>`) +
      row("Dispatch Date",  d.date) +
      row("From Plant",     d.fromPlantName) +
      row("To Plant",       d.toPlantName) +
      row("Dispatched By",  d.dispatchedByName)
    )}

    ${section("Material",
      row("Description",    d.material) +
      row("Quantity",       `<strong>${d.qtyDispatched} ${d.unit}</strong>`) +
      row("No. of Boxes",   d.boxes || "—") +
      row("Batch / Lot No.",d.batch  || "—")
    )}

    ${section("Vehicle & Driver",
      row("Vehicle No.",    d.vehicleNo) +
      row("Vehicle Type",   d.vehicleType) +
      row("Driver Name",    d.driverName) +
      row("Driver Phone",   d.driverPhone) +
      row("Departure Time", d.departureTime) +
      row("E-Way Bill",     d.ewayBill || "—")
    )}

    ${d.remarks ? `<div style="margin-top:16px;padding:12px 16px;background:#f9f9f9;border-radius:6px;font-size:13px;color:#4a4a6a"><strong>Remarks:</strong> ${d.remarks}</div>` : ""}

    <div style="margin-top:24px;padding:12px 16px;background:#fff3e0;border-radius:6px;font-size:13px;color:#bf360c">
      ⏳ Please confirm receipt once the vehicle arrives at <strong>${d.toPlantName}</strong>.
    </div>
    `
  );
}

function buildReceiptEmail(d, r, isDiscrep) {
  const diff     = r.qtyReceived - d.qtyDispatched;
  const diffStr  = `${diff >= 0 ? "+" : ""}${diff.toFixed(3)} ${d.unit}`;
  const diffColor = diff < 0 ? "#c62828" : diff > 0 ? "#1565c0" : "#2e7d32";
  const accentColor = isDiscrep ? "#c62828" : "#2e7d32";
  const statusBanner = isDiscrep
    ? `<div style="background:#ffebee;border-left:4px solid #c62828;padding:12px 16px;border-radius:4px;margin-bottom:20px;font-size:14px;color:#b71c1c">
        ⚠️ <strong>Discrepancy Detected!</strong> Quantity received does not match quantity dispatched. Difference: <strong>${diffStr}</strong>
       </div>`
    : `<div style="background:#e8f5e9;border-left:4px solid #2e7d32;padding:12px 16px;border-radius:4px;margin-bottom:20px;font-size:14px;color:#1b5e20">
        ✅ <strong>Receipt Confirmed Successfully.</strong> Quantities match.
       </div>`;

  return emailWrapper(
    isDiscrep ? `⚠️ Discrepancy — ${d.dispatchId}` : `✅ Receipt Confirmed — ${d.dispatchId}`,
    accentColor,
    `
    ${statusBanner}

    ${section("Receipt Details",
      row("Dispatch ID",    `<span style="font-family:monospace;font-weight:700;color:#1565c0">${d.dispatchId}</span>`) +
      row("Arrival Date",   r.arrivalDate) +
      row("Arrival Time",   r.arrivalTime) +
      row("Received By",    r.receivedByName) +
      row("From Plant",     d.fromPlantName) +
      row("To Plant",       d.toPlantName)
    )}

    ${section("Quantity Reconciliation",
      row("Material",          d.material) +
      row("Qty Dispatched",    `${d.qtyDispatched} ${d.unit}`) +
      row("Qty Received",      `${r.qtyReceived} ${d.unit}`) +
      row("Difference",        diffStr, diffColor) +
      row("Status",            isDiscrep ? "⚠️ DISCREPANCY" : "✅ OK", accentColor)
    )}

    ${r.receiptRemarks ? `<div style="margin-top:16px;padding:12px 16px;background:#f9f9f9;border-radius:6px;font-size:13px;color:#4a4a6a"><strong>Receipt Remarks:</strong> ${r.receiptRemarks}</div>` : ""}

    ${isDiscrep ? `<div style="margin-top:16px;padding:12px 16px;background:#ffebee;border-radius:6px;font-size:13px;color:#c62828">
      Please investigate the discrepancy and take necessary action.
    </div>` : ""}
    `
  );
}
