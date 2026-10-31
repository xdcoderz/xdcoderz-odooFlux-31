# Brightloop Subscription Operations

A five-hour MVP slice for managing recurring plans, subscriptions, invoices, payments, and a finance overview.

## Run locally

Requirements: Python 3.11+ and Node.js 20+.

### API

```powershell
cd D:\code\xdcoderz-flux-31\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The first API startup creates a local SQLite database and demo records. API docs are at `http://localhost:8000/docs`.

### Web app

Open a second PowerShell window:

```powershell
cd D:\code\xdcoderz-flux-31\frontend
npm install
npm run dev
```

Open `http://localhost:5173`. Demo admin sign-in:

- Email: `admin@brightloop.demo`
- Password: `Brightloop!2026`

Demo customer sign-in:

- Email: `billing@northstar.example`
- Password: `Customer!2026`

## Current workflow

1. Sign in as admin and review the seeded customer, product, monthly plan, and due subscription.
2. Click **Run billing**. Each due active subscription gets at most one invoice for its billing period.
3. Record a payment from the invoice list. Paid invoices update the dashboard totals.
4. Create a customer, product, plan, or subscription from the relevant screen.
5. Sign in as the demo customer to see the customer-scoped portal.

Money is stored as integer paise. Invoice lines snapshot the plan price at billing time. Access roles are `admin`, `staff`, and `customer`; public signup always creates a customer account.

## Railway deployment outline

Create a Railway project with a Postgres database and two services rooted at `backend` and `frontend`. The backend service uses `backend/railway.toml`; set `TOKEN_SECRET` to a long random value and set `CORS_ORIGINS` to the deployed frontend URL. Railway supplies `DATABASE_URL` from Postgres. The frontend service uses `frontend/railway.toml`; set `VITE_API_URL` to the deployed API URL plus `/api` at build time.

## Scope notes

This is an MVP foundation. Billing runs on demand from the staff button; no scheduler or payment gateway is connected. Tax, discount rules, quotation templates, reset emails, PDF generation, pause/renew actions, and production database migrations are not included yet. The sign-in chart is illustrative; dashboard figures and records come from the API. Lists currently return the first 100 rows and need pagination before larger deployments.
