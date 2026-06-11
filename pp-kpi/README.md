# KPI Dashboard — Polyplastics India

A fully functional, Firebase-backed KPI Management Dashboard for tracking monthly KPI performance across plants and departments.

## Live app

After enabling GitHub Pages (Settings → Pages → Branch: `main`, Folder: `/`), your app will be live at:

```
https://<your-github-username>.github.io/<your-repo-name>/
```

---

## Repository structure

```
📁 repo-root/
├── index.html            ← redirect to kpi-dashboard.html (GitHub Pages entry point)
├── kpi-dashboard.html    ← main application
├── firebase-config.js    ← Firebase API layer (Auth + Firestore + Realtime DB)
└── README.md             ← this file
```

Both `kpi-dashboard.html` and `firebase-config.js` **must stay in the same folder**. The HTML imports the config via `./firebase-config.js` as an ES module.

---

## Firebase project

| Setting | Value |
|---|---|
| Project ID | `skr-msa` |
| Auth domain | `skr-msa.firebaseapp.com` |
| Realtime DB | `skr-msa-default-rtdb.asia-southeast1.firebasedatabase.app` |
| Storage bucket | `skr-msa.firebasestorage.app` |

---

## One-time Firebase setup (do these once in the Firebase Console)

### 1. Enable Email/Password auth
Firebase Console → Authentication → Sign-in method → Email/Password → Enable

### 2. Set Firestore rules
Firebase Console → Firestore → Rules → paste:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, write: if request.auth.uid == uid;
      allow read: if request.auth != null &&
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'Super Admin';
    }
    match /kpiMaster/{id} {
      allow read: if request.auth != null;
      allow write: if request.auth != null &&
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'Super Admin';
    }
    match /kpiData/{id} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
      allow update: if request.auth != null;
    }
    match /plants/{id} {
      allow read: if request.auth != null;
      allow write: if request.auth != null &&
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'Super Admin';
    }
  }
}
```

### 3. Set Realtime Database rules
Firebase Console → Realtime Database → Rules → paste:

```json
{
  "rules": {
    "kpiLive": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "alerts": {
      ".read": "auth != null",
      ".write": "auth != null"
    }
  }
}
```

### 4. Create the first Super Admin user

**Step A** — Firebase Console → Authentication → Add user → enter email + password

**Step B** — Firebase Console → Firestore → Create collection `users` → Document ID = the UID from Step A → add fields:

```
name         : "Sushil Kumar"          (string)
email        : "sushil@..."            (string)
role         : "Super Admin"           (string)
plant        : "All"                   (string)
department   : "All"                   (string)
createdAt    : (timestamp — use console picker)
```

### 5. Seed sample data (optional)
After signing in, open the browser console (F12) and run:

```js
window.FB.seedFirestore(kpiMaster, kpiData)
```

This pushes all sample KPI master records and historical entries into Firestore.

---

## User roles

| Role | Can do |
|---|---|
| **Super Admin** | Everything — create plants, KPIs, users, view all dashboards, see alerts |
| **Plant Admin** | View plant-specific dashboards, monitor submissions |
| **Department User** | Enter monthly KPI data for their plant + department |

---

## Adding more users

For each new user:
1. Firebase Console → Authentication → Add user
2. Firestore → `users` collection → new doc with UID as document ID → set `name`, `email`, `role`, `plant`, `department`

---

## Local development (without GitHub Pages)

Because ES modules require HTTP, you cannot open `kpi-dashboard.html` directly as a `file://` URL. Use a local server:

```bash
# Option 1 — Node.js
npx serve .

# Option 2 — Python
python3 -m http.server 8080

# Option 3 — VS Code
Install "Live Server" extension → right-click kpi-dashboard.html → Open with Live Server
```

Then open `http://localhost:8080` in your browser.

---

## Firestore collections reference

| Collection | Purpose |
|---|---|
| `users` | User profiles with role, plant, department |
| `plants` | Plant master (code + name) |
| `kpiMaster` | KPI definitions (target, unit, direction, weightage) |
| `kpiData` | Monthly KPI entries with action plans |

Realtime Database paths:

| Path | Purpose |
|---|---|
| `/kpiLive/{plant}/{year}/{month}/{entryId}` | Live KPI feed for dashboard updates |
| `/alerts/{alertId}` | Red KPI alerts for Super Admin banner |
