#!/usr/bin/env node
/**
 * seed.js  —  Bootstrap initial Firestore data after first deploy.
 * Run once:  node scripts/seed.js
 *
 * Requires:  GOOGLE_APPLICATION_CREDENTIALS pointing to your service account JSON,
 *            OR run `firebase login` and set FIREBASE_PROJECT_ID env var.
 *
 * Usage:
 *   export GOOGLE_APPLICATION_CREDENTIALS="./service-account.json"
 *   export FIREBASE_PROJECT_ID="your-project-id"
 *   node scripts/seed.js
 */

const admin = require('firebase-admin');

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) { console.error('Set FIREBASE_PROJECT_ID env var'); process.exit(1); }

admin.initializeApp({ projectId });
const db = admin.firestore();

async function seed() {
  console.log('\n🌱  Seeding Firestore for project:', projectId, '\n');

  // ── App Settings ──────────────────────────────────────────────────────
  await db.collection('settings').doc('app').set({
    companyName:  'Your Company Name',
    companyShort: 'YCN',
    address:      'Your Company Address',
    phone:        '',
    email:        '',
    footerText:   'Electronically approved through Price Proposal Approval System',
    logoUrl:      '',
    createdAt:    admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  console.log('✅  settings/app');

  // ── Approval Settings ─────────────────────────────────────────────────
  await db.collection('settings').doc('approval').set({
    reminder1Hrs:  24,
    reminder2Hrs:  48,
    escalationHrs: 72,
    maxReminders:  3,
    reminderFreq:  24,
    createdAt:     admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  console.log('✅  settings/approval');

  // ── Numbering Settings ────────────────────────────────────────────────
  await db.collection('settings').doc('numbering').set({
    format:     'PP-{YEAR}-{SEQ6}',
    currency:   '₹',
    dateFormat: 'DD-MM-YYYY',
    createdAt:  admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  console.log('✅  settings/numbering');

  // ── Proposal counter ──────────────────────────────────────────────────
  await db.collection('counters').doc('proposals').set({}, { merge: true });
  console.log('✅  counters/proposals');

  // ── Default Email Templates ───────────────────────────────────────────
  const APP_URL = `https://${projectId}.web.app`;
  const templates = {
    submission: {
      subject: 'New Price Proposal Pending Your Approval: {{proposalNumber}}',
      body: `Dear {{approverName}},\n\nA new price proposal requires your approval.\n\nProposal: {{proposalNumber}}\nPlant: {{plant}}\nParty: {{partyName}}\nProposed Amount: ₹{{proposedAmount}}\nChange: {{diffPercent}}%\nSubmitted By: {{creatorName}}\n\nSign in to the system:\n${APP_URL}\n\n──────────────────────────\nOR use your one-click magic link (valid 48 hours, no sign-in needed):\n{{magicLinkUrl}}\n──────────────────────────\n\nThis link is personal — do not forward it.\n\nRegards,\nPrice Proposal System`,
    },
    approval: {
      subject: 'Proposal Approved at Level {{approvalLevel}} — Action Required: {{proposalNumber}}',
      body: `Dear {{approverName}},\n\nPrice proposal {{proposalNumber}} has been approved at Level {{approvalLevel}} and now requires your review.\n\nPlant: {{plant}}\nParty: {{partyName}}\nProposed Amount: ₹{{proposedAmount}}\nChange: {{diffPercent}}%\n\nSign in:\n${APP_URL}\n\n──────────────────────────\nOne-click magic link (valid 48 hours):\n{{magicLinkUrl}}\n──────────────────────────\n\nRegards,\nPrice Proposal System`,
    },
    final_approval: {
      subject: '✅ FINALLY APPROVED: Price Proposal {{proposalNumber}}',
      body: `Dear {{creatorName}},\n\nYour price proposal {{proposalNumber}} has been FINALLY APPROVED.\n\nPlant: {{plant}}\nParty: {{partyName}}\nProposed Price: ₹{{proposedAmount}}\nFinal Approval: {{approvalDate}}\nApproved By: {{approverName}}\n\nLog in to download the approved PDF:\n${APP_URL}\n\nRegards,\nPrice Proposal System`,
    },
    rejection: {
      subject: '❌ REJECTED: Price Proposal {{proposalNumber}}',
      body: `Dear {{creatorName}},\n\nYour price proposal {{proposalNumber}} has been REJECTED.\n\nRejected By: {{approverName}}\nDate: {{approvalDate}}\nReason: {{comment}}\n\nView proposal:\n${APP_URL}\n\nRegards,\nPrice Proposal System`,
    },
    return: {
      subject: '↩ Return for Correction: {{proposalNumber}}',
      body: `Dear {{creatorName}},\n\nYour price proposal {{proposalNumber}} has been returned for correction.\n\nReturned By: {{approverName}}\nCorrection Required: {{comment}}\n\nPlease update and resubmit:\n${APP_URL}\n\nRegards,\nPrice Proposal System`,
    },
    reminder: {
      subject: '⏰ Reminder #{reminderNumber}: Proposal {{proposalNumber}} Awaiting Your Approval',
      body: `Dear {{approverName}},\n\nThis is reminder #{{reminderNumber}}.\n\nProposal {{proposalNumber}} has been pending your approval for {{pendingHours}} hours.\n\nPlant: {{plant}} | Party: {{partyName}} | Amount: ₹{{proposedAmount}}\n\nSign in:\n${APP_URL}\n\n──────────────────────────\nOne-click magic link (valid 48 hours):\n{{magicLinkUrl}}\n──────────────────────────\n\nRegards,\nPrice Proposal System`,
    },
    escalation: {
      subject: '🚨 ESCALATION: Overdue Approval — {{proposalNumber}} ({{pendingHours}}h)',
      body: `Dear {{supervisorName}},\n\nThis is an escalation alert.\n\nProposal {{proposalNumber}} is OVERDUE — pending for {{pendingHours}} hours.\n\nCurrently with: {{approverName}}\nPlant: {{plant}} | Party: {{partyName}} | Amount: ₹{{proposedAmount}}\n\nPlease follow up or take action:\n${APP_URL}\n\nRegards,\nPrice Proposal System`,
    },
    magic_link: {
      subject: '🔗 One-Click Approval: {{proposalNumber}}',
      body: `Dear {{approverName}},\n\nYou can approve proposal {{proposalNumber}} directly — no sign-in needed:\n\n──────────────────────────\n{{magicLinkUrl}}\n──────────────────────────\n\nThis link is valid for 48 hours and can only be used once.\nDo not share this link.\n\nProposal Details:\n• Number: {{proposalNumber}}\n• Plant: {{plant}}\n• Party: {{partyName}}\n• Amount: ₹{{proposedAmount}} ({{diffPercent}}% change)\n• Approval Level: Level {{approvalLevel}}\n\nOr sign in to view full details:\n${APP_URL}\n\nRegards,\nPrice Proposal System`,
    },
  };

  for (const [type, tmpl] of Object.entries(templates)) {
    await db.collection('emailTemplates').doc(type).set({
      ...tmpl,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log(`✅  emailTemplates/${type}`);
  }

  // ── Sample Plants ─────────────────────────────────────────────────────
  const plants = [
    { code: 'PLT01', name: 'Plant 01', location: 'Location A', status: 'Active' },
    { code: 'PLT02', name: 'Plant 02', location: 'Location B', status: 'Active' },
    { code: 'PLT03', name: 'Plant 03', location: 'Location C', status: 'Active' },
    { code: 'CORP',  name: 'Corporate Office', location: 'HQ', status: 'Active' },
  ];
  for (const p of plants) {
    await db.collection('plants').add({ ...p, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    console.log(`✅  plants/${p.code}`);
  }

  console.log('\n🎉  Seed complete!\n');
  console.log('Next steps:');
  console.log('  1. Open your app URL and register the first account (auto-assigned Super Admin)');
  console.log('  2. Settings → Company: add your company name and logo');
  console.log('  3. Users: add approvers and creators');
  console.log('  4. Approval Matrix: configure approval levels\n');

  process.exit(0);
}

seed().catch(e => { console.error(e); process.exit(1); });
