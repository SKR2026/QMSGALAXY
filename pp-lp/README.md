# LPA Management System

**Enterprise Layered Process Audit Management**  
Multi-plant · Role-based access · Real-time · Cloud Functions  

---

## Architecture Overview

```
Firebase Hosting  ──→  index.html (Single Page Application)
                          │
                          ├── Firebase Authentication  (identity)
                          │
                          ├── Firestore  (data, real-time)
                          │     └── /apps/lpa/  (namespace — isolated from other apps)
                          │
                          └── Cloud Functions  (server-side automation)
                                │
                                ├── processDailyReminders  (scheduled daily)
                                ├── processEmailQueue      (scheduled every 15 min)
                                └── createLPAUser          (callable — create users)
```

**Key principle:** The application never relies on the browser being open for reminders or escalations. Cloud Functions handle all automated processing independently.

---

## Prerequisites

- [Node.js 18+](https://nodejs.org/)
- [Firebase CLI](https://firebase.google.com/docs/cli): `npm install -g firebase-tools`
- A [Firebase project](https://console.firebase.google.com/) with:
  - Authentication enabled (Email/Password provider)
  - Firestore enabled (Native mode)
  - Functions enabled (Blaze / pay-as-you-go plan required for Cloud Functions)

---

## Step 1 — Firebase Project Setup

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project (e.g. `lpa-management-prod`)
3. Enable **Authentication** → Sign-in method → **Email/Password**
4. Enable **Firestore** → Start in **production mode**
5. Enable **Hosting**

---

## Step 2 — Get Firebase Config

1. Firebase Console → Project Settings → General → Your apps
2. Click "Add app" → Web app
3. Copy the `firebaseConfig` object
4. Open `js/firebase-config.js` and replace the placeholder values:

```javascript
const firebaseConfig = {
  apiKey:            "YOUR_ACTUAL_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};
```

> **These values are public browser API keys — safe to include in frontend code.**  
> **NEVER place `serviceAccountKey.json` or private keys in any frontend file.**

---

## Step 3 — Clone and Configure Repository

```bash
git clone https://github.com/YOUR_ORG/lpa-management-system.git
cd lpa-management-system
```

Update `js/firebase-config.js` with your project credentials (see Step 2).

---

## Step 4 — Deploy Firestore Rules and Indexes

```bash
firebase login
firebase use YOUR_PROJECT_ID

# Deploy security rules (IMPORTANT — do this first)
firebase deploy --only firestore:rules

# Deploy indexes
firebase deploy --only firestore:indexes
```

> **Security rules are critical.** Without them, data is either fully open or fully closed.  
> Allow ~5 minutes for indexes to build before running complex queries.

---

## Step 5 — Deploy Cloud Functions

```bash
cd functions
npm install
cd ..

firebase deploy --only functions
```

To configure email notifications (optional but recommended):

```bash
# For SendGrid
firebase functions:config:set email.provider="sendgrid" email.apikey="SG.your_key_here" email.from="noreply@yourcompany.com" email.name="LPA System"

# For Resend
firebase functions:config:set email.provider="resend" email.apikey="re_your_key_here"

# Re-deploy after setting config
firebase deploy --only functions
```

---

## Step 6 — Deploy Frontend

```bash
firebase deploy --only hosting
```

Your application will be live at: `https://YOUR_PROJECT_ID.web.app`

---

## Step 7 — Create the First Super Admin

> **This step must be done carefully.** The system uses Firebase Auth UID as the Firestore document ID for user profiles.

### Method A — Firebase Console (Recommended for initial setup)

1. **Firebase Console → Authentication → Add user**
   - Email: `superadmin@yourcompany.com`
   - Password: (set a strong password)
   - Copy the **UID** shown (e.g. `abc123def456`)

2. **Firebase Console → Firestore → `/apps/lpa/users/`**
   - Click "Add document"
   - **Document ID:** paste the UID from step 1 exactly
   - Add these fields:

```
name:         "Super Admin"           (string)
email:        "superadmin@yourcompany.com"  (string)
empId:        "SA001"                 (string)
role:         "super_admin"           (string)
status:       "active"                (string)
plantId:      null
initials:     "SA"                    (string)
createdAt:    (click clock icon → server timestamp)
```

3. Open the application and log in with the Super Admin credentials.

### Method B — Seed Script (Alternative)

```bash
# Run from project root (requires service account)
node scripts/seedSuperAdmin.js --email=superadmin@yourcompany.com
```

---

## Step 8 — Initial Application Setup

After logging in as Super Admin:

### 1. Create Plants
- Navigate to **Master Data → Plants**
- Add each plant (Plant 1, Plant 2, Plant 3, etc.)

### 2. Create Departments
- **Master Data → Departments**
- Assign each department to a plant

### 3. Create Processes
- **Master Data → Processes**
- Assign to departments

### 4. Create Audit Levels
- **Master Data → Audit Levels**
- Example:
  - Level 1 — Operator (Daily)
  - Level 2 — Supervisor (Daily/Weekly)
  - Level 3 — Department Head (Weekly)
  - Level 4 — Plant Head (Monthly)
  - Level 5 — Corporate (Monthly/Quarterly)

### 5. Create LPA Questions
- **Master Data → Questions**
- Assign questions to Plant + Audit Level
- Set criticality (Critical/Major/Minor)

### 6. Create Plant Admins
- **Users → Add User**
- Role: Plant Admin
- Assign to a plant

### 7. Create Auditors
- **Users → Add User**
- Role: Auditor
- Assign to a plant

---

## Step 9 — GitHub Deployment Workflow (Optional)

To enable automatic deployment on push:

1. Create `.github/workflows/firebase-deploy.yml`:

```yaml
name: Deploy to Firebase
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
        working-directory: functions
      - uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          repoToken: ${{ secrets.GITHUB_TOKEN }}
          firebaseServiceAccount: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}
          projectId: YOUR_PROJECT_ID
```

2. Add `FIREBASE_SERVICE_ACCOUNT` to GitHub repository secrets.

---

## Full Deployment Commands Reference

```bash
# All at once
firebase deploy

# Individual components
firebase deploy --only hosting
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
firebase deploy --only functions

# Functions only
cd functions && npm install && cd ..
firebase deploy --only functions
```

---

## Data Structure

All LPA data is namespaced under `/apps/lpa/` to prevent conflicts with other applications in the same Firebase project:

```
/apps/lpa/
├── users/{userId}              ← LPA-specific user profiles
├── plants/{plantId}
├── departments/{deptId}
├── processes/{processId}
├── auditLevels/{levelId}
├── questionMasters/{questionId}
├── audits/{auditId}
├── auditDrafts/{auditId}       ← Temporary draft responses
├── findings/{findingId}
├── correctiveActions/{actionId}
├── notifications/{notifId}
├── activityLogs/{logId}        ← Immutable audit trail
├── emailQueue/{queueId}        ← Cloud Functions only
├── categories/{catId}
└── settings/{settingId}
```

---

## Role Permissions

| Feature | Super Admin | Plant Admin | Auditor | Management |
|---------|:-----------:|:-----------:|:-------:|:----------:|
| All plants | ✓ | — | — | — |
| Own plant | ✓ | ✓ | ✓ | ✓ |
| Manage users | ✓ | Plant | — | — |
| Manage plants | ✓ | — | — | — |
| Create audit | ✓ | ✓ | — | — |
| Execute audit | ✓ | ✓ | ✓ | — |
| Reopen audit | ✓ | ✓ | — | — |
| Verify action | ✓ | ✓ | — | — |
| Close finding | ✓ | ✓ | — | — |
| View reports | ✓ | ✓ | Limited | ✓ |
| Activity log | ✓ | — | — | — |
| System settings | ✓ | — | — | — |

---

## Security Notes

1. **Firestore Security Rules** enforce all authorization server-side. Bypassing the UI does not grant additional access.

2. **Plant isolation** is enforced in rules — a Plant Admin for Plant A cannot read Plant B data even with direct Firestore API calls.

3. **Audit immutability** — submitted/verified audits cannot be modified by normal users. Reopen creates an audit trail.

4. **Activity logs** are append-only — no user can update or delete them (enforced in rules).

5. **Email credentials** are stored in Firebase Functions environment config, never in frontend code or the repository.

6. **Service account keys** must never be committed to git. Use Firebase managed identity in Cloud Functions.

---

## Troubleshooting

### "Missing or insufficient permissions"
- Check Firestore rules are deployed: `firebase deploy --only firestore:rules`
- Verify the user's LPA profile exists in `/apps/lpa/users/{uid}` with `status: "active"` and a valid `role`
- Ensure the user's `plantId` matches the data they're trying to access

### "Your account has not been configured"
- The user logged in via Firebase Auth but has no LPA profile document
- Create the profile in Firestore Console under `/apps/lpa/users/{uid}`

### Functions not running
- Check Firebase Console → Functions → Logs
- Verify the project is on Blaze (pay-as-you-go) plan
- Functions require billing to be enabled for scheduled triggers

### Indexes not built
- After deploying indexes, wait 5-10 minutes
- Check Firebase Console → Firestore → Indexes for build status

---

## Support

For issues, open a GitHub issue or review Firebase Console logs:
- **Hosting logs:** Firebase Console → Hosting
- **Function logs:** Firebase Console → Functions → Logs
- **Firestore security rules:** Firebase Console → Firestore → Rules → Rules Playground

---

*LPA Management System v2.0 — Built for enterprise manufacturing quality compliance*
