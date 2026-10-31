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
2. Add products and variants, define plans with cadence and lifecycle rules, then create reusable quotation templates.
3. Create a subscription directly or from a template. Review its lines and use guarded actions for quotation, confirmation, activation, pause, resume, closure, and renewal.
4. Choose **Run billing**, review the cutoff and due count, then create invoices. Each due active subscription gets at most one invoice for its billing period.
5. Open an invoice to review its line and payment history, print it, or record a payment. Paid invoices update the dashboard totals.
6. Create a customer from the customer screen, or sign in as the demo customer to see the customer-scoped portal.

Money is stored as integer paise. Invoice lines snapshot the plan price at billing time. Access roles are `admin`, `staff`, and `customer`; public signup always creates a customer account.

## Railway deployment outline

Create a Railway project with a Postgres database and two services rooted at `backend` and `frontend`. The backend service uses `backend/railway.toml`; set `TOKEN_SECRET` to a long random value and set `CORS_ORIGINS` to the deployed frontend URL. Railway supplies `DATABASE_URL` from Postgres. The frontend service uses `frontend/railway.toml`; set `VITE_API_URL` to the deployed API URL plus `/api` at build time.

## Scope notes

The UI follows the supplied Stripe-style tokens and adds role-filtered navigation, shared status badges, a due-count billing dialog, dashboard tabs, a payments page, and server-side list pagination (25 rows by default; up to 100 per request). Search is debounced and sent to the API. Dashboard figures and chart data come from aggregate queries; the sign-in art is illustrative.

## Three-phase completion plan

- **Phase 1 — Catalog and subscriptions:** product variants, daily/weekly/monthly/yearly plans, availability and lifecycle rules, quotation templates, multi-line subscriptions, expiry dates, pause/resume/renew actions. Implemented in the MVP.
- **Phase 2 — Billing rules:** tax and discount configuration, invoice state actions, qualifying product/subscription discounts, usage limits, automatic rule application, and SMTP invoice email. Implemented with local email simulation when SMTP is unset.
- **Phase 3 — Operations and launch:** password reset delivery, staff management screen, richer customer self-service, report filters, large-data performance checks, and production database migrations/deployment.

Billing currently runs on demand; there is no scheduler or payment gateway. Set the optional `SMTP_*` variables in `backend/.env.example` to deliver invoice emails. Railway configuration is present, but deployment has not been done.
