# Brightloop Subscription Operations

Brightloop is a small subscription and billing app. It has a React frontend and a FastAPI API backed by SQLite for local work or PostgreSQL for a hosted environment.

## Run it locally

Start the API from the repository root:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

In another terminal, start the frontend:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. The API docs are at `http://localhost:8000/docs`. On first start, the API creates `backend/brightloop.db` and adds sample records.

Sample sign-ins (local database only):

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@brightloop.demo` | `Brightloop!2026` |
| Customer | `billing@northstar.example` | `Customer!2026` |

The sample credentials appear on the sign-in screen only in development. If SMTP is not configured, password-reset links are written to the API log.

Sign-up, staff creation, and password reset require a password with at least nine characters, an uppercase letter, a lowercase letter, and a special character. The API enforces these rules as well as the sign-in form.

## What’s in the app

Admins manage staff, customers, products, plans, quotation templates, taxes, and discounts. Staff handle subscriptions, invoices, payments, customer requests, and finance reports. Customers can see their own subscriptions and invoices, update their billing profile, and send a request to the team.

The dashboard normalizes active subscription line values into gross MRR, then annualizes that figure as ARR. Both figures are before tax and discounts. Its forecast is an editable scenario based on current MRR, annual expansion and churn assumptions, and a 6, 12, or 24 month horizon; it is separate from cash collected and is not presented as a prediction.

Billing runs when a staff member starts it. Invoice amounts are saved when an invoice is created, and a subscription can only be billed once for a period. Money is stored in paise. Lists use server-side pagination; the default page size is 25, with a maximum of 100.

## Database changes

Alembic migrations live in `backend/migrations`. From the `backend` directory, create a migration after changing the models, review the generated file, and apply it:

```powershell
python -m alembic revision --autogenerate -m "describe the change"
python -m alembic upgrade head
```

Add a new migration for each schema change; don’t edit one that has already been applied. Vercel deployments require the database to be migrated before the API starts.

To check the main list and reporting queries against a temporary database with 10,000 subscriptions, run:

```powershell
python perf_check.py
```

The script creates its own SQLite database and removes it when it finishes. It does not use `brightloop.db`.

## Live deployment

Watch the [Brightloop demo on YouTube](https://www.youtube.com/watch?v=EXqLulUUBNM) for a walkthrough of the application.

Brightloop is deployed as two Vercel projects:

| Service | Live URL |
| --- | --- |
| Frontend | [xdcoderz-odoo-flux-31-rghi.vercel.app](https://xdcoderz-odoo-flux-31-rghi.vercel.app/) |
| Backend API | [xdcoderz-odoo-flux-31.vercel.app](https://xdcoderz-odoo-flux-31.vercel.app/) |
| API health | [xdcoderz-odoo-flux-31.vercel.app/api/health](https://xdcoderz-odoo-flux-31.vercel.app/api/health) |
| API documentation | [xdcoderz-odoo-flux-31.vercel.app/docs](https://xdcoderz-odoo-flux-31.vercel.app/docs) |

Both projects use this repository. The Vercel root directory is `frontend` for the UI and `backend` for the API. The frontend’s `VITE_API_URL` points to `https://xdcoderz-odoo-flux-31.vercel.app/api`.

The API runs on Vercel and uses the Neon PostgreSQL project `brightloop-subscriptions` in Asia Pacific (Singapore). The initial Alembic schema migration (`58c430309754`) has been applied. The API health endpoint returned `200`, and the frontend origin passed the backend CORS preflight check.

SMTP environment variables have been configured in the backend’s Vercel project using `brightloop28@gmail.com`. Redeploy the backend after changing environment variables. Then verify email delivery with a password-reset request; until that check succeeds, SMTP delivery is not confirmed.

## Vercel deployment settings

The API requires hosted PostgreSQL; SQLite files aren’t persistent on Vercel. Keep database URLs, token secrets, admin passwords, and SMTP app passwords in Vercel environment variables, not in source control. Configure the backend project with `DATABASE_URL`, `TOKEN_SECRET`, `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD`, `SEED_DEMO_DATA=false`, `FRONTEND_URL`, and `CORS_ORIGINS`. SMTP uses `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_STARTTLS`, and `SMTP_SSL`.

When deploying a new frontend URL, update `FRONTEND_URL` and `CORS_ORIGINS` in the backend project and redeploy the API. For a new backend URL, update `VITE_API_URL` in the frontend project and redeploy the UI. Vercel settings are in `backend/vercel.json` and `frontend/vercel.json`.
