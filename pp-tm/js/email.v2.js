// ─────────────────────────────────────────────────────────────
//  PTMS – Email Notification Module
//
//  Calls Firebase Cloud Function "sendPtmsEmail" which sends
//  via Gmail SMTP + 16-digit App Password (server-side only).
//  No EmailJS. No credentials in the browser.
// ─────────────────────────────────────────────────────────────

import { db, app } from "./firebase.v2.js";
import {
  doc, getDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getFunctions, httpsCallable }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";

// ── Get Firebase Functions instance (asia-south1 region) ─────
let _functions = null;
function getFns() {
  if (!_functions) {
    _functions = getFunctions(app, "asia-south1");
  }
  return _functions;
}

// ── Load email config from Firestore ─────────────────────────
let EMAIL_CONFIG = {
  onDispatch:    { to: [], cc: [] },
  onReceipt:     { to: [], cc: [] },
  onDiscrepancy: { to: [], cc: [] },
};
let configLoaded = false;

export async function loadEmailConfig() {
  try {
    const snap = await getDoc(doc(db, "settings", "emailConfig"));
    if (snap.exists()) EMAIL_CONFIG = { ...EMAIL_CONFIG, ...snap.data() };
    configLoaded = true;
  } catch (e) {
    console.warn("Could not load email config:", e.message);
  }
}

export async function saveEmailConfig(config) {
  // Ensure all fields are stored as plain arrays (never strings)
  const clean = {};
  for (const [eventKey, val] of Object.entries(config)) {
    if (val && typeof val === "object" && ("to" in val || "cc" in val)) {
      clean[eventKey] = {
        to: Array.isArray(val.to) ? val.to.filter(Boolean) : [],
        cc: Array.isArray(val.cc) ? val.cc.filter(Boolean) : [],
      };
    } else {
      clean[eventKey] = val;
    }
  }
  await setDoc(doc(db, "settings", "emailConfig"), {
    ...clean,
    updatedAt: serverTimestamp()
  });
  EMAIL_CONFIG = clean;
}

export function getEmailConfig() { return EMAIL_CONFIG; }

// ── Internal: call the Cloud Function ────────────────────────
async function callSendEmail(payload) {
  try {
    const sendEmail = httpsCallable(getFns(), "sendPtmsEmail");
    const result    = await sendEmail(payload);
    return result.data;          // { sent: true } or { sent: false, reason: "..." }
  } catch (e) {
    console.error("sendPtmsEmail error:", e);
    return { sent: false, reason: e.message || "Cloud Function error" };
  }
}

// ══════════════════════════════════════════════════════════════
//  PUBLIC: send dispatch notification
// ══════════════════════════════════════════════════════════════
export async function sendDispatchEmail(dispatch, user) {
  if (!configLoaded) await loadEmailConfig();

  return callSendEmail({
    type: "dispatch",
    dispatchData: {
      dispatchId:       dispatch.dispatchId,
      date:             dispatch.date,
      fromPlantName:    dispatch.fromPlantName,
      toPlantName:      dispatch.toPlantName,
      toPlantId:        dispatch.toPlantId,        // ← for auto plant-contact lookup
      material:         dispatch.material,
      qtyDispatched:    dispatch.qtyDispatched,
      unit:             dispatch.unit,
      boxes:            dispatch.boxes || 0,
      batch:            dispatch.batch || "",
      vehicleNo:        dispatch.vehicleNo,
      vehicleType:      dispatch.vehicleType,
      driverName:       dispatch.driverName,
      driverPhone:      dispatch.driverPhone,
      departureTime:    dispatch.departureTime,
      ewayBill:         dispatch.ewayBill || "",
      remarks:          dispatch.remarks || "",
      dispatchedByName: user.name,
      senderEmail:      user.email || "",          // ← auto-CC the dispatcher
    },
  });
}

// ══════════════════════════════════════════════════════════════
//  PUBLIC: send receipt / discrepancy notification
// ══════════════════════════════════════════════════════════════
export async function sendReceiptEmail(dispatch, receipt, user) {
  if (!configLoaded) await loadEmailConfig();

  return callSendEmail({
    type: "receipt",
    dispatchData: {
      dispatchId:    dispatch.dispatchId,
      date:          dispatch.date,
      fromPlantName: dispatch.fromPlantName,
      toPlantName:   dispatch.toPlantName,
      fromPlantId:   dispatch.fromPlantId,         // ← notify from-plant contacts
      toPlantId:     dispatch.toPlantId,           // ← notify to-plant contacts
      material:      dispatch.material,
      qtyDispatched: dispatch.qtyDispatched,
      unit:          dispatch.unit,
    },
    receiptData: {
      arrivalDate:     receipt.arrivalDate,
      arrivalTime:     receipt.arrivalTime,
      qtyReceived:     receipt.qtyReceived,
      receiptRemarks:  receipt.receiptRemarks || "",
      receivedByName:  user.name,
      receiverEmail:   user.email || "",           // ← auto-CC the receiver
    },
    // Plant notify contacts collected client-side (from both plants)
    plantNotifyEmails: receipt.plantNotifyEmails || [],
  });
}
