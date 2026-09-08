import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as nodemailer from 'nodemailer';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import * as Handlebars from 'handlebars';

admin.initializeApp();
const db      = admin.firestore();
const storage = admin.storage();
const auth    = admin.auth();

// ─── EMAIL TRANSPORT ────────────────────────────────────────────────────────
function getTransporter() {
  const cfg = functions.config();
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: cfg.gmail?.user || process.env.GMAIL_USER,
      pass: cfg.gmail?.pass || process.env.GMAIL_PASS,
    },
  });
}

// ─── MAGIC LINK SECRET ──────────────────────────────────────────────────────
function getMagicSecret(): string {
  return functions.config().magic?.secret || process.env.MAGIC_SECRET || 'change-me-in-production';
}

function signToken(token: string): string {
  return crypto.createHmac('sha256', getMagicSecret()).update(token).digest('hex');
}

function verifyTokenSignature(token: string, sig: string): boolean {
  const expected = signToken(token);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

// ─── HELPERS ────────────────────────────────────────────────────────────────
async function getSettings(doc: string = 'app'): Promise<any> {
  const snap = await db.collection('settings').doc(doc).get();
  return snap.exists ? snap.data() : {};
}

async function getEmailTemplate(type: string): Promise<{ subject: string; body: string }> {
  const snap = await db.collection('emailTemplates').doc(type).get();
  if (snap.exists) return snap.data() as any;
  return getDefaultTemplate(type);
}

function getDefaultTemplate(type: string): { subject: string; body: string } {
  const APP_URL = functions.config().app?.url || 'https://your-app.web.app';
  const map: Record<string, { subject: string; body: string }> = {
    submission: {
      subject: 'New Proposal Pending Your Approval: {{proposalNumber}}',
      body: `Dear {{approverName}},\n\nA new price proposal requires your approval.\n\nProposal: {{proposalNumber}}\nPlant: {{plant}}\nParty: {{partyName}}\nProposed: ₹{{proposedAmount}}\nChange: {{diffPercent}}%\n\nSign in to approve:\n${APP_URL}\n\nOr use your one-click magic link (valid 48h):\n{{magicLinkUrl}}\n\nRegards,\nPrice Proposal System`,
    },
    approval: {
      subject: 'Proposal Approved at Level {{approvalLevel}}: {{proposalNumber}}',
      body: `Dear {{approverName}},\n\nProposal {{proposalNumber}} has been approved at Level {{approvalLevel}}.\n\nPlant: {{plant}}\nProposed: ₹{{proposedAmount}}\n\nIt now requires your review.\n\nOne-click approval:\n{{magicLinkUrl}}\n\nOr sign in:\n${APP_URL}\n\nRegards,\nPrice Proposal System`,
    },
    final_approval: {
      subject: 'APPROVED: Price Proposal {{proposalNumber}}',
      body: `Dear {{creatorName}},\n\nYour price proposal {{proposalNumber}} has been FINALLY APPROVED.\n\nPlant: {{plant}}\nParty: {{partyName}}\nProposed Price: ₹{{proposedAmount}}\nApproved: {{approvalDate}}\n\nDownload PDF:\n${APP_URL}\n\nRegards,\nPrice Proposal System`,
    },
    rejection: {
      subject: 'REJECTED: Price Proposal {{proposalNumber}}',
      body: `Dear {{creatorName}},\n\nYour price proposal {{proposalNumber}} has been REJECTED.\n\nReason: {{comment}}\nRejected By: {{approverName}}\nDate: {{approvalDate}}\n\nView details:\n${APP_URL}\n\nRegards,\nPrice Proposal System`,
    },
    return: {
      subject: 'Return for Correction: {{proposalNumber}}',
      body: `Dear {{creatorName}},\n\nYour price proposal {{proposalNumber}} has been returned for correction.\n\nCorrection Required: {{comment}}\nReturned By: {{approverName}}\n\nPlease update and resubmit:\n${APP_URL}\n\nRegards,\nPrice Proposal System`,
    },
    reminder: {
      subject: 'Reminder: Proposal {{proposalNumber}} Awaiting Your Approval',
      body: `Dear {{approverName}},\n\nThis is reminder #{{reminderNumber}} that proposal {{proposalNumber}} is awaiting your approval for {{pendingHours}} hours.\n\nOne-click approval:\n{{magicLinkUrl}}\n\nOr sign in:\n${APP_URL}\n\nRegards,\nPrice Proposal System`,
    },
    escalation: {
      subject: 'ESCALATION: Overdue Approval — {{proposalNumber}}',
      body: `Dear {{supervisorName}},\n\nProposal {{proposalNumber}} is OVERDUE — pending for {{pendingHours}} hours with {{approverName}}.\n\nPlant: {{plant}}\nProposed: ₹{{proposedAmount}}\n\nPlease review:\n${APP_URL}\n\nRegards,\nPrice Proposal System`,
    },
  };
  return map[type] || { subject: '{{proposalNumber}}', body: '' };
}

function renderTemplate(tmpl: string, vars: Record<string, any>): string {
  return Handlebars.compile(tmpl)(vars);
}

async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  const settings   = await getSettings('app');
  const transporter= getTransporter();
  await transporter.sendMail({
    from: `"${settings.companyName || 'Price Proposal System'}" <${functions.config().gmail?.user || ''}>`,
    to,
    subject,
    text,
    html: text.replace(/\n/g, '<br>'),
  });
}

// ─── GENERATE PROPOSAL NUMBER ────────────────────────────────────────────────
async function generateProposalNumber(plantId: string): Promise<string> {
  const numSettings = await getSettings('numbering');
  const format      = numSettings.format || 'PP-{YEAR}-{SEQ6}';
  const year        = new Date().getFullYear().toString();
  const month       = String(new Date().getMonth() + 1).padStart(2, '0');

  const plantSnap = await db.collection('plants').doc(plantId).get();
  const plantCode = plantSnap.exists ? (plantSnap.data()!.code || 'PLT') : 'PLT';
  const counterKey= `${year}`;

  // Atomic counter via Firestore transaction
  const counterRef= db.collection('counters').doc('proposals');
  let seq = 0;
  await db.runTransaction(async tx => {
    const snap = await tx.get(counterRef);
    const data  = snap.exists ? snap.data()! : {};
    seq = (data[counterKey] || 0) + 1;
    tx.set(counterRef, { [counterKey]: seq }, { merge: true });
  });

  const seqStr = String(seq);
  return format
    .replace('{YEAR}',  year)
    .replace('{MONTH}', month)
    .replace('{PLANT}', plantCode)
    .replace('{SEQ6}',  seqStr.padStart(6, '0'))
    .replace('{SEQ4}',  seqStr.padStart(4, '0'));
}

// ─── CREATE MAGIC LINK TOKEN ─────────────────────────────────────────────────
async function createMagicLinkToken(
  proposalId: string,
  approverId: string,
  approverEmail: string,
  level: number
): Promise<string> {
  const APP_URL = functions.config().app?.url || 'https://your-app.web.app';
  const rawToken= uuidv4();
  const sig     = signToken(rawToken);
  const composite = `${rawToken}.${sig}`;

  await db.collection('magicLinkTokens').doc(composite).set({
    proposalId,
    approverId,
    approverEmail,
    level,
    createdAt:  admin.firestore.FieldValue.serverTimestamp(),
    expiresAt:  admin.firestore.Timestamp.fromDate(new Date(Date.now() + 48 * 3600 * 1000)),
    used:       false,
    usedAt:     null,
  });

  return `${APP_URL}/?magic=${encodeURIComponent(composite)}`;
}

// ─── WRITE AUDIT LOG ─────────────────────────────────────────────────────────
async function writeAudit(
  userId: string,
  userName: string,
  userEmail: string,
  userRole: string,
  proposalId: string | null,
  proposalNumber: string | null,
  action: string,
  details: string
): Promise<void> {
  await db.collection('auditLogs').add({
    userId, userName, userEmail, userRole,
    proposalId, proposalNumber, action, details,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });
}

// ─── WRITE IN-APP NOTIFICATION ───────────────────────────────────────────────
async function writeNotification(
  userId: string,
  title: string,
  body: string,
  proposalId: string
): Promise<void> {
  await db.collection('notifications').add({
    userId, title, body, proposalId,
    read: false, readAt: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

// ─── DETERMINE APPROVAL ROUTE ────────────────────────────────────────────────
async function determineApprovalRoute(
  plantId: string,
  category: string,
  proposedPrice: number,
  diffPercent: number
): Promise<any[]> {
  const snap = await db.collection('approvalMatrices')
    .orderBy('order')
    .get();

  const rules = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

  // Filter matching rules
  const matching = rules.filter((r: any) => {
    if (r.plantId && r.plantId !== plantId) return false;
    if (r.category && r.category !== category) return false;
    if (r.minValue && proposedPrice < r.minValue) return false;
    if (r.maxValue && proposedPrice > r.maxValue) return false;
    if (r.maxPctChange && Math.abs(diffPercent) > r.maxPctChange) return false;
    return true;
  });

  // Sort by level
  return matching.sort((a: any, b: any) => a.level - b.level);
}

// ═══════════════════════════════════════════════════════════════════════════
//  CALLABLE: submitProposal
// ═══════════════════════════════════════════════════════════════════════════
export const submitProposal = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in.');

  const { proposalId, proposalData } = data;
  const uid = context.auth.uid;

  // Load user profile
  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) throw new functions.https.HttpsError('not-found', 'User not found.');
  const user = userSnap.data()!;

  if (!['Proposal Creator', 'Plant Admin', 'Super Admin'].includes(user.role)) {
    throw new functions.https.HttpsError('permission-denied', 'Insufficient role to create proposals.');
  }

  // Validate required fields
  const { plantId, partyName, productService, description, currentPrice, proposedPrice } = proposalData;
  if (!plantId || !partyName || !description || !currentPrice || !proposedPrice) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing required proposal fields.');
  }

  // Verify plant access
  if (user.role !== 'Super Admin' && !user.plantIds?.includes(plantId)) {
    throw new functions.https.HttpsError('permission-denied', 'No access to this plant.');
  }

  // Get plant info
  const plantSnap = await db.collection('plants').doc(plantId).get();
  if (!plantSnap.exists) throw new functions.https.HttpsError('not-found', 'Plant not found.');
  const plant = plantSnap.data()!;

  const diff       = proposedPrice - currentPrice;
  const diffPercent= currentPrice ? (diff / currentPrice * 100) : 0;

  // Determine approval route
  const route = await determineApprovalRoute(plantId, proposalData.category, proposedPrice, diffPercent);
  if (!route.length) {
    throw new functions.https.HttpsError('failed-precondition', 'No approval rules configured. Please contact the administrator.');
  }

  // Generate proposal number
  const proposalNumber = await generateProposalNumber(plantId);

  // Prepare first approver
  const firstLevel   = route[0];
  const approverSnap = await db.collection('users').doc(firstLevel.approverId).get();
  const approver     = approverSnap.exists ? approverSnap.data()! : { name: firstLevel.approverName, email: firstLevel.approverEmail };

  const now = admin.firestore.FieldValue.serverTimestamp();

  // Build final proposal data
  const finalData: any = {
    ...proposalData,
    proposalNumber,
    plantName:           plant.name,
    createdBy:           uid,
    createdByName:       user.name,
    createdByEmail:      user.email,
    difference:          diff,
    diffPercent,
    status:              'Pending Approval',
    currentApprovalLevel:firstLevel.level,
    currentApproverId:   firstLevel.approverId,
    currentApproverEmail:approver.email,
    levelName:           firstLevel.levelName,
    approvalRoute:       route.map((r: any) => ({
      level: r.level, levelName: r.levelName,
      approverId: r.approverId, approverName: r.approverName, approverEmail: r.approverEmail,
    })),
    submittedAt:  now,
    updatedAt:    now,
  };

  let pid = proposalId;
  if (pid) {
    // Editing an existing draft/returned
    const existing = await db.collection('proposals').doc(pid).get();
    if (!existing.exists) throw new functions.https.HttpsError('not-found', 'Proposal not found.');
    if (existing.data()!.createdBy !== uid) throw new functions.https.HttpsError('permission-denied', 'Not your proposal.');
    if (!['Draft', 'Returned'].includes(existing.data()!.status)) {
      throw new functions.https.HttpsError('failed-precondition', 'Cannot resubmit a proposal in current status.');
    }
    await db.collection('proposals').doc(pid).update(finalData);
  } else {
    finalData.createdAt = now;
    finalData.approvals = [];
    const ref = await db.collection('proposals').add(finalData);
    pid = ref.id;
  }

  // Write submission history entry
  await db.collection('proposals').doc(pid).collection('approvalHistory').add({
    level:         0,
    approverId:    uid,
    approverName:  user.name,
    approverEmail: user.email,
    action:        'Submitted',
    comment:       '',
    timestamp:     now,
  });

  // Audit log
  await writeAudit(uid, user.name, user.email, user.role, pid, proposalNumber, 'Submitted', `Submitted proposal for approval. Route: ${route.length} level(s).`);

  // In-app notification to first approver
  await writeNotification(firstLevel.approverId, `New Approval Request: ${proposalNumber}`, `${user.name} submitted a proposal for ₹${proposedPrice.toLocaleString('en-IN')} — ${partyName}`, pid);

  // Generate magic link for first approver
  const magicLinkUrl = await createMagicLinkToken(pid, firstLevel.approverId, approver.email, firstLevel.level);

  // Send email
  try {
    const tmpl = await getEmailTemplate('submission');
    const vars = {
      proposalNumber, plant: plant.name, partyName,
      proposedAmount: proposedPrice.toLocaleString('en-IN'),
      diffPercent: diffPercent.toFixed(2),
      approverName: approver.name || approver.email,
      creatorName: user.name,
      approvalLevel: firstLevel.level,
      magicLinkUrl,
      submissionDate: new Date().toLocaleDateString('en-IN'),
      applicationLink: functions.config().app?.url || 'https://your-app.web.app',
    };
    await sendEmail(approver.email, renderTemplate(tmpl.subject, vars), renderTemplate(tmpl.body, vars));
  } catch (emailErr) {
    console.error('[submitProposal] Email failed:', emailErr);
  }

  return { success: true, proposalId: pid, proposalNumber };
});

// ═══════════════════════════════════════════════════════════════════════════
//  CALLABLE: processApproval
// ═══════════════════════════════════════════════════════════════════════════
export const processApproval = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in.');

  const { proposalId, comment } = data;
  const uid = context.auth.uid;

  const [propSnap, userSnap] = await Promise.all([
    db.collection('proposals').doc(proposalId).get(),
    db.collection('users').doc(uid).get(),
  ]);

  if (!propSnap.exists) throw new functions.https.HttpsError('not-found', 'Proposal not found.');
  if (!userSnap.exists) throw new functions.https.HttpsError('not-found', 'User not found.');

  const proposal = propSnap.data()!;
  const user     = userSnap.data()!;

  // Server-side authorization check
  if (proposal.currentApproverId !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'You are not the designated approver for this proposal.');
  }
  if (proposal.status !== 'Pending Approval') {
    throw new functions.https.HttpsError('failed-precondition', `Proposal status is "${proposal.status}" — cannot approve.`);
  }

  const now    = admin.firestore.FieldValue.serverTimestamp();
  const nowTs  = new Date();
  const route: any[] = proposal.approvalRoute || [];
  const currentIdx   = route.findIndex((r: any) => r.level === proposal.currentApprovalLevel);
  const nextLevel    = route[currentIdx + 1];
  const isFinal      = !nextLevel;

  // Write approval history (immutable — client cannot write this)
  await db.collection('proposals').doc(proposalId).collection('approvalHistory').add({
    level:         proposal.currentApprovalLevel,
    approverId:    uid,
    approverName:  user.name,
    approverEmail: user.email,
    role:          user.role,
    action:        'Approved',
    comment:       comment || '',
    timestamp:     now,
  });

  if (isFinal) {
    // Final approval
    await db.collection('proposals').doc(proposalId).update({
      status:              'Approved',
      approvedAt:          now,
      finalApprovedBy:     uid,
      finalApprovedByName: user.name,
      finalApprovedByEmail:user.email,
      updatedAt:           now,
    });

    // Notify creator
    const tmpl = await getEmailTemplate('final_approval');
    const vars = {
      proposalNumber: proposal.proposalNumber,
      plant:          proposal.plantName,
      partyName:      proposal.partyName,
      creatorName:    proposal.createdByName,
      proposedAmount: proposal.proposedPrice?.toLocaleString('en-IN'),
      approvalDate:   nowTs.toLocaleString('en-IN'),
      approverName:   user.name,
      applicationLink:functions.config().app?.url || 'https://your-app.web.app',
    };
    await writeNotification(proposal.createdBy, `✅ Approved: ${proposal.proposalNumber}`, `Your proposal has been finally approved by ${user.name}`, proposalId);
    try { await sendEmail(proposal.createdByEmail, renderTemplate(tmpl.subject, vars), renderTemplate(tmpl.body, vars)); } catch(e) { console.error('[email final]',e); }

    await writeAudit(uid, user.name, user.email, user.role, proposalId, proposal.proposalNumber, 'Approved', `Final approval — Level ${proposal.currentApprovalLevel}`);

  } else {
    // Move to next approver
    const nextApproverSnap = await db.collection('users').doc(nextLevel.approverId).get();
    const nextApprover     = nextApproverSnap.exists ? nextApproverSnap.data()! : { name: nextLevel.approverName, email: nextLevel.approverEmail };

    await db.collection('proposals').doc(proposalId).update({
      status:               'Pending Approval',
      currentApprovalLevel: nextLevel.level,
      currentApproverId:    nextLevel.approverId,
      currentApproverEmail: nextApprover.email,
      levelName:            nextLevel.levelName,
      updatedAt:            now,
    });

    // Generate new magic link for next approver
    const magicLinkUrl = await createMagicLinkToken(proposalId, nextLevel.approverId, nextApprover.email, nextLevel.level);

    // Notify next approver
    await writeNotification(nextLevel.approverId, `New Approval Request: ${proposal.proposalNumber}`, `Approved by ${user.name} at Level ${proposal.currentApprovalLevel} — awaiting your review`, proposalId);
    const tmpl = await getEmailTemplate('approval');
    const vars = {
      proposalNumber: proposal.proposalNumber,
      plant:          proposal.plantName,
      approverName:   nextApprover.name || nextApprover.email,
      approvalLevel:  nextLevel.level,
      proposedAmount: proposal.proposedPrice?.toLocaleString('en-IN'),
      diffPercent:    proposal.diffPercent?.toFixed(2),
      magicLinkUrl,
      applicationLink:functions.config().app?.url || 'https://your-app.web.app',
    };
    try { await sendEmail(nextApprover.email, renderTemplate(tmpl.subject, vars), renderTemplate(tmpl.body, vars)); } catch(e) { console.error('[email approval]',e); }

    // Also notify creator of progress
    await writeNotification(proposal.createdBy, `Level ${proposal.currentApprovalLevel} Approved: ${proposal.proposalNumber}`, `Approved by ${user.name} — moved to Level ${nextLevel.level}`, proposalId);

    await writeAudit(uid, user.name, user.email, user.role, proposalId, proposal.proposalNumber, 'Approved', `Level ${proposal.currentApprovalLevel} approved. Moved to Level ${nextLevel.level}.`);
  }

  return { success: true, message: isFinal ? 'Proposal finally approved!' : `Moved to Level ${nextLevel.level}` };
});

// ═══════════════════════════════════════════════════════════════════════════
//  CALLABLE: processRejection
// ═══════════════════════════════════════════════════════════════════════════
export const processRejection = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in.');

  const { proposalId, comment } = data;
  if (!comment?.trim()) throw new functions.https.HttpsError('invalid-argument', 'Comment is required for rejection.');

  const uid = context.auth.uid;
  const [propSnap, userSnap] = await Promise.all([
    db.collection('proposals').doc(proposalId).get(),
    db.collection('users').doc(uid).get(),
  ]);

  if (!propSnap.exists) throw new functions.https.HttpsError('not-found', 'Proposal not found.');
  const proposal = propSnap.data()!;
  const user     = userSnap.data()!;

  if (proposal.currentApproverId !== uid) throw new functions.https.HttpsError('permission-denied', 'Not the designated approver.');
  if (proposal.status !== 'Pending Approval') throw new functions.https.HttpsError('failed-precondition', 'Not pending approval.');

  const now = admin.firestore.FieldValue.serverTimestamp();

  await db.collection('proposals').doc(proposalId).collection('approvalHistory').add({
    level: proposal.currentApprovalLevel, approverId: uid,
    approverName: user.name, approverEmail: user.email, role: user.role,
    action: 'Rejected', comment: comment || '', timestamp: now,
  });

  await db.collection('proposals').doc(proposalId).update({ status: 'Rejected', rejectedAt: now, updatedAt: now });

  await writeNotification(proposal.createdBy, `❌ Rejected: ${proposal.proposalNumber}`, `Rejected by ${user.name}: ${comment}`, proposalId);

  const tmpl = await getEmailTemplate('rejection');
  const vars = {
    proposalNumber: proposal.proposalNumber, creatorName: proposal.createdByName,
    approverName: user.name, comment,
    approvalDate: new Date().toLocaleDateString('en-IN'),
    applicationLink: functions.config().app?.url || 'https://your-app.web.app',
  };
  try { await sendEmail(proposal.createdByEmail, renderTemplate(tmpl.subject, vars), renderTemplate(tmpl.body, vars)); } catch(e) {}

  await writeAudit(uid, user.name, user.email, user.role, proposalId, proposal.proposalNumber, 'Rejected', `Level ${proposal.currentApprovalLevel} rejected. Reason: ${comment}`);

  return { success: true, message: 'Proposal rejected.' };
});

// ═══════════════════════════════════════════════════════════════════════════
//  CALLABLE: processReturn
// ═══════════════════════════════════════════════════════════════════════════
export const processReturn = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in.');

  const { proposalId, comment } = data;
  if (!comment?.trim()) throw new functions.https.HttpsError('invalid-argument', 'Comment is required when returning.');

  const uid = context.auth.uid;
  const [propSnap, userSnap] = await Promise.all([
    db.collection('proposals').doc(proposalId).get(),
    db.collection('users').doc(uid).get(),
  ]);

  if (!propSnap.exists) throw new functions.https.HttpsError('not-found', 'Proposal not found.');
  const proposal = propSnap.data()!;
  const user     = userSnap.data()!;

  if (proposal.currentApproverId !== uid) throw new functions.https.HttpsError('permission-denied', 'Not the designated approver.');
  if (proposal.status !== 'Pending Approval') throw new functions.https.HttpsError('failed-precondition', 'Not pending approval.');

  const now = admin.firestore.FieldValue.serverTimestamp();

  await db.collection('proposals').doc(proposalId).collection('approvalHistory').add({
    level: proposal.currentApprovalLevel, approverId: uid,
    approverName: user.name, approverEmail: user.email, role: user.role,
    action: 'Returned', comment: comment || '', timestamp: now,
  });

  await db.collection('proposals').doc(proposalId).update({ status: 'Returned', returnedAt: now, updatedAt: now });

  await writeNotification(proposal.createdBy, `↩ Returned: ${proposal.proposalNumber}`, `Returned by ${user.name}: ${comment}`, proposalId);

  const tmpl = await getEmailTemplate('return');
  const vars = {
    proposalNumber: proposal.proposalNumber, creatorName: proposal.createdByName,
    approverName: user.name, comment,
    applicationLink: functions.config().app?.url || 'https://your-app.web.app',
  };
  try { await sendEmail(proposal.createdByEmail, renderTemplate(tmpl.subject, vars), renderTemplate(tmpl.body, vars)); } catch(e) {}

  await writeAudit(uid, user.name, user.email, user.role, proposalId, proposal.proposalNumber, 'Returned', `Level ${proposal.currentApprovalLevel} returned. Reason: ${comment}`);

  return { success: true, message: 'Proposal returned for correction.' };
});

// ═══════════════════════════════════════════════════════════════════════════
//  CALLABLE: validateMagicLinkToken
// ═══════════════════════════════════════════════════════════════════════════
export const validateMagicLinkToken = functions.https.onCall(async (data) => {
  const { token } = data;
  if (!token) return { valid: false, reason: 'No token provided.' };

  // Verify signature
  const parts = token.split('.');
  if (parts.length !== 2) return { valid: false, reason: 'Malformed token.' };
  const [rawToken, sig] = parts;

  if (!verifyTokenSignature(rawToken, sig)) return { valid: false, reason: 'Invalid token signature.' };

  // Look up in Firestore
  const tokenSnap = await db.collection('magicLinkTokens').doc(token).get();
  if (!tokenSnap.exists) return { valid: false, reason: 'Token not found or already used.' };

  const tokenData = tokenSnap.data()!;

  if (tokenData.used) return { valid: false, reason: 'This approval link has already been used.' };

  const expiresAt = tokenData.expiresAt?.toDate ? tokenData.expiresAt.toDate() : new Date(tokenData.expiresAt);
  if (new Date() > expiresAt) return { valid: false, reason: 'This approval link has expired (48-hour limit).' };

  // Get proposal data for preview
  const propSnap = await db.collection('proposals').doc(tokenData.proposalId).get();
  if (!propSnap.exists) return { valid: false, reason: 'Proposal no longer exists.' };

  const p = propSnap.data()!;
  if (p.status !== 'Pending Approval') {
    return { valid: false, reason: `Proposal is already "${p.status}" — no action required.` };
  }

  return {
    valid: true,
    proposalId:    tokenData.proposalId,
    approverId:    tokenData.approverId,
    approverEmail: tokenData.approverEmail,
    proposal: {
      proposalNumber:      p.proposalNumber,
      plantName:           p.plantName,
      partyName:           p.partyName,
      currentPrice:        p.currentPrice,
      proposedPrice:       p.proposedPrice,
      diffPercent:         p.diffPercent,
      currentApprovalLevel:p.currentApprovalLevel,
      levelName:           p.levelName,
    },
  };
});

// ═══════════════════════════════════════════════════════════════════════════
//  CALLABLE: processMagicLinkApproval
// ═══════════════════════════════════════════════════════════════════════════
export const processMagicLinkApproval = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in to use magic link.');

  const { token, proposalId, action, comment } = data;
  const uid = context.auth.uid;

  // Validate token
  const parts = token.split('.');
  if (parts.length !== 2 || !verifyTokenSignature(parts[0], parts[1])) {
    throw new functions.https.HttpsError('permission-denied', 'Invalid token.');
  }

  const tokenSnap = await db.collection('magicLinkTokens').doc(token).get();
  if (!tokenSnap.exists) throw new functions.https.HttpsError('not-found', 'Token not found.');
  const tokenData = tokenSnap.data()!;

  if (tokenData.used) throw new functions.https.HttpsError('already-exists', 'This link has already been used.');

  const expiresAt = tokenData.expiresAt?.toDate ? tokenData.expiresAt.toDate() : new Date(tokenData.expiresAt);
  if (new Date() > expiresAt) throw new functions.https.HttpsError('deadline-exceeded', 'This link has expired.');

  // CRITICAL: Verify the authenticated user is the intended approver
  if (tokenData.approverId !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'This approval link is assigned to a different user. Please sign in with the correct account.');
  }

  // Mark token as used BEFORE processing (prevents replay)
  await db.collection('magicLinkTokens').doc(token).update({
    used: true, usedAt: admin.firestore.FieldValue.serverTimestamp(), usedByUid: uid,
  });

  // Delegate to the appropriate action handler
  // We call the same logic as the regular approval functions
  const mockContext = { auth: context.auth } as any;
  const actionMap: Record<string, any> = {
    approve: processApproval,
    reject:  processRejection,
    return:  processReturn,
  };

  const fn = actionMap[action];
  if (!fn) throw new functions.https.HttpsError('invalid-argument', 'Invalid action.');

  try {
    const result = await fn.run({ proposalId, comment: comment || '' }, mockContext);
    return { success: true, message: result.message || `Proposal ${action}d successfully.` };
  } catch (e: any) {
    // Unmark token if action failed so user can retry
    await db.collection('magicLinkTokens').doc(token).update({ used: false, usedAt: null });
    throw e;
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  CALLABLE: createUser (Super Admin only)
// ═══════════════════════════════════════════════════════════════════════════
export const createUser = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in.');

  const callerSnap = await db.collection('users').doc(context.auth.uid).get();
  if (!callerSnap.exists || !['Super Admin','Plant Admin'].includes(callerSnap.data()!.role)) {
    throw new functions.https.HttpsError('permission-denied', 'Only admins can create users.');
  }

  const { name, email, password, role, department, plantIds, status } = data;
  if (!name || !email || !password) throw new functions.https.HttpsError('invalid-argument', 'Name, email and password required.');

  if (role === 'Super Admin' && callerSnap.data()!.role !== 'Super Admin') {
    throw new functions.https.HttpsError('permission-denied', 'Only Super Admin can create Super Admin users.');
  }

  try {
    const userRecord = await auth.createUser({ displayName: name, email, password });
    await db.collection('users').doc(userRecord.uid).set({
      uid: userRecord.uid, name, email, role: role || 'Viewer',
      department: department || '', plantIds: plantIds || [],
      status: status || 'Active',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: context.auth.uid,
    });
    await writeAudit(context.auth.uid, callerSnap.data()!.name, callerSnap.data()!.email, callerSnap.data()!.role, null, null, 'UserCreated', `Created user: ${name} (${email}) — ${role}`);
    return { success: true, uid: userRecord.uid };
  } catch (e: any) {
    throw new functions.https.HttpsError('internal', e.message);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  CALLABLE: generateApprovedProposalPDF
// ═══════════════════════════════════════════════════════════════════════════
export const generateApprovedProposalPDF = functions
  .runWith({ memory: '1GB', timeoutSeconds: 120 })
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in.');

    const { proposalId } = data;
    const uid = context.auth.uid;

    const propSnap = await db.collection('proposals').doc(proposalId).get();
    if (!propSnap.exists) throw new functions.https.HttpsError('not-found', 'Proposal not found.');
    const p = propSnap.data()!;

    if (p.status !== 'Approved') throw new functions.https.HttpsError('failed-precondition', 'Only approved proposals can be downloaded.');

    // Verify access
    const userSnap = await db.collection('users').doc(uid).get();
    const user     = userSnap.data()!;
    if (!['Super Admin','Plant Admin'].includes(user.role) && p.createdBy !== uid && !user.plantIds?.includes(p.plantId)) {
      throw new functions.https.HttpsError('permission-denied', 'No access to this proposal.');
    }

    // Fetch approval history
    const histSnap = await db.collection('proposals').doc(proposalId).collection('approvalHistory').orderBy('timestamp','asc').get();
    const history  = histSnap.docs.map(d => d.data());

    const settings = await getSettings('app');
    const approvalRef = `PP-${proposalId.slice(-8).toUpperCase()}`;

    // Build PDF HTML
    const htmlContent = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  body { font-family: Arial, sans-serif; font-size: 12px; color: #111; margin: 0; padding: 0; }
  .header { background: #1a3a6e; color: #fff; padding: 20px 30px; display: flex; align-items: center; gap: 20px; }
  .header img { height: 50px; }
  .header-text h1 { font-size: 18px; margin: 0 0 4px; }
  .header-text p  { font-size: 11px; margin: 0; opacity: .8; }
  .section { padding: 20px 30px; }
  .section-title { font-size: 14px; font-weight: bold; color: #1a3a6e; border-bottom: 2px solid #1a3a6e; padding-bottom: 6px; margin-bottom: 14px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px 20px; }
  .field-label { font-size: 9px; font-weight: bold; color: #666; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 2px; }
  .field-value { font-size: 12px; font-weight: 600; }
  .price-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; background: #f5f5f5; border-radius: 6px; padding: 12px; }
  .price-box { text-align: center; }
  .price-box .price-label { font-size: 9px; color: #666; text-transform: uppercase; }
  .price-box .price-val  { font-size: 16px; font-weight: bold; }
  .tl { margin: 0; padding: 0; list-style: none; }
  .tl li { display: flex; gap: 12px; margin-bottom: 12px; }
  .tl-dot { width: 28px; height: 28px; border-radius: 50%; background: #1a3a6e; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 11px; flex-shrink: 0; font-weight: bold; }
  .tl-dot.approved { background: #057a55; }
  .tl-dot.rejected { background: #c81e1e; }
  .tl-dot.returned { background: #6c2bd9; }
  .tl-body { background: #f9f9f9; border-radius: 4px; padding: 10px 12px; flex: 1; }
  .tl-body .approver { font-weight: bold; font-size: 12px; }
  .tl-body .meta { font-size: 10px; color: #666; margin-top: 2px; }
  .tl-body .cmt  { font-size: 11px; margin-top: 6px; background: #fff; border-left: 3px solid #1a3a6e; padding: 6px 8px; }
  .final-box { background: #d1fae5; border: 2px solid #057a55; border-radius: 8px; padding: 16px; margin: 0 30px; }
  .final-box h3 { color: #057a55; margin: 0 0 10px; font-size: 14px; }
  .footer { position: fixed; bottom: 0; left: 0; right: 0; background: #f0f0f0; padding: 8px 30px; font-size: 9px; color: #666; display: flex; justify-content: space-between; border-top: 1px solid #ddd; }
  .watermark { color: #057a55; font-weight: bold; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; }
  @page { margin: 0 0 40px; }
</style></head><body>

<div class="header">
  ${settings.logoUrl ? `<img src="${settings.logoUrl}" alt="Logo">` : ''}
  <div class="header-text">
    <h1>${settings.companyName || 'Company'}</h1>
    <p>PRICE PROPOSAL APPROVAL DOCUMENT</p>
    <p>${settings.address || ''}</p>
  </div>
  <div style="margin-left:auto;text-align:right">
    <div style="font-size:16px;font-weight:bold">${p.proposalNumber}</div>
    <div style="font-size:10px;opacity:.8">Status: APPROVED ✓</div>
    <div style="font-size:10px;opacity:.8">Ref: ${approvalRef}</div>
  </div>
</div>

<div class="section">
  <div class="section-title">Proposal Information</div>
  <div class="grid">
    <div><div class="field-label">Proposal Number</div><div class="field-value">${p.proposalNumber}</div></div>
    <div><div class="field-label">Plant</div><div class="field-value">${p.plantName}</div></div>
    <div><div class="field-label">Proposal Date</div><div class="field-value">${p.proposalDate || '—'}</div></div>
    <div><div class="field-label">Party / Customer</div><div class="field-value">${p.partyName}</div></div>
    <div><div class="field-label">Product / Service</div><div class="field-value">${p.productService}</div></div>
    <div><div class="field-label">Category</div><div class="field-value">${p.category || '—'}</div></div>
    <div><div class="field-label">Created By</div><div class="field-value">${p.createdByName}</div></div>
    <div><div class="field-label">Email</div><div class="field-value">${p.createdByEmail}</div></div>
    <div><div class="field-label">Submitted At</div><div class="field-value">${p.submittedAt?.toDate ? p.submittedAt.toDate().toLocaleString('en-IN') : '—'}</div></div>
  </div>
  <div style="margin-top:14px;background:#f9f9f9;padding:12px;border-radius:6px">
    <div class="field-label">Description</div>
    <div style="font-size:12px;margin-top:4px">${p.description}</div>
  </div>
  <div style="margin-top:10px;background:#f9f9f9;padding:12px;border-radius:6px">
    <div class="field-label">Justification</div>
    <div style="font-size:12px;margin-top:4px">${p.justification}</div>
  </div>
</div>

<div class="section">
  <div class="section-title">Pricing Details</div>
  <div class="price-grid">
    <div class="price-box">
      <div class="price-label">Current Price</div>
      <div class="price-val">₹${p.currentPrice?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
    </div>
    <div class="price-box">
      <div class="price-label">Proposed Price</div>
      <div class="price-val">₹${p.proposedPrice?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
    </div>
    <div class="price-box">
      <div class="price-label">Difference</div>
      <div class="price-val" style="color:${p.diffPercent >= 0 ? '#057a55' : '#c81e1e'}">${p.diffPercent >= 0 ? '+' : ''}₹${Math.abs(p.difference || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
    </div>
    <div class="price-box">
      <div class="price-label">% Change</div>
      <div class="price-val" style="color:${p.diffPercent >= 0 ? '#057a55' : '#c81e1e'}">${p.diffPercent >= 0 ? '+' : ''}${p.diffPercent?.toFixed(2)}%</div>
    </div>
  </div>
</div>

<div class="section">
  <div class="section-title">Approval History</div>
  <ul class="tl">
    ${history.map((h: any, i: number) => `
    <li>
      <div class="tl-dot ${(h.action || '').toLowerCase()}">${h.action === 'Approved' ? '✓' : h.action === 'Rejected' ? '✗' : h.action === 'Submitted' ? '→' : '↩'}</div>
      <div class="tl-body">
        <div class="approver">${h.approverName || '—'}</div>
        <div class="meta">
          Email: ${h.approverEmail || '—'} &nbsp;|&nbsp;
          ${h.level > 0 ? `Approval Level: Level ${h.level} — ${p.approvalRoute?.find((r: any) => r.level === h.level)?.levelName || ''} &nbsp;|&nbsp;` : 'Role: Creator &nbsp;|&nbsp;'}
          Action: <strong>${h.action}</strong> &nbsp;|&nbsp;
          ${h.timestamp?.toDate ? h.timestamp.toDate().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
        </div>
        ${h.comment ? `<div class="cmt">Comment: ${h.comment}</div>` : ''}
      </div>
    </li>`).join('')}
  </ul>
</div>

${p.finalApprovedByName ? `
<div class="final-box">
  <h3>✅ FINAL APPROVAL</h3>
  <div class="grid">
    <div><div class="field-label">Approved By</div><div class="field-value">${p.finalApprovedByName}</div></div>
    <div><div class="field-label">Email ID</div><div class="field-value">${p.finalApprovedByEmail}</div></div>
    <div><div class="field-label">Approval Date & Time</div><div class="field-value">${p.approvedAt?.toDate ? p.approvedAt.toDate().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}</div></div>
  </div>
</div>` : ''}

<div class="footer">
  <div>
    <span class="watermark">Electronically Approved</span> — ${settings.footerText || 'Price Proposal Approval System'} &nbsp;|&nbsp; Approval Ref: ${approvalRef}
  </div>
  <div>Generated: ${new Date().toLocaleString('en-IN')} &nbsp;|&nbsp; Document is system-generated and legally binding</div>
</div>

</body></html>`;

    // Use puppeteer to generate PDF
    const puppeteer = require('puppeteer');
    const browser   = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page      = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '10mm', bottom: '20mm', left: '0', right: '0' } });
    await browser.close();

    // Upload to Storage
    const filename = `pdfs/${proposalId}/PP_${p.proposalNumber}_Approved.pdf`;
    const file     = storage.bucket().file(filename);
    await file.save(pdfBuffer, { metadata: { contentType: 'application/pdf' }, public: false });
    const [url] = await file.getSignedUrl({ action: 'read', expires: Date.now() + 7 * 24 * 3600 * 1000 }); // 7-day link

    await writeAudit(uid, user.name, user.email, user.role, proposalId, p.proposalNumber, 'Downloaded', 'PDF generated and downloaded');

    return { success: true, url };
  });

// ═══════════════════════════════════════════════════════════════════════════
//  SCHEDULED: processPendingApprovalReminders (runs every hour)
// ═══════════════════════════════════════════════════════════════════════════
export const processPendingApprovalReminders = functions.pubsub
  .schedule('every 60 minutes')
  .onRun(async () => {
    const approvalSettings = await getSettings('approval');
    const reminder1Hrs   = approvalSettings.reminder1Hrs   || 24;
    const reminder2Hrs   = approvalSettings.reminder2Hrs   || 48;
    const escalationHrs  = approvalSettings.escalationHrs  || 72;
    const maxReminders   = approvalSettings.maxReminders   || 3;
    const APP_URL        = functions.config().app?.url || 'https://your-app.web.app';

    const snap = await db.collection('proposals').where('status', '==', 'Pending Approval').get();
    const batch = db.batch();
    const promises: Promise<any>[] = [];

    for (const doc of snap.docs) {
      const p   = { id: doc.id, ...doc.data() };
      const hrs = p.submittedAt?.toDate
        ? (Date.now() - p.submittedAt.toDate().getTime()) / 3600000
        : 0;

      // Check reminder state
      const reminderCount = p.reminderCount || 0;
      const lastReminder  = p.lastReminderAt?.toDate ? p.lastReminderAt.toDate().getTime() : 0;
      const hoursSinceLast= (Date.now() - lastReminder) / 3600000;

      if (reminderCount >= maxReminders) continue;
      if (hoursSinceLast < (approvalSettings.reminderFreq || 24)) continue; // avoid duplicate within frequency window

      let shouldRemind = false;
      let isEscalation = false;

      if (reminderCount === 0 && hrs >= reminder1Hrs) shouldRemind = true;
      else if (reminderCount === 1 && hrs >= reminder2Hrs) shouldRemind = true;
      else if (hrs >= escalationHrs) { shouldRemind = true; isEscalation = true; }

      if (!shouldRemind) continue;

      // Get approver info
      if (!p.currentApproverId) continue;
      const approverSnap = await db.collection('users').doc(p.currentApproverId).get();
      if (!approverSnap.exists) continue;
      const approver = approverSnap.data()!;

      // Generate fresh magic link for reminder
      const magicLinkUrl = await createMagicLinkToken(p.id, p.currentApproverId, approver.email, p.currentApprovalLevel || 1);

      const vars = {
        proposalNumber:  p.proposalNumber,
        plant:           p.plantName,
        approverName:    approver.name,
        partyName:       p.partyName,
        proposedAmount:  p.proposedPrice?.toLocaleString('en-IN'),
        pendingHours:    Math.floor(hrs).toString(),
        reminderNumber:  (reminderCount + 1).toString(),
        magicLinkUrl,
        applicationLink: APP_URL,
      };

      const tmplType = isEscalation ? 'escalation' : 'reminder';
      const tmpl     = await getEmailTemplate(tmplType);

      promises.push(
        sendEmail(approver.email, renderTemplate(tmpl.subject, vars), renderTemplate(tmpl.body, vars))
          .then(() => {
            batch.update(doc.ref, {
              reminderCount:    reminderCount + 1,
              lastReminderAt:   admin.firestore.FieldValue.serverTimestamp(),
              lastReminderType: isEscalation ? 'escalation' : 'reminder',
            });
          })
          .catch(err => console.error(`[reminder] Failed for ${p.proposalNumber}:`, err))
      );

      // Log reminder in its own collection for audit
      promises.push(
        db.collection('reminders').add({
          proposalId:     p.id,
          proposalNumber: p.proposalNumber,
          approverId:     p.currentApproverId,
          approverEmail:  approver.email,
          reminderNumber: reminderCount + 1,
          type:           isEscalation ? 'escalation' : 'reminder',
          sentAt:         admin.firestore.FieldValue.serverTimestamp(),
          pendingHours:   Math.floor(hrs),
        })
      );
    }

    await Promise.allSettled(promises);
    await batch.commit();
    console.log(`[reminder] Processed ${snap.docs.length} pending proposals`);
    return null;
  });

// ═══════════════════════════════════════════════════════════════════════════
//  SCHEDULED: escalateOverdueApproval (runs every 6 hours)
// ═══════════════════════════════════════════════════════════════════════════
export const escalateOverdueApproval = functions.pubsub
  .schedule('every 6 hours')
  .onRun(async () => {
    const settings     = await getSettings('approval');
    const escalationHrs= settings.escalationHrs || 72;

    const snap = await db.collection('proposals').where('status', '==', 'Pending Approval').get();
    for (const doc of snap.docs) {
      const p   = { id: doc.id, ...doc.data() };
      const hrs = p.submittedAt?.toDate
        ? (Date.now() - p.submittedAt.toDate().getTime()) / 3600000
        : 0;
      if (hrs < escalationHrs) continue;
      if (p.escalated) continue; // already escalated once

      console.log(`[escalation] ${p.proposalNumber} — ${Math.floor(hrs)}h overdue`);
      await doc.ref.update({ escalated: true, escalatedAt: admin.firestore.FieldValue.serverTimestamp() });
      await writeAudit('system', 'System', 'system@pps', 'System', p.id, p.proposalNumber, 'Escalated', `Approval overdue by ${Math.floor(hrs)} hours`);
    }
    return null;
  });
