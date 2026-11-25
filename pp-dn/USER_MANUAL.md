# CDRTS User Manual
## Corporate Document Registration & Tracking System

---

## Table of Contents

1. [Overview](#overview)
2. [Logging In](#logging-in)
3. [Plant / Department User Guide](#plant--department-user-guide)
4. [Corporate MR Guide](#corporate-mr-guide)
5. [Superadmin Guide](#superadmin-guide)
6. [Document Statuses](#document-statuses)
7. [Email Notifications](#email-notifications)
8. [Frequently Asked Questions](#faq)

---

## Overview

CDRTS (Corporate Document Registration & Tracking System) ensures that official DMS (Document Management System) numbers are unique across all plants and departments. Users submit documents for numbering; Corporate MR processes them and assigns official numbers; the system prevents any duplicates through backend transaction control.

---

## Logging In

1. Navigate to your application URL
2. Enter your **email address** and **password**
3. Click **Sign In**
4. If you forgot your password, click **Forgot Password?** to receive a reset link

---

## Plant / Department User Guide

### Submitting a New Document

1. Click **Submit Document** in the sidebar
2. Fill in the form:
   - **Document Title** – Required; descriptive name of the document
   - **Document Category** – Select from the dropdown (configured by Superadmin)
   - **Plant** – Pre-filled with your assigned plant; change if needed
   - **Department** – Pre-filled with your assigned department
   - **Description** – Optional; brief description of the document
   - **Revision** – Optional; e.g., Rev 00, Rev A
   - **Attachment** – Upload the document file (PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX; max 50MB)
3. Click **Save as Draft** to save without submitting, or **Submit Document** to submit for numbering
4. On successful submission, you will receive a unique **Internal Reference Number** (e.g., CDRTS-2026-00042)

### Tracking Your Documents

1. Click **My Documents** in the sidebar
2. View all your submitted documents with their current status
3. Click the **eye icon** to view full document details including status history
4. Click the **download icon** to download your document
5. Documents in **Draft** or **Returned for Correction** status can be edited by clicking **Edit**

### Send Notification Button

If your document has been pending with Corporate MR for some time:

1. Click **Send Notification** in the top navigation bar
2. The system will send **one consolidated email** to Corporate MR listing ALL your pending documents
3. A cooldown period applies (default: 2 hours) to prevent repeated notifications
4. The last notification time is displayed next to the button

> **Note:** You will receive an email notification automatically when your document number is assigned or when your document is returned for correction.

---

## Corporate MR Guide

### Processing Queue

1. Click **Document Queue** in the sidebar
2. View all pending documents submitted by plant users
3. Use the filters at the top to filter by Plant, Department, Category, or Status
4. Use the search box to find specific documents

> **Note:** Opening a document automatically changes its status to **Under Process**

### Assigning a DMS Number

1. In the Document Queue, find the document you want to process
2. Download the document using the **download icon**
3. Upload the document to the official DMS portal
4. Obtain the official DMS document number from the DMS portal
5. Click the **# (hash) icon** next to the document
6. In the **Assign Official DMS Number** modal:
   - Enter the **Official DMS Document Number**
   - Click **Check** to verify the number is not already used
   - Enter **DMS Upload Date** and **DMS Upload Time**
   - Add optional **Remarks**
7. Click **Assign Number**
8. The system will:
   - Validate uniqueness (using a Firestore transaction – duplicates are impossible)
   - Update the document status to **Number Assigned**
   - Automatically send an email to the submitting user
   - Record the assignment date/time

### Returning a Document for Correction

If a document has an issue:

1. Click the **return arrow icon** next to the document
2. Enter clear **Correction Remarks** explaining what needs to be fixed
3. Click **Return Document**
4. The user will receive an email notification with your remarks

### Duplicate Number Check

The system enforces uniqueness at the **backend level** using Firestore transactions. Even if two Corporate MR users try to assign the same number simultaneously, only one will succeed.

---

## Superadmin Guide

### Dashboard

The main dashboard shows:
- **7 KPI Cards**: Total Submitted, Pending with MR, Under Process, Returned, Numbers Assigned, Avg DMS Upload Time, Avg Numbering Turnaround
- **6 Charts**: Plant-wise, Monthly trend, Department-wise, Category-wise, Status overview
- **Document Tracking Table**: Full document list with sorting, search, pagination, Excel export

#### Filters
- Financial Year, Month, Date Range (top row)
- Plant filter buttons
- Department, Category, Status dropdowns
- Apply/Clear filter buttons

### Managing Documents

As Superadmin, you have access to:
- **View all documents** from all plants and departments
- **Process documents** (assign numbers, return for correction) same as Corporate MR
- **Delete records** using the multi-select checkbox system

#### Soft Deleting Records

1. Check the checkbox(es) next to documents you wish to delete
2. Click **Delete Selected**
3. Enter a **Deletion Reason** (required)
4. Click **Delete Records**
5. Records are **soft-deleted** (archived, not permanently removed)
6. Deletion is logged with your identity, timestamp, and reason

### Settings

#### Plants
- Add, edit, activate, deactivate plants
- Duplicate plant names are prevented

#### Departments
- Add departments, associate with plants
- Activate/deactivate departments

#### Users
- Create new user accounts (triggers Firebase Auth user creation)
- Assign roles: Plant User, Corporate MR, Superadmin
- Assign users to plants and departments
- Activate/deactivate users

#### Document Categories
- Add document categories (e.g., SOP, Procedure, Policy, Form, Work Instruction)
- Activate/deactivate categories
- Duplicate names prevented

#### Email Configuration
- Set application URL (used in email notification links)
- Gmail credentials are **never** stored here – they are in Firebase Secret Manager

#### Branding
- Upload company logo (PNG, JPG, SVG)
- Set application title
- Set primary color

#### Notification Settings
- Set notification cooldown period (minimum minutes between user Send Notification requests)

### Audit Logs

Click **Audit Logs** in the sidebar to view complete activity history:
- All document submissions, edits, downloads
- Status changes with before/after values
- Number assignments
- Deletions with reasons
- Email notifications sent
- User management actions

Audit logs are **immutable** – no one can edit or delete them.

---

## Document Statuses

| Status | Color | Description |
|--------|-------|-------------|
| Draft | Grey | Saved but not submitted |
| Submitted | Blue | Submitted by user, awaiting MR action |
| Pending with MR | Orange | In Corporate MR's queue |
| Under Process | Purple | Corporate MR has opened/downloaded the document |
| Returned for Correction | Red | Returned to user with remarks |
| Resubmitted | Cyan | User resubmitted after correction |
| Number Assigned | Green | Official DMS number assigned |
| Closed | Grey | Fully processed and closed |

---

## Email Notifications

| Event | Recipient | Frequency |
|-------|-----------|-----------|
| New document submitted | Corporate MR | Consolidated (every 30 min batch) |
| User clicks Send Notification | Corporate MR | One consolidated email (all pending) |
| DMS number assigned | Submitting user | One email per document |
| Document returned | Submitting user | One email per document |

> **Important:** Bulk submissions do NOT generate one email per document. The scheduler consolidates all pending notifications into one email every 30 minutes.

---

## FAQ

**Q: Can I delete a submitted document?**
A: No. Only Superadmin can delete records, using the multi-select checkbox system with a mandatory reason. Documents are soft-deleted (archived) for auditability.

**Q: What happens if I submit the same DMS number twice?**
A: The system rejects it immediately – at the backend/database level, not just the UI. Even simultaneous submissions from two users are handled safely using Firestore transactions.

**Q: Can I modify a document after submitting?**
A: Only if the document is in **Draft** or **Returned for Correction** status. Once submitted, only Corporate MR or Superadmin can modify it.

**Q: When will Corporate MR receive my notification email?**
A: The system batches notifications and sends them every 30 minutes. You can also use the **Send Notification** button for an immediate consolidated reminder (subject to cooldown).

**Q: What file types are supported?**
A: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX – maximum 50MB per file.

**Q: All times shown are in which timezone?**
A: All dates and times are displayed in **Indian Standard Time (IST / UTC+5:30)**.

**Q: Can a user from Plant A see documents from Plant B?**
A: No. Regular users can only see their own submitted documents. Corporate MR and Superadmin can see all documents.

**Q: What is the difference between "DMS Upload Time" and "Assignment Date"?**
A: DMS Upload Date/Time is when Corporate MR uploaded the document to the DMS portal (manually entered). Assignment Date is automatically recorded by the system when the DMS number is saved in CDRTS.
