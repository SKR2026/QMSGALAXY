# VEMS — Vehicle Expense Management System

Enterprise-grade SPA for managing multi-plant fleet expenses, CO₂ tracking, and mileage analytics. Hosted on Firebase with Cloud Functions scheduler.

## Features

| Module | Description |
|---|---|
| **Dashboard** | KPI cards, monthly trend charts, plant-wise comparison, document alerts |
| **Vehicles** | Full CRUD with document expiry tracking, expense timeline, odometer history |
| **Expenses** | Paginated expense log with mandatory bill upload, multi-plant filters |
| **Mileage** | Fleet mileage KPIs, monthly fuel trends, per-vehicle efficiency table |
| **CO₂** | Emission estimates by fuel type, monthly trend, plant-wise comparison |
| **Alerts** | Document expiry alerts grouped by severity (expired/critical/warning/notice) |
| **Reports** | 8 report types with PDF export (vehicle, plant, category, fuel, CO₂...) |
| **Bulk Upload** | CSV template download, drag-drop import with row validation |
| **Plants** | Multi-plant cards with vehicle count and expense totals |
| **Users** | Role-based user management (Super Admin / Plant Admin) |
| **Management View** | No-login read-only dashboard via token URL |
| **Audit Log** | Full action audit trail (superadmin only) |
| **Settings** | Management token generator, CO₂ factor editor, notification thresholds |

## Tech Stack

- **Frontend**: React 18, Vite, React Router v6, Recharts, Lucide icons
- **Backend**: Firebase (Hosting, Auth, Firestore, Storage, Cloud Functions)
- **Cloud Functions**: Node.js 20, scheduled jobs via Google Cloud Scheduler
- **Export**: jsPDF + autoTable, xlsx

## Roles

| Role | Access |
|---|---|
| `superadmin` | All plants, all features, Settings, Users, Audit, Plants |
| `plant_admin` | Own plant only — Vehicles, Expenses, Reports, Mileage, CO₂, Alerts |
| Management (token) | Read-only dashboard via `/management?token=...` |

---

## Getting Started

### 1. Clone & Install

```bash
cd vems
npm install
cd functions && npm install && cd ..
```

### 2. Firebase Setup

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable **Authentication** (Email/Password), **Firestore**, **Storage**, **Functions**
3. Copy `.env.example` → `.env` and fill in your Firebase config

```bash
cp .env.example .env
# edit .env with your Firebase credentials
```

### 3. Run in Demo Mode (no Firebase needed)

```bash
npm run dev
```

Visit `http://localhost:5173` — the app runs entirely in-memory with sample data.

**Demo accounts:**
| User | Email | Password |
|---|---|---|
| Super Admin | rajiv@orgfleet.com | password123 |
| Plant Admin (Manesar) | deepak@orgfleet.com | password123 |
| Plant Admin (Pune) | priya@orgfleet.com | password123 |

**Management view:** `/management?token=mgmt-view-2026-secure-abc123`

---

## Firebase Deployment

### 4. Install Firebase CLI

```bash
npm install -g firebase-tools
firebase login
```

### 5. Configure Project

```bash
firebase use --add
# Select your project and give it an alias (e.g., "production")
```

Edit `.firebaserc`:
```json
{
  "projects": {
    "default": "your-actual-project-id"
  }
}
```

### 6. Deploy Firestore Rules & Indexes

```bash
firebase deploy --only firestore
firebase deploy --only storage
```

### 7. Seed Initial Data (optional)

```bash
node scripts/seed.js   # (create this to push sampleData.js to Firestore)
```

### 8. Build & Deploy Frontend

```bash
npm run build
firebase deploy --only hosting
```

### 9. Deploy Cloud Functions

```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

---

## Cloud Functions (Scheduler)

| Function | Schedule | Description |
|---|---|---|
| `dailyExpiryAlert` | Daily 7:00 AM IST | Checks insurance, pollution, fitness expiry for all vehicles; creates critical notifications |
| `monthlyExpenseReport` | 1st of month 8:00 AM IST | Generates monthly aggregated report by plant; notifies superadmin |
| `weeklyMileageSummary` | Monday 9:00 AM IST | Aggregates weekly fuel consumption and flags low-mileage vehicles |
| `cleanupOldAlerts` | Sunday 2:00 AM IST | Deletes acknowledged alerts older than 90 days |
| `checkMissingBills` | Daily 6:00 PM IST | Flags yesterday's expenses without bill attachment |
| `onExpenseCreate` | Firestore trigger | Logs expense creation to audit trail |
| `generateReport` | HTTP callable | On-demand report generation from admin UI |

---

## Firestore Collections

```
/users/{userId}           — user profiles + roles
/plants/{plantId}         — plant definitions
/vehicles/{vehicleId}     — vehicle records + document expiry dates
/expenses/{expenseId}     — expense records (with plantId, vehicleId, hasBill)
/bills/{billId}           — bill metadata (actual files in Storage)
/alerts/{alertId}         — document expiry alerts
/notifications/{id}       — push notifications (in-app)
/audit_log/{logId}        — full audit trail (Cloud Functions write-only)
/monthly_reports/{month}  — aggregated monthly summaries
/weekly_reports/{id}      — aggregated weekly mileage reports
/mgmt_tokens/{tokenId}    — management view tokens
```

## Storage Paths

```
/bills/{plantId}/{vehicleId}/{fileName}    — expense bill attachments
/bulk_uploads/{userId}/{fileName}          — temporary CSV uploads
/reports/{reportId}                        — generated PDF reports
```

---

## Environment Variables

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

---

## Security Notes

- Bill upload is **mandatory** before expense submission (client-side enforced)
- Management view tokens are time-limited and can be revoked from Settings
- Firestore rules enforce plant-scoped data access for plant admins
- Audit log is **write-only from Cloud Functions** — tamper-proof
- Storage rules limit uploads to PDF/JPG/PNG under 10MB
- All Cloud Functions deployed to `asia-south1` (Mumbai) for low latency

---

## Build for Production

```bash
npm run build        # outputs to /dist
firebase deploy      # deploys hosting + functions + rules
```

Or deploy individually:
```bash
firebase deploy --only hosting      # frontend only
firebase deploy --only functions    # Cloud Functions only
firebase deploy --only firestore    # rules + indexes only
```
