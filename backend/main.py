from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
from datetime import date, datetime, timedelta, timezone
from typing import Generator

from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, case, cast, create_engine, func, inspect, or_, select, text
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

class ProductVariant(Base):
    __tablename__ = "product_variants"
    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    attribute: Mapped[str] = mapped_column(String(80))
    value: Mapped[str] = mapped_column(String(120))
    extra_price_minor: Mapped[int] = mapped_column(Integer, default=0)

class Plan(Base):
    __tablename__ = "plans"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    price_minor: Mapped[int] = mapped_column(Integer)
    billing_period: Mapped[str] = mapped_column(String(20), default="monthly")
    min_qty: Mapped[int] = mapped_column(Integer, default=1)
    active: Mapped[bool] = mapped_column(default=True)
    available_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    available_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    auto_close: Mapped[bool] = mapped_column(Boolean, default=False)
    closable: Mapped[bool] = mapped_column(Boolean, default=True)
    pausable: Mapped[bool] = mapped_column(Boolean, default=False)
    renewable: Mapped[bool] = mapped_column(Boolean, default=True)

class Tax(Base):
    __tablename__ = "taxes"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    rate_percent: Mapped[float] = mapped_column(default=0.0)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

class Discount(Base):
    __tablename__ = "discounts"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    discount_type: Mapped[str] = mapped_column(String(20), default="percentage")
    value: Mapped[float] = mapped_column(default=0.0)
    code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    auto_apply: Mapped[bool] = mapped_column(Boolean, default=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

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
    expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    quotation_expires_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    paused: Mapped[bool] = mapped_column(Boolean, default=False)
    tax_id: Mapped[int | None] = mapped_column(ForeignKey("taxes.id"), nullable=True)
    discount_id: Mapped[int | None] = mapped_column(ForeignKey("discounts.id"), nullable=True)

class SubscriptionLine(Base):
    __tablename__ = "subscription_lines"
    id: Mapped[int] = mapped_column(primary_key=True)
    subscription_id: Mapped[int] = mapped_column(ForeignKey("subscriptions.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    plan_id: Mapped[int | None] = mapped_column(ForeignKey("plans.id"), nullable=True)
    variant_id: Mapped[int | None] = mapped_column(ForeignKey("product_variants.id"), nullable=True)
    description: Mapped[str] = mapped_column(String(200))
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    unit_price_minor: Mapped[int] = mapped_column(Integer)

class QuotationTemplate(Base):
    __tablename__ = "quotation_templates"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160), unique=True)
    validity_days: Mapped[int] = mapped_column(Integer, default=30)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

class QuotationTemplateLine(Base):
    __tablename__ = "quotation_template_lines"
    id: Mapped[int] = mapped_column(primary_key=True)
    template_id: Mapped[int] = mapped_column(ForeignKey("quotation_templates.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    plan_id: Mapped[int | None] = mapped_column(ForeignKey("plans.id"), nullable=True)
    description: Mapped[str] = mapped_column(String(200))
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    unit_price_minor: Mapped[int] = mapped_column(Integer)

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
    discount_id: Mapped[int | None] = mapped_column(ForeignKey("discounts.id"), nullable=True)
    discount_amount_minor: Mapped[int] = mapped_column(Integer, default=0)
    tax_id: Mapped[int | None] = mapped_column(ForeignKey("taxes.id"), nullable=True)
    tax_amount_minor: Mapped[int] = mapped_column(Integer, default=0)
    total_minor: Mapped[int] = mapped_column(Integer)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
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

class InvoiceDelivery(Base):
    __tablename__ = "invoice_deliveries"
    id: Mapped[int] = mapped_column(primary_key=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id", ondelete="CASCADE"), index=True)
    recipient_email: Mapped[str] = mapped_column(String(255))
    subject: Mapped[str] = mapped_column(String(255))
    sent_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    status: Mapped[str] = mapped_column(String(50), default="Delivered")
    content_preview: Mapped[str] = mapped_column(Text, default="")

class TaxIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    rate_percent: float = Field(ge=0.0, le=100.0)
    is_default: bool = False

class DiscountIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    discount_type: str = Field(default="percentage")
    value: float = Field(ge=0.0)
    code: str | None = None
    auto_apply: bool = False

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
    variants: list["ProductVariantIn"] = Field(default_factory=list)

class ProductVariantIn(BaseModel):
    attribute: str = Field(min_length=1, max_length=80)
    value: str = Field(min_length=1, max_length=120)
    extra_price_minor: int = Field(default=0, ge=0)

class PlanIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    product_id: int
    price_minor: int = Field(ge=0)
    billing_period: str = "monthly"
    min_qty: int = Field(default=1, ge=1)
    available_from: date | None = None
    available_until: date | None = None
    auto_close: bool = False
    closable: bool = True
    pausable: bool = False
    renewable: bool = True

class CustomerIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    email: EmailStr

class SubscriptionIn(BaseModel):
    customer_id: int
    plan_id: int | None = None
    start_date: date
    quantity: int = Field(default=1, ge=1)
    payment_terms_days: int = Field(default=14, ge=0)
    expiry_date: date | None = None
    template_id: int | None = None
    tax_id: int | None = None
    discount_id: int | None = None
    lines: list["SubscriptionLineIn"] = Field(default_factory=list)

class SubscriptionLineIn(BaseModel):
    product_id: int
    plan_id: int | None = None
    variant_id: int | None = None
    description: str | None = Field(default=None, max_length=200)
    quantity: int = Field(default=1, ge=1)
    unit_price_minor: int | None = Field(default=None, ge=0)

class QuotationTemplateLineIn(BaseModel):
    product_id: int
    plan_id: int | None = None
    description: str = Field(min_length=1, max_length=200)
    quantity: int = Field(default=1, ge=1)
    unit_price_minor: int = Field(ge=0)

class QuotationTemplateIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    validity_days: int = Field(default=30, ge=1, le=365)
    lines: list[QuotationTemplateLineIn] = Field(min_length=1)

class SubscriptionTransitionIn(BaseModel):
    to: str

class PaymentIn(BaseModel):
    method: str = Field(min_length=1, max_length=40)
    amount_minor: int = Field(gt=0)
    paid_at: datetime | None = None
    note: str = ""

class BillingRunIn(BaseModel):
    as_of: date | None = None

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
    if period == "daily":
        return day + timedelta(days=1)
    if period == "weekly":
        return day + timedelta(days=7)
    if period == "yearly":
        year, month = day.year + 1, day.month
    else:
        year, month = day.year + (day.month // 12), day.month % 12 + 1
    import calendar
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


def paginated(db: Session, query, count_query, page: int, page_size: int, serialize) -> dict:
    total = db.scalar(count_query) or 0
    records = list(db.scalars(query.offset((page - 1) * page_size).limit(page_size)))
    return {"items": [serialize(record) for record in records], "total": total, "page": page, "page_size": page_size}


def customer_dict(c: Customer) -> dict:
    return {"id": c.id, "name": c.name, "email": c.email}


def product_dict(p: Product, db: Session | None = None) -> dict:
    result = {"id": p.id, "name": p.name, "price_minor": p.price_minor, "cost_minor": p.cost_minor, "notes": p.notes, "active": p.active}
    if db is not None:
        result["variants"] = [{"id": v.id, "attribute": v.attribute, "value": v.value, "extra_price_minor": v.extra_price_minor} for v in db.scalars(select(ProductVariant).where(ProductVariant.product_id == p.id).order_by(ProductVariant.id))]
    return result


def plan_dict(db: Session, p: Plan) -> dict:
    product = db.get(Product, p.product_id)
    return {"id": p.id, "name": p.name, "product_id": p.product_id, "product_name": product.name if product else "", "price_minor": p.price_minor, "billing_period": p.billing_period, "min_qty": p.min_qty, "active": p.active, "available_from": p.available_from.isoformat() if p.available_from else None, "available_until": p.available_until.isoformat() if p.available_until else None, "auto_close": p.auto_close, "closable": p.closable, "pausable": p.pausable, "renewable": p.renewable}


def calculate_billing_amounts(
    db: Session,
    sub: Subscription | None,
    subtotal_minor: int,
    requested_discount_id: int | None = None,
    requested_tax_id: int | None = None,
) -> tuple[int, int | None, int, int | None, int]:
    discount_id = requested_discount_id or (sub.discount_id if sub else None)
    discount = db.get(Discount, discount_id) if discount_id else None
    if not discount:
        discount = db.scalar(select(Discount).where(Discount.active.is_(True), Discount.auto_apply.is_(True)).limit(1))

    discount_amount_minor = 0
    applied_discount_id = None
    if discount and discount.active:
        applied_discount_id = discount.id
        if discount.discount_type == "percentage":
            discount_amount_minor = round(subtotal_minor * (discount.value / 100.0))
        else:
            discount_amount_minor = int(discount.value * 100)
        discount_amount_minor = max(0, min(subtotal_minor, discount_amount_minor))

    taxable_subtotal = max(0, subtotal_minor - discount_amount_minor)

    tax_id = requested_tax_id or (sub.tax_id if sub else None)
    tax = db.get(Tax, tax_id) if tax_id else None
    if not tax:
        tax = db.scalar(select(Tax).where(Tax.active.is_(True), Tax.is_default.is_(True)).limit(1))

    tax_amount_minor = 0
    applied_tax_id = None
    if tax and tax.active:
        applied_tax_id = tax.id
        tax_amount_minor = round(taxable_subtotal * (tax.rate_percent / 100.0))

    total_minor = taxable_subtotal + tax_amount_minor
    return discount_amount_minor, applied_discount_id, tax_amount_minor, applied_tax_id, total_minor


def subscription_dict(db: Session, s: Subscription) -> dict:
    c, p = db.get(Customer, s.customer_id), db.get(Plan, s.plan_id)
    lines = list(db.scalars(select(SubscriptionLine).where(SubscriptionLine.subscription_id == s.id).order_by(SubscriptionLine.id)))
    if not lines and p:
        product = db.get(Product, p.product_id)
        lines = [SubscriptionLine(id=0, subscription_id=s.id, product_id=p.product_id, plan_id=p.id, description=product.name if product else p.name, quantity=s.quantity, unit_price_minor=p.price_minor)]
    serialized_lines = []
    total = 0
    for line in lines:
        product = db.get(Product, line.product_id)
        variant = db.get(ProductVariant, line.variant_id) if line.variant_id else None
        amount = line.quantity * line.unit_price_minor
        total += amount
        serialized_lines.append({"id": line.id, "product_id": line.product_id, "product_name": product.name if product else line.description, "plan_id": line.plan_id, "variant_id": line.variant_id, "variant": f"{variant.attribute}: {variant.value}" if variant else "", "description": line.description, "quantity": line.quantity, "unit_price_minor": line.unit_price_minor, "amount_minor": amount})

    tax = db.get(Tax, s.tax_id) if s.tax_id else None
    discount = db.get(Discount, s.discount_id) if s.discount_id else None
    _, _, _, _, total_recurring = calculate_billing_amounts(db, s, total)

    return {
        "id": s.id,
        "number": s.number,
        "customer_id": s.customer_id,
        "customer_name": c.name if c else "",
        "customer_email": c.email if c else "",
        "plan_id": s.plan_id,
        "plan_name": p.name if p else "",
        "product_name": (db.get(Product, p.product_id).name if p and db.get(Product, p.product_id) else ""),
        "start_date": s.start_date.isoformat(),
        "expiry_date": s.expiry_date.isoformat() if s.expiry_date else None,
        "quotation_expires_on": s.quotation_expires_on.isoformat() if s.quotation_expires_on else None,
        "next_billing_date": s.next_billing_date.isoformat(),
        "status": s.status,
        "paused": s.paused,
        "closable": p.closable if p else True,
        "pausable": p.pausable if p else False,
        "renewable": p.renewable if p else False,
        "quantity": s.quantity,
        "payment_terms_days": s.payment_terms_days,
        "billing_period": p.billing_period if p else "monthly",
        "unit_price_minor": p.price_minor if p else 0,
        "subtotal_minor": total,
        "amount_minor": total_recurring,
        "tax_id": s.tax_id,
        "tax_name": tax.name if tax else None,
        "discount_id": s.discount_id,
        "discount_name": discount.name if discount else None,
        "lines": serialized_lines,
    }


def invoice_dict(db: Session, i: Invoice) -> dict:
    c = db.get(Customer, i.customer_id)
    paid = db.scalar(select(func.coalesce(func.sum(Payment.amount_minor), 0)).where(Payment.invoice_id == i.id)) or 0
    discount = db.get(Discount, i.discount_id) if i.discount_id else None
    tax = db.get(Tax, i.tax_id) if i.tax_id else None
    deliveries_count = db.scalar(select(func.count(InvoiceDelivery.id)).where(InvoiceDelivery.invoice_id == i.id)) or 0
    return {
        "id": i.id,
        "number": i.number,
        "subscription_id": i.subscription_id,
        "customer_id": i.customer_id,
        "customer_name": c.name if c else "",
        "customer_email": c.email if c else "",
        "period_start": i.period_start.isoformat(),
        "due_date": i.due_date.isoformat(),
        "status": i.status,
        "subtotal_minor": i.subtotal_minor,
        "discount_id": i.discount_id,
        "discount_name": discount.name if discount else None,
        "discount_amount_minor": i.discount_amount_minor or 0,
        "tax_id": i.tax_id,
        "tax_name": tax.name if tax else None,
        "tax_rate_percent": tax.rate_percent if tax else 0.0,
        "tax_amount_minor": i.tax_amount_minor or 0,
        "total_minor": i.total_minor,
        "paid_minor": paid,
        "balance_minor": 0 if i.status == "Cancelled" else max(0, i.total_minor - paid),
        "sent_at": i.sent_at.isoformat() if i.sent_at else None,
        "deliveries_count": deliveries_count,
    }


@app.on_event("startup")
def startup() -> None:
    Base.metadata.create_all(engine)
    # Keep existing local/demo databases usable as this MVP schema grows.
    additive_columns = {
        "plans": {"available_from": "DATE", "available_until": "DATE", "auto_close": "BOOLEAN NOT NULL DEFAULT FALSE", "closable": "BOOLEAN NOT NULL DEFAULT TRUE", "pausable": "BOOLEAN NOT NULL DEFAULT FALSE", "renewable": "BOOLEAN NOT NULL DEFAULT TRUE"},
        "subscriptions": {"expiry_date": "DATE", "quotation_expires_on": "DATE", "paused": "BOOLEAN NOT NULL DEFAULT FALSE", "tax_id": "INTEGER", "discount_id": "INTEGER"},
        "invoices": {"discount_id": "INTEGER", "discount_amount_minor": "INTEGER NOT NULL DEFAULT 0", "tax_id": "INTEGER", "tax_amount_minor": "INTEGER NOT NULL DEFAULT 0", "sent_at": "DATETIME"},
    }
    with engine.begin() as connection:
        for table, columns in additive_columns.items():
            present = {column["name"] for column in inspect(connection).get_columns(table)}
            for name, definition in columns.items():
                if name not in present:
                    connection.execute(text(f'ALTER TABLE "{table}" ADD COLUMN "{name}" {definition}'))
    with SessionLocal() as db:
        if not db.scalar(select(Tax.id).limit(1)):
            gst = Tax(name="GST 18%", rate_percent=18.0, is_default=True, active=True)
            zero = Tax(name="Zero Rated 0%", rate_percent=0.0, is_default=False, active=True)
            db.add_all([gst, zero])
        if not db.scalar(select(Discount.id).limit(1)):
            launch_disc = Discount(name="Launch Discount 10%", discount_type="percentage", value=10.0, code="LAUNCH10", auto_apply=True, active=True)
            fixed_disc = Discount(name="Early VIP Flat ₹500", discount_type="fixed", value=500.0, code="VIP500", auto_apply=False, active=True)
            db.add_all([launch_disc, fixed_disc])
        db.commit()
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
def list_products(page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100), search: str = "", _: User = Depends(current_user), db: Session = Depends(db_session)) -> dict:
    query = select(Product).where(Product.active.is_(True))
    count_query = select(func.count(Product.id)).where(Product.active.is_(True))
    if search.strip():
        term = f"%{search.strip()}%"
        query, count_query = query.where(Product.name.ilike(term)), count_query.where(Product.name.ilike(term))
    return paginated(db, query.order_by(Product.name), count_query, page, page_size, lambda p: product_dict(p, db))


@app.post("/api/products", status_code=201)
def create_product(body: ProductIn, _: User = Depends(admin_user), db: Session = Depends(db_session)) -> dict:
    values = body.model_dump(exclude={"variants"})
    product = Product(**values)
    db.add(product)
    db.flush()
    for variant in body.variants:
        db.add(ProductVariant(product_id=product.id, **variant.model_dump()))
    db.commit()
    db.refresh(product)
    return product_dict(product, db)


@app.get("/api/plans")
def list_plans(page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100), search: str = "", _: User = Depends(current_user), db: Session = Depends(db_session)) -> dict:
    query = select(Plan).where(Plan.active.is_(True))
    count_query = select(func.count(Plan.id)).where(Plan.active.is_(True))
    if search.strip():
        term = f"%{search.strip()}%"
        query, count_query = query.where(Plan.name.ilike(term)), count_query.where(Plan.name.ilike(term))
    return paginated(db, query.order_by(Plan.name), count_query, page, page_size, lambda p: plan_dict(db, p))


@app.post("/api/plans", status_code=201)
def create_plan(body: PlanIn, _: User = Depends(admin_user), db: Session = Depends(db_session)) -> dict:
    if body.billing_period not in {"daily", "weekly", "monthly", "yearly"}:
        raise HTTPException(status_code=422, detail="Choose daily, weekly, monthly, or yearly billing")
    if body.available_from and body.available_until and body.available_until < body.available_from:
        raise HTTPException(status_code=422, detail="Plan end date must be on or after its start date")
    if db.get(Product, body.product_id) is None:
        raise HTTPException(status_code=404, detail="Product not found")
    plan = Plan(**body.model_dump())
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan_dict(db, plan)


def template_dict(db: Session, template: QuotationTemplate) -> dict:
    lines = list(db.scalars(select(QuotationTemplateLine).where(QuotationTemplateLine.template_id == template.id).order_by(QuotationTemplateLine.id)))
    return {"id": template.id, "name": template.name, "validity_days": template.validity_days, "active": template.active, "lines": [{"id": line.id, "product_id": line.product_id, "product_name": db.get(Product, line.product_id).name if db.get(Product, line.product_id) else "", "plan_id": line.plan_id, "description": line.description, "quantity": line.quantity, "unit_price_minor": line.unit_price_minor} for line in lines]}


@app.get("/api/templates")
def list_templates(page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100), _: User = Depends(staff_user), db: Session = Depends(db_session)) -> dict:
    return paginated(db, select(QuotationTemplate).where(QuotationTemplate.active.is_(True)).order_by(QuotationTemplate.name), select(func.count(QuotationTemplate.id)).where(QuotationTemplate.active.is_(True)), page, page_size, lambda t: template_dict(db, t))


@app.post("/api/templates", status_code=201)
def create_template(body: QuotationTemplateIn, _: User = Depends(admin_user), db: Session = Depends(db_session)) -> dict:
    if db.scalar(select(QuotationTemplate.id).where(func.lower(QuotationTemplate.name) == body.name.lower())):
        raise HTTPException(status_code=409, detail="A quotation template with this name already exists")
    for line in body.lines:
        if db.get(Product, line.product_id) is None:
            raise HTTPException(status_code=404, detail=f"Product {line.product_id} not found")
        if line.plan_id:
            plan = db.get(Plan, line.plan_id)
            if plan is None:
                raise HTTPException(status_code=404, detail=f"Plan {line.plan_id} not found")
            if plan.product_id != line.product_id:
                raise HTTPException(status_code=422, detail="A template plan must belong to the selected product")
    template = QuotationTemplate(name=body.name, validity_days=body.validity_days)
    db.add(template)
    db.flush()
    db.add_all([QuotationTemplateLine(template_id=template.id, **line.model_dump()) for line in body.lines])
    db.commit()
    db.refresh(template)
    return template_dict(db, template)


@app.get("/api/customers")
def list_customers(page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100), search: str = "", _: User = Depends(staff_user), db: Session = Depends(db_session)) -> dict:
    query, count_query = select(Customer), select(func.count(Customer.id))
    if search.strip():
        term = f"%{search.strip()}%"
        condition = or_(Customer.name.ilike(term), Customer.email.ilike(term))
        query, count_query = query.where(condition), count_query.where(condition)
    return paginated(db, query.order_by(Customer.name), count_query, page, page_size, customer_dict)


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


@app.get("/api/subscriptions/{subscription_id}")
def get_subscription(subscription_id: int, user: User = Depends(current_user), db: Session = Depends(db_session)) -> dict:
    sub = db.get(Subscription, subscription_id)
    if sub is None or (user.role == "customer" and sub.customer_id != user.customer_id):
        raise HTTPException(status_code=404, detail="Subscription not found")
    if refresh_subscription_lifecycle(db, sub):
        db.commit()
        db.refresh(sub)
    result = subscription_dict(db, sub)
    result["invoices"] = [invoice_dict(db, inv) for inv in db.scalars(select(Invoice).where(Invoice.subscription_id == sub.id).order_by(Invoice.created_at.desc()).limit(25))]
    return result


@app.post("/api/subscriptions/{subscription_id}/transition")
def transition_subscription(subscription_id: int, body: SubscriptionTransitionIn, _: User = Depends(staff_user), db: Session = Depends(db_session)) -> dict:
    sub = db.get(Subscription, subscription_id)
    if sub is None:
        raise HTTPException(status_code=404, detail="Subscription not found")
    plan = db.get(Plan, sub.plan_id)
    allowed = {"Draft": {"Quotation"}, "Quotation": {"Draft", "Confirmed"}, "Confirmed": {"Active"}, "Active": set(), "Paused": set(), "Closed": set()}
    if sub.status == "Active":
        if plan and plan.pausable:
            allowed["Active"].add("Paused")
        if plan and plan.closable:
            allowed["Active"].add("Closed")
    if sub.status == "Paused":
        if plan and plan.pausable:
            allowed["Paused"].add("Active")
        if plan and plan.closable:
            allowed["Paused"].add("Closed")
    if body.to not in allowed.get(sub.status, set()):
        raise HTTPException(status_code=409, detail=f"Cannot move a {sub.status} subscription to {body.to}")
    if sub.status == "Quotation" and body.to == "Confirmed" and sub.quotation_expires_on and sub.quotation_expires_on < date.today():
        raise HTTPException(status_code=409, detail="This quotation has expired and cannot be confirmed")
    sub.status = body.to
    sub.paused = body.to == "Paused"
    db.commit()
    db.refresh(sub)
    return subscription_dict(db, sub)


@app.get("/api/subscriptions")
def list_subscriptions(page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100), search: str = "", status_filter: str = "", user: User = Depends(current_user), db: Session = Depends(db_session)) -> dict:
    query, count_query = select(Subscription), select(func.count(Subscription.id))
    conditions = []
    if user.role == "customer":
        conditions.append(Subscription.customer_id == user.customer_id)
    if status_filter.strip():
        conditions.append(Subscription.status == status_filter.strip())
    if search.strip():
        term = f"%{search.strip()}%"
        conditions.append(or_(Subscription.number.ilike(term), Subscription.customer_id.in_(select(Customer.id).where(or_(Customer.name.ilike(term), Customer.email.ilike(term)))), Subscription.plan_id.in_(select(Plan.id).where(Plan.name.ilike(term)))))
    if conditions:
        query, count_query = query.where(*conditions), count_query.where(*conditions)
    result = paginated(db, query.order_by(Subscription.start_date.desc()), count_query, page, page_size, lambda s: subscription_dict(db, s))
    changed = False
    for item in result["items"]:
        sub = db.get(Subscription, item["id"])
        if sub and refresh_subscription_lifecycle(db, sub):
            changed = True
    if changed:
        db.commit()
        result["items"] = [subscription_dict(db, db.get(Subscription, item["id"])) for item in result["items"]]
    return result


@app.post("/api/subscriptions", status_code=201)
def create_subscription(body: SubscriptionIn, _: User = Depends(staff_user), db: Session = Depends(db_session)) -> dict:
    customer = db.get(Customer, body.customer_id)
    template = db.get(QuotationTemplate, body.template_id) if body.template_id else None
    if customer is None:
        raise HTTPException(status_code=404, detail="Customer not found")
    if body.template_id and (template is None or not template.active):
        raise HTTPException(status_code=404, detail="Quotation template not found")
    template_lines = list(db.scalars(select(QuotationTemplateLine).where(QuotationTemplateLine.template_id == template.id).order_by(QuotationTemplateLine.id))) if template else []
    primary_plan_id = body.plan_id or next((line.plan_id for line in template_lines if line.plan_id), None)
    plan = db.get(Plan, primary_plan_id) if primary_plan_id else None
    if plan is None:
        raise HTTPException(status_code=422, detail="Choose a plan or use a template containing a plan line")
    if not plan.active:
        raise HTTPException(status_code=422, detail="This plan is inactive")
    if plan.available_from and body.start_date < plan.available_from or plan.available_until and body.start_date > plan.available_until:
        raise HTTPException(status_code=422, detail="The plan is not available on the subscription start date")
    if body.quantity < plan.min_qty:
        raise HTTPException(status_code=422, detail=f"Plan minimum quantity is {plan.min_qty}")
    source_lines = body.lines or [SubscriptionLineIn(product_id=line.product_id, plan_id=line.plan_id, description=line.description, quantity=line.quantity, unit_price_minor=line.unit_price_minor) for line in template_lines]
    if not body.lines and template_lines:
        primary_line = next((line for line in source_lines if line.plan_id == plan.id), None)
        if primary_line:
            primary_line.quantity = body.quantity
    if not source_lines:
        source_lines = [SubscriptionLineIn(product_id=plan.product_id, plan_id=plan.id, quantity=body.quantity, unit_price_minor=plan.price_minor)]
    subscription = Subscription(number=f"SUB-{secrets.token_hex(3).upper()}", customer_id=customer.id, plan_id=plan.id, start_date=body.start_date, next_billing_date=body.start_date, expiry_date=body.expiry_date, quotation_expires_on=body.start_date + timedelta(days=template.validity_days) if template else None, status="Draft", quantity=body.quantity, payment_terms_days=body.payment_terms_days, tax_id=body.tax_id, discount_id=body.discount_id)
    db.add(subscription)
    db.flush()
    for line in source_lines:
        product = db.get(Product, line.product_id)
        line_plan = db.get(Plan, line.plan_id) if line.plan_id else None
        variant = db.get(ProductVariant, line.variant_id) if line.variant_id else None
        if product is None or line_plan and line_plan.product_id != product.id:
            raise HTTPException(status_code=422, detail="Each subscription line must use a valid product and matching plan")
        if line.variant_id and (variant is None or variant.product_id != product.id):
            raise HTTPException(status_code=422, detail="Choose a variant belonging to the selected product")
        price = line.unit_price_minor if line.unit_price_minor is not None else (line_plan.price_minor if line_plan else product.price_minor) + (variant.extra_price_minor if variant else 0)
        db.add(SubscriptionLine(subscription_id=subscription.id, product_id=product.id, plan_id=line_plan.id if line_plan else None, variant_id=variant.id if variant else None, description=line.description or product.name, quantity=line.quantity, unit_price_minor=price))
    db.commit()
    db.refresh(subscription)
    return subscription_dict(db, subscription)


def refresh_subscription_lifecycle(db: Session, sub: Subscription) -> bool:
    if sub.status != "Active":
        return False
    plan = db.get(Plan, sub.plan_id)
    changed = False
    if plan and plan.auto_close and sub.expiry_date and sub.expiry_date <= date.today():
        sub.status = "Closed"
        sub.paused = False
        changed = True
    return changed


@app.post("/api/subscriptions/{subscription_id}/renew")
def renew_subscription(subscription_id: int, _: User = Depends(staff_user), db: Session = Depends(db_session)) -> dict:
    sub = db.get(Subscription, subscription_id)
    if sub is None:
        raise HTTPException(status_code=404, detail="Subscription not found")
    plan = db.get(Plan, sub.plan_id)
    if not plan or not plan.renewable or sub.status != "Closed":
        raise HTTPException(status_code=409, detail="Only closed subscriptions on renewable plans can be renewed")
    sub.status = "Active"
    sub.paused = False
    sub.start_date = date.today()
    sub.next_billing_date = date.today()
    sub.expiry_date = None
    db.commit()
    db.refresh(sub)
    return subscription_dict(db, sub)


@app.post("/api/subscriptions/{subscription_id}/invoice")
def create_subscription_invoice(subscription_id: int, as_draft: bool = False, _: User = Depends(staff_user), db: Session = Depends(db_session)) -> dict:
    sub = db.get(Subscription, subscription_id)
    if sub is None:
        raise HTTPException(status_code=404, detail="Subscription not found")
    plan = db.get(Plan, sub.plan_id)
    period_start = sub.next_billing_date
    existing = db.scalar(select(Invoice.id).where(Invoice.subscription_id == sub.id, Invoice.period_start == period_start))
    if existing:
        raise HTTPException(status_code=409, detail=f"An invoice for period starting {period_start.isoformat()} already exists")
    lines = list(db.scalars(select(SubscriptionLine).where(SubscriptionLine.subscription_id == sub.id).order_by(SubscriptionLine.id)))
    if not lines and plan:
        product = db.get(Product, plan.product_id)
        lines = [SubscriptionLine(id=0, subscription_id=sub.id, product_id=plan.product_id, plan_id=plan.id, description=product.name if product else plan.name, quantity=sub.quantity, unit_price_minor=plan.price_minor)]
    subtotal_minor = sum(line.quantity * line.unit_price_minor for line in lines)
    discount_amt, disc_id, tax_amt, tx_id, total_minor = calculate_billing_amounts(db, sub, subtotal_minor)
    today = date.today()
    invoice = Invoice(
        number=f"INV-{secrets.token_hex(3).upper()}",
        subscription_id=sub.id,
        customer_id=sub.customer_id,
        period_start=period_start,
        due_date=today + timedelta(days=sub.payment_terms_days),
        status="Draft" if as_draft else "Confirmed",
        subtotal_minor=subtotal_minor,
        discount_id=disc_id,
        discount_amount_minor=discount_amt,
        tax_id=tx_id,
        tax_amount_minor=tax_amt,
        total_minor=total_minor,
    )
    db.add(invoice)
    db.flush()
    db.add_all([InvoiceLine(invoice_id=invoice.id, description=line.description, quantity=line.quantity, unit_price_minor=line.unit_price_minor, amount_minor=line.quantity * line.unit_price_minor) for line in lines])
    if plan:
        sub.next_billing_date = add_period(period_start, plan.billing_period)
    db.commit()
    db.refresh(invoice)
    return invoice_dict(db, invoice)


@app.get("/api/invoices")
def list_invoices(page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100), search: str = "", status_filter: str = "", overdue: bool = False, user: User = Depends(current_user), db: Session = Depends(db_session)) -> dict:
    query, count_query = select(Invoice), select(func.count(Invoice.id))
    conditions = []
    if user.role == "customer":
        conditions.append(Invoice.customer_id == user.customer_id)
    if status_filter.strip():
        val = status_filter.strip()
        if val == "Overdue":
            conditions.extend([Invoice.status.notin_(["Paid", "Cancelled"]), Invoice.due_date < date.today()])
        elif val == "Outstanding":
            conditions.extend([Invoice.status.notin_(["Paid", "Cancelled"]), Invoice.due_date >= date.today()])
        else:
            conditions.append(Invoice.status == val)
    if overdue:
        conditions.extend([Invoice.status.notin_(["Paid", "Cancelled"]), Invoice.due_date < date.today()])
    if search.strip():
        term = f"%{search.strip()}%"
        conditions.append(or_(Invoice.number.ilike(term), Invoice.customer_id.in_(select(Customer.id).where(or_(Customer.name.ilike(term), Customer.email.ilike(term))))))
    if conditions:
        query, count_query = query.where(*conditions), count_query.where(*conditions)
    return paginated(db, query.order_by(Invoice.created_at.desc()), count_query, page, page_size, lambda i: invoice_dict(db, i))


def payment_dict(db: Session, payment: Payment) -> dict:
    invoice = db.get(Invoice, payment.invoice_id)
    customer = db.get(Customer, invoice.customer_id) if invoice else None
    return {"id": payment.id, "invoice_id": payment.invoice_id, "invoice_number": invoice.number if invoice else "", "customer_name": customer.name if customer else "", "method": payment.method, "amount_minor": payment.amount_minor, "paid_at": payment.paid_at.isoformat(), "note": payment.note}


@app.get("/api/invoices/{invoice_id}")
def get_invoice(invoice_id: int, user: User = Depends(current_user), db: Session = Depends(db_session)) -> dict:
    invoice = db.get(Invoice, invoice_id)
    if invoice is None or (user.role == "customer" and invoice.customer_id != user.customer_id):
        raise HTTPException(status_code=404, detail="Invoice not found")
    customer = db.get(Customer, invoice.customer_id)
    subscription = db.get(Subscription, invoice.subscription_id)
    lines = list(db.scalars(select(InvoiceLine).where(InvoiceLine.invoice_id == invoice.id).order_by(InvoiceLine.id)))
    payments = list(db.scalars(select(Payment).where(Payment.invoice_id == invoice.id).order_by(Payment.paid_at.desc())))
    deliveries = list(db.scalars(select(InvoiceDelivery).where(InvoiceDelivery.invoice_id == invoice.id).order_by(InvoiceDelivery.sent_at.desc())))
    result = invoice_dict(db, invoice)
    result["customer"] = customer_dict(customer) if customer else None
    result["subscription_number"] = subscription.number if subscription else ""
    line_subtotal = invoice.subtotal_minor or 1
    result["lines"] = [
        {
            "id": line.id,
            "description": line.description,
            "quantity": line.quantity,
            "unit_price_minor": line.unit_price_minor,
            "amount_minor": line.amount_minor,
            "tax_minor": round((line.amount_minor / line_subtotal) * invoice.tax_amount_minor) if invoice.tax_amount_minor else 0,
        }
        for line in lines
    ]
    result["payments"] = [{"id": p.id, "method": p.method, "amount_minor": p.amount_minor, "paid_at": p.paid_at.isoformat(), "note": p.note} for p in payments]
    result["deliveries"] = [
        {
            "id": d.id,
            "recipient_email": d.recipient_email,
            "subject": d.subject,
            "sent_at": d.sent_at.isoformat(),
            "status": d.status,
            "content_preview": d.content_preview,
        }
        for d in deliveries
    ]
    return result


@app.post("/api/invoices/{invoice_id}/confirm")
def confirm_invoice(invoice_id: int, _: User = Depends(staff_user), db: Session = Depends(db_session)) -> dict:
    inv = db.get(Invoice, invoice_id)
    if inv is None:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if inv.status != "Draft":
        raise HTTPException(status_code=409, detail=f"Only draft invoices can be confirmed (current status: {inv.status})")
    inv.status = "Confirmed"
    db.commit()
    db.refresh(inv)
    return invoice_dict(db, inv)


@app.post("/api/invoices/{invoice_id}/cancel")
def cancel_invoice(invoice_id: int, _: User = Depends(staff_user), db: Session = Depends(db_session)) -> dict:
    inv = db.get(Invoice, invoice_id)
    if inv is None:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if inv.status == "Paid":
        raise HTTPException(status_code=409, detail="Paid invoices cannot be cancelled")
    inv.status = "Cancelled"
    db.commit()
    db.refresh(inv)
    return invoice_dict(db, inv)


@app.post("/api/invoices/{invoice_id}/send")
def send_invoice(invoice_id: int, _: User = Depends(staff_user), db: Session = Depends(db_session)) -> dict:
    inv = db.get(Invoice, invoice_id)
    if inv is None:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if inv.status == "Cancelled":
        raise HTTPException(status_code=409, detail="Cancelled invoices cannot be sent")
    customer = db.get(Customer, inv.customer_id)
    recipient = customer.email if customer else "billing@customer.example"
    tax = db.get(Tax, inv.tax_id) if inv.tax_id else None
    discount = db.get(Discount, inv.discount_id) if inv.discount_id else None
    paid = db.scalar(select(func.coalesce(func.sum(Payment.amount_minor), 0)).where(Payment.invoice_id == inv.id)) or 0
    balance = max(0, inv.total_minor - paid)

    disc_text = f"- ₹{inv.discount_amount_minor / 100:,.2f} ({discount.name})" if inv.discount_amount_minor and discount else (f"- ₹{inv.discount_amount_minor / 100:,.2f}" if inv.discount_amount_minor else "₹0.00")
    tax_text = f"+ ₹{inv.tax_amount_minor / 100:,.2f} ({tax.name})" if inv.tax_amount_minor and tax else (f"+ ₹{inv.tax_amount_minor / 100:,.2f}" if inv.tax_amount_minor else "₹0.00")

    preview = (
        f"Hi {customer.name if customer else 'Customer'},\n\n"
        f"Invoice {inv.number} has been issued.\n"
        f"Due date: {inv.due_date.isoformat()}\n"
        f"• Subtotal: ₹{inv.subtotal_minor / 100:,.2f}\n"
        f"• Discount: {disc_text}\n"
        f"• Tax: {tax_text}\n"
        f"• Total: ₹{inv.total_minor / 100:,.2f}\n"
        f"• Amount Due: ₹{balance / 100:,.2f}\n\n"
        f"Please remit payment via bank transfer or card before the due date.\n"
        f"Thank you for choosing Brightloop!"
    )
    delivery = InvoiceDelivery(
        invoice_id=inv.id,
        recipient_email=recipient,
        subject=f"Invoice {inv.number} from Brightloop Software",
        sent_at=datetime.utcnow(),
        status="Delivered",
        content_preview=preview,
    )
    db.add(delivery)
    inv.sent_at = datetime.utcnow()
    if inv.status not in ("Paid", "Cancelled"):
        inv.status = "Sent"
    db.commit()
    db.refresh(inv)
    return invoice_dict(db, inv)


@app.get("/api/taxes")
def list_taxes(_: User = Depends(current_user), db: Session = Depends(db_session)) -> list[dict]:
    taxes = list(db.scalars(select(Tax).order_by(Tax.name)))
    return [{"id": t.id, "name": t.name, "rate_percent": t.rate_percent, "is_default": t.is_default, "active": t.active} for t in taxes]


@app.post("/api/taxes", status_code=201)
def create_tax(body: TaxIn, _: User = Depends(staff_user), db: Session = Depends(db_session)) -> dict:
    if db.scalar(select(Tax.id).where(Tax.name == body.name)):
        raise HTTPException(status_code=409, detail="A tax with this name already exists")
    if body.is_default:
        for t in db.scalars(select(Tax)):
            t.is_default = False
    tax = Tax(name=body.name, rate_percent=body.rate_percent, is_default=body.is_default, active=True)
    db.add(tax)
    db.commit()
    db.refresh(tax)
    return {"id": tax.id, "name": tax.name, "rate_percent": tax.rate_percent, "is_default": tax.is_default, "active": tax.active}


@app.patch("/api/taxes/{tax_id}/toggle")
def toggle_tax(tax_id: int, _: User = Depends(staff_user), db: Session = Depends(db_session)) -> dict:
    tax = db.get(Tax, tax_id)
    if tax is None:
        raise HTTPException(status_code=404, detail="Tax not found")
    tax.active = not tax.active
    db.commit()
    db.refresh(tax)
    return {"id": tax.id, "name": tax.name, "rate_percent": tax.rate_percent, "is_default": tax.is_default, "active": tax.active}


@app.get("/api/discounts")
def list_discounts(_: User = Depends(current_user), db: Session = Depends(db_session)) -> list[dict]:
    discounts = list(db.scalars(select(Discount).order_by(Discount.name)))
    return [{"id": d.id, "name": d.name, "discount_type": d.discount_type, "value": d.value, "code": d.code, "auto_apply": d.auto_apply, "active": d.active} for d in discounts]


@app.post("/api/discounts", status_code=201)
def create_discount(body: DiscountIn, _: User = Depends(staff_user), db: Session = Depends(db_session)) -> dict:
    if db.scalar(select(Discount.id).where(Discount.name == body.name)):
        raise HTTPException(status_code=409, detail="A discount with this name already exists")
    if body.auto_apply:
        for d in db.scalars(select(Discount)):
            d.auto_apply = False
    discount = Discount(name=body.name, discount_type=body.discount_type, value=body.value, code=body.code, auto_apply=body.auto_apply, active=True)
    db.add(discount)
    db.commit()
    db.refresh(discount)
    return {"id": discount.id, "name": discount.name, "discount_type": discount.discount_type, "value": discount.value, "code": discount.code, "auto_apply": discount.auto_apply, "active": discount.active}


@app.patch("/api/discounts/{discount_id}/toggle")
def toggle_discount(discount_id: int, _: User = Depends(staff_user), db: Session = Depends(db_session)) -> dict:
    discount = db.get(Discount, discount_id)
    if discount is None:
        raise HTTPException(status_code=404, detail="Discount not found")
    discount.active = not discount.active
    db.commit()
    db.refresh(discount)
    return {"id": discount.id, "name": discount.name, "discount_type": discount.discount_type, "value": discount.value, "code": discount.code, "auto_apply": discount.auto_apply, "active": discount.active}


@app.get("/api/payments")
def list_payments(page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100), search: str = "", user: User = Depends(current_user), db: Session = Depends(db_session)) -> dict:
    query, count_query = select(Payment), select(func.count(Payment.id))
    if user.role == "customer":
        allowed_invoice_ids = select(Invoice.id).where(Invoice.customer_id == user.customer_id)
        query, count_query = query.where(Payment.invoice_id.in_(allowed_invoice_ids)), count_query.where(Payment.invoice_id.in_(allowed_invoice_ids))
    if search.strip():
        term = f"%{search.strip()}%"
        matching_invoice_ids = select(Invoice.id).join(Customer, Customer.id == Invoice.customer_id).where(or_(Invoice.number.ilike(term), Customer.name.ilike(term)))
        condition = Payment.invoice_id.in_(matching_invoice_ids)
        query, count_query = query.where(condition), count_query.where(condition)
    return paginated(db, query.order_by(Payment.paid_at.desc()), count_query, page, page_size, lambda p: payment_dict(db, p))


@app.get("/api/billing/preview")
def billing_preview(as_of: date | None = None, _: User = Depends(staff_user), db: Session = Depends(db_session)) -> dict:
    cutoff = as_of or date.today()
    due_subscriptions = list(db.scalars(select(Subscription).where(Subscription.status == "Active", Subscription.paused.is_(False), Subscription.next_billing_date <= cutoff)))
    valid_subs = [sub for sub in due_subscriptions if not (db.get(Plan, sub.plan_id).auto_close and sub.expiry_date and sub.expiry_date <= cutoff)]
    due_count = len(valid_subs)
    estimated_minor = 0
    for sub in valid_subs:
        plan = db.get(Plan, sub.plan_id)
        if plan:
            lines = list(db.scalars(select(SubscriptionLine).where(SubscriptionLine.subscription_id == sub.id)))
            subtotal = sum(l.quantity * l.unit_price_minor for l in lines) if lines else plan.price_minor * sub.quantity
            _, _, _, _, total = calculate_billing_amounts(db, sub, subtotal)
            estimated_minor += total
    return {"as_of": cutoff.isoformat(), "due_count": due_count, "skipped": 0, "estimated_total_minor": estimated_minor}


@app.post("/api/billing/run")
def run_billing(body: BillingRunIn, _: User = Depends(staff_user), db: Session = Depends(db_session)) -> dict:
    today = body.as_of or date.today()
    due_subscriptions = list(db.scalars(select(Subscription).where(Subscription.status == "Active", Subscription.paused.is_(False), Subscription.next_billing_date <= today).order_by(Subscription.id)))
    created: list[str] = []
    for sub in due_subscriptions:
        refresh_subscription_lifecycle(db, sub)
        if sub.status != "Active":
            continue
        period_start = sub.next_billing_date
        existing = db.scalar(select(Invoice.id).where(Invoice.subscription_id == sub.id, Invoice.period_start == period_start))
        if existing:
            continue
        plan = db.get(Plan, sub.plan_id)
        if plan is None:
            continue
        lines = list(db.scalars(select(SubscriptionLine).where(SubscriptionLine.subscription_id == sub.id).order_by(SubscriptionLine.id)))
        if not lines:
            product = db.get(Product, plan.product_id)
            lines = [SubscriptionLine(id=0, subscription_id=sub.id, product_id=plan.product_id, plan_id=plan.id, description=f"{product.name if product else plan.name} · {plan.name}", quantity=sub.quantity, unit_price_minor=plan.price_minor)]
        subtotal_minor = sum(line.quantity * line.unit_price_minor for line in lines)
        discount_amt, disc_id, tax_amt, tx_id, total_minor = calculate_billing_amounts(db, sub, subtotal_minor)
        invoice = Invoice(
            number=f"INV-{secrets.token_hex(3).upper()}",
            subscription_id=sub.id,
            customer_id=sub.customer_id,
            period_start=period_start,
            due_date=today + timedelta(days=sub.payment_terms_days),
            status="Confirmed",
            subtotal_minor=subtotal_minor,
            discount_id=disc_id,
            discount_amount_minor=discount_amt,
            tax_id=tx_id,
            tax_amount_minor=tax_amt,
            total_minor=total_minor,
        )
        db.add(invoice)
        db.flush()
        db.add_all([InvoiceLine(invoice_id=invoice.id, description=line.description, quantity=line.quantity, unit_price_minor=line.unit_price_minor, amount_minor=line.quantity * line.unit_price_minor) for line in lines])
        sub.next_billing_date = add_period(period_start, plan.billing_period)
        created.append(invoice.number)
    db.commit()
    return {"created": len(created), "skipped": len(due_subscriptions) - len(created), "failed": 0, "invoice_numbers": created, "message": f"Created {len(created)} invoice(s)"}


@app.post("/api/invoices/{invoice_id}/payments", status_code=201)
def record_payment(invoice_id: int, body: PaymentIn, _: User = Depends(staff_user), db: Session = Depends(db_session)) -> dict:
    invoice = db.get(Invoice, invoice_id)
    if invoice is None:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if invoice.status == "Paid":
        raise HTTPException(status_code=409, detail="Invoice is already paid")
    if invoice.status == "Cancelled":
        raise HTTPException(status_code=409, detail="Cannot record payment for a cancelled invoice")
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
    balance_query = select(func.coalesce(func.sum(balance_expr), 0)).select_from(Invoice).outerjoin(payment_totals, payment_totals.c.invoice_id == Invoice.id).where(Invoice.status != "Paid", Invoice.status != "Cancelled")
    overdue_count_query = select(func.count(Invoice.id)).where(Invoice.status != "Paid", Invoice.status != "Cancelled", Invoice.due_date < date.today())
    overdue_list_query = select(Invoice).where(Invoice.status != "Paid", Invoice.status != "Cancelled", Invoice.due_date < date.today()).order_by(Invoice.due_date).limit(25)
    overdue_amount_query = select(func.coalesce(func.sum(balance_expr), 0)).select_from(Invoice).outerjoin(payment_totals, payment_totals.c.invoice_id == Invoice.id).where(Invoice.status != "Paid", Invoice.status != "Cancelled", Invoice.due_date < date.today())
    status_query = select(Subscription.status, func.count(Subscription.id)).group_by(Subscription.status)
    active_list_query = select(Subscription).where(Subscription.status == "Active").order_by(Subscription.next_billing_date).limit(10)
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
        overdue_amount_query = overdue_amount_query.where(Invoice.customer_id == customer_filter)
        status_query = status_query.where(Subscription.customer_id == customer_filter)
        active_list_query = active_list_query.where(Subscription.customer_id == customer_filter)
        mrr_query = mrr_query.where(Subscription.customer_id == customer_filter)
        history_query = history_query.where(Invoice.customer_id == customer_filter)
    overdue_rows = list(db.scalars(overdue_list_query))
    history_rows = db.execute(history_query).all()
    revenue_history = [{"day": str(day), "amount_minor": amount or 0} for day, amount in history_rows]
    subscription_status_counts = {name: count for name, count in db.execute(status_query).all()}
    active_subscription_rows = list(db.scalars(active_list_query))
    return {
        "active_subscriptions": active_count,
        "revenue_minor": paid_revenue,
        "outstanding_minor": db.scalar(balance_query) or 0,
        "overdue_count": db.scalar(overdue_count_query) or 0,
        "overdue_amount_minor": db.scalar(overdue_amount_query) or 0,
        "mrr_minor": db.scalar(mrr_query) or 0,
        "subscription_status_counts": subscription_status_counts,
        "active_subscription_rows": [subscription_dict(db, row) for row in active_subscription_rows],
        "revenue_history": revenue_history,
        "revenue_30d_minor": sum(row["amount_minor"] for row in revenue_history),
        "overdue_invoices": [invoice_dict(db, inv) for inv in overdue_rows],
    }
