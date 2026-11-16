# Gift Management System — Firebase + GitHub starter

This is a Firebase Hosting starter for a centralized multi-plant Gift Management System.

## Included
- `public/index.html`: responsive web app with employee registration/login, gift request submission, plant review, Top Management approval, basic dashboard, and pending-user activation.
- `firestore.rules`: initial role and plant-scoped access rules.
- `firestore.indexes.json`: index manifest (initially empty).
- `firebase.json` and `.firebaserc`: Firebase Hosting / Firestore deployment configuration.
- `.github/workflows/firebase-hosting.yml`: deploys Hosting on pushes to `main`.

## Before deployment

1. Create/select a Firebase project.
2. Enable **Authentication → Email/Password**.
3. Create a **Cloud Firestore** database.
4. Register a Firebase Web App and copy its config into `public/index.html` (`firebaseConfig`).
5. Replace `YOUR_FIREBASE_PROJECT_ID` in `.firebaserc` and `.github/workflows/firebase-hosting.yml`.
6. In Firestore, create the following master documents:
   - `plants/{plantId}` with `{ "name": "Plant Name", "active": true }`
   - `departments/{departmentId}` with `{ "name": "Department Name", "active": true }`
7. Create the first Super Admin user:
   - Create the user in Firebase Authentication.
   - Create `users/{AUTH_UID}` in Firestore with fields:
     ```json
     {
       "employeeCode": "ADMIN001",
       "name": "System Administrator",
       "designation": "Super Admin",
       "departmentId": "admin",
       "plantId": "all",
       "email": "admin@example.com",
       "mobile": "",
       "role": "superadmin",
       "status": "active"
     }
     ```
   Use the exact Authentication UID as the Firestore document ID.

## Deploy from your computer

Install Node.js and Firebase CLI, then run from this project folder:

```bash
npm install -g firebase-tools
firebase login
firebase use YOUR_FIREBASE_PROJECT_ID
firebase deploy --only hosting,firestore:rules,firestore:indexes
```

## Deploy automatically through GitHub

1. Push these files to a GitHub repository, branch `main`.
2. In GitHub repository settings → Secrets and variables → Actions, add:
   - `FIREBASE_SERVICE_ACCOUNT`: JSON content of a Firebase service account key with appropriate Firebase Hosting deployment permissions.
3. Update `YOUR_FIREBASE_PROJECT_ID` in `.github/workflows/firebase-hosting.yml`.
4. Push to `main`; GitHub Actions deploys the Hosting site.

## Important implementation notes

- This is a functional starter, not a fully audited production release.
- Create user accounts through the public registration form. Accounts remain `pending` until a Plant Admin/Super Admin activates them.
- The first Super Admin must be provisioned manually as described above.
- Firestore rules are a starting point and should be security-reviewed before production.
- The current front end provides the core request and approval path. Gift catalogue CRUD, procurement receipts, inventory ledger, recipient-level distribution, bulk Excel import/export, email notifications, approval history UI, and server-side audit logging are planned extensions.
- For strong employee-code uniqueness, use a trusted Cloud Function/transaction-backed registration endpoint. Client-side duplicate checking alone is not sufficient against concurrent registrations.
- Do not place service-account credentials or private keys in the website source code or GitHub repository.
