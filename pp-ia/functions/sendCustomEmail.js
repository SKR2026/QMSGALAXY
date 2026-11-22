/**
 * sendCustomEmail — callable Cloud Function (asia-south1)
 *
 * Accepts: { to: string[], subject: string, html: string }
 * Uses the same GMAIL_USER + GMAIL_APP_PASS secrets as the existing email setup.
 *
 * Deploy alongside existing functions (do NOT replace index.js):
 *   firebase deploy --only functions:sendCustomEmail
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret }       = require('firebase-functions/params');
const nodemailer              = require('nodemailer');

const GMAIL_USER     = defineSecret('GMAIL_USER');
const GMAIL_APP_PASS = defineSecret('GMAIL_APP_PASS');

exports.sendCustomEmail = onCall(
  {
    region:  'asia-south1',
    secrets: [GMAIL_USER, GMAIL_APP_PASS],
  },
  async (request) => {
    // Must be signed in
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const { to, subject, html } = request.data || {};

    if (!to || !subject || !html) {
      throw new HttpsError('invalid-argument', 'Missing to / subject / html.');
    }

    const toList = Array.isArray(to) ? to.filter(Boolean) : [to];
    if (!toList.length) {
      throw new HttpsError('invalid-argument', 'No valid recipients.');
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: GMAIL_USER.value(),
        pass: GMAIL_APP_PASS.value(),   // Gmail App Password (16-char)
      },
    });

    await transporter.sendMail({
      from:    `"Audit Management" <${GMAIL_USER.value()}>`,
      to:      toList.join(', '),
      subject: subject,
      html:    html,
    });

    return { success: true, recipients: toList.length };
  }
);
