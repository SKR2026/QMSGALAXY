# HIRA Management System

**Hazard Identification & Risk Assessment Management System**

A production-ready, Firebase-powered EHS web application for managing HIRA studies across multiple plants and sites.

---

## Features

- **Multi-plant architecture** — Corporate, Plant 01–05 and more
- **Role-based access control** — Super Admin, Corporate EHS, Plant Admin, Assessor, Viewer
- **Full HIRA lifecycle** — Draft → Submitted → Review → Approved / Rejected
- **Risk matrix** — 5×5 Likelihood × Severity with configurable thresholds
- **Hazard identification** — 23 hazard categories, hierarchy of controls
- **Initial & residual risk** — Visual comparison with risk reduction tracking
- **Action tracker** — Linked to HIRA hazards with status management
- **Automated email reminders** — Gmail via Firebase Cloud Functions
- **Dashboard & reports** — KPI cards, charts, Excel/CSV/PDF exports
- **Audit trail** — Immutable log of every significant change
- **In-app notifications** — Real-time unread count via Firestore listeners
- **Firestore security rules** — Plant-level access enforcement
- **Persistent data** — All data stored in Cloud Firestore, survives logout/refresh

---

## Project Structure

```
hira-system/
├── index.html              # Main single-page application
├── firebase.json           # Firebase hosting, functions, rules config
├── firestore.rules         # Security rules for Firestore
├── firestore.indexes.json  # Firestore composite indexes
├── storage.rules           # Firebase Storage security rules
├── functions/
│   ├── index.js            # Cloud Functions (email reminders, triggers)
│   └── package.json        # Functions dependencies
└── README.md               # This file
```

---

## Prerequisites

- Node.js 18+
- Firebase CLI: `npm install -g firebase-tools`
- A Google/Firebase account

---

## Step-by-Step Deployment

### 1. Create Firebase Project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add project** → Enter a name (e.g. `hira-system`)
3. Enable Google Analytics (optional)
4. Wait for project creation

### 2. Enable Firebase Services

In your Firebase project console:

- **Authentication** → Get started → Enable **Email/Password** sign-in
- **Firestore Database** → Create database → Choose region (e.g. `asia-south1` for India) → Start in **production mode**
- **Storage** → Get started → Accept defaults
- **Functions** → Get started (requires Blaze plan for external network calls)

### 3. Install Firebase CLI

```bash
npm install -g firebase-tools
firebase login
```

### 4. Configure the Application

Open `index.html` and replace the `firebaseConfig` object with your actual Firebase project config:

```javascript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

You can find this in Firebase Console → Project Settings → Your apps → Web app → SDK setup and configuration.

### 5. Initialize Firebase in Your Directory

```bash
cd hira-system
firebase use --add
# Select your project when prompted
```

Or manually create `.firebaserc`:

```json
{
  "projects": {
    "default": "YOUR_PROJECT_ID"
  }
}
```

### 6. Install Cloud Functions Dependencies

```bash
cd functions
npm install
cd ..
```

### 7. Configure Gmail for Email Reminders

The system uses Gmail App Passwords (NOT your real password).

**Set up Gmail App Password:**
1. Go to [myaccount.google.com](https://myaccount.google.com) → Security
2. Enable 2-Step Verification
3. Go to App passwords → Generate an app password for "Mail"
4. Copy the 16-character password

**Configure Firebase Functions:**
```bash
firebase functions:config:set gmail.user="your-email@gmail.com"
firebase functions:config:set gmail.password="YOUR_APP_PASSWORD"
firebase functions:config:set app.url="https://YOUR_PROJECT.web.app"
```

**Verify config:**
```bash
firebase functions:config:get
```

### 8. Deploy Firestore Rules

```bash
firebase deploy --only firestore:rules
```

### 9. Deploy Firestore Indexes

```bash
firebase deploy --only firestore:indexes
```

Note: Index deployment can take 5–15 minutes. Check status in Firebase Console → Firestore → Indexes.

### 10. Deploy Storage Rules

```bash
firebase deploy --only storage
```

### 11. Deploy Cloud Functions

```bash
firebase deploy --only functions
```

### 12. Deploy Hosting

```bash
firebase deploy --only hosting
```

### 13. Full Deploy (all at once)

```bash
firebase deploy
```

Your app will be available at:
- `https://YOUR_PROJECT.web.app`
- `https://YOUR_PROJECT.firebaseapp.com`

---

## First Run

1. Open your app URL
2. Click **Create account** to register the first user
   - The **first registered user** is automatically granted **Super Admin** role
3. Log in → You'll have full access
4. Click **Demo seed data** to populate sample plants, HIRAs, and actions
5. Add more users from **User Management** → Assign roles and plants

---

## User Roles

| Role | Create HIRA | Submit | Review/Approve | Manage Users | All Plants |
|------|-------------|--------|----------------|--------------|------------|
| Super Admin | ✓ | ✓ | ✓ | ✓ | ✓ |
| Corporate EHS | ✓ | ✓ | ✓ | — | ✓ |
| Plant Admin | ✓ | ✓ | — | — | Assigned only |
| HIRA Assessor | ✓ | ✓ | — | — | Assigned only |
| Viewer | — | — | — | — | Assigned only |

---

## HIRA Workflow

```
Draft → Submitted → Under Review → Approved
                              ↘ Rejected → Revision Required → Resubmitted → Approved
```

## Risk Matrix

| | Insignificant (1) | Minor (2) | Moderate (3) | Major (4) | Catastrophic (5) |
|---|---|---|---|---|---|
| Almost Certain (5) | 5-M | 10-H | 15-H | 20-C | 25-C |
| Likely (4) | 4-L | 8-M | 12-H | 16-H | 20-C |
| Possible (3) | 3-L | 6-M | 9-M | 12-H | 15-H |
| Unlikely (2) | 2-L | 4-L | 6-M | 8-M | 10-H |
| Rare (1) | 1-L | 2-L | 3-L | 4-L | 5-M |

L = Low (1–4), M = Medium (5–9), H = High (10–16), C = Critical (17–25)

---

## Testing Cloud Functions Locally

```bash
firebase emulators:start
```

**Test reminder function:**
```bash
firebase functions:shell
# In shell:
hiraReviewReminder({})
actionReminder({})
```

**Check logs:**
```bash
firebase functions:log
```

---

## Environment Variables (Production)

| Key | Description |
|-----|-------------|
| `gmail.user` | Gmail address for sending reminders |
| `gmail.password` | Gmail App Password (not real password) |
| `app.url` | Your Firebase Hosting URL |

---

## Firestore Data Structure

```
plants/{plantId}
  - name, plantCode, location, status, ehsContact, ehsEmail

users/{uid}
  - uid, name, email, role, plantIds[], status, department

hiras/{hiraId}
  - hiraId, plantId, activity, status, hazards[], ...
  /approvals/{approvalId}
    - action, newStatus, userId, comments, timestamp

actions/{actionId}
  - actionId, hiraId, plantId, description, status, targetDate, ...

notifications/{notifId}
  - uid, title, body, read, createdAt

auditLogs/{logId}
  - userId, module, action, timestamp, oldValue, newValue

emailLogs/{logId}
  - reminderKey, type, status, sentAt, recipient
```

---

## Security Notes

- **Never expose Gmail credentials** in frontend code
- All secrets are stored in Firebase Functions config (server-side)
- Firestore rules enforce plant-level data isolation
- Audit logs are immutable (no update/delete allowed)
- Approval records are immutable once created
- Users cannot modify their own role or plant assignments

---

## Upgrading to Production

1. Enable **Firebase App Check** for bot protection
2. Set up **Custom Claims** via Firebase Admin SDK for role enforcement at token level
3. Enable **Firebase Performance Monitoring**
4. Configure **Firebase Alerts** for high error rates
5. Set up **Cloud Armor** or rate limiting for Cloud Functions
6. Consider **Blaze plan** budget alerts to avoid unexpected charges

---

## Support

For deployment issues, check:
- [Firebase Documentation](https://firebase.google.com/docs)
- [Cloud Firestore](https://firebase.google.com/docs/firestore)
- [Firebase Functions](https://firebase.google.com/docs/functions)
- [Firebase Hosting](https://firebase.google.com/docs/hosting)
