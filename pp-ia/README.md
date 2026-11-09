# Group-Level Integrated Internal Audit Management System
## Firebase Deployment Guide

---

### Project Structure

```
audit-firebase/
├── firebase.json              # Hosting, Firestore, Functions, Emulators config
├── .firebaserc                # Project alias
├── firestore.rules            # Security rules (all 20+ collections)
├── firestore.indexes.json     # 12 composite indexes
├── public/
│   ├── index.html             # Full SPA — 20 modules, Chart.js, SheetJS
│   └── firebase-config.js     # ← EDIT THIS with your project credentials
└── functions/
    ├── package.json
    └── index.js               # Cloud Functions (triggers + scheduled + callable)
```

---

### Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 20+ |
| Firebase CLI | Latest (`npm i -g firebase-tools`) |
| Firebase Plan | **Blaze** (pay-as-you-go) — required for Cloud Functions |

---

### Quick Start

```bash
# 1. Install Firebase CLI
npm install -g firebase-tools

# 2. Login
firebase login

# 3. Edit firebase-config.js with your project credentials

# 4. Update .firebaserc with your project ID
#    Replace "YOUR-FIREBASE-PROJECT-ID" with your actual project ID

# 5. Install Functions dependencies
cd functions && npm install && cd ..

# 6. Deploy everything
firebase deploy
```

---

### Firebase Console Setup (before first deploy)

1. **Authentication** → Sign-in method → Email/Password → **Enable**
2. **Firestore** → Create database → Start in **Production mode** → Choose region
3. **Storage** → Get started → Production mode
4. **Functions** → Already covered when you upgrade to Blaze

---

### Email Notifications (Gmail OAuth)

1. Enable **Secret Manager API** in Google Cloud Console
2. Create a secret named `gmail-oauth-creds`:
```json
{
  "clientId":     "your-oauth-client-id",
  "clientSecret": "your-oauth-client-secret",
  "refreshToken": "your-refresh-token",
  "fromEmail":    "audits@yourcompany.com"
}
```
3. Grant Cloud Functions service account: `roles/secretmanager.secretAccessor`

> To skip email for now: in `functions/index.js`, the `sendEmail()` function fails gracefully — the app continues working, just without email delivery.

---

### Local Development (Emulators)

```bash
firebase emulators:start
```

| Emulator | Port |
|----------|------|
| Auth | 9099 |
| Firestore | 8080 |
| Functions | 5001 |
| Hosting | 5000 |
| Emulator UI | 4000 |

Open http://localhost:5000 — the app detects emulators automatically when running on localhost.

---

### First-Time Data Seeding

After deploy, sign in with your Super Admin account and use the **Settings** module to:
- Upload your organization logo
- Configure the org name

Use Firestore Console to seed initial data:
- **plants** collection: add plant documents (`{name, code, location}`)
- **departments** collection: add departments (`{name, plant, head}`)
- **users** collection: add your first Super Admin user (UID = Firebase Auth UID)

---

### User Roles

| Role | Capabilities |
|------|-------------|
| Super Admin | Full access, all plants, user management, settings |
| Plant Admin | Full access within assigned plant |
| Auditor | Create/conduct audits, raise findings |
| Dept Head | View findings, update CAPA status for own dept |
| Viewer | Read-only across all modules |

---

### Cloud Functions Summary

| Function | Trigger | Description |
|----------|---------|-------------|
| `onFindingCreated` | Firestore write | Auto-creates CAPA, notifies plant admins |
| `onCAPAUpdated` | Firestore write | Updates myActions, notifies assignee |
| `onAuditPlanCreated` | Firestore write | Creates myAction for lead auditor |
| `onChecklistUploadLog` | Firestore write | Batch-processes bulk upload rows |
| `dailyCAPAReminder` | 08:00 IST daily | Marks overdue CAPAs, sends reminders |
| `weeklySupplierReminder` | 09:00 IST Monday | Alerts on suppliers due in 30 days |
| `monthlyKPISnapshot` | 1st of month | Writes KPI snapshot document |
| `getDashboardKPIs` | Callable | Aggregates dashboard metrics server-side |
| `sendManualNotification` | Callable | Admin sends manual push notification |
| `rollbackChecklistVersion` | Callable | Deletes a bulk-upload batch |

---

### Support

Built with:
- Firebase SDK v10 (compat)
- Chart.js 4.4.1
- SheetJS (xlsx) 0.18.5
- Material Icons + Inter font
