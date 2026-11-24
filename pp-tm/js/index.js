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

// ─────────────────────────────────────────────────────────────
//  Helper: normalise a Firestore field that may be stored as
//  a comma/semicolon-separated string OR a proper array.
//  Returns a deduplicated array of non-empty trimmed strings.
// ─────────────────────────────────────────────────────────────
function toEmailArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return [...new Set(value.map(v => (v || "").trim()).filter(Boolean))];
  }
  // Legacy string storage: "a@x.com; b@x.com, c@x.com"
  return [...new Set(
    String(value).split(/[,;]+/).map(v => v.trim()).filter(Boolean)
  )];
}

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

// ─────────────────────────────────────────────────────────────
//  Helper: fetch a plant's contact email from Firestore.
//  Plants are stored in collection "plants" with doc ID = plantId.
//  Returns "" if not found or no email set.
// ─────────────────────────────────────────────────────────────
async function getPlantEmail(plantId) {
  if (!plantId) return "";
  try {
    const snap = await db.doc(`plants/${plantId}`).get();
    return (snap.exists && snap.data().email) ? snap.data().email.trim() : "";
  } catch (e) {
    console.warn(`Could not fetch plant email for ${plantId}:`, e.message);
    return "";
  }
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
    onDispatch:    { to: [], cc: [] },
    onReceipt:     { to: [], cc: [] },
    onDiscrepancy: { to: [], cc: [] },
  };
  try {
    const cfgSnap = await db.doc("settings/emailConfig").get();
    if (cfgSnap.exists) emailConfig = { ...emailConfig, ...cfgSnap.data() };
  } catch (e) {
    console.warn("Could not load emailConfig from Firestore:", e.message);
  }

  // ── Auto-fetch destination plant's contact email ──────────
  //  dispatchData.toPlantId is passed from the browser client.
  //  On dispatch: notify the receiving plant's contact.
  //  On receipt:  same plant (they just confirmed arrival).
  const plantContactEmail = await getPlantEmail(dispatchData.toPlantId);

  // ── Build email content ───────────────────────────────────
  let subject, htmlBody, cfg;

  if (type === "dispatch") {
    cfg = emailConfig.onDispatch;
    subject = `🚚 New Dispatch: ${dispatchData.dispatchId} | ${dispatchData.fromPlantName} → ${dispatchData.toPlantName}`;
    htmlBody = buildDispatchEmail(dispatchData);

  } else if (type === "receipt") {
    const isDiscrep = receiptData && Math.abs(receiptData.qtyReceived - dispatchData.qtyDispatched) > 0.001;
    cfg = isDiscrep ? emailConfig.onDiscrepancy : emailConfig.onReceipt;

    // On discrepancy: also CC the normal receipt list
    if (isDiscrep) {
      const receiptTo = toEmailArray(emailConfig.onReceipt.to);
      const receiptCc = toEmailArray(emailConfig.onReceipt.cc);
      cfg = {
        to: toEmailArray(cfg.to),
        cc: [...new Set([...toEmailArray(cfg.cc), ...receiptTo, ...receiptCc])],
      };
    }
    subject = isDiscrep
      ? `⚠️ Discrepancy Alert: ${dispatchData.dispatchId} | ${dispatchData.fromPlantName} → ${dispatchData.toPlantName}`
      : `✅ Receipt Confirmed: ${dispatchData.dispatchId} | ${dispatchData.fromPlantName} → ${dispatchData.toPlantName}`;
    htmlBody = buildReceiptEmail(dispatchData, receiptData, isDiscrep);

  } else {
    throw new HttpsError("invalid-argument", `Unknown email type: ${type}`);
  }

  // ── Build TO / CC lists (parse string or array from Firestore) ──
  //
  //  Priority / routing:
  //    TO   = configured TO list  +  plant contact email (auto)
  //    CC   = configured CC list  +  dispatcher/receiver (auto-CC acting user)
  //
  //  Plant contact is added to TO so the receiving plant always
  //  gets the notification even if no fixed TO is configured.

  const configuredTo = toEmailArray(cfg.to);
  const configuredCc = toEmailArray(cfg.cc);

  // Auto-CC the acting user (dispatcher / receiver)
  const actingUserEmails = [];
  if (dispatchData.senderEmail)                    actingUserEmails.push(dispatchData.senderEmail.trim());
  if (receiptData && receiptData.receiverEmail)    actingUserEmails.push(receiptData.receiverEmail.trim());

  // Merge plant contact into TO (deduplicated)
  const toList = [...new Set([
    ...configuredTo,
    ...(plantContactEmail ? [plantContactEmail] : []),
  ])].filter(Boolean);

  const ccList = [...new Set([
    ...configuredCc,
    ...actingUserEmails,
  ])].filter(e => e && !toList.includes(e)); // don't CC someone already in TO

  if (toList.length === 0 && ccList.length === 0) {
    console.log(`No recipients configured for type "${type}" — skipping email.`);
    return { sent: false, reason: "No recipients configured" };
  }

  // If somehow still no TO (no config, no plant email), promote first CC to TO
  const finalTo = toList.length ? toList : [ccList[0]];
  const finalCC = toList.length ? ccList : ccList.slice(1);

  // ── Send via Gmail ────────────────────────────────────────
  const transporter = await createTransporter();
  const gmailSnap   = await db.doc("settings/gmailConfig").get();
  const gmailUser   = gmailSnap.data().user;

  const mailOptions = {
    from:    `"PTMS Notifications" <${gmailUser}>`,
    to:      finalTo.join(", "),
    cc:      finalCC.length ? finalCC.join(", ") : undefined,
    subject,
    html:    htmlBody,
  };

  await transporter.sendMail(mailOptions);
  console.log(
    `✅ Email sent [${type}] to: ${finalTo.join(", ")}` +
    (finalCC.length ? ` | cc: ${finalCC.join(", ")}` : "") +
    (plantContactEmail ? ` | plant-contact: ${plantContactEmail}` : "")
  );
  return { sent: true };
});


// ═════════════════════════════════════════════════════════════
//  EMAIL TEMPLATES  — Beautiful rounded-card design
// ═════════════════════════════════════════════════════════════

function emailWrapper(title, subtitle, accentGrad, iconEmoji, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#eef1f8;font-family:'Segoe UI',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f8;padding:40px 16px">
  <tr><td align="center">

    <!-- Outer card -->
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.12)">

      <!-- ── HEADER GRADIENT ── -->
      <tr><td style="background:${accentGrad};padding:36px 36px 32px">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="vertical-align:top">
              <div style="display:inline-block;background:rgba(255,255,255,.18);border-radius:50px;padding:5px 14px;font-size:11px;font-weight:700;color:rgba(255,255,255,.95);letter-spacing:.1em;text-transform:uppercase;margin-bottom:14px">
                📦 PTMS Notification
              </div>
              <div style="font-size:24px;font-weight:800;color:#ffffff;line-height:1.2;margin-bottom:6px">${title}</div>
              <div style="font-size:13px;color:rgba(255,255,255,.8);font-weight:400">${subtitle}</div>
            </td>
            <td align="right" style="vertical-align:top;padding-left:16px">
              <div style="width:60px;height:60px;background:rgba(255,255,255,.2);border-radius:16px;text-align:center;line-height:60px;font-size:28px">
                ${iconEmoji}
              </div>
            </td>
          </tr>
        </table>
      </td></tr>

      <!-- ── BODY ── -->
      <tr><td style="padding:32px 36px">${bodyHtml}</td></tr>

      <!-- ── FOOTER ── -->
      <tr><td style="background:#f7f9fc;border-top:1px solid #e8ecf4;border-radius:0 0 20px 20px;padding:20px 36px">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:11px;color:#9aa3b7;line-height:1.6">
              <strong style="color:#6b7280">PTMS</strong> — Plant Transport &amp; Material Tracking System<br>
              This is an automated notification. Please do not reply to this email.
            </td>
            <td align="right" style="font-size:20px;opacity:.35">🏭</td>
          </tr>
        </table>
      </td></tr>

    </table>

  </td></tr>
</table>

</body></html>`;
}

// Single detail row inside a card
function row(label, value, highlight) {
  const valStyle = `font-size:13.5px;color:${highlight || "#1f2937"};${highlight ? "font-weight:700;" : ""}`;
  return `<tr>
    <td style="padding:11px 16px;font-size:12.5px;font-weight:600;color:#6b7280;width:42%;border-bottom:1px solid #f1f3f8;white-space:nowrap">${label}</td>
    <td style="padding:11px 16px;${valStyle};border-bottom:1px solid #f1f3f8">${value ?? "—"}</td>
  </tr>`;
}

// Section card with rounded corners
function section(title, iconEmoji, rows) {
  return `
  <div style="margin-bottom:20px">
    <div style="display:flex;align-items:center;margin-bottom:10px">
      <span style="font-size:14px;margin-right:7px">${iconEmoji}</span>
      <span style="font-size:11.5px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.07em">${title}</span>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0"
      style="background:#ffffff;border:1.5px solid #e8ecf4;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.04)">
      ${rows}
    </table>
  </div>`;
}

// Pill / badge
function pill(text, bg, color) {
  return `<span style="display:inline-block;background:${bg};color:${color};padding:3px 12px;border-radius:50px;font-size:12px;font-weight:700">${text}</span>`;
}

// Route arrow banner
function routeBanner(from, to, bgColor, borderColor, textColor) {
  return `
  <div style="background:${bgColor};border:1.5px solid ${borderColor};border-radius:14px;padding:18px 22px;margin-bottom:24px">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center" style="width:40%">
          <div style="font-size:11px;font-weight:600;color:${textColor};opacity:.7;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">From</div>
          <div style="font-size:15px;font-weight:800;color:${textColor}">${from}</div>
        </td>
        <td align="center" style="width:20%;font-size:22px;color:${textColor};opacity:.5">→</td>
        <td align="center" style="width:40%">
          <div style="font-size:11px;font-weight:600;color:${textColor};opacity:.7;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">To</div>
          <div style="font-size:15px;font-weight:800;color:${textColor}">${to}</div>
        </td>
      </tr>
    </table>
  </div>`;
}

function buildDispatchEmail(d) {
  return emailWrapper(
    `New Dispatch Created`,
    `Dispatch ID: ${d.dispatchId}  •  ${d.date}`,
    `linear-gradient(135deg, #1a237e 0%, #0d47a1 60%, #1565c0 100%)`,
    "🚚",
    `
    ${routeBanner(d.fromPlantName, d.toPlantName, "#eff6ff", "#bfdbfe", "#1e3a8a")}

    ${section("Dispatch Details", "🔖",
      row("Dispatch ID",   `<span style="font-family:monospace;font-size:13px;font-weight:700;color:#1d4ed8;background:#eff6ff;padding:2px 8px;border-radius:6px">${d.dispatchId}</span>`) +
      row("Dispatch Date", d.date) +
      row("Dispatched By", d.dispatchedByName) +
      row("Status",        pill("Dispatched", "#dbeafe", "#1d4ed8"))
    )}

    ${section("Material Details", "📦",
      row("Description",    d.material) +
      row("Quantity",       `<strong style="font-size:15px;color:#1d4ed8">${d.qtyDispatched}</strong> <span style="color:#6b7280">${d.unit}</span>`) +
      row("No. of Boxes",   d.boxes  || "—") +
      row("Batch / Lot No.", d.batch || "—")
    )}

    ${section("Vehicle & Driver", "🚛",
      row("Vehicle No.",    `<strong>${d.vehicleNo}</strong>`) +
      row("Vehicle Type",   d.vehicleType) +
      row("Driver Name",    d.driverName) +
      row("Driver Phone",   d.driverPhone) +
      row("Departure Time", d.departureTime) +
      row("E-Way Bill",     d.ewayBill || "—")
    )}

    ${d.remarks ? `
    <div style="background:#fffbeb;border:1.5px solid #fde68a;border-radius:14px;padding:16px 20px;margin-bottom:20px">
      <div style="font-size:11.5px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">📝 Remarks</div>
      <div style="font-size:13.5px;color:#78350f">${d.remarks}</div>
    </div>` : ""}

    <div style="background:linear-gradient(135deg,#fff7ed,#ffedd5);border:1.5px solid #fed7aa;border-radius:14px;padding:18px 22px;text-align:center">
      <div style="font-size:22px;margin-bottom:8px">⏳</div>
      <div style="font-size:14px;font-weight:700;color:#9a3412;margin-bottom:4px">Action Required</div>
      <div style="font-size:13px;color:#c2410c">Please confirm receipt once the vehicle arrives at <strong>${d.toPlantName}</strong>.</div>
    </div>
    `
  );
}

function buildReceiptEmail(d, r, isDiscrep) {
  const diff      = r.qtyReceived - d.qtyDispatched;
  const diffStr   = `${diff >= 0 ? "+" : ""}${diff.toFixed(3)} ${d.unit}`;
  const diffColor = diff < 0 ? "#b91c1c" : diff > 0 ? "#1d4ed8" : "#15803d";

  if (isDiscrep) {
    // ── DISCREPANCY email ──────────────────────────────────────
    return emailWrapper(
      `Discrepancy Alert`,
      `Dispatch ID: ${d.dispatchId}`,
      `linear-gradient(135deg, #7f1d1d 0%, #b91c1c 60%, #dc2626 100%)`,
      "⚠️",
      `
      <div style="background:linear-gradient(135deg,#fef2f2,#fee2e2);border:1.5px solid #fca5a5;border-radius:14px;padding:20px 22px;margin-bottom:24px;text-align:center">
        <div style="font-size:32px;margin-bottom:8px">⚠️</div>
        <div style="font-size:16px;font-weight:800;color:#991b1b;margin-bottom:6px">Quantity Mismatch Detected</div>
        <div style="font-size:13.5px;color:#b91c1c">The received quantity does not match the dispatched quantity.</div>
        <div style="margin-top:12px;display:inline-block;background:#991b1b;color:#fff;padding:6px 20px;border-radius:50px;font-size:14px;font-weight:700">
          Difference: ${diffStr}
        </div>
      </div>

      ${routeBanner(d.fromPlantName, d.toPlantName, "#fff1f2", "#fecaca", "#7f1d1d")}

      ${section("Receipt Details", "📋",
        row("Dispatch ID",   `<span style="font-family:monospace;font-size:13px;font-weight:700;color:#1d4ed8;background:#eff6ff;padding:2px 8px;border-radius:6px">${d.dispatchId}</span>`) +
        row("Arrival Date",  r.arrivalDate) +
        row("Arrival Time",  r.arrivalTime) +
        row("Received By",   r.receivedByName)
      )}

      ${section("Quantity Reconciliation", "⚖️",
        row("Material",       d.material) +
        row("Qty Dispatched", `${d.qtyDispatched} ${d.unit}`) +
        row("Qty Received",   `<strong style="color:#b91c1c">${r.qtyReceived} ${d.unit}</strong>`) +
        row("Difference",     `<strong style="font-size:14px">${diffStr}</strong>`, diffColor) +
        row("Status",         pill("⚠️ DISCREPANCY", "#fee2e2", "#b91c1c"))
      )}

      ${r.receiptRemarks ? `
      <div style="background:#fffbeb;border:1.5px solid #fde68a;border-radius:14px;padding:16px 20px;margin-bottom:20px">
        <div style="font-size:11.5px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">📝 Receipt Remarks</div>
        <div style="font-size:13.5px;color:#78350f">${r.receiptRemarks}</div>
      </div>` : ""}

      <div style="background:linear-gradient(135deg,#fef2f2,#fee2e2);border:1.5px solid #fca5a5;border-radius:14px;padding:18px 22px;text-align:center">
        <div style="font-size:14px;font-weight:700;color:#991b1b;margin-bottom:4px">🔍 Investigation Required</div>
        <div style="font-size:13px;color:#b91c1c">Please investigate the discrepancy and take necessary corrective action.</div>
      </div>
      `
    );
  } else {
    // ── RECEIPT CONFIRMED email ────────────────────────────────
    return emailWrapper(
      `Receipt Confirmed`,
      `Dispatch ID: ${d.dispatchId}  •  ${r.arrivalDate}`,
      `linear-gradient(135deg, #064e3b 0%, #065f46 60%, #047857 100%)`,
      "✅",
      `
      <div style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:1.5px solid #86efac;border-radius:14px;padding:20px 22px;margin-bottom:24px;text-align:center">
        <div style="font-size:32px;margin-bottom:8px">✅</div>
        <div style="font-size:16px;font-weight:800;color:#14532d;margin-bottom:6px">Receipt Confirmed Successfully</div>
        <div style="font-size:13.5px;color:#166534">Quantities match — no discrepancy found.</div>
      </div>

      ${routeBanner(d.fromPlantName, d.toPlantName, "#f0fdf4", "#bbf7d0", "#14532d")}

      ${section("Receipt Details", "📋",
        row("Dispatch ID",   `<span style="font-family:monospace;font-size:13px;font-weight:700;color:#1d4ed8;background:#eff6ff;padding:2px 8px;border-radius:6px">${d.dispatchId}</span>`) +
        row("Arrival Date",  r.arrivalDate) +
        row("Arrival Time",  r.arrivalTime) +
        row("Received By",   r.receivedByName)
      )}

      ${section("Quantity Reconciliation", "⚖️",
        row("Material",       d.material) +
        row("Qty Dispatched", `${d.qtyDispatched} ${d.unit}`) +
        row("Qty Received",   `<strong style="color:#15803d">${r.qtyReceived} ${d.unit}</strong>`) +
        row("Difference",     `<strong style="font-size:14px">${diffStr}</strong>`, diffColor) +
        row("Status",         pill("✅ MATCHED", "#dcfce7", "#15803d"))
      )}

      ${r.receiptRemarks ? `
      <div style="background:#fffbeb;border:1.5px solid #fde68a;border-radius:14px;padding:16px 20px;">
        <div style="font-size:11.5px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">📝 Receipt Remarks</div>
        <div style="font-size:13.5px;color:#78350f">${r.receiptRemarks}</div>
      </div>` : ""}
      `
    );
  }
}
