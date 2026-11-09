# Firebase Hosting & Deployment Guide
## Group Audit Management System

---

## Prerequisites

| Tool | Install command | Purpose |
|------|----------------|---------|
| Node.js 20+ | https://nodejs.org | Cloud Functions runtime |
| Firebase CLI | `npm install -g firebase-tools` | Deploy everything |
| Google Cloud SDK | https://cloud.google.com/sdk | Secret Manager setup |
| Git (optional) | https://git-scm.com | Version control |

---

## Step 1 — Create a Firebase Project

1. Open https://console.firebase.google.com
2. Click **Add project** → give it a name (e.g. `group-audit-system`)
3. Enable or disable Google Analytics → **Create project**
4. Wait for provisioning → **Continue**

---

## Step 2 — Enable Required Firebase Services

### Authentication
1. Left sidebar → **Authentication** → **Get started**
2. **Sign-in method** tab → **Email/Password** → toggle **Enable** → **Save**

### Firestore Database
1. Left sidebar → **Firestore Database** → **Create database**
2. Select **Start in production mode** → **Next**
3. Choose a region: **asia-south1 (Mumbai)** for India → **Enable**

### Storage
1. Left sidebar → **Storage** → **Get started**
2. Select **Start in production mode** → **Next** → choose same region → **Done**

### Functions (requires Blaze plan)
1. Left sidebar → **Functions** → it will prompt to upgrade to **Blaze (pay-as-you-go)**
2. Click **Upgrade** → add billing → confirm
3. Functions are free up to 2M invocations/month — typical audit system usage costs < ₹100/month

---

## Step 3 — Configure the Project Locally

### 3a. Login to Firebase CLI
```bash
firebase login
```
This opens a browser — sign in with the same Google account used in Step 1.

### 3b. Set your project ID in .firebaserc
Open `audit-firebase/.firebaserc` and replace `YOUR-FIREBASE-PROJECT-ID`:
```json
{
  "projects": {
    "default": "group-audit-system"
  }
}
```
Your project ID is shown in Firebase Console → Project Settings (gear icon) → **Project ID**.

### 3c. Fill in firebase-config.js
Open `audit-firebase/public/firebase-config.js`.

Go to Firebase Console → Project Settings → **Your apps** → click the web icon (`</>`) → **Register app** → copy the config object:

```javascript
const firebaseConfig = {
  apiKey:            "AIzaSy...",
  authDomain:        "group-audit-system.firebaseapp.com",
  projectId:         "group-audit-system",
  storageBucket:     "group-audit-system.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123456789:web:abcdef123456",
  measurementId:     "G-XXXXXXXXXX"
};
```

### 3d. Install Functions dependencies
```bash
cd audit-firebase/functions
npm install
cd ..
```

---

## Step 4 — Gmail Email Setup (Secret Manager)

The system sends emails using your Gmail account via OAuth2 (not a plain password).

### 4a. Enable APIs in Google Cloud Console
1. Go to https://console.cloud.google.com
2. Make sure your Firebase project is selected (top left dropdown)
3. Search and enable these APIs:
   - **Gmail API**
   - **Secret Manager API**

### 4b. Create OAuth2 Credentials
1. Go to **APIs & Services** → **Credentials** → **+ Create Credentials** → **OAuth 2.0 Client IDs**
2. Application type: **Web application**
3. Under **Authorized redirect URIs**, add:
   ```
   https://developers.google.com/oauthplayground
   ```
4. Click **Create** → copy the **Client ID** and **Client Secret**

### 4c. Get a Refresh Token
1. Open https://developers.google.com/oauthplayground
2. Click the ⚙️ gear icon (top right) → check **Use your own OAuth credentials**
3. Paste your Client ID and Client Secret → Close
4. In Step 1 (left panel), scroll to **Gmail API v1** → select `https://mail.google.com/`
5. Click **Authorize APIs** → sign in with the Gmail account you want to send FROM
6. Click **Exchange authorization code for tokens**
7. Copy the **Refresh token** value

### 4d. Store credentials in Secret Manager
Create a file called `gmail-creds.json` on your computer (do NOT commit this):
```json
{
  "clientId":     "your-client-id.apps.googleusercontent.com",
  "clientSecret": "your-client-secret",
  "refreshToken": "your-refresh-token",
  "fromEmail":    "audits@yourcompany.com",
  "fromName":     "Group Audit System"
}
```

Upload to Secret Manager:
```bash
# If gcloud is not configured for this project:
gcloud config set project YOUR-PROJECT-ID

# Create the secret
gcloud secrets create gmail-oauth-creds --data-file=gmail-creds.json

# Grant Cloud Functions permission to read it
gcloud secrets add-iam-policy-binding gmail-oauth-creds \
  --member="serviceAccount:YOUR-PROJECT-ID@appspot.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

After uploading, delete `gmail-creds.json` from your computer.

---

## Step 5 — Update Brand Constants in Functions

Open `audit-firebase/functions/index.js`, find the `BRAND` object near the top and update:

```javascript
const BRAND = {
  name:    'Your Company Audit System',   // shown in email header
  color:   '#2563EB',                      // brand accent color
  colorDark: '#1D4ED8',
  logoUrl: '',                              // paste Storage URL after uploading logo
  appUrl:  'https://YOUR-PROJECT-ID.web.app',  // your live app URL
};
```

---

## Step 6 — Deploy

Deploy everything in one command:
```bash
cd audit-firebase
firebase deploy
```

This deploys:
- **Hosting** — your SPA to `https://YOUR-PROJECT-ID.web.app`
- **Firestore rules** — security rules for all 20+ collections
- **Firestore indexes** — 12 composite indexes (may take 2–5 min to build)
- **Cloud Functions** — 12 functions in region `asia-south1`

### Deploy individual parts (faster for updates):
```bash
firebase deploy --only hosting          # update frontend only
firebase deploy --only functions        # update Cloud Functions only
firebase deploy --only firestore:rules  # update security rules only
firebase deploy --only firestore:indexes
```

---

## Step 7 — Seed Initial Data

After first deploy, sign in and set up master data via Firestore Console
(https://console.firebase.google.com → Firestore):

### Create your Super Admin user
1. Go to Firebase Console → **Authentication** → **Add user**
2. Enter email and a temporary password → note the UID shown
3. In Firestore, create document `users/{UID}`:
```json
{
  "name": "Super Admin",
  "email": "admin@yourcompany.com",
  "role": "Super Admin",
  "plant": "All Plants",
  "status": "Active"
}
```

### Add plants (or use the Settings module in the app)
Create documents in `plants` collection:
```json
{
  "name": "Bawal",
  "code": "BWL",
  "location": "Bawal, Haryana",
  "state": "Haryana",
  "head": "Plant Head Name",
  "contact": "planthead@yourcompany.com",
  "active": true,
  "completionRate": 0
}
```

### App settings
Create document `appSettings/org`:
```json
{
  "orgName": "Your Company Name",
  "loginPortalTitle": "Group Audit System"
}
```

---

## Step 8 — Custom Domain (Optional)

1. Firebase Console → **Hosting** → **Add custom domain**
2. Enter your domain (e.g. `audit.yourcompany.com`)
3. Add the two DNS records shown at your domain registrar
4. Firebase auto-provisions an SSL certificate (takes ~24 hours)

---

## Local Development (Emulators)

Test without touching production:
```bash
cd audit-firebase
firebase emulators:start
```

| Emulator | URL |
|----------|-----|
| App | http://localhost:5000 |
| Firestore | http://localhost:8080 |
| Functions | http://localhost:5001 |
| Auth | http://localhost:9099 |
| Emulator UI | http://localhost:4000 |

The app auto-detects localhost and connects to emulators.

---

## Scheduled Functions Schedule Reference

| Function | Schedule | Purpose |
|----------|----------|---------|
| `dailyCAPAReminder` | 08:00 IST daily | Overdue + due-soon CAPA emails |
| `dailyEffectivenessReminder` | 09:00 IST daily | Effectiveness review alerts |
| `weeklySupplierReminder` | Monday 09:00 IST | Suppliers due in 30 days |
| `weeklyDigest` | Sunday 20:00 IST | Per-plant KPI summary email |
| `monthlyKPISnapshot` | 1st of month 03:30 IST | Writes dashboard snapshot |

---

## Email Templates Included

| Template | Trigger |
|----------|---------|
| Finding Raised → CAPA assigned | Firestore trigger on new finding |
| CAPA Overdue | Daily scheduler |
| CAPA Due Soon (3 days) | Daily scheduler |
| Audit Scheduled | Firestore trigger on new audit plan |
| Supplier Audit Due | Weekly scheduler |
| Effectiveness Review Due | Daily scheduler |
| Weekly KPI Digest | Weekly scheduler |
| LPA Result | Available for callable use |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `firebase: command not found` | Run `npm install -g firebase-tools` |
| `Error: Failed to get Firebase project` | Run `firebase login` again or check `.firebaserc` |
| Functions deploy fails | Check Node 20 is installed: `node --version` |
| Emails not sending | Check Secret Manager secret name matches exactly `gmail-oauth-creds`; check service account has `secretmanager.secretAccessor` role |
| Firestore permission denied | Check `firestore.rules` is deployed; check user document has correct role field |
| Indexes still building | Wait 5 min after first deploy before testing queries |
| Login screen shows blank | Check `firebase-config.js` values are correct (no extra spaces or missing quotes) |

---

## Cost Estimate (typical 500-user, 6-plant deployment)

| Service | Free Tier | Typical Monthly Usage | Estimated Cost |
|---------|-----------|----------------------|----------------|
| Hosting | 10 GB/month | ~1 GB | Free |
| Firestore reads | 50K/day | ~100K/day | ~₹150/month |
| Firestore writes | 20K/day | ~20K/day | ~₹100/month |
| Cloud Functions | 2M calls/month | ~50K calls | Free |
| Storage | 5 GB | ~500 MB (logos) | Free |
| **Total** | | | **~₹250/month** |
