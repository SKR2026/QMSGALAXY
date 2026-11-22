// ─────────────────────────────────────────────────────────────
//  PTMS – Email Notification Module
//
//  Uses EmailJS (https://www.emailjs.com) which connects to
//  Gmail via your 16-digit App Password — no backend needed.
//
//  Setup:
//  1. Create free account at emailjs.com
//  2. Add Gmail service → paste your Gmail + 16-digit App Password
//  3. Create two email templates (see README for template variables)
//  4. Paste your Service ID, Template IDs, and Public Key below
// ─────────────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════
//  ⚙️  CONFIGURATION — fill these in after EmailJS setup
// ══════════════════════════════════════════════════════════════
const EMAILJS_PUBLIC_KEY      = "YOUR_EMAILJS_PUBLIC_KEY";   // from EmailJS → Account
const EMAILJS_SERVICE_ID      = "YOUR_SERVICE_ID";           // e.g. "service_abc123"
const EMAILJS_DISPATCH_TMPL   = "YOUR_DISPATCH_TEMPLATE_ID"; // e.g. "template_dispatch"
const EMAILJS_RECEIPT_TMPL    = "YOUR_RECEIPT_TEMPLATE_ID";  // e.g. "template_receipt"

// ══════════════════════════════════════════════════════════════
//  NOTIFICATION RECIPIENTS
//  Add as many emails as needed per event.
//  These are also editable by Super Admin inside Admin Panel.
//  Stored in Firestore: /settings/emailConfig
// ══════════════════════════════════════════════════════════════
let EMAIL_CONFIG = {
  // Sent when any dispatch is created
  onDispatch: {
    to: [],           // e.g. ["manager@company.com", "logistics@company.com"]
    cc: [],
  },
  // Sent when receipt is confirmed
  onReceipt: {
    to: [],
    cc: [],
  },
  // Sent specifically on discrepancy
  onDiscrepancy: {
    to: [],
    cc: [],
  }
};

// ── Load config from Firestore ────────────────────────────────
import { db } from "./firebase.js";
import {
  doc, getDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export async function loadEmailConfig() {
  try {
    const snap = await getDoc(doc(db, "settings", "emailConfig"));
    if (snap.exists()) {
      EMAIL_CONFIG = { ...EMAIL_CONFIG, ...snap.data() };
    }
  } catch (e) {
    console.warn("Could not load email config:", e.message);
  }
}

export async function saveEmailConfig(config) {
  await setDoc(doc(db, "settings", "emailConfig"), {
    ...config,
    updatedAt: serverTimestamp()
  });
  EMAIL_CONFIG = config;
}

export function getEmailConfig() { return EMAIL_CONFIG; }

// ── Initialize EmailJS ─────────────────────────────────────────
let emailJsReady = false;

async function ensureEmailJs() {
  if (emailJsReady) return true;
  if (!window.emailjs) {
    return new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js";
      s.onload = () => {
        window.emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
        emailJsReady = true;
        resolve(true);
      };
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
  }
  window.emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
  emailJsReady = true;
  return true;
}

// ── Send a single email via EmailJS ───────────────────────────
async function sendEmail(templateId, toEmails, ccEmails, params) {
  if (!toEmails || toEmails.length === 0) return { sent: false, reason: "No recipients configured" };
  if (EMAILJS_PUBLIC_KEY === "YOUR_EMAILJS_PUBLIC_KEY") {
    console.warn("EmailJS not configured — skipping email send.");
    return { sent: false, reason: "EmailJS not configured" };
  }

  const ready = await ensureEmailJs();
  if (!ready) return { sent: false, reason: "EmailJS failed to load" };

  const payload = {
    ...params,
    to_email: toEmails.join(","),
    cc_email: (ccEmails || []).join(","),
  };

  try {
    await window.emailjs.send(EMAILJS_SERVICE_ID, templateId, payload);
    return { sent: true };
  } catch (e) {
    console.error("EmailJS error:", e);
    return { sent: false, reason: e?.text || e?.message || "Unknown error" };
  }
}

// ══════════════════════════════════════════════════════════════
//  PUBLIC FUNCTIONS — called from dispatch.js & receipt.js
// ══════════════════════════════════════════════════════════════

/**
 * Send dispatch notification email.
 * Called after a new dispatch is saved to Firestore.
 *
 * @param {Object} dispatch  - The dispatch data object
 * @param {Object} user      - The logged-in user who created it
 */
export async function sendDispatchEmail(dispatch, user) {
  await loadEmailConfig();
  const cfg = EMAIL_CONFIG.onDispatch;

  const params = {
    dispatch_id:       dispatch.dispatchId,
    dispatch_date:     dispatch.date,
    from_plant:        dispatch.fromPlantName,
    to_plant:          dispatch.toPlantName,
    material:          dispatch.material,
    qty_dispatched:    `${dispatch.qtyDispatched} ${dispatch.unit}`,
    boxes:             dispatch.boxes || "—",
    batch:             dispatch.batch || "—",
    vehicle_no:        dispatch.vehicleNo,
    vehicle_type:      dispatch.vehicleType,
    driver_name:       dispatch.driverName,
    driver_phone:      dispatch.driverPhone,
    departure_time:    dispatch.departureTime,
    eway_bill:         dispatch.ewayBill || "—",
    remarks:           dispatch.remarks || "—",
    dispatched_by:     user.name,
    dispatched_by_email: user.email,
    timestamp:         new Date().toLocaleString("en-IN"),
  };

  const result = await sendEmail(
    EMAILJS_DISPATCH_TMPL,
    cfg.to,
    cfg.cc,
    params
  );

  if (result.sent) {
    console.log(`📧 Dispatch email sent for ${dispatch.dispatchId}`);
  } else {
    console.warn(`📧 Dispatch email skipped: ${result.reason}`);
  }
  return result;
}

/**
 * Send receipt confirmation email.
 * Called after receipt is confirmed in Firestore.
 *
 * @param {Object} dispatch  - Original dispatch data
 * @param {Object} receipt   - Receipt fields (arrivalDate, qtyReceived, etc.)
 * @param {Object} user      - The logged-in user who confirmed
 */
export async function sendReceiptEmail(dispatch, receipt, user) {
  await loadEmailConfig();

  const diff        = receipt.qtyReceived - dispatch.qtyDispatched;
  const isDiscrep   = Math.abs(diff) > 0.001;
  const cfg         = isDiscrep ? EMAIL_CONFIG.onDiscrepancy : EMAIL_CONFIG.onReceipt;

  // Merge recipients: receipt + discrepancy (if applicable)
  let toEmails = [...(cfg.to || [])];
  let ccEmails = [...(cfg.cc || [])];
  if (isDiscrep) {
    // Also CC normal receipt list
    ccEmails = [...new Set([...ccEmails, ...(EMAIL_CONFIG.onReceipt.to || [])])];
  }

  const params = {
    dispatch_id:       dispatch.dispatchId,
    dispatch_date:     dispatch.date,
    from_plant:        dispatch.fromPlantName,
    to_plant:          dispatch.toPlantName,
    material:          dispatch.material,
    qty_dispatched:    `${dispatch.qtyDispatched} ${dispatch.unit}`,
    qty_received:      `${receipt.qtyReceived} ${dispatch.unit}`,
    difference:        `${diff >= 0 ? "+" : ""}${diff.toFixed(3)} ${dispatch.unit}`,
    status:            isDiscrep ? "⚠️ DISCREPANCY" : "✅ OK",
    arrival_date:      receipt.arrivalDate,
    arrival_time:      receipt.arrivalTime,
    vehicle_no:        dispatch.vehicleNo,
    driver_name:       dispatch.driverName,
    receipt_remarks:   receipt.receiptRemarks || "—",
    received_by:       user.name,
    received_by_email: user.email,
    timestamp:         new Date().toLocaleString("en-IN"),
    is_discrepancy:    isDiscrep ? "YES" : "NO",
  };

  const result = await sendEmail(
    EMAILJS_RECEIPT_TMPL,
    toEmails,
    ccEmails,
    params
  );

  if (result.sent) {
    console.log(`📧 Receipt email sent for ${dispatch.dispatchId}`);
  } else {
    console.warn(`📧 Receipt email skipped: ${result.reason}`);
  }
  return result;
}
