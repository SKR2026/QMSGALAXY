/**
 * LPA Management System — Firebase Cloud Functions
 * Gmail email delivery via Nodemailer (App Password) or OAuth2
 *
 * Deploy:  firebase deploy --only functions
 * Emulate: firebase emulators:start --only functions
 *
 * Firestore path for Gmail config (saved by super admin settings UI):
 *   apps/lpa/settings/gmailConfig  {
 *     senderEmail : "you@gmail.com",
 *     senderName  : "LPA System",
 *     appPassword : "xxxx xxxx xxxx xxxx",   ← 16-char Google App Password
 *     useOAuth    : false
 *   }
 */

"use strict";

const functions  = require("firebase-functions");
const admin      = require("firebase-admin");
const nodemailer = require("nodemailer");
const { google } = require("googleapis");

admin.initializeApp();
const db = admin.firestore();

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/** Shorthand for the LPA namespace */
const lpa = (col) => db.collection("apps").doc("lpa").collection(col);

/** Read Gmail config from Firestore once per cold-start (cached). */
let _cachedCfg = null;
let _cfgTs = 0;
const CFG_TTL_MS = 5 * 60 * 1000; // re-read every 5 min

async function getGmailConfig() {
  const now = Date.now();
  if (_cachedCfg && now - _cfgTs < CFG_TTL_MS) return _cachedCfg;

  const snap = await lpa("settings").doc("gmailConfig").get();

  if (!snap.exists) throw new Error("Gmail config not found. Please configure it in Super Admin → Settings → Gmail.");

  _cachedCfg = snap.data();
  _cfgTs = now;
  return _cachedCfg;
}

/** Build a Nodemailer transporter from the stored config. */
async function buildTransporter(cfg) {
  if (cfg.useOAuth) {
    // ── OAuth2 path ──────────────────────────────────────────────
    const oauth2Client = new google.auth.OAuth2(
      cfg.clientId,
      cfg.clientSecret,
      "https://developers.google.com/oauthplayground"
    );
    oauth2Client.setCredentials({ refresh_token: cfg.refreshToken });

    const { token } = await oauth2Client.getAccessToken();

    return nodemailer.createTransport({
      service: "gmail",
      auth: {
        type:         "OAuth2",
        user:         cfg.senderEmail,
        clientId:     cfg.clientId,
        clientSecret: cfg.clientSecret,
        refreshToken: cfg.refreshToken,
        accessToken:  token,
      },
    });
  } else {
    // ── App Password path ────────────────────────────────────────
    return nodemailer.createTransport({
      host:   "smtp.gmail.com",
      port:   465,
      secure: true,
      auth: {
        user: cfg.senderEmail,
        pass: cfg.appPassword,
      },
    });
  }
}

/**
 * Core email sender — used by every function below.
 * @param {object} opts  { to, cc, subject, html, text }
 */
async function deliverEmail(opts) {
  const cfg         = await getGmailConfig();
  const transporter = await buildTransporter(cfg);

  const info = await transporter.sendMail({
    from:    `"${cfg.senderName || "LPA System"}" <${cfg.senderEmail}>`,
    to:      opts.to,
    cc:      opts.cc  || undefined,
    subject: opts.subject,
    text:    opts.text || undefined,
    html:    opts.html || undefined,
  });

  functions.logger.info("[LPA mail] Sent:", info.messageId, "→", opts.to);
  return info.messageId;
}

/** Shared HTML email wrapper. */
function wrapHtml(title, bodyHtml, accentColor = "#1a56db") {
  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0"
             style="background:#fff;border-radius:12px;overflow:hidden;
                    box-shadow:0 2px 12px rgba(0,0,0,.08);">
        <!-- Header -->
        <tr>
          <td style="background:${accentColor};padding:24px 32px;">
            <span style="color:#fff;font-size:20px;font-weight:700;">${title}</span>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:28px 32px;font-size:14px;color:#374151;line-height:1.7;">
            ${bodyHtml}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;
                     font-size:11px;color:#9ca3af;text-align:center;">
            LPA Management System · This is an automated notification · Do not reply
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─────────────────────────────────────────────
// 1. CALLABLE: sendEmail
//    General-purpose email send called from the app.
//    Payload: { to, cc?, subject, bodyHtml, bodyText? }
// ─────────────────────────────────────────────
exports.sendEmail = functions.https.onCall(async (data, context) => {
  // Only authenticated users may call this
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Must be signed in.");
  }

  const { to, cc, subject, bodyHtml, bodyText } = data;
  if (!to || !subject || !bodyHtml) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Required fields: to, subject, bodyHtml"
    );
  }

  try {
    const msgId = await deliverEmail({
      to, cc, subject,
      html: wrapHtml(subject, bodyHtml),
      text: bodyText,
    });
    return { success: true, messageId: msgId };
  } catch (err) {
    functions.logger.error("[LPA mail] sendEmail error:", err);
    throw new functions.https.HttpsError("internal", err.message);
  }
});

// ─────────────────────────────────────────────
// 2. CALLABLE: sendTestEmail
//    Super admin presses "Send Test" in the settings panel.
//    Payload: { to? }  — defaults to the sender's own address
// ─────────────────────────────────────────────
exports.sendTestEmail = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Must be signed in.");
  }

  try {
    const cfg = await getGmailConfig();
    const to  = (data && data.to) ? data.to : cfg.senderEmail;

    const html = wrapHtml(
      "✅ Test Email — LPA System",
      `<p>Hello,</p>
       <p>This is a <strong>test email</strong> from your LPA Management System.</p>
       <p>If you received this, your Gmail configuration is working correctly.</p>
       <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
       <p style="color:#6b7280;font-size:12px;">Sent by: ${cfg.senderEmail}</p>`
    );

    const msgId = await deliverEmail({ to, subject: "✅ Test Email — LPA System", html });
    return { success: true, messageId: msgId, sentTo: to };
  } catch (err) {
    functions.logger.error("[LPA mail] sendTestEmail error:", err);
    throw new functions.https.HttpsError("internal", err.message);
  }
});

// ─────────────────────────────────────────────
// 3. FIRESTORE TRIGGER: onEscalationAction
//    Fires when a correctiveAction document gets an escalationLevel set.
//
//    FIX: path was "apps/lpa/actions/{actionId}" — corrected to
//         "apps/lpa/correctiveActions/{actionId}"
//    FIX: escalationEmails settings path corrected to apps/lpa/settings
// ─────────────────────────────────────────────
exports.onEscalationAction = functions.firestore
  .document("apps/lpa/correctiveActions/{actionId}")   // ← FIXED path
  .onWrite(async (change, context) => {
    const before = change.before.exists ? change.before.data() : null;
    const after  = change.after.exists  ? change.after.data()  : null;
    if (!after) return null; // deletion

    const levelBefore = before ? before.escalationLevel : undefined;
    const levelAfter  = after.escalationLevel;

    // Only act when escalation level is newly set or changes
    if (levelBefore === levelAfter || !levelAfter) return null;

    const levelLabels = { 1: "Level 1", 2: "Level 2", corporate: "Corporate" };
    const levelColors = { 1: "#f59e0b", 2: "#ef4444", corporate: "#7c3aed" };
    const label  = levelLabels[levelAfter] || String(levelAfter);
    const color  = levelColors[levelAfter] || "#1a56db";

    // FIX: read escalation email config from apps/lpa/settings (not root /settings)
    let escCfg = {};
    try {
      const escSnap = await lpa("settings").doc("escalationEmails").get();
      if (escSnap.exists) escCfg = escSnap.data();
    } catch (e) {
      functions.logger.warn("[LPA] Could not read escalationEmails config:", e);
    }

    const levelKey = levelAfter === "corporate" ? "corp" : `l${levelAfter}`;
    const toRaw    = escCfg[levelKey] || "";
    const ccRaw    = escCfg.cc || "";

    if (!toRaw) {
      functions.logger.info(`[LPA] No recipients configured for escalation ${label}, skipping.`);
      return null;
    }

    const actionId   = context.params.actionId;
    const actionDesc = after.description || after.title || actionId;
    // FIX: field is targetDate, not dueDate
    const dueDate    = after.targetDate   || after.dueDate || "N/A";
    const plant      = after.plantName    || after.plantId || "—";
    // FIX: field is responsible, not assigneeName
    const assignee   = after.responsible  || after.assigneeName || after.assigneeEmail || "—";

    const subject = `🚨 LPA Escalation – ${label}: Action Overdue`;
    const html    = wrapHtml(subject, `
      <p>An LPA corrective action has reached <strong>${label} escalation</strong>.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px;">
        <tr style="background:#f9fafb;">
          <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;width:40%;">Action ID</td>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;font-family:monospace;">${actionId}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;">Description</td>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;">${actionDesc}</td>
        </tr>
        <tr style="background:#f9fafb;">
          <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;">Plant</td>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;">${plant}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;">Responsible</td>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;">${assignee}</td>
        </tr>
        <tr style="background:#f9fafb;">
          <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;">Target Date</td>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;color:#ef4444;font-weight:600;">${dueDate}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;">Escalation Level</td>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;">
            <span style="background:${color};color:#fff;padding:2px 10px;border-radius:99px;font-size:12px;">
              ${label}
            </span>
          </td>
        </tr>
      </table>
      <p>Please take immediate action to close this finding.</p>
    `, color);

    try {
      await deliverEmail({ to: toRaw, cc: ccRaw || undefined, subject, html });
    } catch (err) {
      functions.logger.error("[LPA mail] Escalation email error:", err);
    }
    return null;
  });

// ─────────────────────────────────────────────
// 4. CALLABLE: sendAuditNotification
//    Send an audit assignment / reminder email.
//    Payload: { to, cc?, auditId, auditTitle, scheduledDate, plantName, auditorName, type }
//    type: 'assignment' | 'reminder' | 'completed'
// ─────────────────────────────────────────────
exports.sendAuditNotification = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Must be signed in.");
  }

  const {
    to, cc, auditId, auditTitle, scheduledDate,
    plantName, auditorName, type = "reminder"
  } = data;

  if (!to || !auditTitle) {
    throw new functions.https.HttpsError("invalid-argument", "Required: to, auditTitle");
  }

  const typeLabels = {
    assignment: { label: "New Audit Assignment",    color: "#1a56db", emoji: "📋" },
    reminder:   { label: "Audit Reminder",          color: "#f59e0b", emoji: "⏰" },
    completed:  { label: "Audit Completed",         color: "#059669", emoji: "✅" },
    overdue:    { label: "Audit Overdue — Action Required", color: "#ef4444", emoji: "🚨" },
  };
  const info    = typeLabels[type] || typeLabels.reminder;
  const subject = `${info.emoji} LPA ${info.label}: ${auditTitle}`;

  const html = wrapHtml(subject, `
    <p>Hello${auditorName ? ` ${auditorName}` : ""},</p>
    <p>This is a <strong>${info.label}</strong> notification for the following LPA audit:</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px;">
      <tr style="background:#f9fafb;">
        <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;width:40%;">Audit</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;">${auditTitle}</td>
      </tr>
      ${plantName ? `<tr>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;">Plant</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;">${plantName}</td>
      </tr>` : ""}
      ${auditId ? `<tr style="background:#f9fafb;">
        <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;">Audit ID</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;font-family:monospace;">${auditId}</td>
      </tr>` : ""}
      ${scheduledDate ? `<tr>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;">Scheduled Date</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;color:${info.color};">${scheduledDate}</td>
      </tr>` : ""}
    </table>
    ${type === "overdue"
      ? "<p style='color:#ef4444;font-weight:600;'>⚠️ This audit is overdue. Please complete it immediately or contact your administrator.</p>"
      : "<p>Please log in to the LPA Management System to view the full audit details.</p>"
    }
  `, info.color);

  try {
    const msgId = await deliverEmail({ to, cc, subject, html });
    return { success: true, messageId: msgId };
  } catch (err) {
    functions.logger.error("[LPA mail] sendAuditNotification error:", err);
    throw new functions.https.HttpsError("internal", err.message);
  }
});

// ─────────────────────────────────────────────
// 5. CALLABLE: sendFindingNotification
//    Notify assignee of a new finding / corrective action.
//    Payload: { to, cc?, findingId, findingDesc, criticality, dueDate, plantName, assigneeName }
// ─────────────────────────────────────────────
exports.sendFindingNotification = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Must be signed in.");
  }

  const {
    to, cc, findingId, findingDesc, criticality = "medium",
    dueDate, plantName, assigneeName
  } = data;

  if (!to || !findingDesc) {
    throw new functions.https.HttpsError("invalid-argument", "Required: to, findingDesc");
  }

  const critColors = {
    critical: "#7f1d1d", high: "#ef4444",
    medium:   "#f59e0b", low:  "#22c55e"
  };
  const critColor = critColors[criticality.toLowerCase()] || "#f59e0b";
  const subject   = `🔍 LPA Finding Assigned: ${findingDesc.substring(0, 60)}${findingDesc.length > 60 ? "…" : ""}`;

  const html = wrapHtml(subject, `
    <p>Hello${assigneeName ? ` ${assigneeName}` : ""},</p>
    <p>A new <strong>LPA finding</strong> has been assigned to you and requires a corrective action.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px;">
      ${findingId ? `<tr style="background:#f9fafb;">
        <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;width:40%;">Finding ID</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;font-family:monospace;">${findingId}</td>
      </tr>` : ""}
      <tr>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;">Description</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;">${findingDesc}</td>
      </tr>
      <tr style="background:#f9fafb;">
        <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;">Criticality</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;">
          <span style="background:${critColor};color:#fff;padding:2px 10px;border-radius:99px;
                       font-size:12px;text-transform:capitalize;">${criticality}</span>
        </td>
      </tr>
      ${plantName ? `<tr>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;">Plant</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;">${plantName}</td>
      </tr>` : ""}
      ${dueDate ? `<tr style="background:#f9fafb;">
        <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;">Action Due Date</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;color:#ef4444;font-weight:600;">${dueDate}</td>
      </tr>` : ""}
    </table>
    <p>Please log in to the LPA Management System to submit your corrective action plan.</p>
  `, critColor);

  try {
    const msgId = await deliverEmail({ to, cc, subject, html });
    return { success: true, messageId: msgId };
  } catch (err) {
    functions.logger.error("[LPA mail] sendFindingNotification error:", err);
    throw new functions.https.HttpsError("internal", err.message);
  }
});

// ─────────────────────────────────────────────
// 6. SCHEDULED: dailyEscalationCheck
//    Runs every day at 08:00 IST (02:30 UTC).
//    Scans open actions past their target date and
//    sets escalationLevel, which triggers function #3.
//
//    FIX: collection was "actions" (collectionGroup) — corrected to
//         apps/lpa/correctiveActions
//    FIX: status values were lowercase ("open","in_progress") — corrected to
//         LPA status values ("Open","Assigned","In Progress","Returned")
//    FIX: field was dueDate — corrected to targetDate
//    FIX: escalation settings path corrected to apps/lpa/settings
// ─────────────────────────────────────────────
exports.dailyEscalationCheck = functions.pubsub
  .schedule("30 2 * * *")
  .timeZone("Asia/Calcutta")
  .onRun(async () => {
    const now = new Date();

    // FIX: correct collection path + correct status values
    const actionsQ = await lpa("correctiveActions")
      .where("status", "in", ["Open", "Assigned", "In Progress", "Returned"])
      .get();

    let escalated = 0;

    for (const doc of actionsQ.docs) {
      const action = doc.data();
      // FIX: field is targetDate, not dueDate
      if (!action.targetDate) continue;

      const due  = new Date(action.targetDate);
      const days = Math.floor((now - due) / 86400000); // days overdue
      if (days <= 0) continue;

      // FIX: read thresholds from apps/lpa/settings (not root /settings)
      let thresholds = { l1: 3, l2: 7, corporate: 14 };
      try {
        const tSnap = await lpa("settings").doc("escalationThresholds").get();
        if (tSnap.exists) thresholds = { ...thresholds, ...tSnap.data() };
      } catch (_) {}

      let newLevel = null;
      if (days >= thresholds.corporate) newLevel = "corporate";
      else if (days >= thresholds.l2)   newLevel = 2;
      else if (days >= thresholds.l1)   newLevel = 1;

      if (newLevel && newLevel !== action.escalationLevel) {
        await doc.ref.update({
          escalationLevel:     newLevel,
          escalationUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        escalated++;
      }
    }

    functions.logger.info(`[LPA] Daily escalation check: ${escalated} action(s) escalated.`);
    return null;
  });

// ─────────────────────────────────────────────
// 7. CALLABLE: saveGmailConfig
//    Super admin saves Gmail settings from the UI.
//    Payload: { senderEmail, senderName, appPassword, useOAuth?,
//               clientId?, clientSecret?, refreshToken? }
//
//    FIX: user lookup was db.collection("users") (root) — corrected to
//         apps/lpa/users
// ─────────────────────────────────────────────
exports.saveGmailConfig = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Must be signed in.");
  }

  // FIX: correct user path — was db.collection("users"), must be apps/lpa/users
  const userDoc = await lpa("users").doc(context.auth.uid).get();
  if (!userDoc.exists || userDoc.data().role !== "super_admin") {
    throw new functions.https.HttpsError("permission-denied", "Only super admins can update Gmail config.");
  }

  const { senderEmail, senderName, appPassword, useOAuth,
          clientId, clientSecret, refreshToken } = data;

  if (!senderEmail) {
    throw new functions.https.HttpsError("invalid-argument", "senderEmail is required.");
  }
  if (!useOAuth && !appPassword) {
    throw new functions.https.HttpsError("invalid-argument", "appPassword is required when not using OAuth.");
  }

  const cfg = {
    senderEmail:  senderEmail.trim(),
    senderName:   (senderName || "LPA System").trim(),
    useOAuth:     Boolean(useOAuth),
    updatedAt:    admin.firestore.FieldValue.serverTimestamp(),
    updatedBy:    context.auth.uid,
  };

  if (useOAuth) {
    Object.assign(cfg, { clientId, clientSecret, refreshToken });
  } else {
    cfg.appPassword = appPassword;
  }

  // FIX: write to apps/lpa/settings/gmailConfig (was already correct here, kept as-is)
  await lpa("settings").doc("gmailConfig").set(cfg, { merge: true });

  // Bust the in-process cache
  _cachedCfg = null;

  return { success: true };
});
