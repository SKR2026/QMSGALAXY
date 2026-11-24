const { onRequest } = require("firebase-functions/v2/https");
const nodemailer = require("nodemailer");

// Deploy with:
//   firebase functions:config:set gmail.user="you@gmail.com" gmail.pass="xxxx xxxx xxxx xxxx"
// OR set environment variables in Firebase Console > Functions > Edit > Environment variables:
//   GMAIL_USER = you@gmail.com
//   GMAIL_PASS = xxxx xxxx xxxx xxxx  (16-char App Password, spaces optional)

exports.sendGhMail = onRequest(
  { cors: true, region: "asia-south1" },   // Mumbai — close to India users
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Origin", "*");
      res.set("Access-Control-Allow-Headers", "Content-Type");
      return res.status(204).send("");
    }
    res.set("Access-Control-Allow-Origin", "*");

    const { to, subject, html } = req.body || {};
    if (!to || !subject || !html) {
      return res.status(400).json({ error: "Missing to / subject / html" });
    }

    const gmailUser = process.env.GMAIL_USER;
    const gmailPass = process.env.GMAIL_PASS;
    if (!gmailUser || !gmailPass) {
      return res.status(500).json({ error: "Gmail credentials not configured in function environment." });
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: gmailUser, pass: gmailPass.replace(/\s/g, "") },
    });

    const recipients = Array.isArray(to) ? to.join(",") : to;
    try {
      await transporter.sendMail({
        from: `"Guest House System" <${gmailUser}>`,
        to: recipients,
        subject,
        html,
      });
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error("sendGhMail error:", err);
      return res.status(500).json({ error: err.message });
    }
  }
);
