# PTMS – Plant Transport & Material Tracking System

A web-based multi-plant transport and material movement tracking system built with HTML5, Vanilla JavaScript, and Firebase (Firestore + Auth + Hosting).

---

## 🗂️ Project Structure

```
ptms/
├── index.html            ← Login page + app shell
├── management.html       ← Public management dashboard (no login)
├── css/
│   └── style.css         ← Full responsive stylesheet
├── js/
│   ├── firebase.js       ← Firebase init + exports
│   ├── auth.js           ← Login, logout, role guards
│   ├── app.js            ← Router, nav, session
│   ├── dispatch.js       ← Create & view outgoing dispatches
│   ├── receipt.js        ← Confirm incoming vehicle receipts
│   ├── dashboard.js      ← Plant & admin dashboards
│   ├── reports.js        ← Filterable reports + CSV export
│   └── admin.js          ← Plants master + user management
├── firestore.rules       ← Firestore security rules
├── firestore.indexes.json← Composite indexes
├── firebase.json         ← Hosting + Firestore config
└── .firebaserc           ← Firebase project pointer
```

---

## 🚀 Setup Instructions

### Step 1 – Create Firebase Project

1. Go to https://console.firebase.google.com
2. Click **Add Project** → give it a name (e.g. `ptms-company`)
3. Enable **Google Analytics** (optional)

### Step 2 – Enable Firestore

1. In Firebase Console → **Firestore Database**
2. Click **Create Database**
3. Choose **Production mode** (rules will be deployed)
4. Select region (e.g. `asia-south1` for India)

### Step 3 – Enable Authentication

1. Firebase Console → **Authentication** → **Get Started**
2. Enable **Email/Password** provider

### Step 4 – Get your Firebase Config

1. Firebase Console → Project Settings (⚙️) → **Your apps** → Web
2. Click **Add app** → register a web app
3. Copy the config object

### Step 5 – Paste Config into the app

Paste your config in **two places**:

**`js/firebase.js`** — replace the placeholder `FIREBASE_CONFIG` object:
```javascript
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSy...",
  authDomain:        "your-project.firebaseapp.com",
  projectId:         "your-project",
  storageBucket:     "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123456789:web:abc..."
};
```

**`management.html`** — same config in the `<script type="module">` block.

Also update **`.firebaserc`**:
```json
{ "projects": { "default": "your-project" } }
```

### Step 6 – Install Firebase CLI & Deploy

```bash
npm install -g firebase-tools
firebase login
cd ptms/
firebase deploy --only hosting,firestore
```

### Step 7 – Create First Super Admin User

Since no users exist yet, do this via Firebase Console:

1. **Authentication** → **Add User** → enter email + password
2. **Firestore** → **Start collection** → Collection ID: `users`
3. Add a document with **Document ID = that user's UID** (copy from Auth):
```json
{
  "name": "Admin User",
  "email": "admin@company.com",
  "role": "superAdmin",
  "plantId": null,
  "isActive": true,
  "createdAt": (use Timestamp type)
}
```
4. Log in at `index.html` → Super Admin panel → add Plants → add Plant Users

---

## 👥 User Roles

| Role | Access |
|------|--------|
| **Management** | `management.html` — no login, read-only view of all data |
| **Plant User** | Login at `index.html` — can dispatch from their plant, receive at their plant, view their reports |
| **Super Admin** | Login at `index.html` — full access; manage plants & users; see all data |

---

## 📋 Dispatch ID Format

`PTMS-YYYY-00001`  (e.g. `PTMS-2026-00001`)

Auto-generated using a Firestore transaction counter — guaranteed unique even with concurrent users.

---

## 🔒 Security Design

- **Management view**: Public read of `dispatches` and `plants` only. No write access, no auth credentials exposed.
- **Plant Users**: Can only create dispatches FROM their assigned plant. Can only confirm receipts TO their plant. Cannot delete dispatches or modify original dispatch data after receipt.
- **Activity Logs**: Append-only. No user (including super admin) can delete logs.
- **Firestore Rules**: Enforce all role restrictions server-side — cannot be bypassed from browser.

---

## 🌐 Pages

| URL | Description |
|-----|-------------|
| `/index.html` | Login + authenticated app (dispatch, receipt, reports) |
| `/management.html` | Public read-only management dashboard |

---

## 📦 Firestore Collections

| Collection | Description |
|------------|-------------|
| `plants` | Plant master (code, name, location, contact) |
| `users` | User profiles (name, email, role, plantId, isActive) |
| `dispatches` | Dispatch records (created by Plant A, updated on receipt by Plant B) |
| `activityLogs` | Immutable audit trail of all actions |
| `counters` | Auto-increment counters for Dispatch IDs |

---

## 🛠️ Tech Stack

- **Frontend**: HTML5, CSS3, Vanilla JavaScript (ES Modules)
- **Database**: Firebase Firestore (NoSQL)
- **Auth**: Firebase Authentication (Email/Password)
- **Hosting**: Firebase Hosting
- **No build step** — runs directly in browser

---

## 📞 Support

For issues, contact the system administrator or the development team.
