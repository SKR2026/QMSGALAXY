/**
 * Gmail Email Backend — Cloud Run
 * ─────────────────────────────────────────────────────────────────────────────
 * Endpoints
 *   POST /api/send-email       — single notification (logMail / visit create+update)
 *   POST /api/send-digest      — bulk digest (array of recipients)
 *   POST /api/test-connection  — smoke-test from Settings → Gmail → "Send Test Email"
 *   GET  /health               — Cloud Run health probe
 *
 * Environment variables (set via Cloud Run env vars — never hard-code):
 *   GMAIL_USER      e.g.  yourname@gmail.com
 *   GMAIL_APP_PASS  16-char App Password from Google Account → Security → App Passwords
 *   PORT            injected by Cloud Run (default 8080)
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const http       = require('http');
const https      = require('https');
const nodemailer = require('nodemailer');

/* ── SMTP transporter (created once at startup) ─────────────────────────── */
function createTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASS;

  if (!user || !pass) {
    console.warn('[email] GMAIL_USER or GMAIL_APP_PASS not set — transporter disabled');
    return null;
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
}

const transporter = createTransporter();

/* ── Tiny helpers ───────────────────────────────────────────────────────── */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end',  () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch (e) { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type':                'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

/* ── Core send helper ───────────────────────────────────────────────────── */
async function sendMail({ to, subject, htmlBody, senderName }) {
  if (!transporter) throw new Error('GMAIL_USER / GMAIL_APP_PASS not configured on this Cloud Run service.');

  const from = senderName
    ? `"${senderName}" <${process.env.GMAIL_USER}>`
    : process.env.GMAIL_USER;

  const info = await transporter.sendMail({
    from,
    to,
    subject,
    html: htmlBody,
  });

  console.log(`[email] sent → ${to} | msgId=${info.messageId}`);
  return info;
}

/* ── HTTP server ────────────────────────────────────────────────────────── */
const PORT = parseInt(process.env.PORT || '8080', 10);

const server = http.createServer(async (req, res) => {

  /* CORS pre-flight (browser fetch from HTML app) */
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  /* ── GET /health ── */
  if (req.method === 'GET' && req.url === '/health') {
    return json(res, 200, { status: 'ok', gmail: !!transporter });
  }

  /* ── POST /api/send-email ── */
  if (req.method === 'POST' && req.url === '/api/send-email') {
    try {
      const { to, subject, htmlBody, senderName } = await readBody(req);

      if (!to || !subject || !htmlBody) {
        return json(res, 400, { error: 'Missing required fields: to, subject, htmlBody' });
      }

      const info = await sendMail({ to, subject, htmlBody, senderName });
      return json(res, 200, { success: true, messageId: info.messageId, from: process.env.GMAIL_USER });

    } catch (err) {
      console.error('[send-email]', err.message);
      return json(res, 500, { error: err.message });
    }
  }

  /* ── POST /api/send-digest ── */
  if (req.method === 'POST' && req.url === '/api/send-digest') {
    try {
      const { recipients, subject, htmlBody, senderName } = await readBody(req);

      if (!Array.isArray(recipients) || recipients.length === 0) {
        return json(res, 400, { error: 'recipients must be a non-empty array' });
      }
      if (!subject || !htmlBody) {
        return json(res, 400, { error: 'Missing required fields: subject, htmlBody' });
      }

      const results = [];
      for (const to of recipients) {
        try {
          const info = await sendMail({ to, subject, htmlBody, senderName });
          results.push({ to, success: true, messageId: info.messageId });
        } catch (err) {
          console.error(`[send-digest] failed for ${to}:`, err.message);
          results.push({ to, success: false, error: err.message });
        }
      }

      return json(res, 200, { results });

    } catch (err) {
      console.error('[send-digest]', err.message);
      return json(res, 500, { error: err.message });
    }
  }

  /* ── POST /api/test-connection ── */
  if (req.method === 'POST' && req.url === '/api/test-connection') {
    try {
      const { to } = await readBody(req);
      if (!to) return json(res, 400, { error: 'Missing field: to' });

      const subject  = '✅ PlantVisit — Gmail Backend Connected';
      const htmlBody = `
        <div style="font-family:Arial,sans-serif;padding:32px;max-width:480px;margin:auto;background:#f9f9f9;border-radius:12px;border:1px solid #e0e0e0">
          <h2 style="color:#34a853;margin-top:0">✅ Connection Successful</h2>
          <p style="color:#333">Your PlantVisit Gmail backend is correctly configured and running on <strong>Google Cloud Run</strong>.</p>
          <p style="color:#555;font-size:13px">
            From: <code>${process.env.GMAIL_USER}</code><br>
            Time: <code>${new Date().toISOString()}</code>
          </p>
          <p style="color:#999;font-size:12px;margin-top:24px">This is an automated test email. No action needed.</p>
        </div>`;

      const info = await sendMail({ to, subject, htmlBody, senderName: 'PlantVisit Backend' });
      return json(res, 200, { success: true, from: process.env.GMAIL_USER, messageId: info.messageId });

    } catch (err) {
      console.error('[test-connection]', err.message);
      return json(res, 500, { error: err.message });
    }
  }

  /* ── 404 fallback ── */
  return json(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`[server] Gmail backend listening on port ${PORT}`);
  console.log(`[server] GMAIL_USER = ${process.env.GMAIL_USER || '(not set)'}`);
});
