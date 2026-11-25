# CDRTS – Deployment Guide

## Corporate Document Registration & Tracking System
### Firebase + GitHub Deployment Instructions

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 18+ | https://nodejs.org |
| Firebase CLI | Latest | `npm install -g firebase-tools` |
| Git | Any | https://git-scm.com |
| GitHub account | — | https://github.com |

---

## Step 1 – Create Firebase Project

1. Go to https://console.firebase.google.com
2. Click **Add project** → Enter name (e.g. `cdrts-prod`)
3. Enable **Google Analytics** (optional)
4. Click **Create project**

### Enable Firebase Services:
- **Authentication** → Sign-in method → Enable **Email/Password**
- **Firestore Database** → Create database → **Production mode** → Select region
- **Storage** → Get started → **Production mode**
- **Functions** → Get started (requires Blaze/pay-as-you-go plan for Cloud Functions)
- **Hosting** → Get started

---

## Step 2 – Get Firebase Configuration

1. In Firebase Console → Project settings → Your apps → **Add app** → Web (`</>`)
2. Register app name (e.g. `CDRTS Web`)
3. Copy the `firebaseConfig` object
4. Open `public/js/firebase-config.js` and replace the placeholder values:

```javascript
const firebaseConfig = {
  apiKey:            "YOUR_ACTUAL_API_KEY",
  authDomain:        "your-project-id.firebaseapp.com",
  projectId:         "your-project-id",
  storageBucket:     "your-project-id.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123456789:web:abcdef"
};
```

---

## Step 3 – Set Up Gmail App Password

1. Go to your Google Account → Security → 2-Step Verification (enable if not already)
2. Go to Security → **App passwords**
3. Select **Mail** and **Other device** → Enter "CDRTS"
4. Copy the 16-digit password (e.g. `xxxx xxxx xxxx xxxx`)

### Store in Firebase Secret Manager:

```bash
# Login to Firebase
firebase login

# Set secrets (you will be prompted to enter the value)
firebase functions:secrets:set GMAIL_USER
# Enter: your-gmail@gmail.com

firebase functions:secrets:set GMAIL_APP_PASSWORD
# Enter: your-16-digit-app-password (without spaces)
```

---

## Step 4 – Clone and Set Up Repository

```bash
# Create GitHub repository at https://github.com/new
# Then clone it
git clone https://github.com/YOUR_USERNAME/cdrts.git
cd cdrts

# Copy all project files into this directory
# (or initialize git in the project folder)
git init
git remote add origin https://github.com/YOUR_USERNAME/cdrts.git
```

---

## Step 5 – Install Dependencies

```bash
# Install Cloud Functions dependencies
cd functions
npm install
cd ..
```

---

## Step 6 – Firebase CLI Login and Project Link

```bash
# Login
firebase login

# Link to your project
firebase use --add
# Select your project from the list
# Give it an alias: "production"
```

---

## Step 7 – Deploy Security Rules and Indexes

```bash
# Deploy Firestore rules
firebase deploy --only firestore:rules

# Deploy Firestore indexes
firebase deploy --only firestore:indexes

# Deploy Storage rules
firebase deploy --only storage
```

---

## Step 8 – Deploy Cloud Functions

```bash
# Deploy all functions
firebase deploy --only functions

# Verify deployment
firebase functions:log
```

Expected functions deployed:
- `sendUserNotification`
- `assignDocumentNumber`
- `returnDocumentForCorrection`
- `submitDocument`
- `sendConsolidatedMRNotification` (scheduled)
- `createUser`
- `deleteRecords`
- `checkDocumentNumber`

---

## Step 9 – Deploy Frontend to Firebase Hosting

```bash
# Deploy hosting
firebase deploy --only hosting

# Full deployment (all services at once)
firebase deploy
```

Your app will be available at:
`https://YOUR_PROJECT_ID.web.app`

---

## Step 10 – GitHub Actions CI/CD (Automatic Deployment)

### Create `.github/workflows/firebase-deploy.yml`:

```yaml
name: Deploy to Firebase

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'

      - name: Install Functions Dependencies
        run: cd functions && npm ci

      - name: Deploy to Firebase
        uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          repoToken: '${{ secrets.GITHUB_TOKEN }}'
          firebaseServiceAccount: '${{ secrets.FIREBASE_SERVICE_ACCOUNT }}'
          projectId: skr-doc
          channelId: live
```

### Add GitHub Secret:
1. Firebase Console → Project Settings → Service accounts → **Generate new private key**
2. GitHub repo → Settings → Secrets → **New repository secret**
   - Name: `FIREBASE_SERVICE_ACCOUNT`
   - Value: (paste the JSON content)

---

## Step 11 – Create Superadmin User

1. Open your app URL
2. Go to Firebase Console → Authentication → **Add user**
   - Email: `admin@yourcompany.com`
   - Password: (strong password)
3. The first user to log in with no existing Firestore user record is auto-promoted to Superadmin
4. **OR** manually create the Firestore document:

```
Collection: users
Document ID: (copy the UID from Firebase Auth)
Fields:
  uid: "USER_UID_FROM_AUTH"
  email: "admin@yourcompany.com"
  displayName: "System Administrator"
  role: "superadmin"
  active: true
  createdAt: (server timestamp)
```

---

## Step 12 – Initial Application Setup

Log in as Superadmin and configure:

1. **Settings → Plants** – Add your manufacturing plants
2. **Settings → Departments** – Add departments (link to plants)
3. **Settings → Categories** – Add document categories (e.g. SOP, Policy, Procedure, Form)
4. **Settings → Users** – Create Corporate MR and plant user accounts
5. **Settings → Email Config** – Set application URL for email links
6. **Settings → Notifications** – Set cooldown period (default: 120 minutes)
7. **Settings → Branding** – Upload company logo, set app title

---

## Firestore Collections Created Automatically

| Collection | Description |
|-----------|-------------|
| `users` | User profiles and roles |
| `plants` | Plant master data |
| `departments` | Department master data |
| `documentCategories` | Category master data |
| `documents` | All document submissions |
| `documentNumberRegistry` | Unique DMS number index |
| `notificationQueue` | Email notification queue |
| `notificationLogs` | Sent email log |
| `activityLogs` | Complete audit trail |
| `appSettings` | Application configuration |
| `deletedRecords` | Soft-deleted document archive |

---

## Security Checklist

- [ ] Firebase API key is NOT committed to git (keep in firebase-config.js locally, use env vars in CI)
- [ ] Gmail App Password stored in Firebase Secret Manager, never in code
- [ ] Firestore security rules deployed
- [ ] Storage security rules deployed
- [ ] All Cloud Functions validate user role server-side
- [ ] No hardcoded credentials anywhere in codebase
- [ ] Repository is private (GitHub)

---

## Troubleshooting

**Functions not deploying:** Upgrade to Blaze plan in Firebase Console → Billing

**Email not sending:** Verify Gmail App Password is correct. Test with:
```bash
firebase functions:secrets:access GMAIL_APP_PASSWORD
```

**Permission denied errors:** Check Firestore security rules are deployed and user has correct role in `users` collection

**Functions region mismatch:** If you used a region other than `us-central1`, update in `firebase-config.js`:
```javascript
const functions = getFunctions(app, "asia-south1"); // e.g. Mumbai
```

**Storage upload fails:** Check Storage rules are deployed and file size is under 50MB

---

## Cost Estimates (Firebase Blaze Plan)

| Service | Free Tier | Typical Small-Scale Cost |
|---------|-----------|-------------------------|
| Firestore reads | 50K/day free | ~$0.06/100K reads |
| Firestore writes | 20K/day free | ~$0.18/100K writes |
| Storage | 5GB free | ~$0.026/GB |
| Functions | 2M calls/month free | Minimal for internal use |
| Hosting | 10GB/month free | Free for most cases |
| Email (Gmail SMTP) | Free | Free (Gmail App Password) |

For an organization with <100 users and <1000 documents/month, monthly cost is typically **under $5**.

---

## Support & Maintenance

- Monitor Functions logs: `firebase functions:log --follow`
- Monitor Firestore usage: Firebase Console → Firestore → Usage
- Rotate Gmail App Password: Update secret with `firebase functions:secrets:set GMAIL_APP_PASSWORD`
- Backup Firestore: Firebase Console → Firestore → Import/Export → Export
