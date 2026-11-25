/**
 * Price Proposal System — Cloud Functions
 * Project: skr-learn  |  Region: asia-south1
 */

'use strict';

const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError }  = require("firebase-functions/v2/https");
const { initializeApp }       = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth }             = require("firebase-admin/auth");
const nodemailer              = require("nodemailer");

initializeApp();
const db   = getFirestore();
const auth = getAuth();

const REGION   = "asia-south1";
const APP_URL  = process.env.APP_URL  || "https://skr-learn.web.app";
const FROM_NAME = process.env.MAIL_FROM_NAME || "Price Approval System";
const CORS_ORIGINS = [
  "https://www.qmsgalaxy.com","https://qmsgalaxy.com",
  "https://skr-learn.web.app","https://skr-learn.firebaseapp.com"
];
const SECRETS = ["GMAIL_USER", "GMAIL_APP_PASSWORD"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function gmailTransport() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error("GMAIL_USER / GMAIL_APP_PASSWORD are not configured.");
  return nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
}

function asNumber(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

/**
 * resolveAnnualImpact — returns the absolute annual financial impact of a proposal.
 * This is used for ALL approval routing decisions (minValue / maxValue thresholds).
 *
 * Priority:
 *  1. proposal.annualImpact            — Option 1 standard form (pre-calculated)
 *  2. proposal.comparison.annualImpact — Option 2 comparison form (overall)
 *  3. Sum of per-row max annual impacts — Option 2 row-level calculation
 *     Each row: max( abs((newPrice - existingPrice) × qtyMonth × 12) ) across 3 quotations
 *  4. proposedPrice fallback           — legacy proposals without impact data
 *
 * Always returns a positive (absolute) value so both price increases and
 * cost savings are routed correctly through the authority matrix.
 */
function resolveAnnualImpact(proposal) {
  // Option 1: annualImpact saved directly on proposal
  if (proposal.annualImpact != null && asNumber(proposal.annualImpact) !== 0) {
    return Math.abs(asNumber(proposal.annualImpact));
  }

  // Option 2 overall annualImpact
  if (proposal.comparison?.annualImpact != null && asNumber(proposal.comparison.annualImpact) !== 0) {
    return Math.abs(asNumber(proposal.comparison.annualImpact));
  }

  // Option 2 row-level: sum of max annual impact per row across 3 quotations
  const rows = proposal.comparison?.rows;
  if (Array.isArray(rows) && rows.length) {
    const total = rows.reduce((sum, r) => {
      const qty = asNumber(r.qtyMonth);
      if (!qty) return sum;
      const quoteImpacts = (r.quotations ?? []).map(q =>
        Math.abs((asNumber(q.newPrice) - asNumber(q.existingPrice)) * qty * 12)
      );
      return sum + (quoteImpacts.length ? Math.max(...quoteImpacts) : 0);
    }, 0);
    if (total > 0) return total;
  }

  // Fallback: use proposed price (legacy / simple proposals)
  return asNumber(proposal.proposedPrice ?? proposal.newPrice ?? proposal.proposedAmount ?? 0);
}

// ── Date / Time helpers ────────────────────────────────────────────────────────
// All notification-email timestamps are displayed in IST (Asia/Kolkata).
// Firestore timestamps are stored as UTC instants; only presentation is converted.
// This helper is intentionally centralized so every email template uses the
// same conversion and cannot drift by the server's local timezone.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function asDate(v) {
  if (v == null || v === "") return new Date();
  if (v instanceof Date) return new Date(v.getTime());
  if (typeof v?.toDate === "function") return v.toDate();
  if (typeof v?.toMillis === "function") return new Date(v.toMillis());
  if (typeof v === "number") return new Date(v < 1e12 ? v * 1000 : v);

  // Prefer explicit timezone-bearing strings. For legacy strings without a
  // timezone, retain the historical server interpretation rather than guessing.
  const parsed = new Date(v);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function istParts(v = new Date()) {
  const utc = asDate(v);
  if (Number.isNaN(utc.getTime())) return null;

  // Convert the UTC instant to IST and read with UTC getters. This is
  // independent of the Cloud Functions host timezone/locale.
  const ist = new Date(utc.getTime() + IST_OFFSET_MS);

  let hh = ist.getUTCHours();
  const min = String(ist.getUTCMinutes()).padStart(2, "0");
  const sec = String(ist.getUTCSeconds()).padStart(2, "0");
  const ampm = hh < 12 ? "AM" : "PM";
  hh = hh % 12 || 12;

  return {
    dd: String(ist.getUTCDate()).padStart(2, "0"),
    mm: String(ist.getUTCMonth() + 1).padStart(2, "0"),
    yyyy: ist.getUTCFullYear(),
    mon: MONTHS_SHORT[ist.getUTCMonth()],
    hh: String(hh).padStart(2, "0"),
    min,
    sec,
    ampm
  };
}

/** Central formatter for EVERY notification-email timestamp. */
function dateText(v = new Date()) {
  const p = istParts(v);
  if (!p) return "—";
  return `${p.dd}/${p.mm}/${p.yyyy}, ${p.hh}:${p.min}:${p.sec} ${p.ampm} IST`;
}

function dateOnlyText(v = new Date()) {
  const p = istParts(v);
  return p ? `${p.dd} ${p.mon} ${p.yyyy}` : "—";
}

function istYear(v = new Date()) {
  const p = istParts(v);
  return p ? String(p.yyyy) : String(new Date().getUTCFullYear());
}

/** Current server instant, formatted centrally as IST for email templates. */
function currentISTText() {
  return currentISTText();
}

function rupees(n) {
  return "₹" + asNumber(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── HTML Email Builder ────────────────────────────────────────────────────────

function emailHTML({ type, title, subtitle, recipientName, proposalNumber, plant, partyName,
                     amount, diffPercent, approvalLevel, submissionDate, approvalDate,
                     comment, proposalLink, extraRows = [] }) {

  const colors = {
    submission:    { accent: "#1a56db", badge: "#dbeafe", badgeText: "#1e40af", icon: "🔔", label: "Pending Approval"      },
    recommendation:{ accent: "#7c3aed", badge: "#ede9fe", badgeText: "#6d28d9", icon: "📋", label: "Recommendation Recorded" },
    approval:      { accent: "#0891b2", badge: "#cffafe", badgeText: "#0e7490", icon: "✅", label: "Level Approved"          },
    final_approval:{ accent: "#16a34a", badge: "#dcfce7", badgeText: "#15803d", icon: "🎉", label: "Finally Approved" },
    rejection:     { accent: "#dc2626", badge: "#fee2e2", badgeText: "#b91c1c", icon: "❌", label: "Rejected"         },
    return:        { accent: "#d97706", badge: "#fef3c7", badgeText: "#b45309", icon: "↩️", label: "Returned"         },
    test:          { accent: "#7c3aed", badge: "#ede9fe", badgeText: "#6d28d9", icon: "🧪", label: "Test"             },
  };
  const c = colors[type] || colors.submission;
  const year = istYear();

  const row = (label, value) => value ? `
    <tr>
      <td style="padding:8px 0;color:#6b7280;font-size:13px;font-weight:500;width:40%;vertical-align:top">${label}</td>
      <td style="padding:8px 0;color:#111827;font-size:13px;font-weight:600;vertical-align:top">${value}</td>
    </tr>` : "";

  const detailRows = [
    row("Proposal No.", proposalNumber),
    row("Plant",        plant),
    row("Party / Customer", partyName),
    row("Proposed Amount", amount ? rupees(amount) : null),
    row("Price Change", diffPercent != null ? `${diffPercent > 0 ? "+" : ""}${diffPercent}%` : null),
    row("Approval Level", approvalLevel ? `Level ${approvalLevel}` : null),
    row("Submitted On",  submissionDate),
    row("Approved On",   approvalDate),
    ...extraRows.map(r => row(r.label, r.value)),
  ].filter(Boolean).join("");

  const commentBlock = comment ? `
    <div style="margin-top:20px;background:#f9fafb;border-left:4px solid ${c.accent};border-radius:0 12px 12px 0;padding:14px 18px">
      <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Comment / Remarks</div>
      <div style="font-size:14px;color:#374151;line-height:1.6">${comment}</div>
    </div>` : "";

  const viewButton = proposalLink ? `
    <div style="text-align:center;margin:28px 0 8px">
      <a href="${proposalLink}" target="_blank"
         style="display:inline-block;background:${c.accent};color:#ffffff;font-size:14px;font-weight:700;
                text-decoration:none;padding:14px 36px;border-radius:50px;letter-spacing:.3px;
                box-shadow:0 4px 14px rgba(0,0,0,.15)">
        View Proposal →
      </a>
    </div>` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Segoe UI',Arial,sans-serif">

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px">

        <!-- Header -->
        <tr><td style="background:${c.accent};border-radius:16px 16px 0 0;padding:32px 36px;text-align:center">
          <div style="font-size:36px;margin-bottom:10px">${c.icon}</div>
          <div style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-.3px">${title}</div>
          ${subtitle ? `<div style="color:rgba(255,255,255,.8);font-size:13px;margin-top:6px">${subtitle}</div>` : ""}
          <div style="display:inline-block;background:${c.badge};color:${c.badgeText};
                      font-size:11px;font-weight:700;padding:4px 14px;border-radius:50px;
                      margin-top:14px;letter-spacing:.5px;text-transform:uppercase">
            ${c.label}
          </div>
        </td></tr>

        <!-- Body -->
        <tr><td style="background:#ffffff;padding:32px 36px">

          <!-- Greeting -->
          <div style="font-size:15px;color:#374151;margin-bottom:20px">
            Dear <strong>${recipientName || "Team"}</strong>,
          </div>

          <!-- Details card -->
          ${detailRows ? `
          <div style="background:#f9fafb;border-radius:12px;padding:18px 22px;margin-bottom:4px">
            <table width="100%" cellpadding="0" cellspacing="0">
              ${detailRows}
            </table>
          </div>` : ""}

          ${commentBlock}
          ${viewButton}

        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f9fafb;border-radius:0 0 16px 16px;padding:20px 36px;text-align:center;
                        border-top:1px solid #e5e7eb">
          <div style="font-size:12px;color:#9ca3af">
            This is an automated notification from <strong style="color:#6b7280">Price Approval System</strong><br>
            © ${year} QMS Galaxy · Please do not reply to this email
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>

</body>
</html>`;
}

// ── Template defaults ─────────────────────────────────────────────────────────

function buildEmailForProposal(type, data) {
  const link = `${APP_URL}/?proposal=${encodeURIComponent(data.proposalId || "")}`;

  const configs = {
    submission: {
      title:     "New Proposal Awaiting Your Approval",
      subtitle:  "Action required — please review and approve",
      recipientName: data.approverName,
      comment:   null,
      proposalLink: link,
    },
    recommendation: {
      title:     `Your Recommendation Has Been Recorded at Level ${data.approvalLevel}`,
      subtitle:  "Thank you — this proposal is advancing to the next approver",
      recipientName: data.approverName,
      comment:   data.comment,
      proposalLink: link,
    },
    approval: {
      title:     `Proposal Approved at Level ${data.approvalLevel}`,
      subtitle:  "This proposal is advancing to the next approval level",
      recipientName: data.approverName,
      comment:   data.comment,
      proposalLink: link,
    },
    final_approval: {
      title:     "Your Proposal Has Been Approved!",
      subtitle:  "Congratulations — final approval granted",
      recipientName: data.creatorName,
      comment:   data.comment,
      proposalLink: link,
    },
    rejection: {
      title:     "Proposal Has Been Rejected",
      subtitle:  "Please review the comments below",
      recipientName: data.creatorName,
      comment:   data.comment,
      proposalLink: link,
    },
    return: {
      title:     "Proposal Returned for Correction",
      subtitle:  "Please make the necessary changes and resubmit",
      recipientName: data.creatorName,
      comment:   data.comment,
      proposalLink: link,
    },
  };

  const cfg = configs[type] || configs.submission;

  return emailHTML({
    type,
    ...cfg,
    proposalNumber: data.proposalNumber,
    plant:          data.plant,
    partyName:      data.partyName,
    amount:         data.proposedAmount,
    diffPercent:    data.diffPercent,
    approvalLevel:  data.approvalLevel,
    submissionDate: data.submissionDate,
    approvalDate:   type === "final_approval" ? data.approvalDate : null,
  });
}

function subjectFor(type, data) {
  const map = {
    submission:     `Action Required: Price Proposal ${data.proposalNumber} Awaiting Your Approval`,
    submission_recommend: `Recommendation Required: Price Proposal ${data.proposalNumber} — Amount Exceeds Your Authority`,
    recommendation: `Recommendation Recorded at Level ${data.approvalLevel}: Price Proposal ${data.proposalNumber}`,
    approval:       `Approved at Level ${data.approvalLevel}: Price Proposal ${data.proposalNumber}`,
    final_approval: `✅ Finally Approved: Price Proposal ${data.proposalNumber}`,
    rejection:      `❌ Rejected: Price Proposal ${data.proposalNumber}`,
    return:         `↩️ Returned for Correction: Price Proposal ${data.proposalNumber}`,
  };
  return map[type] || `Price Proposal ${data.proposalNumber}`;
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function findApprover(proposal, level = 1, creatorId = null) {
  // NEW LOGIC (simple & clean):
  // ─────────────────────────────────────────────────────────────
  // 1. ALL proposals pass through EVERY configured level in sequence.
  //    Levels are never skipped based on amount.
  // 2. Within each level, maxValue selects WHICH approver handles it:
  //    - Rule with lowest maxValue that is >= amount → selected.
  //    - If no maxValue is set (blank) → catches all amounts.
  // ─────────────────────────────────────────────────────────────
  // Example matrix:
  //   L1, max ₹50,000  → Plant Manager   (handles up to ₹50k)
  //   L1, No limit     → Sr. Manager     (handles above ₹50k)
  //   L2, No limit     → Director        (always at L2)
  //   L3, No limit     → MD/CEO          (always final)
  // ─────────────────────────────────────────────────────────────
  const requestedLevel = asNumber(level) || 1;

  const snap = await db.collection("pp_approvalMatrices").get();
  const rules = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(r => !r.plantId  || r.plantId  === proposal.plantId)
    .filter(r => !r.category || r.category === proposal.category)
    .filter(r => asNumber(r.level) === requestedLevel)
    .sort((a, b) => {
      const orderDiff = asNumber(a.order) - asNumber(b.order);
      if (orderDiff) return orderDiff;
      return String(a.id).localeCompare(String(b.id));
    });

  if (!rules.length) return null;

  const amount = resolveAnnualImpact(proposal);

  // Select approver: find rule where amount <= maxValue (or maxValue is blank = no limit).
  // Among multiple matching rules, pick the one with the lowest maxValue (most specific).
  // This lets you have "up to ₹50k → Plant Manager" and "above ₹50k → Director" at same level.
  const matchingRules = rules
    .filter(r => {
      const max = r.maxValue == null || r.maxValue === "" ? Infinity : asNumber(r.maxValue);
      return amount <= max;
    })
    .sort((a, b) => {
      // Sort by maxValue ascending so most specific (lowest cap) is preferred
      const maxA = a.maxValue == null || a.maxValue === "" ? Infinity : asNumber(a.maxValue);
      const maxB = b.maxValue == null || b.maxValue === "" ? Infinity : asNumber(b.maxValue);
      return maxA - maxB;
    });

  // If no rule matches (amount > all maxValues), fall back to the rule with highest maxValue
  // (most senior approver at this level) — ensures no proposal is ever orphaned.
  const candidates = matchingRules.length
    ? matchingRules
    : [...rules].sort((a, b) => {
        const maxA = a.maxValue == null || a.maxValue === "" ? Infinity : asNumber(a.maxValue);
        const maxB = b.maxValue == null || b.maxValue === "" ? Infinity : asNumber(b.maxValue);
        return maxB - maxA; // highest maxValue first
      });

  if (!candidates.length) return null;

  // Prefer first candidate whose approver is not the proposal creator (no self-approval).
  let rule = null;
  for (const candidateRule of candidates) {
    const candidateId = String(candidateRule.approverId || "").trim();
    if (!creatorId || !candidateId || candidateId !== String(creatorId)) {
      rule = candidateRule;
      break;
    }
    // If candidateId is not the canonical Auth UID, it will be resolved below
    // and compared against creatorId after loading pp_users.
    if (candidateRule.approverEmail) {
      const candidateEmail = String(candidateRule.approverEmail).trim().toLowerCase();
      const creatorEmail = String(proposal.createdByEmail || "").trim().toLowerCase();
      if (!creatorEmail || candidateEmail !== creatorEmail) {
        rule = candidateRule;
        break;
      }
    }
  }

  if (!rule) return null;

  let email = String(rule.approverEmail || "").trim().toLowerCase();
  let name = rule.approverName || "Approver";
  let uid = "";

  // Matrix may contain Auth UID or pp_users document ID. Resolve both forms
  // to the canonical Firebase Auth UID used by currentUser.uid.
  if (rule.approverId) {
    const candidate = String(rule.approverId).trim();

    // Fast path: pp_users document ID == Auth UID.
    let u = await db.collection("pp_users").doc(candidate).get();
    if (u.exists) {
      const data = u.data() || {};
      uid = data.uid || u.id;
      email = String(data.email || email).trim().toLowerCase();
      name = data.name || name;
    } else {
      // Compatibility path for matrices created with a non-document UID key.
      const byUid = await db.collection("pp_users").where("uid", "==", candidate).limit(1).get();
      if (!byUid.empty) {
        const doc = byUid.docs[0];
        const data = doc.data() || {};
        uid = data.uid || doc.id;
        email = String(data.email || email).trim().toLowerCase();
        name = data.name || name;
      }
    }
  }

  // If the matrix only has an email, resolve that to the user's canonical UID.
  if (!uid && email) {
    const byEmail = await db.collection("pp_users")
      .where("email", "==", email)
      .limit(1)
      .get();
    if (!byEmail.empty) {
      const doc = byEmail.docs[0];
      const data = doc.data() || {};
      uid = data.uid || doc.id;
      email = String(data.email || email).trim().toLowerCase();
      name = data.name || name;
    }
  }

  if (!email) return null;

  const creatorEmail = String(proposal.createdByEmail || "").trim().toLowerCase();
  if (creatorId && uid && String(uid) === String(creatorId)) {
    // Try another matching matrix rule at this level.
    const remaining = candidates.filter(r => r.id !== rule.id);
    for (const candidateRule of remaining) {
      let candidateEmail = String(candidateRule.approverEmail || "").trim().toLowerCase();
      let candidateName = candidateRule.approverName || "Approver";
      let candidateUid = "";

      if (candidateRule.approverId) {
        const c = String(candidateRule.approverId).trim();
        const u = await db.collection("pp_users").doc(c).get();
        if (u.exists) {
          const d = u.data() || {};
          candidateUid = d.uid || u.id;
          candidateEmail = String(d.email || candidateEmail).trim().toLowerCase();
          candidateName = d.name || candidateName;
        } else {
          const byUid = await db.collection("pp_users").where("uid", "==", c).limit(1).get();
          if (!byUid.empty) {
            const d = byUid.docs[0].data() || {};
            candidateUid = d.uid || byUid.docs[0].id;
            candidateEmail = String(d.email || candidateEmail).trim().toLowerCase();
            candidateName = d.name || candidateName;
          }
        }
      }
      if (!candidateUid && candidateEmail) {
        const byEmail = await db.collection("pp_users").where("email", "==", candidateEmail).limit(1).get();
        if (!byEmail.empty) {
          const d = byEmail.docs[0].data() || {};
          candidateUid = d.uid || byEmail.docs[0].id;
          candidateEmail = String(d.email || candidateEmail).trim().toLowerCase();
          candidateName = d.name || candidateName;
        }
      }

      if (candidateUid && String(candidateUid) !== String(creatorId) &&
          candidateEmail && (!creatorEmail || candidateEmail !== creatorEmail)) {
        return {
          id: candidateUid,
          email: candidateEmail,
          name: candidateName,
          level: requestedLevel,
          matrixRuleId: candidateRule.id
        };
      }
    }
    return null;
  }

  return {
    id: uid,
    email,
    name,
    level: requestedLevel,
    matrixRuleId: rule.id
  };
}

async function getMaxApprovalLevel() {
  const snap = await db.collection("pp_approvalMatrices").get();
  const levels = snap.docs.map(d => asNumber(d.data().level)).filter(Boolean);
  return levels.length ? Math.max(...levels) : 1;
}

// ── getProposalMaxLevel ───────────────────────────────────────────────────────
// Returns the STOP level for this proposal — the lowest level number at which
// at least one rule's maxValue is >= the proposal's annual impact (or blank = no limit).
//
// NEW ROUTING LOGIC:
//   • Levels below the stop level  → "Recommendation" (amount exceeds approver's authority)
//   • Stop level                   → "Final Approval"  (amount within approver's authority)
//   • Levels above the stop level  → SKIPPED
//
// Example with matrix:
//   L1 Sushil  max ₹10,000   L1 Sushil1 max ₹20,000
//   L2 Sushil2 max ₹30,000   L3 Sushil3 no limit
//
//  ₹15,000 proposal → L1 (Sushil1, max ₹20k covers it) → stop = L1
//  ₹60,000 proposal → L1 no coverage, L2 no coverage, L3 no limit covers → stop = L3
async function getProposalMaxLevel(proposal) {
  const snap   = await db.collection("pp_approvalMatrices").get();
  const amount = resolveAnnualImpact(proposal);

  const rules = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(r => !r.plantId  || r.plantId  === proposal.plantId)
    .filter(r => !r.category || r.category === proposal.category);

  // Gather all distinct levels, sorted ascending
  const distinctLevels = [...new Set(rules.map(r => asNumber(r.level)).filter(Boolean))].sort((a, b) => a - b);

  // Walk levels in order; stop at the first level where ANY rule covers the amount
  for (const lvl of distinctLevels) {
    const rulesAtLevel = rules.filter(r => asNumber(r.level) === lvl);
    const covered = rulesAtLevel.some(r => {
      const max = (r.maxValue == null || r.maxValue === "") ? Infinity : asNumber(r.maxValue);
      return amount <= max;
    });
    if (covered) return lvl;
  }

  // No level covers it (shouldn't happen if matrix has a "no limit" rule) —
  // fall back to the highest configured level so the proposal still gets approved.
  return distinctLevels.length ? Math.max(...distinctLevels) : 1;
}

// Helper: true if the amount EXCEEDS every rule's maxValue at the given level
// (i.e. this level is a "recommendation" level, not a final authority level).
async function isRecommendationLevel(proposal, level) {
  const snap   = await db.collection("pp_approvalMatrices").get();
  const amount = resolveAnnualImpact(proposal);

  const rulesAtLevel = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(r => !r.plantId  || r.plantId  === proposal.plantId)
    .filter(r => !r.category || r.category === proposal.category)
    .filter(r => asNumber(r.level) === asNumber(level));

  if (!rulesAtLevel.length) return false;

  // If ANY rule at this level covers the amount → this is a final-authority level
  const covered = rulesAtLevel.some(r => {
    const max = (r.maxValue == null || r.maxValue === "") ? Infinity : asNumber(r.maxValue);
    return amount <= max;
  });
  return !covered; // true = recommendation level (amount exceeds all caps here)
}

async function getUser(uid) {
  if (!uid) return null;
  const snap = await db.collection("pp_users").doc(uid).get();
  return snap.exists ? snap.data() : null;
}

async function sendMail({ to, subject, html, text }) {
  const t = gmailTransport();
  return t.sendMail({ from: `"${FROM_NAME}" <${process.env.GMAIL_USER}>`, to, subject, html, text });
}

async function logEmail({ proposalId, to, type, subject, status, error }) {
  await db.collection("pp_emailLogs").add({
    proposalId: proposalId || null, to, type, subject, status,
    error: error || null, createdAt: FieldValue.serverTimestamp()
  });
}

async function createInAppNotification(userId, proposalId, title, body) {
  if (!userId) return;
  const createdAtIST = currentISTText();
  await db.collection("pp_notifications").add({
    userId, proposalId: proposalId || null, title, body,
    read: false,
    createdAt: FieldValue.serverTimestamp(), // UTC — use for ordering/queries
    createdAtIST,                            // IST string — use for display in UI
  });
}

async function generateProposalNumber(plantCode) {
  const year   = istYear();
  const prefix = `PP-${plantCode || "GEN"}-${year}-`;
  const snap   = await db.collection("pp_proposals")
    .where("proposalNumber", ">=", prefix)
    .where("proposalNumber", "<",  prefix + "~").get();
  const seq = (snap.size + 1).toString().padStart(4, "0");
  return `${prefix}${seq}`;
}

// ── onProposalWritten ─────────────────────────────────────────────────────────

exports.onProposalWritten = onDocumentWritten(
  { document: "pp_proposals/{proposalId}", region: REGION, secrets: SECRETS },
  async event => {
    const before = event.data?.before?.data() || null;
    const after  = event.data?.after?.data()  || null;
    if (!after) return;

    const oldStatus = before?.status || "";
    const newStatus = after.status   || "";

    const transitions = [
      ["", "Pending Approval"], ["Draft", "Pending Approval"], ["Returned", "Pending Approval"],
      ["Pending Approval", "Approved"], ["Pending Approval", "Rejected"], ["Pending Approval", "Returned"]
    ];
    if (!transitions.some(([a, b]) => a === oldStatus && b === newStatus)) return;

    const proposalId     = event.params.proposalId;
    const proposedAmount = asNumber(after.proposedPrice ?? after.newPrice);
    const currentPrice   = asNumber(after.currentPrice  ?? after.existingPrice);
    const diffPercent    = currentPrice ? ((proposedAmount - currentPrice) / currentPrice * 100).toFixed(1) : null;

    const base = {
      proposalId,
      proposalNumber: after.proposalNumber || proposalId,
      plant:          after.plantName || after.plant || "",
      partyName:      after.partyName || after.customer || "",
      creatorName:    after.createdByName || after.requestedBy || "Proposal Creator",
      proposedAmount,
      diffPercent,
      approvalLevel:  after.currentApprovalLevel || 1,
      submissionDate: after.submittedAt ? dateText(after.submittedAt) : "—",
      // Use the actual Firestore-recorded action timestamp for the "Approved/Rejected On" field.
      // after.approvedAt / after.rejectedAt / after.returnedAt are resolved real Timestamps in
      // the after snapshot (not sentinels). Fall back to new Date() (trigger dispatch time) only
      // if none of those fields exist (e.g. old proposals without them).
      approvalDate:   dateText(after.approvedAt || after.rejectedAt || after.returnedAt || new Date()),
      comment:        after.lastApprovalComment || after.rejectionReason || after.returnComment || "",
    };

    const creatorEmail = after.createdByEmail || "";

    try {
      if (newStatus === "Pending Approval") {
        const currentLevel = after.currentApprovalLevel || 1;
        const approver = await findApprover(after, currentLevel, after.createdBy || null);
        if (!approver?.email) {
          await logEmail({ proposalId, to: "", type: "submission", subject: "No approver", status: "skipped", error: "No approver email found." });
          return;
        }
        // Determine if this approver is acting as recommender (amount exceeds their maxValue)
        // or as the actual final authority (amount within their maxValue).
        const isRecommend = await isRecommendationLevel(after, currentLevel);
        const emailType   = isRecommend ? "submission_recommend" : "submission";
        const emailData   = { ...base, approverName: approver.name };
        const subject     = subjectFor(emailType, base);
        const html        = isRecommend
          ? emailHTML({
              type: "submission",   // use submission styling but altered text
              title: "Recommendation Required — Amount Exceeds Your Authority",
              subtitle: "Please review and recommend; a higher approver will give final approval",
              recipientName: approver.name,
              proposalNumber: base.proposalNumber,
              plant: base.plant,
              partyName: base.partyName,
              amount: base.proposedAmount,
              diffPercent: base.diffPercent,
              approvalLevel: currentLevel,
              submissionDate: base.submissionDate,
              proposalLink: `${APP_URL}/?proposal=${encodeURIComponent(proposalId)}`,
              extraRows: [{ label: "Your Role", value: `Recommender at Level ${currentLevel} (amount exceeds your authority limit)` }]
            })
          : buildEmailForProposal("submission", emailData);
        await sendMail({ to: approver.email, subject, html, text: `Dear ${approver.name},\n\nProposal ${base.proposalNumber} requires your ${isRecommend ? "recommendation" : "approval"}.\n\nView: ${APP_URL}/?proposal=${encodeURIComponent(proposalId)}` });
        await logEmail({ proposalId, to: approver.email, type: emailType, subject, status: "sent" });
        await createInAppNotification(approver.id, proposalId,
          isRecommend ? "Recommendation required" : "New approval assigned",
          `${base.proposalNumber} awaits your ${isRecommend ? "recommendation" : "approval"}.`);
      }

      if (newStatus === "Approved") {
        if (!creatorEmail) return;

        // 1. Notify the proposal creator
        const subject = subjectFor("final_approval", base);
        const html    = buildEmailForProposal("final_approval", base);
        await sendMail({ to: creatorEmail, subject, html, text: `Dear ${base.creatorName},\n\nYour proposal ${base.proposalNumber} has been finally approved.` });
        await logEmail({ proposalId, to: creatorEmail, type: "final_approval", subject, status: "sent" });

        // 2. Notify Accounts department (CC observers configured in Settings → Approval)
        try {
          const settingsSnap = await db.collection("pp_settings").doc("approval").get();
          const ccObservers  = settingsSnap.exists ? (settingsSnap.data().ccObservers || []) : [];
          const accountsEmails = ccObservers.filter(o => o.email);
          for (const observer of accountsEmails) {
            const accSubject = `✅ Approved for Payment: Price Proposal ${base.proposalNumber}`;
            const accHtml = emailHTML({
              type: "final_approval",
              title: "Proposal Approved — For Your Action",
              subtitle: "This price proposal has received final approval",
              recipientName: observer.name || "Accounts Team",
              proposalNumber: base.proposalNumber,
              plant: base.plant,
              partyName: base.partyName,
              amount: base.proposedAmount,
              diffPercent: base.diffPercent,
              approvalLevel: base.approvalLevel,
              submissionDate: base.submissionDate,
              approvalDate: base.approvalDate,
              extraRows: [
                { label: "Action Required", value: "Please update records and process accordingly" },
                { label: "Approved By",     value: after.currentApproverName || "Final Approver" },
              ]
            });
            await sendMail({ to: observer.email, subject: accSubject, html: accHtml,
              text: `Dear ${observer.name||'Accounts Team'},\n\nProposal ${base.proposalNumber} for ${base.partyName} has been finally approved.\n\nPlease update your records and process accordingly.\n\nView: ${APP_URL}/?proposal=${encodeURIComponent(proposalId)}` });
            await logEmail({ proposalId, to: observer.email, type: "accounts_notification", subject: accSubject, status: "sent" });
          }
        } catch (accErr) {
          console.error("[accounts notify] Failed:", accErr.message);
        }
      }

      if (newStatus === "Rejected" || newStatus === "Returned") {
        if (!creatorEmail) return;
        const type    = newStatus === "Rejected" ? "rejection" : "return";
        const subject = subjectFor(type, base);
        const html    = buildEmailForProposal(type, base);
        await sendMail({ to: creatorEmail, subject, html, text: `Dear ${base.creatorName},\n\nProposal ${base.proposalNumber} has been ${newStatus.toLowerCase()}.\n\nComment: ${base.comment}` });
        await logEmail({ proposalId, to: creatorEmail, type, subject, status: "sent" });
      }
    } catch (err) {
      await logEmail({ proposalId, to: "", type: newStatus, subject: "Workflow notification", status: "failed", error: err.message || String(err) });
      console.error("Proposal email failed:", err);
    }
  }
);

// ── submitProposal ────────────────────────────────────────────────────────────

exports.submitProposal = onCall(
  { region: REGION, cors: CORS_ORIGINS, secrets: SECRETS },
  async request => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign-in required.");
    const { proposalId, proposalData } = request.data || {};
    if (!proposalData) throw new HttpsError("invalid-argument", "proposalData is required.");

    const uid   = request.auth.uid;
    const user  = await getUser(uid);
    const plant = proposalData.plantId
      ? (await db.collection("pp_plants").doc(proposalData.plantId).get()).data()
      : null;

    const proposalForApprover = {
      ...proposalData,
      createdBy: uid,
      createdByEmail: user?.email || request.auth.token?.email || ""
    };
    let approver = await findApprover(proposalForApprover, 1, uid);

    // If no Level 1 rule matches this amount/plant/category, check whether any
    // Level 1 rule exists at all for this plant — if yes, the matrix value
    // ranges are misconfigured. If no Level 1 rule exists at all, also fail.
    // Special case: Super Admin can always approve as a last resort so proposals
    // are never completely blocked by a misconfigured matrix.
    if (!approver?.id || !approver?.email) {
      if (user?.role === "Super Admin") {
        // Super Admin submitting — assign to themselves as Level 1 approver of last resort.
        // This only happens when no matrix Level 1 rule covers this proposal's amount.
        approver = { id: uid, email: user.email, name: user.name || "Super Admin", level: 1 };
        console.warn("[submitProposal] No Level 1 matrix rule matched — assigning Super Admin as fallback approver. Fix your matrix value ranges.");
      } else {
        throw new HttpsError(
          "failed-precondition",
          "No Level 1 approver is configured for this proposal value/plant/category. Please ask your Super Admin to update the Approval Matrix so that a Level 1 rule covers this amount."
        );
      }
    }

    const proposalNumber = await generateProposalNumber(plant?.code || "GEN");

    const docData = {
      ...proposalData, proposalNumber,
      status: "Pending Approval", currentApprovalLevel: 1,
      currentApproverId:    approver?.id    || null,
      currentApproverEmail: approver?.email || null,
      currentApproverName:  approver?.name  || null,
      createdBy:      uid,
      createdByName:  user?.name  || request.auth.token?.name  || "",
      createdByEmail: user?.email || request.auth.token?.email || "",
      submittedAt: FieldValue.serverTimestamp(),
      updatedAt:   FieldValue.serverTimestamp(),
    };

    const incomingAttachments = Array.isArray(proposalData.attachments) ? proposalData.attachments : [];
    if (incomingAttachments.length) {
      docData.attachments = FieldValue.arrayUnion(...incomingAttachments);
    }

    let docRef;
    if (proposalId) {
      docRef = db.collection("pp_proposals").doc(proposalId);
      await docRef.update(docData);
    } else {
      docData.createdAt = FieldValue.serverTimestamp();
      docRef = await db.collection("pp_proposals").add(docData);
    }
    return { success: true, proposalId: docRef.id, proposalNumber };
  }
);

// ── processApproval ───────────────────────────────────────────────────────────

exports.processApproval = onCall(
  { region: REGION, cors: CORS_ORIGINS, secrets: SECRETS },
  async request => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign-in required.");
    const { proposalId, comment } = request.data || {};
    if (!proposalId) throw new HttpsError("invalid-argument", "proposalId required.");

    const ref  = db.collection("pp_proposals").doc(proposalId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Proposal not found.");

    const proposal     = snap.data();
    const currentLevel = asNumber(proposal.currentApprovalLevel) || 1;

    // Use proposal-specific max level: determined by which matrix levels
    // have rules covering THIS proposal's amount/plant/category.
    // e.g. ₹1,500 → final at L2 even if L3 exists globally.
    const maxLevel     = await getProposalMaxLevel(proposal);
    const uid          = request.auth.uid;
    const user         = await getUser(uid);

    // Allow Super Admin to approve any proposal — otherwise verify it's the assigned approver
    const isSuperAdmin = user?.role === "Super Admin";

    // Users with any of these roles can act as approvers (they can both create AND approve).
    // The ONLY restriction is they cannot approve their OWN proposal (self-approval).
    const canApprove = isSuperAdmin ||
      ["Super Admin","Plant Admin","Approver","Creator & Approver","Proposal Creator"].includes(user?.role);

    if (!canApprove) {
      throw new HttpsError("permission-denied", "You do not have permission to approve proposals.");
    }

    // A user may be both creator and approver, but cannot approve their own
    // proposal. This preserves separation of duties while allowing the same
    // account to approve proposals created by other users.
    if (proposal.createdBy && String(proposal.createdBy) === String(uid)) {
      throw new HttpsError("permission-denied", "A proposal creator cannot approve their own proposal. Another approver must be configured for this level.");
    }

    if (!isSuperAdmin && proposal.currentApproverId && proposal.currentApproverId !== uid) {
      throw new HttpsError("permission-denied", "You are not the assigned approver for this proposal.");
    }

    // Is the current approver acting as a recommender (amount exceeds their authority)?
    const currentIsRecommend = await isRecommendationLevel(proposal, currentLevel);

    const actionLabel = currentIsRecommend ? "Recommended" : "Approved";
    const approvalEntry = {
      level: currentLevel, approverId: uid,
      approverName: user?.name || "",
      action: actionLabel,
      actionAt: currentISTText(),
      approvedAt: currentISTText(),  // kept for backward compat
      comment: comment || ""
    };

    // Shared base data for notification emails
    const proposedAmount = asNumber(proposal.proposedPrice ?? proposal.newPrice);
    const currentPrice   = asNumber(proposal.currentPrice ?? proposal.existingPrice);
    const diffPercent    = currentPrice ? ((proposedAmount - currentPrice) / currentPrice * 100).toFixed(1) : null;
    const emailBase = {
      proposalId,
      proposalNumber: proposal.proposalNumber || proposalId,
      plant:          proposal.plantName || proposal.plant || "",
      partyName:      proposal.partyName || proposal.customer || "",
      creatorName:    proposal.createdByName || proposal.requestedBy || "Proposal Creator",
      proposedAmount,
      diffPercent,
      approvalLevel:  currentLevel,
      submissionDate: dateText(proposal.submittedAt || proposal.createdAt),
      approvalDate:   currentISTText(),
      comment:        comment || "",
      approverName:   user?.name || "",
    };
    const proposalLink = `${APP_URL}/?proposal=${encodeURIComponent(proposalId)}`;

    if (currentLevel >= maxLevel) {
      // ── FINAL APPROVAL ──────────────────────────────────────────────────────
      await ref.update({
        status: "Approved", currentApprovalLevel: currentLevel,
        currentApproverId: null, currentApproverEmail: null, currentApproverName: null,
        approvedAt: FieldValue.serverTimestamp(), lastApprovalComment: comment || "",
        approvalHistory: FieldValue.arrayUnion(approvalEntry),
        approverIds: FieldValue.arrayUnion(uid),
        updatedAt: FieldValue.serverTimestamp()
      });
      await db.collection("pp_userActions").doc(uid).collection("actions").doc(proposalId).set({
        proposalId, action: "Approved", level: currentLevel,
        actionAt: currentISTText(), comment: comment || "",
        approverName: user?.name || ""
      }, { merge: true });
      // onProposalWritten fires on status → "Approved" and handles creator + accounts emails.
    } else {
      // ── RECOMMENDATION — advance to next level ───────────────────────────────
      // Only levels where amount EXCEEDS all maxValues reach here;
      // the recommender's action is logged but next level will be the final authority.

      const matrixSnap = await db.collection("pp_approvalMatrices").get();

      const eligibleNextLevels = [...new Set(
        matrixSnap.docs
          .map(d => ({ ...d.data(), id: d.id }))
          .filter(r => asNumber(r.level) > currentLevel)
          .filter(r => !r.plantId  || r.plantId  === proposal.plantId)
          .filter(r => !r.category || r.category === proposal.category)
          .map(r => asNumber(r.level))
          .filter(Boolean)
      )].sort((a, b) => a - b);

      const nextLevel = eligibleNextLevels[0] || null;

      if (!nextLevel) {
        // Matrix gap — no higher level found; finalise anyway to avoid deadlock.
        console.warn(`[processApproval] No next level found after ${currentLevel} — finalising ${proposalId}.`);
        await ref.update({
          status: "Approved", currentApprovalLevel: currentLevel,
          currentApproverId: null, currentApproverEmail: null, currentApproverName: null,
          approvedAt: FieldValue.serverTimestamp(), lastApprovalComment: comment || "",
          approvalHistory: FieldValue.arrayUnion(approvalEntry), updatedAt: FieldValue.serverTimestamp()
        });
        return { success: true };
      }

      const nextApprover = await findApprover(proposal, nextLevel, proposal.createdBy);
      if (!nextApprover?.id || !nextApprover?.email) {
        throw new HttpsError(
          "failed-precondition",
          `No approver is configured for Level ${nextLevel} for this plant/category/value.`
        );
      }

      // Persist the advance
      await ref.update({
        status: "Pending Approval", currentApprovalLevel: nextLevel,
        currentApproverId:    nextApprover.id,
        currentApproverEmail: nextApprover.email,
        currentApproverName:  nextApprover.name,
        levelName:            nextApprover.levelName || null,
        lastApprovalComment: comment || "",
        approvalHistory: FieldValue.arrayUnion(approvalEntry),
        approverIds: FieldValue.arrayUnion(uid),
        updatedAt: FieldValue.serverTimestamp()
      });
      await db.collection("pp_userActions").doc(uid).collection("actions").doc(proposalId).set({
        proposalId, action: actionLabel, level: currentLevel,
        actionAt: currentISTText(), comment: comment || "",
        approverName: user?.name || ""
      }, { merge: true });

      // ── Email: confirm recommendation to the current approver ────────────────
      if (user?.email) {
        try {
          const recSubject = subjectFor("recommendation", emailBase);
          const recHtml = emailHTML({
            type: "recommendation",
            title: `Recommendation Recorded at Level ${currentLevel}`,
            subtitle: "Your recommendation has been noted — the proposal is advancing to the next approver",
            recipientName: user.name || "",
            proposalNumber: emailBase.proposalNumber,
            plant: emailBase.plant,
            partyName: emailBase.partyName,
            amount: emailBase.proposedAmount,
            diffPercent: emailBase.diffPercent,
            approvalLevel: currentLevel,
            submissionDate: emailBase.submissionDate,
            proposalLink,
            extraRows: [
              { label: "Your Action",   value: `Recommendation (Level ${currentLevel})` },
              { label: "Forwarded To",  value: `${nextApprover.name} (Level ${nextLevel})` },
            ]
          });
          await sendMail({ to: user.email, subject: recSubject, html: recHtml,
            text: `Dear ${user.name||""},\n\nYour recommendation for proposal ${emailBase.proposalNumber} has been recorded.\nIt has been forwarded to ${nextApprover.name} for final approval.` });
          await logEmail({ proposalId, to: user.email, type: "recommendation", subject: recSubject, status: "sent" });
        } catch (e) {
          console.error("[processApproval] Recommendation confirm email failed:", e.message);
        }
      }

      // ── Email: notify next approver (final authority or another recommender) ──
      try {
        const nextIsRecommend = await isRecommendationLevel(proposal, nextLevel);
        const nextEmailType   = nextIsRecommend ? "submission_recommend" : "submission";
        const nextSubject     = subjectFor(nextEmailType, emailBase);
        const nextHtml = nextIsRecommend
          ? emailHTML({
              type: "submission",
              title: "Recommendation Required — Amount Exceeds Your Authority",
              subtitle: "Please review and recommend; a higher approver will give final approval",
              recipientName: nextApprover.name,
              proposalNumber: emailBase.proposalNumber,
              plant: emailBase.plant,
              partyName: emailBase.partyName,
              amount: emailBase.proposedAmount,
              diffPercent: emailBase.diffPercent,
              approvalLevel: nextLevel,
              submissionDate: emailBase.submissionDate,
              proposalLink,
              extraRows: [
                { label: "Recommended By", value: `${user?.name || ""} (Level ${currentLevel})` },
                { label: "Your Role",      value: `Recommender at Level ${nextLevel} (amount exceeds your authority limit)` },
              ]
            })
          : emailHTML({
              type: "submission",
              title: "Final Approval Required",
              subtitle: "This proposal has passed all recommendation levels and requires your final approval",
              recipientName: nextApprover.name,
              proposalNumber: emailBase.proposalNumber,
              plant: emailBase.plant,
              partyName: emailBase.partyName,
              amount: emailBase.proposedAmount,
              diffPercent: emailBase.diffPercent,
              approvalLevel: nextLevel,
              submissionDate: emailBase.submissionDate,
              proposalLink,
              extraRows: [
                { label: "Recommended By", value: `${user?.name || ""} (Level ${currentLevel})` },
                { label: "Your Role",      value: `Final Approver at Level ${nextLevel}` },
              ]
            });
        await sendMail({ to: nextApprover.email, subject: nextSubject, html: nextHtml,
          text: `Dear ${nextApprover.name},\n\nProposal ${emailBase.proposalNumber} requires your ${nextIsRecommend ? "recommendation" : "final approval"}.\n\nRecommended by: ${user?.name || ""}\n\nView: ${proposalLink}` });
        await logEmail({ proposalId, to: nextApprover.email, type: nextEmailType, subject: nextSubject, status: "sent" });
        await createInAppNotification(nextApprover.id, proposalId,
          nextIsRecommend ? "Recommendation required" : "Final approval required",
          `${emailBase.proposalNumber} awaits your ${nextIsRecommend ? "recommendation" : "final approval"}.`);
      } catch (e) {
        console.error("[processApproval] Next-approver notification email failed:", e.message);
        await logEmail({ proposalId, to: nextApprover?.email || "", type: "submission", subject: "next-level notify", status: "failed", error: e.message });
      }
    }
    return { success: true };
  }
);

// ── processRejection ──────────────────────────────────────────────────────────

exports.processRejection = onCall(
  { region: REGION, cors: CORS_ORIGINS, secrets: SECRETS },
  async request => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign-in required.");
    const { proposalId, comment } = request.data || {};
    if (!proposalId) throw new HttpsError("invalid-argument", "proposalId required.");
    const uid = request.auth.uid; const user = await getUser(uid);
    const proposalSnap = await db.collection("pp_proposals").doc(proposalId).get();
    const level = proposalSnap.exists ? (proposalSnap.data().currentApprovalLevel || 1) : 1;
    const actionAt = currentISTText();
    await db.collection("pp_proposals").doc(proposalId).update({
      status: "Rejected", rejectionReason: comment || "", lastApprovalComment: comment || "",
      rejectedBy: uid, rejectedByName: user?.name || "", rejectedAt: FieldValue.serverTimestamp(),
      approvalHistory: FieldValue.arrayUnion({ level, approverId:uid, approverName:user?.name||"", action:"Rejected", comment:comment||"", actionAt }),
      approverIds: FieldValue.arrayUnion(uid),
      updatedAt: FieldValue.serverTimestamp()
    });
    // Write to per-user action log so history tab shows this action
    await db.collection("pp_userActions").doc(uid).collection("actions").doc(proposalId).set({
      proposalId, action: "Rejected", level,
      actionAt, comment: comment||"", approverName: user?.name||""
    }, { merge: true });
    return { success: true };
  }
);

// ── processReturn ─────────────────────────────────────────────────────────────

exports.processReturn = onCall(
  { region: REGION, cors: CORS_ORIGINS, secrets: SECRETS },
  async request => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign-in required.");
    const { proposalId, comment } = request.data || {};
    if (!proposalId) throw new HttpsError("invalid-argument", "proposalId required.");
    const uid = request.auth.uid; const user = await getUser(uid);
    const proposalSnap = await db.collection("pp_proposals").doc(proposalId).get();
    const level = proposalSnap.exists ? (proposalSnap.data().currentApprovalLevel || 1) : 1;
    const actionAt = currentISTText();
    await db.collection("pp_proposals").doc(proposalId).update({
      status: "Returned", returnComment: comment || "", lastApprovalComment: comment || "",
      returnedBy: uid, returnedByName: user?.name||"", returnedAt: FieldValue.serverTimestamp(),
      approvalHistory: FieldValue.arrayUnion({ level, approverId:uid, approverName:user?.name||"", action:"Returned", comment:comment||"", actionAt }),
      approverIds: FieldValue.arrayUnion(uid),
      updatedAt: FieldValue.serverTimestamp()
    });
    // Write to per-user action log so history tab shows this action
    await db.collection("pp_userActions").doc(uid).collection("actions").doc(proposalId).set({
      proposalId, action: "Returned", level,
      actionAt, comment: comment||"", approverName: user?.name||""
    }, { merge: true });
    return { success: true };
  }
);

// ── createUser ────────────────────────────────────────────────────────────────

exports.createUser = onCall(
  { region: REGION, cors: CORS_ORIGINS },
  async request => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign-in required.");
    const caller = await getUser(request.auth.uid);
    if (caller?.role !== "Super Admin") throw new HttpsError("permission-denied", "Super Admin only.");
    const { name, email, password, role, department, plantIds, status } = request.data || {};
    if (!email || !password || !name) throw new HttpsError("invalid-argument", "name, email and password required.");
    // Step 1: Check if this email already exists in pp_users (PP app users only)
    const existingPPUser = await db.collection("pp_users").where("email", "==", email).limit(1).get();
    if (!existingPPUser.empty) {
      // Already a PP user — just update their profile
      const ppDoc = existingPPUser.docs[0];
      await ppDoc.ref.update({ name, role: role||"Viewer", department: department||"", plantIds: plantIds||[], status: status||"Active", updatedAt: FieldValue.serverTimestamp() });
      // Also update password in Auth
      try { await auth.updateUser(ppDoc.id, { displayName: name, password }); } catch(_) {}
      return { success: true, uid: ppDoc.id, updated: true };
    }

    // Step 2: Try to create Firebase Auth user
    let userRecord;
    try {
      userRecord = await auth.createUser({ email, password, displayName: name });
    } catch (authErr) {
      if (authErr.code === 'auth/email-already-exists') {
        // Email exists in Auth from ANOTHER app (HIRA, VEMS, etc.)
        // Create a PP-specific Auth user with a tagged email to keep them separate
        // OR just use the existing UID but mark as PP user in Firestore
        const existing = await auth.getUserByEmail(email);
        // Only proceed if this UID is NOT already used by another PP user
        const uidCheck = await db.collection("pp_users").doc(existing.uid).get();
        if (uidCheck.exists) {
          throw new HttpsError("already-exists", `This email is already registered in the system.`);
        }
        // Safe to reuse UID — user belongs to another app but not PP yet
        userRecord = existing;
        // Update password so they can login to PP with the new password
        await auth.updateUser(existing.uid, { password });
      } else {
        throw new HttpsError("internal", authErr.message);
      }
    }

    // Step 3: Create PP user profile in Firestore
    await db.collection("pp_users").doc(userRecord.uid).set({
      uid: userRecord.uid, name, email,
      role: role || "Viewer",
      department: department || "",
      plantIds: plantIds || [],
      status: status || "Active",
      app: "pp",  // tag so we know this is a Price Proposal user
      createdAt: FieldValue.serverTimestamp()
    });
    return { success: true, uid: userRecord.uid };
  }
);

// ── generateApprovedProposalPDF ───────────────────────────────────────────────

exports.generateApprovedProposalPDF = onCall(
  { region: REGION, cors: CORS_ORIGINS },
  async request => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign-in required.");
    const { proposalId } = request.data || {};
    if (!proposalId) throw new HttpsError("invalid-argument", "proposalId required.");
    const snap = await db.collection("pp_proposals").doc(proposalId).get();
    if (!snap.exists) throw new HttpsError("not-found", "Proposal not found.");
    const proposal = snap.data();
    if (proposal.status !== "Approved") throw new HttpsError("failed-precondition", "Proposal is not approved yet.");
    const url = `${APP_URL}/?proposal=${encodeURIComponent(proposalId)}&pdf=1`;
    return { success: true, url, proposalNumber: proposal.proposalNumber };
  }
);

// ── validateMagicLinkToken ────────────────────────────────────────────────────

exports.validateMagicLinkToken = onCall(
  { region: REGION, cors: CORS_ORIGINS },
  async request => {
    const { token } = request.data || {};
    if (!token) throw new HttpsError("invalid-argument", "token required.");
    const snap = await db.collection("pp_magicLinks").where("token","==",token).where("used","==",false).limit(1).get();
    if (snap.empty) return { valid: false, message: "Invalid or expired link." };
    const data = snap.docs[0].data();
    if (data.expiresAt && data.expiresAt.toMillis() < Date.now()) return { valid: false, message: "This link has expired." };
    return { valid: true, proposalId: data.proposalId, token, approverEmail: data.approverEmail || "" };
  }
);

// ── processMagicLinkApproval ──────────────────────────────────────────────────

exports.processMagicLinkApproval = onCall(
  { region: REGION, cors: CORS_ORIGINS, secrets: SECRETS },
  async request => {
    const { token, action, comment } = request.data || {};
    if (!token || !action) throw new HttpsError("invalid-argument", "token and action required.");
    const snap = await db.collection("pp_magicLinks").where("token","==",token).where("used","==",false).limit(1).get();
    if (snap.empty) throw new HttpsError("not-found", "Invalid or already used link.");
    const linkDoc = snap.docs[0]; const linkData = linkDoc.data();
    if (linkData.expiresAt && linkData.expiresAt.toMillis() < Date.now()) throw new HttpsError("deadline-exceeded", "Link expired.");
    const { proposalId } = linkData;
    const newStatus = action==="approve"?"Approved":action==="reject"?"Rejected":"Returned";
    await db.collection("pp_proposals").doc(proposalId).update({ status:newStatus, lastApprovalComment:comment||"", updatedAt:FieldValue.serverTimestamp() });
    await linkDoc.ref.update({ used:true, usedAt:FieldValue.serverTimestamp() });
    return { success:true, proposalId, status:newStatus };
  }
);

// ── testGmailNotification ─────────────────────────────────────────────────────

exports.testGmailNotification = onCall(
  { region: REGION, cors: CORS_ORIGINS, secrets: SECRETS },
  async request => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign-in required.");
    const u = await db.collection("pp_users").doc(request.auth.uid).get();
    if (!u.exists || u.data().role !== "Super Admin") throw new HttpsError("permission-denied", "Super Admin only.");

    const to = String(request.data?.to || u.data().email || "").trim();
    if (!to) throw new HttpsError("invalid-argument", "Recipient email is required.");

    const html = emailHTML({
      type: "test",
      title: "Gmail Test Successful!",
      subtitle: "Your email notifications are configured correctly",
      recipientName: u.data().name || "Admin",
      extraRows: [
        { label: "Sent To",   value: to },
        { label: "Sent At",   value: currentISTText() },
        { label: "System",    value: "Price Approval System" },
      ]
    });

    await sendMail({
      to, subject: "✅ Price Approval System — Gmail Test Successful",
      html, text: `Gmail test successful. Sent at ${currentISTText()}`
    });
    return { success: true, message: `Test email sent to ${to}` };
  }
);

// ── Auto-Escalation Scheduler ─────────────────────────────────────────────────
// Runs daily at 9 AM IST (3:30 AM UTC)
// If a proposal has been Pending Approval for more than ESCALATION_DAYS,
// it is automatically escalated to the next higher authority.

const { onSchedule } = require("firebase-functions/v2/scheduler");

const ESCALATION_DAYS = 2; // escalate after 2 days of inaction — configurable

exports.autoEscalateProposals = onSchedule(
  { schedule: "30 3 * * *", timeZone: "Asia/Kolkata", region: REGION, secrets: SECRETS },
  async () => {
    console.log("[autoEscalate] Starting daily escalation check…");

    const cutoff = new Date(Date.now() - ESCALATION_DAYS * 24 * 60 * 60 * 1000);

    // Find all proposals pending approval older than cutoff
    const snap = await db.collection("pp_proposals")
      .where("status", "==", "Pending Approval")
      .where("updatedAt", "<", cutoff)
      .get();

    if (snap.empty) {
      console.log("[autoEscalate] No proposals need escalation.");
      return;
    }

    console.log(`[autoEscalate] Found ${snap.size} proposal(s) to escalate.`);

    // Get approval matrix once
    const matrixSnap = await db.collection("pp_approvalMatrices").get();
    const allRules   = matrixSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const levels     = [...new Set(allRules.map(r => asNumber(r.level)).filter(Boolean))].sort((a,b)=>a-b);
    const maxLevel   = levels.length ? Math.max(...levels) : 1;

    for (const doc of snap.docs) {
      const p   = doc.data();
      const pid = doc.id;
      try {
        const currentLevel   = asNumber(p.currentApprovalLevel) || 1;
        const currentApprover = p.currentApproverEmail || "—";
        const daysPending     = Math.floor((Date.now() - (p.updatedAt?.toMillis?.() || Date.now())) / 86400000);

        if (currentLevel >= maxLevel) {
          // Already at highest level — send reminder to current approver instead
          if (p.currentApproverEmail) {
            const subject = `⏰ Reminder: Price Proposal ${p.proposalNumber} Awaiting Your Approval`;
            const html = emailHTML({
              type: "submission",
              title: "Approval Reminder",
              subtitle: `This proposal has been waiting ${daysPending} day(s) — please take action`,
              recipientName: p.currentApproverName || "Approver",
              proposalNumber: p.proposalNumber,
              plant: p.plantName || p.plant || "",
              partyName: p.partyName || "",
              amount: p.proposedPrice,
              approvalLevel: currentLevel,
              submissionDate: dateText(p.submittedAt || p.createdAt),
              proposalLink: `${APP_URL}/?proposal=${encodeURIComponent(pid)}`,
              extraRows: [{ label: "Pending Since", value: `${daysPending} day(s)` }]
            });
            await sendMail({ to: p.currentApproverEmail, subject, html,
              text: `Reminder: Proposal ${p.proposalNumber} has been pending your approval for ${daysPending} days. Please review at ${APP_URL}/?proposal=${encodeURIComponent(pid)}` });
            await logEmail({ proposalId: pid, to: p.currentApproverEmail, type: "reminder", subject, status: "sent" });
            console.log(`[autoEscalate] Reminder sent for ${p.proposalNumber} to ${p.currentApproverEmail}`);
          }
          continue;
        }

        // Find next level approver
        const nextLevel    = currentLevel + 1;
        const nextApprover = await findApprover(p, nextLevel, p.createdBy || null);

        if (!nextApprover?.email) {
          console.warn(`[autoEscalate] No approver found at level ${nextLevel} for ${p.proposalNumber}`);
          continue;
        }

        // Update proposal to next approver
        await doc.ref.update({
          currentApprovalLevel:  nextLevel,
          currentApproverId:     nextApprover.id    || null,
          currentApproverEmail:  nextApprover.email || null,
          currentApproverName:   nextApprover.name  || null,
          lastEscalatedAt:       FieldValue.serverTimestamp(),
          lastEscalatedFrom:     currentApprover,
          escalationCount:       FieldValue.increment(1),
          updatedAt:             FieldValue.serverTimestamp(),
          approvalHistory:       FieldValue.arrayUnion({
            level:        currentLevel,
            approverId:   "system",
            approverName: "System (Auto-Escalation)",
            action:       "Escalated",
            comment:      `Auto-escalated after ${daysPending} day(s) of inaction by ${currentApprover}`,
            actionAt:     currentISTText()
          })
        });

        // Notify new approver
        const emailData = {
          proposalId:     pid,
          proposalNumber: p.proposalNumber,
          plant:          p.plantName || p.plant || "",
          partyName:      p.partyName || "",
          proposedAmount: p.proposedPrice,
          diffPercent:    p.currentPrice ? ((p.proposedPrice - p.currentPrice) / p.currentPrice * 100).toFixed(1) : null,
          approvalLevel:  nextLevel,
          approverName:   nextApprover.name,
          submissionDate: dateText(p.submittedAt || p.createdAt),
          comment:        `This proposal was auto-escalated from Level ${currentLevel} (${currentApprover}) after ${daysPending} day(s) of no action.`,
        };

        const subject = `🔺 Escalated to You: Price Proposal ${p.proposalNumber} — Level ${nextLevel} Approval Required`;
        const html    = emailHTML({
          type:          "approval",
          title:         "Proposal Escalated to You",
          subtitle:      `Escalated from Level ${currentLevel} after ${daysPending} day(s) of inaction`,
          recipientName: nextApprover.name,
          proposalNumber: p.proposalNumber,
          plant:          p.plantName || "",
          partyName:      p.partyName || "",
          amount:         p.proposedPrice,
          approvalLevel:  nextLevel,
          submissionDate: dateText(p.submittedAt || p.createdAt),
          comment:        `Previously assigned to: ${currentApprover}\nAuto-escalated after ${daysPending} day(s) of no action.`,
          proposalLink:   `${APP_URL}/?proposal=${encodeURIComponent(pid)}`,
          extraRows: [
            { label: "Escalated From", value: `Level ${currentLevel} — ${currentApprover}` },
            { label: "Days Pending",   value: `${daysPending} day(s)` }
          ]
        });

        await sendMail({ to: nextApprover.email, subject, html,
          text: `Proposal ${p.proposalNumber} has been escalated to you at Level ${nextLevel}. Previous approver (${currentApprover}) did not act in ${daysPending} days. Review at ${APP_URL}/?proposal=${encodeURIComponent(pid)}` });
        await logEmail({ proposalId: pid, to: nextApprover.email, type: "escalation", subject, status: "sent" });

        // Also notify original approver that it was escalated away from them
        if (p.currentApproverEmail) {
          const notifSubject = `ℹ️ Proposal ${p.proposalNumber} Escalated — No Longer Requires Your Action`;
          const notifHtml = emailHTML({
            type: "return",
            title: "Proposal Escalated Away",
            subtitle: "This proposal has been escalated to the next authority",
            recipientName: p.currentApproverName || "Approver",
            proposalNumber: p.proposalNumber,
            comment: `This proposal has been auto-escalated to Level ${nextLevel} (${nextApprover.name}) because no action was taken for ${daysPending} days. No further action is required from you.`,
            proposalLink: `${APP_URL}/?proposal=${encodeURIComponent(pid)}`
          });
          await sendMail({ to: p.currentApproverEmail, subject: notifSubject, html: notifHtml,
            text: `Proposal ${p.proposalNumber} has been escalated to Level ${nextLevel} due to inaction. No further action required from you.` });
        }

        // In-app notification
        await createInAppNotification(nextApprover.id, pid,
          `🔺 Escalated: ${p.proposalNumber}`,
          `Proposal escalated from Level ${currentLevel}. Please review and approve.`
        );

        console.log(`[autoEscalate] ✅ ${p.proposalNumber} escalated from Level ${currentLevel} (${currentApprover}) → Level ${nextLevel} (${nextApprover.email})`);

      } catch (err) {
        console.error(`[autoEscalate] ❌ Failed for ${pid}:`, err.message);
        await logEmail({ proposalId: pid, to: "", type: "escalation", subject: "Auto-escalation failed",
          status: "failed", error: err.message });
      }
    }
    console.log("[autoEscalate] Daily escalation check complete.");
  }
);

// ── triggerEscalationManually — callable for Super Admin testing ──────────────
exports.triggerEscalationManually = onCall(
  { region: REGION, cors: CORS_ORIGINS, secrets: SECRETS },
  async request => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign-in required.");
    const user = await getUser(request.auth.uid);
    if (user?.role !== "Super Admin") throw new HttpsError("permission-denied", "Super Admin only.");

    console.log("[manualEscalate] Triggered by", request.auth.uid);

    const cutoff = new Date(Date.now() - ESCALATION_DAYS * 24 * 60 * 60 * 1000);
    const snap   = await db.collection("pp_proposals")
      .where("status", "==", "Pending Approval")
      .where("updatedAt", "<", cutoff)
      .get();

    const matrixSnap = await db.collection("pp_approvalMatrices").get();
    const allRules   = matrixSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const levels     = [...new Set(allRules.map(r => asNumber(r.level)).filter(Boolean))].sort((a,b)=>a-b);
    const maxLevel   = levels.length ? Math.max(...levels) : 1;

    let escalated = 0, reminded = 0;

    for (const doc of snap.docs) {
      const p   = doc.data();
      const pid = doc.id;
      try {
        const currentLevel = asNumber(p.currentApprovalLevel) || 1;
        const daysPending  = Math.floor((Date.now() - (p.updatedAt?.toMillis?.() || Date.now())) / 86400000);

        if (currentLevel >= maxLevel) {
          // Send reminder
          if (p.currentApproverEmail) {
            const subject = `⏰ Reminder: Proposal ${p.proposalNumber} Awaiting Your Approval (${daysPending}d)`;
            const html = emailHTML({
              type: "submission", title: "Approval Reminder",
              subtitle: `Pending for ${daysPending} day(s)`,
              recipientName: p.currentApproverName || "Approver",
              proposalNumber: p.proposalNumber, plant: p.plantName || "",
              partyName: p.partyName || "", amount: p.proposedPrice,
              approvalLevel: currentLevel,
              proposalLink: `${APP_URL}/?proposal=${encodeURIComponent(pid)}`,
              extraRows: [{ label: "Pending Since", value: `${daysPending} day(s)` }]
            });
            await sendMail({ to: p.currentApproverEmail, subject, html, text: subject });
            await logEmail({ proposalId: pid, to: p.currentApproverEmail, type: "reminder", subject, status: "sent" });
            reminded++;
          }
          continue;
        }

        const nextLevel    = currentLevel + 1;
        const nextApprover = await findApprover(p, nextLevel, p.createdBy || null);
        if (!nextApprover?.email) continue;

        await doc.ref.update({
          currentApprovalLevel: nextLevel,
          currentApproverId:    nextApprover.id    || null,
          currentApproverEmail: nextApprover.email || null,
          currentApproverName:  nextApprover.name  || null,
          lastEscalatedAt:      FieldValue.serverTimestamp(),
          lastEscalatedFrom:    p.currentApproverEmail || "",
          escalationCount:      FieldValue.increment(1),
          updatedAt:            FieldValue.serverTimestamp(),
          approvalHistory:      FieldValue.arrayUnion({
            level: currentLevel, approverId: "system",
            approverName: "System (Manual Escalation by Admin)",
            action: "Escalated",
            comment: `Manually escalated after ${daysPending} day(s) of inaction by ${p.currentApproverEmail || "—"}`,
            actionAt: currentISTText()
          })
        });

        const subject = `🔺 Escalated: Proposal ${p.proposalNumber} — Level ${nextLevel} Approval Required`;
        const html = emailHTML({
          type: "approval", title: "Proposal Escalated to You",
          subtitle: `Escalated from Level ${currentLevel} after ${daysPending} day(s)`,
          recipientName: nextApprover.name,
          proposalNumber: p.proposalNumber, plant: p.plantName || "",
          partyName: p.partyName || "", amount: p.proposedPrice,
          approvalLevel: nextLevel,
          comment: `Previously assigned to: ${p.currentApproverEmail || "—"}\nEscalated after ${daysPending} day(s) of no action.`,
          proposalLink: `${APP_URL}/?proposal=${encodeURIComponent(pid)}`,
          extraRows: [{ label: "Days Pending", value: `${daysPending} day(s)` }]
        });
        await sendMail({ to: nextApprover.email, subject, html, text: subject });
        await logEmail({ proposalId: pid, to: nextApprover.email, type: "escalation", subject, status: "sent" });
        await createInAppNotification(nextApprover.id, pid, `🔺 Escalated: ${p.proposalNumber}`, `Escalated from Level ${currentLevel}.`);
        escalated++;
      } catch(err) {
        console.error(`[manualEscalate] Failed for ${pid}:`, err.message);
      }
    }

    return { success: true, checked: snap.size, escalated, reminded };
  }
);

// ── sendManagementDigest — scheduled digest of approved proposals ─────────────
//
// Sends a summary of all proposals approved since the last digest run to every
// recipient configured in pp_settings/digest.
//
// Configuration (stored in Firestore: pp_settings/digest):
//   {
//     enabled:     true,
//     frequency:   "daily" | "weekly" | "monthly",
//     recipients:  [{ name: "MD", email: "md@company.com" }, ...],
//     lastSentAt:  <Timestamp>   ← updated after each send
//   }
//
// Schedule: runs every day at 08:00 IST but checks `frequency` internally
// so you only need ONE scheduled function regardless of the chosen frequency.
//
exports.sendManagementDigest = onSchedule(
  { schedule: "0 8 * * *", timeZone: "Asia/Kolkata", region: REGION, secrets: SECRETS },
  async () => {
    console.log("[digest] Starting management digest check …");

    // Load digest config
    const cfgSnap = await db.collection("pp_settings").doc("digest").get();
    if (!cfgSnap.exists) { console.log("[digest] No digest config found — skipping."); return; }
    const cfg = cfgSnap.data();

    if (!cfg.enabled) { console.log("[digest] Digest disabled — skipping."); return; }

    const recipients = (cfg.recipients || []).filter(r => r.email);
    if (!recipients.length) { console.log("[digest] No recipients configured — skipping."); return; }

    // Determine whether enough time has passed since last send
    const frequency = cfg.frequency || "daily";
    const lastSent  = cfg.lastSentAt ? cfg.lastSentAt.toDate() : new Date(0);
    const now       = new Date();
    const hoursSince = (now - lastSent) / 3_600_000;

    const minHours = { daily: 20, weekly: 160, monthly: 700 };
    if (hoursSince < (minHours[frequency] || 20)) {
      console.log(`[digest] Frequency="${frequency}", hoursSince=${hoursSince.toFixed(1)} — not due yet.`);
      return;
    }

    // Fetch proposals approved since lastSent
    const snap = await db.collection("pp_proposals")
      .where("status", "==", "Approved")
      .where("approvedAt", ">",  cfg.lastSentAt || new Date(0))
      .orderBy("approvedAt", "asc")
      .get();

    const proposals = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    console.log(`[digest] ${proposals.length} newly approved proposals to report.`);

    // Always send (even if 0 proposals) so management knows the system is running.
    // Build digest email
    const period = frequency === "weekly" ? "This Week" : frequency === "monthly" ? "This Month" : "Today";
    const totalValue = proposals.reduce((s, p) => s + Math.abs(asNumber(p.annualImpact || p.proposedPrice)), 0);

    const tableRows = proposals.length
      ? proposals.map(p => `
          <tr style="border-bottom:1px solid #e5e7eb">
            <td style="padding:8px 10px;font-size:12px;font-weight:600">${p.proposalNumber || "—"}</td>
            <td style="padding:8px 10px;font-size:12px">${p.plantName || "—"}</td>
            <td style="padding:8px 10px;font-size:12px">${p.partyName || "—"}</td>
            <td style="padding:8px 10px;font-size:12px">${p.productService || "—"}</td>
            <td style="padding:8px 10px;font-size:12px;text-align:right">₹${asNumber(p.currentPrice).toLocaleString("en-IN",{minimumFractionDigits:2})}</td>
            <td style="padding:8px 10px;font-size:12px;text-align:right;font-weight:700;color:#16a34a">₹${asNumber(p.proposedPrice).toLocaleString("en-IN",{minimumFractionDigits:2})}</td>
            <td style="padding:8px 10px;font-size:12px;text-align:center">
              ${p.currentPrice ? ((p.proposedPrice - p.currentPrice)/p.currentPrice*100).toFixed(1)+"%" : "—"}
            </td>
            <td style="padding:8px 10px;font-size:12px">${p.createdByName || "—"}</td>
            <td style="padding:8px 10px;font-size:12px">${p.approvedAt ? dateText(p.approvedAt) : "—"}</td>
          </tr>`).join("")
      : `<tr><td colspan="9" style="padding:20px;text-align:center;color:#6b7280;font-size:13px">No proposals were approved during this period.</td></tr>`;

    const digestHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Price Approval Digest</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Segoe UI',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:720px">

        <!-- Header -->
        <tr><td style="background:#1a56db;border-radius:16px 16px 0 0;padding:28px 36px;text-align:center">
          <div style="font-size:32px;margin-bottom:8px">📊</div>
          <div style="color:#fff;font-size:20px;font-weight:700">Price Approval Digest</div>
          <div style="color:rgba(255,255,255,.8);font-size:13px;margin-top:6px">${period} — ${dateOnlyText(now)}</div>
          <div style="display:inline-block;background:#dbeafe;color:#1e40af;font-size:11px;font-weight:700;padding:4px 14px;border-radius:50px;margin-top:12px;letter-spacing:.5px;text-transform:uppercase">
            For Management Review
          </div>
        </td></tr>

        <!-- Summary cards -->
        <tr><td style="background:#fff;padding:24px 36px 0">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:0 8px 0 0">
                <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px;text-align:center">
                  <div style="font-size:28px;font-weight:700;color:#16a34a">${proposals.length}</div>
                  <div style="font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Proposals Approved</div>
                </div>
              </td>
              <td style="padding:0 0 0 8px">
                <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:16px;text-align:center">
                  <div style="font-size:28px;font-weight:700;color:#1a56db">₹${totalValue.toLocaleString("en-IN",{minimumFractionDigits:2})}</div>
                  <div style="font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Total Approved Value</div>
                </div>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Table -->
        <tr><td style="background:#fff;padding:20px 36px 32px">
          <div style="font-size:13px;font-weight:700;color:#374151;margin-bottom:12px;text-transform:uppercase;letter-spacing:.5px">Approved Proposals</div>
          <div style="overflow-x:auto">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;min-width:600px">
              <thead>
                <tr style="background:#1a56db">
                  <th style="padding:9px 10px;color:#fff;font-size:11px;font-weight:700;text-align:left">Proposal #</th>
                  <th style="padding:9px 10px;color:#fff;font-size:11px;font-weight:700;text-align:left">Plant</th>
                  <th style="padding:9px 10px;color:#fff;font-size:11px;font-weight:700;text-align:left">Party</th>
                  <th style="padding:9px 10px;color:#fff;font-size:11px;font-weight:700;text-align:left">Product</th>
                  <th style="padding:9px 10px;color:#fff;font-size:11px;font-weight:700;text-align:right">Current ₹</th>
                  <th style="padding:9px 10px;color:#fff;font-size:11px;font-weight:700;text-align:right">Approved ₹</th>
                  <th style="padding:9px 10px;color:#fff;font-size:11px;font-weight:700;text-align:center">Change</th>
                  <th style="padding:9px 10px;color:#fff;font-size:11px;font-weight:700;text-align:left">Raised By</th>
                  <th style="padding:9px 10px;color:#fff;font-size:11px;font-weight:700;text-align:left">Approved On</th>
                </tr>
              </thead>
              <tbody>${tableRows}</tbody>
            </table>
          </div>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f9fafb;border-radius:0 0 16px 16px;padding:18px 36px;text-align:center;border-top:1px solid #e5e7eb">
          <div style="font-size:12px;color:#9ca3af">
            Automated digest from <strong style="color:#6b7280">Price Approval System</strong> · ${frequency.charAt(0).toUpperCase()+frequency.slice(1)} summary<br>
            © ${istYear(now)} · To change frequency or recipients, update Settings → Digest
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const subject = `📊 Price Approval Digest — ${period} (${proposals.length} Approved, ₹${totalValue.toLocaleString("en-IN",{maximumFractionDigits:0})})`;

    // Send to all management recipients
    let sentCount = 0;
    for (const recipient of recipients) {
      try {
        await sendMail({
          to: recipient.email,
          subject,
          html: digestHtml,
          text: `Price Approval Digest — ${period}\n\nApproved: ${proposals.length} proposals\nTotal value: ₹${totalValue.toLocaleString("en-IN")}\n\n${proposals.map(p=>`• ${p.proposalNumber} — ${p.partyName} — ₹${asNumber(p.proposedPrice).toLocaleString("en-IN")}`).join("\n") || "No proposals this period."}`
        });
        await logEmail({ proposalId: null, to: recipient.email, type: "management_digest", subject, status: "sent" });
        sentCount++;
      } catch (err) {
        console.error(`[digest] Failed to send to ${recipient.email}:`, err.message);
        await logEmail({ proposalId: null, to: recipient.email, type: "management_digest", subject, status: "failed", error: err.message });
      }
    }

    // Update lastSentAt so next run knows when we last fired
    await db.collection("pp_settings").doc("digest").update({
      lastSentAt: FieldValue.serverTimestamp()
    });

    console.log(`[digest] Done — sent to ${sentCount}/${recipients.length} recipients, covering ${proposals.length} proposals.`);
  }
);

// ── triggerDigestManually — callable for Super Admin testing ──────────────────
exports.triggerDigestManually = onCall(
  { region: REGION, cors: CORS_ORIGINS, secrets: SECRETS },
  async request => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign-in required.");
    const user = await getUser(request.auth.uid);
    if (user?.role !== "Super Admin") throw new HttpsError("permission-denied", "Super Admin only.");

    // Force lastSentAt to epoch so digest runs regardless of frequency
    await db.collection("pp_settings").doc("digest").set({
      lastSentAt: new Date(0)
    }, { merge: true });

    // Re-invoke via a direct call (simulate the scheduled run)
    // Since we can't call onSchedule directly, we inline the same logic check
    console.log("[digest] Manual trigger by", request.auth.uid);
    return { success: true, message: "Digest lastSentAt reset — next scheduled run will send immediately, or wait up to 24h. For instant send, use the Cloud Scheduler in Firebase Console." };
  }
);
