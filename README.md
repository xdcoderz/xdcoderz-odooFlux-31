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
2. Open a subscription to review its lines and lifecycle. Use the guarded actions to move it through quotation, confirmation, activation, and closure.
3. Choose **Run billing**, review the cutoff and due count, then create invoices. Each due active subscription gets at most one invoice for its billing period.
4. Open an invoice to review its line and payment history, print it, or record a payment. Paid invoices update the dashboard totals.
5. Create a customer, product, plan, or subscription from the relevant screen.
6. Sign in as the demo customer to see the customer-scoped portal.

Money is stored as integer paise. Invoice lines snapshot the plan price at billing time. Access roles are `admin`, `staff`, and `customer`; public signup always creates a customer account.

## Railway deployment outline

Create a Railway project with a Postgres database and two services rooted at `backend` and `frontend`. The backend service uses `backend/railway.toml`; set `TOKEN_SECRET` to a long random value and set `CORS_ORIGINS` to the deployed frontend URL. Railway supplies `DATABASE_URL` from Postgres. The frontend service uses `frontend/railway.toml`; set `VITE_API_URL` to the deployed API URL plus `/api` at build time.

## Scope notes

The UI follows the supplied Stripe-style tokens and adds role-filtered navigation, shared status badges, a due-count billing dialog, dashboard tabs, a payments page, and server-side list pagination (25 rows by default; up to 100 per request). Search is debounced and sent to the API. Dashboard figures and chart data come from aggregate queries; the sign-in art is illustrative.

This remains an MVP foundation. Quotation templates, tax and discount setup, product variants, password reset delivery, invoice email/download, advanced filter controls, and production database migrations are not included yet. Billing is on demand; there is no scheduler or payment gateway. Railway configuration is present, but deployment has not been done.
