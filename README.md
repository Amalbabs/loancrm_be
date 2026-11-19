# Loan Sales & Call Centre CRM Backend API

A production-ready REST API backend for a **Loan Sales & Call Centre CRM System** built with **Node.js**, **Express.js**, **Prisma ORM**, and **PostgreSQL**.

The system is designed for high-velocity call center operations supporting two user roles: **ADMIN** and **STAFF**. It tracks 20 call-centre employees, each with a strict daily target of **100 calls** (amounting to a **2,000 call/day floor quota**), complete with lead distribution, disposition tracking, partner bank schemes, and customer KYC document management.

---

## Architecture & Project Structure

```
loan-crm-backend/
├── prisma/
│   └── schema.prisma            # Prisma schema (User, Lead, CallLog, Document, BankScheme)
├── src/
│   ├── config/
│   │   └── db.js                # Prisma Client initialization & connection helper
│   ├── middleware/
│   │   ├── auth.js              # JWT verification (verifyToken) & role guards (isAdmin, isStaff)
│   │   └── upload.js            # Multer storage configuration for KYC & CSV/Excel uploads
│   ├── utils/
│   │   └── parser.js            # Streaming CSV & Excel (.xlsx/.xls) parser & header normalizer
│   ├── controllers/
│   │   ├── authController.js    # Login, registration (default 100 target), profile
│   │   ├── adminController.js   # Floor stats, employee tracking, lead distribution, KYC verification, schemes
│   │   ├── leadController.js    # Bulk upload (CSV/Excel), paginated listing, single lead CRUD
│   │   └── staffController.js   # Assigned queue, call logging (dispositions), document uploads, performance
│   └── routes/
│       ├── authRoutes.js        # /api/auth/*
│       ├── adminRoutes.js       # /api/admin/*
│       ├── leadRoutes.js        # /api/leads/*
│       └── staffRoutes.js       # /api/staff/*
├── uploads/                     # Local storage for KYC documents & uploaded spreadsheets
├── .env                         # Environment variables (Database URL, JWT Secret, Port)
├── .env.example                 # Environment variables template
├── package.json                 # Project dependencies and scripts
├── index.js                     # Express application entry point & router mounting
└── README.md                    # Project documentation
```

---

## Tech Stack & Dependencies

* **Runtime:** Node.js (ES Modules - `"type": "module"`)
* **Framework:** Express.js 5
* **ORM:** Prisma Client v6
* **Database:** PostgreSQL (supports Neon, Supabase, AWS RDS, Docker, and local PostgreSQL)
* **Authentication:** JSON Web Tokens (`jsonwebtoken`) & `bcryptjs`
* **File Uploads & Parsing:** `multer`, `csv-parser`, `xlsx`
* **CORS & Environment:** `cors`, `dotenv`

---

## Setup & Installation

### 1. Prerequisites
* Node.js v18+ or v20+
* PostgreSQL database instance

### 2. Configure Environment Variables
Create or verify `.env` in the root folder:

```env
PORT=5000
NODE_ENV=development
DATABASE_URL=postgresql://username:password@localhost:5432/loan_crm?sslmode=require
JWT_SECRET=supersecretjwtkey_loan_crm_2026_secure
JWT_EXPIRES_IN=7d
UPLOAD_DIR=./uploads
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Sync Database Schema with Prisma
```bash
npm run prisma:push
```

### 5. Start the Server
```bash
# Development (auto-reload with nodemon)
npm run dev

# Production
npm start
```

The API will boot at `http://localhost:5000`.

---

## API Endpoints & Dummy Payloads

All protected routes require an `Authorization` header:
```http
Authorization: Bearer <YOUR_JWT_TOKEN>
```

---

### 1. Authentication Endpoints (`/api/auth`)

#### 1.1 Register User (Admin Only)
* **Method:** `POST`
* **Endpoint:** `/api/auth/register`
* **Access:** **ADMIN ONLY** (`Authorization: Bearer <ADMIN_TOKEN>`)

> **Security Guard:** Only authenticated Admins can register new staff employees. Unauthenticated calls return `401 Unauthorized`, and calls made by staff return `403 Forbidden`. (Initial setup allows bootstrapping the first Admin if zero admins exist).

##### A. Creating an Employee / Staff Caller (Target: 100 calls/day)
* **Header:** `Authorization: Bearer <ADMIN_TOKEN>`
* **Request Body:**
```json
{
  "name": "Rajesh Sharma",
  "email": "rajesh.staff@loancrm.com",
  "password": "Password@123",
  "role": "STAFF",
  "phone": "+919876543210",
  "daily_call_target": 100
}
```
* **Response (`201 Created`):**
```json
{
  "success": true,
  "status": 201,
  "message": "STAFF account created successfully.",
  "data": {
    "user": {
      "id": 1,
      "name": "Rajesh Sharma",
      "email": "rajesh.staff@loancrm.com",
      "role": "STAFF",
      "phone": "+919876543210",
      "dailyCallTarget": 100,
      "isActive": true,
      "createdAt": "2026-11-18T11:20:00.000Z"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

##### B. Creating an Admin Account (Manager / Floor Leader, Target: 0 calls)
* **Request Body:**
```json
{
  "name": "Amal",
  "email": "admin@loancrm.com",
  "password": "AdminPassword@123",
  "role": "ADMIN",
  "phone": "+919800011223"
}
```
* **Response (`201 Created`):**
```json
{
  "success": true,
  "status": 201,
  "message": "ADMIN account created successfully.",
  "data": {
    "user": {
      "id": 4,
      "name": "Amal",
      "email": "admin@loancrm.com",
      "role": "ADMIN",
      "phone": "+919800011223",
      "dailyCallTarget": 0,
      "isActive": true,
      "createdAt": "2026-11-18T13:13:21.873Z"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

#### 1.2 Login User
* **Method:** `POST`
* **Endpoint:** `/api/auth/login`
* **Access:** Public
* **Request Body:**
```json
{
  "email": "rajesh.staff@loancrm.com",
  "password": "Password@123"
}
```
* **Response (`200 OK`):**
```json
{
  "success": true,
  "status": 200,
  "message": "Logged in successfully.",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": 1,
      "name": "Rajesh Sharma",
      "email": "rajesh.staff@loancrm.com",
      "role": "STAFF",
      "dailyCallTarget": 100
    }
  }
}
```

#### 1.3 Get Current User Profile
* **Method:** `GET`
* **Endpoint:** `/api/auth/profile`
* **Access:** Bearer Token
* **Response (`200 OK`):**
```json
{
  "success": true,
  "status": 200,
  "data": {
    "id": 1,
    "name": "Rajesh Sharma",
    "email": "rajesh.staff@loancrm.com",
    "role": "STAFF",
    "phone": "+919876543210",
    "dailyCallTarget": 100,
    "isActive": true
  }
}
```

---

### 2. Admin Portal Endpoints (`/api/admin`)
*Requires `Authorization: Bearer <ADMIN_TOKEN>`*

#### 2.1 Floor-Wide Dashboard Stats (vs 2,000 Quota)
* **Method:** `GET`
* **Endpoint:** `/api/admin/dashboard-stats`
* **Response (`200 OK`):**
```json
{
  "success": true,
  "data": {
    "totalLeads": 1540,
    "newLeadsToday": 180,
    "floorWideQuota": {
      "totalStaff": 20,
      "callsCompletedToday": 1340,
      "targetDailyQuota": 2000,
      "quotaPercentage": "67.00%",
      "remainingCallsNeeded": 660
    },
    "conversionRate": "14.50%",
    "totalDisbursedAmount": "18450000.00",
    "totalRequestedAmount": "42600000.00",
    "disbursedLeadsCount": 224,
    "interestedCallsToday": 210,
    "statusBreakdown": [
      { "status": "NEW", "count": 420 },
      { "status": "INTERESTED", "count": 310 },
      { "status": "CALLBACK_SCHEDULED", "count": 280 },
      { "status": "NOT_INTERESTED", "count": 306 },
      { "status": "DISBURSED", "count": 224 }
    ]
  }
}
```

#### 2.2 Employees Performance Tracker (Calls completed / 100)
* **Method:** `GET`
* **Endpoint:** `/api/admin/employees-performance`
* **Response (`200 OK`):**
```json
{
  "success": true,
  "totalStaff": 20,
  "data": [
    {
      "staffId": 1,
      "name": "Rajesh Sharma",
      "email": "rajesh.staff@loancrm.com",
      "phone": "+919876543210",
      "isActive": true,
      "dailyTarget": 100,
      "callsCompletedToday": 86,
      "callTargetDisplay": "86 / 100",
      "progressPercentage": "86%",
      "interestedCallsToday": 14,
      "convertedLeadsCount": 12,
      "totalAssignedLeads": 75,
      "performanceStatus": "ON_TRACK"
    },
    {
      "staffId": 2,
      "name": "Amit Verma",
      "email": "amit.staff@loancrm.com",
      "phone": "+919876543211",
      "isActive": true,
      "dailyTarget": 100,
      "callsCompletedToday": 104,
      "callTargetDisplay": "104 / 100",
      "progressPercentage": "100%",
      "interestedCallsToday": 22,
      "convertedLeadsCount": 18,
      "totalAssignedLeads": 80,
      "performanceStatus": "TARGET_ACHIEVED"
    }
  ]
}
```

#### 2.3 Distribute Leads (Round-Robin or Manual)
* **Method:** `POST`
* **Endpoint:** `/api/admin/distribute-leads`

*Batch Round-Robin Body:*
```json
{
  "mode": "round_robin",
  "batch_size": 200
}
```
*Manual Assignment Body:*
```json
{
  "mode": "manual",
  "staff_id": 1,
  "lead_ids": [101, 102, 103, 104, 105]
}
```
* **Response (`200 OK`):**
```json
{
  "success": true,
  "message": "Equally distributed 200 leads across 20 active staff members in round-robin fashion.",
  "distributedCount": 200,
  "staffCount": 20
}
```

#### 2.4 Verify Customer KYC / Financial Document
* **Method:** `PUT`
* **Endpoint:** `/api/admin/verify-document/15`
* **Request Body:**
```json
{
  "status": "APPROVED",
  "remarks": "PAN card name and DOB matches NSDL database."
}
```
*or for rejection:*
```json
{
  "status": "REJECTED",
  "remarks": "Bank statement is older than 3 months. Upload latest statement."
}
```
* **Response (`200 OK`):**
```json
{
  "success": true,
  "message": "Document status updated to APPROVED.",
  "data": {
    "id": 15,
    "leadId": 45,
    "docType": "PAN",
    "verificationStatus": "APPROVED",
    "verificationRemarks": "PAN card name and DOB matches NSDL database.",
    "verifiedBy": 99
  }
}
```

#### 2.5 Partner Bank Schemes CRUD
* **List Schemes:** `GET /api/admin/schemes?bank_name=HDFC`
* **Create Scheme:** `POST /api/admin/schemes`
* **Update Scheme:** `PUT /api/admin/schemes/:id`
* **Delete Scheme:** `DELETE /api/admin/schemes/:id`

*Create Request Body:*
```json
{
  "bank_name": "HDFC",
  "scheme_name": "HDFC Salaried Personal Loan",
  "loan_type": "Personal Loan",
  "roi": 10.49,
  "processing_fee": 1.0,
  "min_credit_score": 720,
  "min_tenure_months": 12,
  "max_tenure_months": 60,
  "max_amount": 4000000
}
```
* **Response (`201 Created`):**
```json
{
  "success": true,
  "message": "Partner bank scheme created successfully.",
  "data": {
    "id": 1,
    "bankName": "HDFC",
    "schemeName": "HDFC Salaried Personal Loan",
    "loanType": "Personal Loan",
    "roi": "10.49",
    "processingFee": "1.00",
    "minCreditScore": 720,
    "isActive": true
  }
}
```

---

### 3. Lead Management Endpoints (`/api/leads`)
*Requires `Authorization: Bearer <TOKEN>`*

#### 3.1 Bulk Upload CSV / Excel Leads
* **Method:** `POST`
* **Endpoint:** `/api/leads/bulk-upload`
* **Access:** Admin
* **Content-Type:** `multipart/form-data`
* **Form Data:**
  * `file`: `leads_database.xlsx` (or `.csv`)
  * `auto_distribute`: `true` (optional)
* **Response (`201 Created`):**
```json
{
  "success": true,
  "message": "Successfully imported 500 leads with status 'NEW'.",
  "data": {
    "totalImported": 500,
    "autoDistributed": true,
    "staffCount": 20
  }
}
```

#### 3.2 Get All Leads (Paginated & Filterable)
* **Method:** `GET`
* **Endpoint:** `/api/leads?status=NEW&loan_type=Personal%20Loan&page=1&limit=10`
* **Response (`200 OK`):**
```json
{
  "success": true,
  "data": {
    "leads": [
      {
        "id": 101,
        "fullName": "Ananya Sen",
        "phone": "+919871122334",
        "email": "ananya.sen@example.com",
        "loanType": "Personal Loan",
        "loanAmount": "500000.00",
        "monthlyIncome": "75000.00",
        "creditScore": 765,
        "status": "NEW",
        "assignedTo": 1,
        "assignedStaffName": "Rajesh Sharma",
        "totalCalls": 0,
        "totalDocuments": 0,
        "createdAt": "2026-11-18T10:15:00.000Z"
      }
    ],
    "pagination": {
      "total": 420,
      "page": 1,
      "limit": 10,
      "totalPages": 42
    }
  }
}
```

#### 3.3 Create or Edit Lead Manually
* **Method:** `POST` (or `PUT /api/leads/:id`)
* **Endpoint:** `/api/leads`
* **Access:** Bearer Token

> **Upsert Behavior:**
> - If `id` is **omitted**: Creates a new lead (returns `201 Created`).
> - If `id` is **present** in the payload: Automatically edits/updates the existing lead with that ID (returns `200 OK`).

##### A. Creating a New Lead (No `id`)
* **Request Body:**
```json
{
  "full_name": "Vikram Sethi",
  "phone": "+919822334455",
  "email": "vikram.sethi@gmail.com",
  "loan_type": "Personal Loan",
  "loan_amount": 500000,
  "monthly_income": 65000,
  "credit_score": 730,
  "status": "NEW",
  "notes": "Walk-in inquiry"
}
```
* **Response (`201 Created`):**
```json
{
  "success": true,
  "status": 201,
  "message": "Lead created successfully.",
  "data": {
    "id": 102,
    "fullName": "Vikram Sethi",
    "phone": "+919822334455",
    "loanType": "Personal Loan",
    "loanAmount": "500000.00",
    "status": "NEW"
  }
}
```

##### B. Editing an Existing Lead (With `id` in Payload)
* **Request Body:**
```json
{
  "id": 102,
  "full_name": "Vikram Sethi (Updated)",
  "loan_amount": 750000,
  "status": "INTERESTED",
  "notes": "Customer requested 7.5L instead of 5L"
}
```
* **Response (`200 OK`):**
```json
{
  "success": true,
  "status": 200,
  "message": "Lead updated successfully.",
  "data": {
    "id": 102,
    "fullName": "Vikram Sethi (Updated)",
    "phone": "+919822334455",
    "loanType": "Personal Loan",
    "loanAmount": "750000.00",
    "monthlyIncome": "65000.00",
    "creditScore": 730,
    "status": "INTERESTED",
    "notes": "Customer requested 7.5L instead of 5L",
    "updatedAt": "2026-11-18T18:03:33.102Z"
  }
}
```

---

### 4. Staff Call Center Endpoints (`/api/staff`)
*Requires `Authorization: Bearer <STAFF_TOKEN>`*

#### 4.1 Get Assigned Calling Queue
* **Method:** `GET`
* **Endpoint:** `/api/staff/assigned-leads?status=NEW&page=1&limit=20`
* **Response (`200 OK`):**
```json
{
  "success": true,
  "data": {
    "leads": [
      {
        "id": 101,
        "fullName": "Ananya Sen",
        "phone": "+919871122334",
        "loanType": "Personal Loan",
        "loanAmount": "500000.00",
        "status": "NEW",
        "followUpDate": null,
        "totalCallsLogged": 0,
        "documentsCount": 0
      }
    ],
    "pagination": {
      "total": 35,
      "page": 1,
      "limit": 20,
      "totalPages": 2
    }
  }
}
```

#### 4.2 Log Call Outcome & Disposition
* **Method:** `POST`
* **Endpoint:** `/api/staff/log-call`

*Customer Interested:*
```json
{
  "lead_id": 101,
  "call_disposition": "INTERESTED",
  "call_duration_seconds": 185,
  "remarks": "Looking for 5L Personal Loan. Ready to share PAN and salary slips."
}
```

*Callback Scheduled:*
```json
{
  "lead_id": 101,
  "call_disposition": "CALLBACK_SCHEDULED",
  "callback_date": "2026-11-19T14:30:00.000Z",
  "call_duration_seconds": 45,
  "remarks": "Client is travelling. Asked to call back tomorrow afternoon."
}
```

*Not Interested:*
```json
{
  "lead_id": 101,
  "call_disposition": "NOT_INTERESTED",
  "rejection_reason": "Interest rate higher than expectation",
  "call_duration_seconds": 60,
  "remarks": "Has cheaper loan pre-approved from HDFC."
}
```

* **Response (`201 Created`):**
```json
{
  "success": true,
  "message": "Call logged successfully as INTERESTED.",
  "data": {
    "callLog": {
      "id": 501,
      "leadId": 101,
      "staffId": 1,
      "callStatus": "COMPLETED",
      "callDisposition": "INTERESTED",
      "callDurationSeconds": 185,
      "remarks": "Looking for 5L Personal Loan. Ready to share PAN and salary slips.",
      "createdAt": "2026-11-18T11:24:00.000Z"
    },
    "leadStatus": "INTERESTED",
    "followUpDate": null
  }
}
```

#### 4.3 Upload Customer KYC / Financial Document
* **Method:** `POST`
* **Endpoint:** `/api/staff/upload-document/101`
* **Content-Type:** `multipart/form-data`
* **Form Data:**
  * `document`: `pan_card.pdf`
  * `doc_type`: `PAN` *(Allowed: `PAN`, `AADHAAR`, `BANK_STATEMENT`, `SALARY_SLIP`, `ITR`, `OTHER`)*
* **Response (`201 Created`):**
```json
{
  "success": true,
  "message": "PAN document uploaded successfully for lead Ananya Sen.",
  "data": {
    "id": 16,
    "leadId": 101,
    "uploadedBy": 1,
    "docType": "PAN",
    "fileName": "pan_card-1731932400-58291.pdf",
    "originalName": "pan_card.pdf",
    "fileType": "application/pdf",
    "fileSize": 450210,
    "verificationStatus": "PENDING"
  }
}
```

#### 4.4 Personal Performance Tracker (`X / 100` Quota)
* **Method:** `GET`
* **Endpoint:** `/api/staff/personal-performance`
* **Response (`200 OK`):**
```json
{
  "success": true,
  "data": {
    "agentName": "Rajesh Sharma",
    "dailyTarget": 100,
    "callsCompletedToday": 86,
    "callTargetDisplay": "86 / 100",
    "remainingCallsNeeded": 14,
    "progressPercentage": "86%",
    "quotaStatus": "ON_TRACK",
    "breakdownToday": {
      "interested": 14,
      "callbackScheduled": 18,
      "notInterested": 54
    },
    "pipelineStats": {
      "totalAssignedLeads": 75,
      "interestedLeads": 16,
      "approvedOrDisbursedLeads": 12
    }
  }
}
```

---

### 5. Health Check
* **Method:** `GET`
* **Endpoint:** `/api/health`
* **Access:** Public
* **Response (`200 OK`):**
```json
{
  "status": "online",
  "timestamp": "2026-11-18T11:26:00.000Z",
  "service": "Loan Sales & Call Centre CRM API"
}
```


