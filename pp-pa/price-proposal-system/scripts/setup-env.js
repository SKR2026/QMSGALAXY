#!/usr/bin/env node
/**
 * setup-env.js
 * Run once after firebase login to set all Cloud Functions environment variables.
 * Usage:  node scripts/setup-env.js
 */

const { execSync } = require('child_process');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(res => rl.question(q, res));

async function main() {
  console.log('\n🔧  Price Proposal System — Cloud Functions Environment Setup\n');

  const projectId   = await ask('Firebase Project ID: ');
  const appUrl      = await ask('Deployed App URL (e.g. https://your-project.web.app): ');
  const gmailUser   = await ask('Gmail sender address (e.g. noreply@yourcompany.com): ');
  const gmailPass   = await ask('Gmail App Password (16-char, from Google Account → App Passwords): ');
  const magicSecret = await ask('Magic link HMAC secret (any long random string, e.g. 64 chars): ') || generateSecret();

  console.log('\n⚙️  Setting Firebase Functions config…\n');

  const cmds = [
    `firebase --project ${projectId} functions:config:set app.url="${appUrl}"`,
    `firebase --project ${projectId} functions:config:set gmail.user="${gmailUser}"`,
    `firebase --project ${projectId} functions:config:set gmail.pass="${gmailPass}"`,
    `firebase --project ${projectId} functions:config:set magic.secret="${magicSecret}"`,
  ];

  for (const cmd of cmds) {
    console.log('→', cmd.replace(gmailPass, '****').replace(magicSecret, '****'));
    execSync(cmd, { stdio: 'inherit' });
  }

  console.log('\n✅  Environment variables set successfully!');
  console.log('📦  Now deploy functions:  npm run deploy:functions\n');
  rl.close();
}

function generateSecret() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  return Array.from({ length: 64 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

main().catch(e => { console.error(e); process.exit(1); });
