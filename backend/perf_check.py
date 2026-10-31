"""Run representative read-query checks against an isolated synthetic SQLite dataset."""

from datetime import date, datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from time import perf_counter

from sqlalchemy import create_engine, func, select, text
from sqlalchemy.orm import Session

from main import Base, Customer, Invoice, Payment, Plan, Product, Subscription


def timed(label: str, session: Session, statement) -> None:
    started = perf_counter()
    rows = list(session.execute(statement).all())
    elapsed = (perf_counter() - started) * 1000
    print(f"{label}: {len(rows)} rows in {elapsed:.1f} ms")


def main(rows: int = 10_000) -> None:
    with TemporaryDirectory(prefix="brightloop-perf-") as temp_dir:
        database_path = Path(temp_dir) / "benchmark.db"
        engine = create_engine(f"sqlite:///{database_path}")
        Base.metadata.create_all(engine)
        now = datetime.now()
        today = date.today()
        with Session(engine) as session:
            customer = Customer(name="Benchmark Customer", email="benchmark@example.invalid")
            product = Product(name="Benchmark Product", price_minor=10000)
            session.add_all([customer, product])
            session.flush()
            plan = Plan(name="Benchmark Monthly", product_id=product.id, price_minor=10000, billing_period="monthly")
            session.add(plan)
            session.flush()
            customer_id, plan_id = customer.id, plan.id

            subscription_rows = [
                {
                    "number": f"BENCH-SUB-{index:06d}",
                    "customer_id": customer_id,
                    "plan_id": plan_id,
                    "start_date": today - timedelta(days=90),
                    "next_billing_date": today + timedelta(days=index % 30 - 15),
                    "status": "Active" if index % 5 else "Closed",
                    "quantity": 1 + index % 5,
                    "payment_terms_days": 14,
                    "paused": False,
                }
                for index in range(rows)
            ]
            session.execute(Subscription.__table__.insert(), subscription_rows)
            subscription_ids = list(session.scalars(select(Subscription.id).order_by(Subscription.id)))
            invoice_rows = [
                {
                    "number": f"BENCH-INV-{index:06d}",
                    "subscription_id": subscription_id,
                    "customer_id": customer_id,
                    "period_start": today - timedelta(days=30),
                    "due_date": today + timedelta(days=index % 45 - 20),
                    "status": "Paid" if index % 3 else "Confirmed",
                    "subtotal_minor": 10000,
                    "discount_amount_minor": 0,
                    "discount_usage_reserved": False,
                    "tax_amount_minor": 1800,
                    "total_minor": 11800,
                    "created_at": now - timedelta(days=index % 60),
                }
                for index, subscription_id in enumerate(subscription_ids)
            ]
            session.execute(Invoice.__table__.insert(), invoice_rows)
            invoice_ids = list(session.scalars(select(Invoice.id).order_by(Invoice.id)))
            payment_rows = [
                {"invoice_id": invoice_id, "method": "UPI", "amount_minor": 11800, "paid_at": now - timedelta(days=index % 60), "note": "benchmark"}
                for index, invoice_id in enumerate(invoice_ids)
                if index % 3
            ]
            session.execute(Payment.__table__.insert(), payment_rows)
            session.commit()

            timed("Due subscription page", session, select(Subscription.id).where(Subscription.status == "Active", Subscription.next_billing_date <= today).order_by(Subscription.next_billing_date).limit(25))
            timed("Overdue invoice page", session, select(Invoice.id).where(Invoice.status.in_(["Confirmed", "Sent"]), Invoice.due_date < today).order_by(Invoice.due_date).limit(25))
            timed("Latest payments page", session, select(Payment.id).order_by(Payment.paid_at.desc()).limit(25))
            timed("Finance status aggregation", session, select(Invoice.status, func.count(Invoice.id)).where(Invoice.created_at >= now - timedelta(days=30)).group_by(Invoice.status))

            plans = session.execute(text("EXPLAIN QUERY PLAN SELECT id FROM subscriptions WHERE status='Active' AND next_billing_date <= :cutoff ORDER BY next_billing_date LIMIT 25"), {"cutoff": today.isoformat()}).all()
            print("Subscription query plan:", " | ".join(str(row[-1]) for row in plans))
            plans = session.execute(text("EXPLAIN QUERY PLAN SELECT id FROM invoices WHERE status IN ('Confirmed','Sent') AND due_date < :cutoff ORDER BY due_date LIMIT 25"), {"cutoff": today.isoformat()}).all()
            print("Invoice query plan:", " | ".join(str(row[-1]) for row in plans))
        engine.dispose()
        print(f"Synthetic dataset: {rows:,} subscriptions, {rows:,} invoices, {len(payment_rows):,} payments. Database removed after this run.")


if __name__ == "__main__":
    main()
