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

## What’s in the app

Admins manage staff, customers, products, plans, quotation templates, taxes, and discounts. Staff handle subscriptions, invoices, payments, customer requests, and finance reports. Customers can see their own subscriptions and invoices, update their billing profile, and send a request to the team.

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

## Vercel (not deployed)

Deployment is still on hold. The repository has Vercel settings for two projects: set the backend project’s root directory to `backend` and the frontend project’s root directory to `frontend`.

The API needs a hosted PostgreSQL database; SQLite files aren’t persistent on Vercel. Before deploying the backend, set `DATABASE_URL` and run `python -m alembic upgrade head` from `backend` against that database. Configure these backend environment variables in Vercel:

- `TOKEN_SECRET`: a unique, randomly generated secret.
- `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD`: used to create the first admin on startup.
- `SEED_DEMO_DATA=false`: keep the local demo accounts out of the hosted database.
- `FRONTEND_URL` and `CORS_ORIGINS`: the deployed frontend URL.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_STARTTLS`, and `SMTP_SSL`: SMTP is required for password-reset email.

After the backend is deployed, set `VITE_API_URL` on the frontend project to `https://<backend-domain>/api`. Once the frontend has its final URL, add that exact origin to `CORS_ORIGINS` and redeploy the backend.

Vercel deployment files are `backend/vercel.json` and `frontend/vercel.json`. No deployment has been made.
