# GitHub CI/CD Deployment Guide
## Deploy to https://www.qmsgalaxy.com/pp-ia/

---

## Overview

```
GitHub repo (main branch)
       │  push
       ▼
GitHub Actions (.github/workflows/deploy.yml)
       │  firebase deploy
       ▼
Firebase Hosting  ──► https://www.qmsgalaxy.com/pp-ia/
Firebase Functions (asia-south1)
Firestore Rules + Indexes
```

---

## Step 1 — Push the project to GitHub

```bash
# In the audit-firebase folder:
git init
git add .
git commit -m "Initial commit — Group Audit System"

# Create a new repo on github.com first, then:
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO-NAME.git
git branch -M main
git push -u origin main
```

> ⚠️ Make sure `.gitignore` exists. The workflow file is already in `.github/workflows/deploy.yml`.

---

## Step 2 — Get the Firebase Service Account secret

This is what GitHub Actions uses to authenticate with Firebase (no password needed).

1. Go to **https://console.firebase.google.com** → open project **skr-ia**
2. Click **⚙️ gear icon** → **Project settings** → **Service accounts** tab
3. Click **Generate new private key** → **Generate key**
4. A JSON file downloads — keep this safe (delete after adding to GitHub)

---

## Step 3 — Add secret to GitHub repo

1. Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Name: `FIREBASE_SERVICE_ACCOUNT_SKR_IA`  ← exact name (must match deploy.yml)
4. Value: paste the entire contents of the JSON file downloaded in Step 2
5. Click **Add secret**

---

## Step 4 — Enable GitHub Actions write permission

1. GitHub repo → **Settings** → **Actions** → **General**
2. Scroll to **Workflow permissions** → select **Read and write permissions**
3. Click **Save**

---

## Step 5 — Trigger first deploy

```bash
git push origin main
```

Go to your repo → **Actions** tab to watch the deploy live.
It takes ~3–5 minutes the first time (index building).

After it finishes, your app is live at:
**https://skr-ia.web.app/pp-ia/**

---

## Step 6 — Add Custom Domain (www.qmsgalaxy.com)

### 6a. Add domain in Firebase Console
1. Firebase Console → **Hosting** → **Add custom domain**
2. Enter: `www.qmsgalaxy.com` → **Continue**
3. Firebase shows you **two TXT records** to add → copy them

### 6b. Add DNS records at your domain registrar
Log in to wherever you bought `qmsgalaxy.com` (GoDaddy / Cloudflare / BigRock etc.)
and add these records:

| Type | Host | Value |
|------|------|-------|
| TXT | @ (or qmsgalaxy.com) | Paste value from Firebase step 1 |
| TXT | @ (or qmsgalaxy.com) | Paste value from Firebase step 2 |

Click **Verify** in Firebase Console. DNS can take 10 minutes to 24 hours.

### 6c. Add A records (after verification)
Firebase shows two IP addresses:

| Type | Host | Value |
|------|------|-------|
| A | www | 151.101.1.195 |
| A | www | 151.101.65.195 |

> These IPs may differ — always use the ones Firebase shows you.

### 6d. SSL certificate
Firebase auto-provisions a free SSL certificate within a few hours.
Once done, `https://www.qmsgalaxy.com/pp-ia/` will be live.

---

## File structure after setup

```
audit-firebase/                     ← push this entire folder to GitHub root
├── .github/
│   └── workflows/
│       └── deploy.yml              ← GitHub Actions CI/CD
├── public/
│   └── pp-ia/
│       ├── index.html              ← the full SPA
│       └── firebase-config.js      ← project skr-ia credentials
├── functions/
│   ├── index.js                   ← Cloud Functions + email
│   └── package.json
├── firebase.json                  ← rewrites /pp-ia/** → /pp-ia/index.html
├── .firebaserc                    ← project: skr-ia
├── firestore.rules
└── firestore.indexes.json
```

---

## Auto-deploy on every push

Once set up, every `git push` to `main` automatically:
1. Installs Functions dependencies
2. Deploys hosting (new SPA build)
3. Deploys Cloud Functions
4. Deploys Firestore rules and indexes

You can also deploy manually: GitHub repo → **Actions** → **Deploy to Firebase Hosting** → **Run workflow**

---

## Rollback a bad deploy

```bash
# In Firebase Console → Hosting → see version history → click "Rollback"
# Or via CLI:
firebase hosting:clone skr-ia:live skr-ia:live --version PREVIOUS_VERSION_ID
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Actions says `Error: HTTP Error: 403` | Check the secret name matches exactly: `FIREBASE_SERVICE_ACCOUNT_SKR_IA` |
| `npm ci` fails | Make sure `functions/package-lock.json` is committed (run `npm install` locally first) |
| `/pp-ia/` returns 404 | Check `firebase.json` rewrite rule — source must be `/pp-ia/**` |
| Custom domain not working | DNS propagation takes up to 24h; verify TXT records first |
| SSL not issued | Wait 24h; check domain has correct A records pointing to Firebase IPs |
