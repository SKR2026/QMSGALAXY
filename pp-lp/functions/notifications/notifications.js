/**
 * notifications/notifications.js
 * Email queue processor.
 *
 * Email credentials are loaded from Firebase Functions config:
 *   firebase functions:config:set email.provider="sendgrid" email.apikey="SG.xxx"
 *
 * NEVER hardcode credentials here or commit them to git.
 * NEVER expose credentials in frontend JavaScript.
 */

'use strict';

const admin    = require('firebase-admin');
const functions = require('firebase-functions');

async function processEmailQueue(db, appRoot, log) {
  // Load email config from Firebase Functions environment
  const emailConfig = functions.config().email || {};
  const provider    = emailConfig.provider;
  const apiKey      = emailConfig.apikey;
  const fromEmail   = emailConfig.from || 'noreply@lpa-system.app';
  const fromName    = emailConfig.name || 'LPA Management System';

  if (!provider || !apiKey) {
    console.log('[EmailQueue] Email provider not configured. Skipping email queue.');
    return;
  }

  // Fetch pending emails (max 50 per run)
  const pendingSnap = await db.collection(`${appRoot}/emailQueue`)
    .where('status', '==', 'Pending')
    .orderBy('createdAt', 'asc')
    .limit(50)
    .get();

  if (pendingSnap.empty) {
    console.log('[EmailQueue] No pending emails.');
    return;
  }

  console.log(`[EmailQueue] Processing ${pendingSnap.size} emails.`);

  for (const doc of pendingSnap.docs) {
    const item = doc.data();

    // Mark as processing
    await doc.ref.update({ status: 'Processing', processingAt: admin.firestore.FieldValue.serverTimestamp() });

    try {
      // Resolve recipient email from user profile
      const recipientDoc = await db.doc(`${appRoot}/users/${item.recipientUserId}`).get();
      if (!recipientDoc.exists) {
        await doc.ref.update({ status: 'Failed', error: 'Recipient user not found' });
        continue;
      }

      const recipientEmail = recipientDoc.data().email;
      if (!recipientEmail) {
        await doc.ref.update({ status: 'Failed', error: 'Recipient has no email address' });
        continue;
      }

      // Send via configured provider
      await sendEmail(provider, apiKey, {
        to:      recipientEmail,
        from:    { email: fromEmail, name: fromName },
        subject: item.subject,
        text:    item.body,
        html:    buildEmailHtml(item.subject, item.body, item.relatedRecordId)
      });

      await doc.ref.update({
        status:    'Sent',
        sentAt:    admin.firestore.FieldValue.serverTimestamp(),
        attempts:  admin.firestore.FieldValue.increment(1)
      });

      log.emailsSent++;

    } catch (error) {
      console.error(`[EmailQueue] Failed to send ${doc.id}:`, error.message);

      const attempts = (item.attempts || 0) + 1;
      await doc.ref.update({
        status:   attempts >= 3 ? 'Failed' : 'Retry',
        error:    error.message?.substring(0, 500),
        attempts: attempts,
        lastAttempt: admin.firestore.FieldValue.serverTimestamp()
      });

      log.errors.push({ id: doc.id, error: error.message });
    }
  }
}

async function sendEmail(provider, apiKey, emailData) {
  if (provider === 'sendgrid') {
    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(apiKey);
    await sgMail.send(emailData);

  } else if (provider === 'resend') {
    const { Resend } = require('resend');
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from:    `${emailData.from.name} <${emailData.from.email}>`,
      to:      emailData.to,
      subject: emailData.subject,
      html:    emailData.html,
      text:    emailData.text
    });

  } else {
    throw new Error(`Unsupported email provider: ${provider}`);
  }
}

function buildEmailHtml(subject, body, recordId) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8">
<style>
  body { font-family: Arial, sans-serif; font-size: 14px; color: #333; margin: 0; padding: 0; }
  .header { background: #0f1f3d; color: white; padding: 20px 24px; }
  .header h2 { margin: 0; font-size: 18px; }
  .body { padding: 24px; }
  .footer { padding: 16px 24px; border-top: 1px solid #eee; color: #999; font-size: 12px; }
  .btn { display: inline-block; background: #1a56db; color: white; padding: 10px 20px;
         border-radius: 6px; text-decoration: none; font-weight: 600; margin-top: 16px; }
</style>
</head>
<body>
  <div class="header"><h2>🏭 LPA Management System</h2></div>
  <div class="body">
    <h3>${subject}</h3>
    <p>${body}</p>
    ${recordId ? `<a class="btn" href="#">View in LPA System →</a>` : ''}
  </div>
  <div class="footer">
    This is an automated notification from the LPA Management System.<br>
    Please do not reply to this email.
  </div>
</body>
</html>`;
}

module.exports = { processEmailQueue };
