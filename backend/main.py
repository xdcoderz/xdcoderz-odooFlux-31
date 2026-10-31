from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
from datetime import date, datetime, timedelta, timezone
from typing import Generator

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, case, cast, create_engine, func, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./brightloop.db")
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+psycopg://", 1)
elif DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg://", 1)
TOKEN_SECRET = os.getenv("TOKEN_SECRET", "local-development-secret-change-me")
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

class Base(DeclarativeBase):
    pass

class Customer(Base):
    __tablename__ = "customers"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(300))
    role: Mapped[str] = mapped_column(String(20), default="customer")
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customers.id"), nullable=True)

class Product(Base):
    __tablename__ = "products"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160), index=True)
    price_minor: Mapped[int] = mapped_column(Integer)
    cost_minor: Mapped[int] = mapped_column(Integer, default=0)
    notes: Mapped[str] = mapped_column(Text, default="")
    active: Mapped[bool] = mapped_column(default=True)

class Plan(Base):
    __tablename__ = "plans"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    price_minor: Mapped[int] = mapped_column(Integer)
    billing_period: Mapped[str] = mapped_column(String(20), default="monthly")
    min_qty: Mapped[int] = mapped_column(Integer, default=1)
    active: Mapped[bool] = mapped_column(default=True)

class Subscription(Base):
    __tablename__ = "subscriptions"
    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"), index=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("plans.id"))
    start_date: Mapped[date] = mapped_column(Date)
    next_billing_date: Mapped[date] = mapped_column(Date, index=True)
    status: Mapped[str] = mapped_column(String(20), default="Active", index=True)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    payment_terms_days: Mapped[int] = mapped_column(Integer, default=14)

class Invoice(Base):
    __tablename__ = "invoices"
    __table_args__ = (UniqueConstraint("subscription_id", "period_start", name="uq_invoice_subscription_period"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    subscription_id: Mapped[int] = mapped_column(ForeignKey("subscriptions.id"), index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"), index=True)
    period_start: Mapped[date] = mapped_column(Date)
    due_date: Mapped[date] = mapped_column(Date, index=True)
    status: Mapped[str] = mapped_column(String(20), default="Confirmed", index=True)
    subtotal_minor: Mapped[int] = mapped_column(Integer)
    total_minor: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class InvoiceLine(Base):
    __tablename__ = "invoice_lines"
    id: Mapped[int] = mapped_column(primary_key=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id", ondelete="CASCADE"), index=True)
    description: Mapped[str] = mapped_column(String(200))
    quantity: Mapped[int] = mapped_column(Integer)
    unit_price_minor: Mapped[int] = mapped_column(Integer)
    amount_minor: Mapped[int] = mapped_column(Integer)

class Payment(Base):
    __tablename__ = "payments"
    id: Mapped[int] = mapped_column(primary_key=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id"), index=True)
    method: Mapped[str] = mapped_column(String(40))
    amount_minor: Mapped[int] = mapped_column(Integer)
    paid_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    note: Mapped[str] = mapped_column(Text, default="")

class SignupIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    email: EmailStr
    password: str = Field(min_length=9)

class LoginIn(BaseModel):
    email: EmailStr
    password: str

class ProductIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    price_minor: int = Field(ge=0)
    cost_minor: int = Field(default=0, ge=0)
    notes: str = ""

class PlanIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    product_id: int
    price_minor: int = Field(ge=0)
    billing_period: str = "monthly"
    min_qty: int = Field(default=1, ge=1)

class CustomerIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    email: EmailStr

class SubscriptionIn(BaseModel):
    customer_id: int
    plan_id: int
    start_date: date
    quantity: int = Field(default=1, ge=1)
    payment_terms_days: int = Field(default=14, ge=0)

class PaymentIn(BaseModel):
    method: str = Field(min_length=1, max_length=40)
    amount_minor: int = Field(gt=0)
    paid_at: datetime | None = None
    note: str = ""

class StaffIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    email: EmailStr
    password: str = Field(min_length=9)

app = FastAPI(title="Brightloop Subscription API", version="0.1.0")
allowed_origins = [item.strip() for item in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if item.strip()]
app.add_middleware(CORSMiddleware, allow_origins=allowed_origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
bearer = HTTPBearer(auto_error=False)


def db_session() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 180_000).hex()
    return f"{salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt, digest = stored.split("$", 1)
        candidate = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 180_000).hex()
        return hmac.compare_digest(candidate, digest)
    except ValueError:
        return False


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def make_token(user: User) -> str:
    header = b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = b64(json.dumps({"sub": str(user.id), "role": user.role, "exp": int(datetime.now(timezone.utc).timestamp()) + 60 * 60 * 12}, separators=(",", ":")).encode())
    signing_input = f"{header}.{payload}"
    signature = b64(hmac.new(TOKEN_SECRET.encode(), signing_input.encode(), hashlib.sha256).digest())
    return f"{signing_input}.{signature}"


def current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(db_session)) -> User:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Sign in to continue")
    try:
        header, payload, signature = credentials.credentials.split(".", 2)
        signing_input = f"{header}.{payload}"
        expected = b64(hmac.new(TOKEN_SECRET.encode(), signing_input.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            raise ValueError("bad signature")
        header_data = json.loads(base64.urlsafe_b64decode(header + "=" * (-len(header) % 4)))
        if header_data.get("alg") != "HS256":
            raise ValueError("unsupported algorithm")
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        if claims["exp"] < int(datetime.now(timezone.utc).timestamp()):
            raise ValueError("expired")
        user = db.get(User, int(claims["sub"]))
        if user is None:
            raise ValueError("unknown user")
        return user
    except Exception:
        raise HTTPException(status_code=401, detail="Session expired. Please sign in again.")


def staff_user(user: User = Depends(current_user)) -> User:
    if user.role not in {"admin", "staff"}:
        raise HTTPException(status_code=403, detail="Staff access required")
    return user


def admin_user(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def minor(amount: int) -> str:
    return f"{amount / 100:.2f}"


def add_period(day: date, period: str) -> date:
    if period == "yearly":
        year, month = day.year + 1, day.month
    else:
        year, month = day.year + (day.month // 12), day.month % 12 + 1
    import calendar
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


def customer_dict(c: Customer) -> dict:
    return {"id": c.id, "name": c.name, "email": c.email}


def product_dict(p: Product) -> dict:
    return {"id": p.id, "name": p.name, "price_minor": p.price_minor, "cost_minor": p.cost_minor, "notes": p.notes, "active": p.active}


def plan_dict(db: Session, p: Plan) -> dict:
    product = db.get(Product, p.product_id)
    return {"id": p.id, "name": p.name, "product_id": p.product_id, "product_name": product.name if product else "", "price_minor": p.price_minor, "billing_period": p.billing_period, "min_qty": p.min_qty, "active": p.active}


def subscription_dict(db: Session, s: Subscription) -> dict:
    c, p = db.get(Customer, s.customer_id), db.get(Plan, s.plan_id)
    return {"id": s.id, "number": s.number, "customer_id": s.customer_id, "customer_name": c.name if c else "", "plan_id": s.plan_id, "plan_name": p.name if p else "", "start_date": s.start_date.isoformat(), "next_billing_date": s.next_billing_date.isoformat(), "status": s.status, "quantity": s.quantity, "payment_terms_days": s.payment_terms_days, "amount_minor": (p.price_minor * s.quantity) if p else 0}


def invoice_dict(db: Session, i: Invoice) -> dict:
    c = db.get(Customer, i.customer_id)
    paid = db.scalar(select(func.coalesce(func.sum(Payment.amount_minor), 0)).where(Payment.invoice_id == i.id)) or 0
    return {"id": i.id, "number": i.number, "subscription_id": i.subscription_id, "customer_id": i.customer_id, "customer_name": c.name if c else "", "period_start": i.period_start.isoformat(), "due_date": i.due_date.isoformat(), "status": i.status, "subtotal_minor": i.subtotal_minor, "total_minor": i.total_minor, "paid_minor": paid, "balance_minor": max(0, i.total_minor - paid)}


@app.on_event("startup")
def startup() -> None:
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        if db.scalar(select(User.id).limit(1)):
            return
        customer = Customer(name="Northstar Studio", email="billing@northstar.example")
        db.add(customer)
        db.flush()
        admin = User(email="admin@brightloop.demo", password_hash=hash_password("Brightloop!2026"), role="admin")
        client_user = User(email=customer.email, password_hash=hash_password("Customer!2026"), role="customer", customer_id=customer.id)
        product = Product(name="Brightloop Workspace", price_minor=24900, cost_minor=6200, notes="Team collaboration and reporting")
        db.add_all([admin, client_user, product])
        db.flush()
        plan = Plan(name="Growth · Monthly", product_id=product.id, price_minor=24900, billing_period="monthly", min_qty=1)
        db.add(plan)
        db.flush()
        subscription = Subscription(number="SUB-1001", customer_id=customer.id, plan_id=plan.id, start_date=date.today() - timedelta(days=31), next_billing_date=date.today(), status="Active", quantity=4, payment_terms_days=14)
        db.add(subscription)
        db.commit()


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "service": "brightloop-api"}


@app.post("/api/auth/signup")
def signup(body: SignupIn, db: Session = Depends(db_session)) -> dict:
    password = body.password
    if not (any(c.isupper() for c in password) and any(c.islower() for c in password) and any(not c.isalnum() for c in password)):
        raise HTTPException(status_code=422, detail="Password needs an uppercase letter, a lowercase letter, and a special character")
    email = str(body.email).lower()
    if db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    customer = Customer(name=body.name, email=email)
    db.add(customer)
    db.flush()
    user = User(email=email, password_hash=hash_password(password), role="customer", customer_id=customer.id)
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"access_token": make_token(user), "role": user.role, "email": user.email}


@app.post("/api/auth/login")
def login(body: LoginIn, db: Session = Depends(db_session)) -> dict:
    user = db.scalar(select(User).where(User.email == str(body.email).lower()))
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Email or password is incorrect")
    return {"access_token": make_token(user), "role": user.role, "email": user.email}


@app.get("/api/auth/me")
def me(user: User = Depends(current_user)) -> dict:
    return {"id": user.id, "email": user.email, "role": user.role, "customer_id": user.customer_id}


@app.get("/api/products")
def list_products(_: User = Depends(current_user), db: Session = Depends(db_session)) -> list[dict]:
    return [product_dict(p) for p in db.scalars(select(Product).where(Product.active.is_(True)).order_by(Product.name).limit(100))]


@app.post("/api/products", status_code=201)
def create_product(body: ProductIn, _: User = Depends(admin_user), db: Session = Depends(db_session)) -> dict:
    product = Product(**body.model_dump())
    db.add(product)
    db.commit()
    db.refresh(product)
    return product_dict(product)


@app.get("/api/plans")
def list_plans(_: User = Depends(current_user), db: Session = Depends(db_session)) -> list[dict]:
    return [plan_dict(db, p) for p in db.scalars(select(Plan).where(Plan.active.is_(True)).order_by(Plan.name).limit(100))]


@app.post("/api/plans", status_code=201)
def create_plan(body: PlanIn, _: User = Depends(admin_user), db: Session = Depends(db_session)) -> dict:
    if body.billing_period not in {"monthly", "yearly"}:
        raise HTTPException(status_code=422, detail="Choose monthly or yearly billing")
    if db.get(Product, body.product_id) is None:
        raise HTTPException(status_code=404, detail="Product not found")
    plan = Plan(**body.model_dump())
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan_dict(db, plan)


@app.get("/api/customers")
def list_customers(_: User = Depends(staff_user), db: Session = Depends(db_session)) -> list[dict]:
    return [customer_dict(c) for c in db.scalars(select(Customer).order_by(Customer.name).limit(100))]


@app.post("/api/customers", status_code=201)
def create_customer(body: CustomerIn, _: User = Depends(staff_user), db: Session = Depends(db_session)) -> dict:
    email = str(body.email).lower()
    if db.scalar(select(Customer.id).where(Customer.email == email)):
        raise HTTPException(status_code=409, detail="A customer with this email already exists")
    customer = Customer(name=body.name, email=email)
    db.add(customer)
    db.commit()
    db.refresh(customer)
    return customer_dict(customer)


@app.post("/api/staff", status_code=201)
def create_staff(body: StaffIn, _: User = Depends(admin_user), db: Session = Depends(db_session)) -> dict:
    password = body.password
    if not (any(c.isupper() for c in password) and any(c.islower() for c in password) and any(not c.isalnum() for c in password)):
        raise HTTPException(status_code=422, detail="Password needs an uppercase letter, a lowercase letter, and a special character")
    email = str(body.email).lower()
    if db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    user = User(email=email, password_hash=hash_password(password), role="staff")
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"id": user.id, "email": user.email, "role": user.role}


@app.get("/api/subscriptions")
def list_subscriptions(user: User = Depends(current_user), db: Session = Depends(db_session)) -> list[dict]:
    query = select(Subscription).order_by(Subscription.start_date.desc()).limit(100)
    if user.role == "customer":
        query = query.where(Subscription.customer_id == user.customer_id)
    return [subscription_dict(db, s) for s in db.scalars(query)]


@app.post("/api/subscriptions", status_code=201)
def create_subscription(body: SubscriptionIn, _: User = Depends(staff_user), db: Session = Depends(db_session)) -> dict:
    customer, plan = db.get(Customer, body.customer_id), db.get(Plan, body.plan_id)
    if customer is None or plan is None:
        raise HTTPException(status_code=404, detail="Customer or plan not found")
    if body.quantity < plan.min_qty:
        raise HTTPException(status_code=422, detail=f"Plan minimum quantity is {plan.min_qty}")
    subscription = Subscription(number=f"SUB-{secrets.token_hex(3).upper()}", customer_id=customer.id, plan_id=plan.id, start_date=body.start_date, next_billing_date=body.start_date, status="Active", quantity=body.quantity, payment_terms_days=body.payment_terms_days)
    db.add(subscription)
    db.commit()
    db.refresh(subscription)
    return subscription_dict(db, subscription)


@app.get("/api/invoices")
def list_invoices(user: User = Depends(current_user), db: Session = Depends(db_session)) -> list[dict]:
    query = select(Invoice).order_by(Invoice.created_at.desc()).limit(100)
    if user.role == "customer":
        query = query.where(Invoice.customer_id == user.customer_id)
    return [invoice_dict(db, i) for i in db.scalars(query)]


@app.post("/api/billing/run")
def run_billing(_: User = Depends(staff_user), db: Session = Depends(db_session)) -> dict:
    today = date.today()
    due_subscriptions = list(db.scalars(select(Subscription).where(Subscription.status == "Active", Subscription.next_billing_date <= today).order_by(Subscription.id)))
    created: list[str] = []
    for sub in due_subscriptions:
        period_start = sub.next_billing_date
        existing = db.scalar(select(Invoice.id).where(Invoice.subscription_id == sub.id, Invoice.period_start == period_start))
        if existing:
            continue
        plan = db.get(Plan, sub.plan_id)
        product = db.get(Product, plan.product_id) if plan else None
        if plan is None:
            continue
        amount = plan.price_minor * sub.quantity
        invoice = Invoice(number=f"INV-{secrets.token_hex(3).upper()}", subscription_id=sub.id, customer_id=sub.customer_id, period_start=period_start, due_date=today + timedelta(days=sub.payment_terms_days), status="Confirmed", subtotal_minor=amount, total_minor=amount)
        db.add(invoice)
        db.flush()
        db.add(InvoiceLine(invoice_id=invoice.id, description=f"{product.name if product else plan.name} · {plan.name}", quantity=sub.quantity, unit_price_minor=plan.price_minor, amount_minor=amount))
        sub.next_billing_date = add_period(period_start, plan.billing_period)
        created.append(invoice.number)
    db.commit()
    return {"created": len(created), "invoice_numbers": created, "message": f"Created {len(created)} invoice(s)"}


@app.post("/api/invoices/{invoice_id}/payments", status_code=201)
def record_payment(invoice_id: int, body: PaymentIn, _: User = Depends(staff_user), db: Session = Depends(db_session)) -> dict:
    invoice = db.get(Invoice, invoice_id)
    if invoice is None:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if invoice.status == "Paid":
        raise HTTPException(status_code=409, detail="Invoice is already paid")
    already_paid = db.scalar(select(func.coalesce(func.sum(Payment.amount_minor), 0)).where(Payment.invoice_id == invoice.id)) or 0
    if body.amount_minor > invoice.total_minor - already_paid:
        raise HTTPException(status_code=422, detail="Payment cannot exceed the remaining invoice balance")
    payment = Payment(invoice_id=invoice.id, method=body.method, amount_minor=body.amount_minor, paid_at=body.paid_at or datetime.utcnow(), note=body.note)
    db.add(payment)
    db.flush()
    paid = already_paid + body.amount_minor
    if paid >= invoice.total_minor:
        invoice.status = "Paid"
    db.commit()
    db.refresh(invoice)
    return invoice_dict(db, invoice)


@app.get("/api/overview")
def overview(user: User = Depends(current_user), db: Session = Depends(db_session)) -> dict:
    customer_filter = user.customer_id if user.role == "customer" else None
    active_query = select(func.count(Subscription.id)).where(Subscription.status == "Active")
    revenue_query = select(func.coalesce(func.sum(Payment.amount_minor), 0)).join(Invoice, Invoice.id == Payment.invoice_id)
    if customer_filter is not None:
        active_query = active_query.where(Subscription.customer_id == customer_filter)
        revenue_query = revenue_query.where(Invoice.customer_id == customer_filter)
    active_count = db.scalar(active_query) or 0
    paid_revenue = db.scalar(revenue_query) or 0

    payment_totals = select(Payment.invoice_id.label("invoice_id"), func.sum(Payment.amount_minor).label("paid")).group_by(Payment.invoice_id).subquery()
    paid_amount = func.coalesce(payment_totals.c.paid, 0)
    balance_expr = case((Invoice.total_minor > paid_amount, Invoice.total_minor - paid_amount), else_=0)
    balance_query = select(func.coalesce(func.sum(balance_expr), 0)).select_from(Invoice).outerjoin(payment_totals, payment_totals.c.invoice_id == Invoice.id).where(Invoice.status != "Paid")
    overdue_count_query = select(func.count(Invoice.id)).where(Invoice.status != "Paid", Invoice.due_date < date.today())
    overdue_list_query = select(Invoice).where(Invoice.status != "Paid", Invoice.due_date < date.today()).order_by(Invoice.due_date).limit(10)
    history_day = func.date(Payment.paid_at)
    history_query = select(history_day.label("day"), func.sum(Payment.amount_minor).label("amount_minor")).join(Invoice, Invoice.id == Payment.invoice_id).where(Payment.paid_at >= datetime.utcnow() - timedelta(days=30)).group_by(history_day).order_by(history_day)
    mrr_value = case(
        (Plan.billing_period == "yearly", cast((Plan.price_minor * Subscription.quantity) / 12, Integer)),
        else_=Plan.price_minor * Subscription.quantity,
    )
    mrr_query = select(func.coalesce(func.sum(mrr_value), 0)).select_from(Subscription).join(Plan, Plan.id == Subscription.plan_id).where(Subscription.status == "Active")
    if customer_filter is not None:
        balance_query = balance_query.where(Invoice.customer_id == customer_filter)
        overdue_count_query = overdue_count_query.where(Invoice.customer_id == customer_filter)
        overdue_list_query = overdue_list_query.where(Invoice.customer_id == customer_filter)
        mrr_query = mrr_query.where(Subscription.customer_id == customer_filter)
        history_query = history_query.where(Invoice.customer_id == customer_filter)
    overdue_rows = list(db.scalars(overdue_list_query))
    history_rows = db.execute(history_query).all()
    revenue_history = [{"day": str(day), "amount_minor": amount or 0} for day, amount in history_rows]
    return {
        "active_subscriptions": active_count,
        "revenue_minor": paid_revenue,
        "outstanding_minor": db.scalar(balance_query) or 0,
        "overdue_count": db.scalar(overdue_count_query) or 0,
        "mrr_minor": db.scalar(mrr_query) or 0,
        "revenue_history": revenue_history,
        "revenue_30d_minor": sum(row["amount_minor"] for row in revenue_history),
        "overdue_invoices": [invoice_dict(db, inv) for inv in overdue_rows],
    }
