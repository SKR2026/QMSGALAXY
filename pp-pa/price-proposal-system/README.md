# Price Proposal Approval System

A secure, multi-plant price proposal approval system with magic link email approvals, built as a single-page app on Firebase.

## Quick Start

### 1. Create Firebase Project
1. Go to https://console.firebase.google.com/
2. Click "Add project" → name it (e.g. `price-proposal-app`)
3. Enable Google Analytics (optional)

### 2. Enable Firebase Services
In your project console:
- **Authentication** → Sign-in method → Enable Email/Password
- **Firestore** → Create database → Start in production mode → Choose region
- **Storage** → Get started → Production mode
- **Functions** → (will be deployed via CLI)
- **Hosting** → Get started

### 3. Get Firebase Config
- Project Settings → General → Your apps → Add web app
- Copy the `firebaseConfig` object

### 4. Configure the App
Edit `public/index.html` lines 1062–1069:
```js
const firebaseConfig = {
  apiKey: "YOUR_ACTUAL_API_KEY",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

### 5. GitHub Repository Setup
1. Push this project to a GitHub repository
2. Go to repo Settings → Secrets and variables → Actions
3. Add these secrets:
   - `FIREBASE_SERVICE_ACCOUNT` — from Firebase Console → Project Settings → Service accounts → Generate new private key (paste entire JSON)
   - `FIREBASE_PROJECT_ID` — your Firebase project ID (e.g. `price-proposal-app`)

### 6. Deploy via GitHub Actions
- Every push to `main` branch auto-deploys via `.github/workflows/firebase-deploy.yml`
- PRs get preview URLs automatically

### 7. Deploy Firestore Rules & Indexes
```bash
npm install -g firebase-tools
firebase login
firebase use YOUR_PROJECT_ID
firebase deploy --only firestore:rules,firestore:indexes,storage
```

### 8. Deploy Cloud Functions
```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

### 9. First-Time Setup
1. Open your deployed app URL
2. Register the first account — it automatically becomes **Super Admin**
3. Go to Settings → Company to add your logo and company name
4. Go to Plants → Add Plant (e.g. Plant 01, Plant 02)
5. Go to Users → Add users with appropriate roles
6. Go to Approval Matrix → Configure approval levels and limits

---

## Magic Link Approvals

When a proposal is submitted, approvers receive:
1. **Standard email** with login link (always works)
2. **One-click magic link** for quick approval without logging in

### How Magic Links Work
1. Cloud Function generates a secure token (UUID + HMAC) stored in `magicLinkTokens` collection
2. Token expires after 48 hours and is single-use
3. Link is sent in email: `https://your-app.web.app/?magic=TOKEN&action=approve`
4. Approver opens link:
   - **Not logged in** → sees proposal preview + login button (redirects back after login)
   - **Logged in as correct user** → can approve/reject/return directly
   - **Logged in as wrong user** → sees warning, redirected to login
5. Approval is recorded with Firebase Auth identity (cannot be faked)

---

## Cloud Functions Required

Deploy these functions in `functions/src/index.ts`:

| Function | Trigger | Purpose |
|----------|---------|---------|
| `submitProposal` | Callable | Validates, numbers, routes proposal |
| `processApproval` | Callable | Records approval, moves to next level |
| `processRejection` | Callable | Records rejection, notifies creator |
| `processReturn` | Callable | Returns to creator for correction |
| `validateMagicLinkToken` | Callable | Validates token, returns proposal data |
| `processMagicLinkApproval` | Callable | Processes action via magic link |
| `createUser` | Callable | Creates Firebase Auth user + Firestore profile |
| `generateApprovedProposalPDF` | Callable | Generates PDF, uploads to Storage |
| `sendApprovalEmail` | Firestore trigger | Sends email on proposal update |
| `processPendingApprovalReminders` | Scheduled (every hour) | Sends reminder emails |
| `escalateOverdueApproval` | Scheduled (every 6h) | Escalates overdue approvals |
| `generateProposalNumber` | Internal | Atomic counter-based numbering |

---

## Database Structure

```
/users/{uid}
  name, email, role, plantIds[], department, status

/plants/{plantId}
  code, name, location, managerName, managerEmail, status

/proposals/{proposalId}
  proposalNumber, plantId, plantName
  createdBy, createdByName, createdByEmail
  partyName, productService, description, justification
  currentPrice, proposedPrice, difference, diffPercent
  category, validity, proposalDate
  status, currentApprovalLevel, currentApproverId, currentApproverEmail
  submittedAt, approvedAt, createdAt, updatedAt
  attachments[]

/proposals/{proposalId}/approvalHistory/{histId}
  level, approverId, approverName, approverEmail
  action, comment, timestamp (server-set)

/approvalMatrices/{ruleId}
  plantId, category, level, levelName
  approverId, approverName, approverEmail
  minValue, maxValue, maxPctChange, order

/magicLinkTokens/{token}
  proposalId, approverId, approverEmail
  action, createdAt, expiresAt, used, usedAt

/notifications/{notifId}
  userId, title, body, proposalId, read, readAt, createdAt

/emailTemplates/{type}
  subject, body, updatedAt

/settings/app
  companyName, companyShort, address, logoUrl, footerText

/settings/approval
  reminder1Hrs, reminder2Hrs, escalationHrs, maxReminders, reminderFreq

/settings/numbering
  format, currency, dateFormat

/counters/proposals
  count (atomically incremented per plant/year)

/auditLogs/{logId}
  userId, userName, userEmail, userRole
  proposalId, proposalNumber, action, details, timestamp
```

---

## Role Permissions

| Feature | Super Admin | Plant Admin | Proposal Creator | Approver | Viewer |
|---------|-------------|-------------|-----------------|----------|--------|
| View all proposals | ✅ | Own plant | Own proposals | Assigned | Read-only |
| Create proposals | ✅ | ✅ | ✅ | ❌ | ❌ |
| Approve proposals | ✅ | ✅ | ❌ | ✅ | ❌ |
| Manage users | ✅ | Own plant | ❌ | ❌ | ❌ |
| Manage plants | ✅ | ❌ | ❌ | ❌ | ❌ |
| Approval matrix | ✅ | ❌ | ❌ | ❌ | ❌ |
| Settings | ✅ | Partial | ❌ | ❌ | ❌ |
| Audit logs | ✅ | ✅ | ❌ | ❌ | ❌ |

---

## Security Highlights
- All approval actions validated server-side in Cloud Functions
- Magic link tokens are HMAC-signed, single-use, and expire after 48h
- Firestore Security Rules enforce plant-level access control
- Approval history is server-written only (Firestore rules block client writes)
- Server timestamps used everywhere (client time not trusted)
- Firebase Auth UID is always captured — email/name cannot be spoofed
