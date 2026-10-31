"""SQLite persistence (SQLAlchemy 2)."""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone

from sqlalchemy import (create_engine, String, Integer, Float, Text, DateTime, ForeignKey, Boolean, JSON, event)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker, relationship

DATA_DIR = os.environ.get("PROLOG_DATA_DIR", os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data")))
os.makedirs(DATA_DIR, exist_ok=True)
FILES_DIR = os.path.join(DATA_DIR, "files")
os.makedirs(FILES_DIR, exist_ok=True)
DB_URL = os.environ.get("PROLOG_DB_URL", f"sqlite:///{os.path.join(DATA_DIR, 'app.db')}")

engine = create_engine(DB_URL, connect_args={"check_same_thread": False} if DB_URL.startswith("sqlite") else {})


@event.listens_for(engine, "connect")
def _fk(dbapi_conn, _):
    if DB_URL.startswith("sqlite"):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA journal_mode=WAL")
        cur.close()


SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[int] = mapped_column(primary_key=True)
    job_no: Mapped[str] = mapped_column(String(64), default="")
    quotation_no: Mapped[str] = mapped_column(String(128), default="")
    customer_name: Mapped[str] = mapped_column(String(256), default="")
    product_subject: Mapped[str] = mapped_column(String(256), default="")
    drawing_no: Mapped[str] = mapped_column(String(128), default="")
    status: Mapped[str] = mapped_column(String(32), default="draft")   # draft|quoted|won|lost|in_production|completed
    job_class: Mapped[str] = mapped_column(String(32), default="CUSTOM MADE")
    meta: Mapped[dict] = mapped_column(JSON, default=dict)             # dims, material, tags, source_file ...
    estimate: Mapped[dict] = mapped_column(JSON, default=dict)
    quote_doc: Mapped[dict] = mapped_column(JSON, default=dict)
    actuals: Mapped[dict] = mapped_column(JSON, default=dict)          # actual production costs (learning)
    summary: Mapped[dict] = mapped_column(JSON, default=dict)          # last computed items/totals (for lists)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)
    revisions = relationship("Revision", back_populates="project", cascade="all, delete-orphan")
    drawings = relationship("Drawing", back_populates="project", cascade="all, delete-orphan")


class Revision(Base):
    __tablename__ = "revisions"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    rev_no: Mapped[int] = mapped_column(Integer)
    quotation_no: Mapped[str] = mapped_column(String(128), default="")
    note: Mapped[str] = mapped_column(Text, default="")
    estimate: Mapped[dict] = mapped_column(JSON)
    quote_doc: Mapped[dict] = mapped_column(JSON)
    summary: Mapped[dict] = mapped_column(JSON)
    files: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    project = relationship("Project", back_populates="revisions")


class Drawing(Base):
    __tablename__ = "drawings"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    filename: Mapped[str] = mapped_column(String(256))
    path: Mapped[str] = mapped_column(String(512))
    mime: Mapped[str] = mapped_column(String(64))
    pages: Mapped[int] = mapped_column(Integer, default=1)
    page_sizes: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(32), default="uploaded")   # uploaded|analyzing|extracted|reviewed|error
    error: Mapped[str] = mapped_column(Text, default="")
    extraction: Mapped[dict] = mapped_column(JSON, default=dict)          # raw AI output
    review: Mapped[dict] = mapped_column(JSON, default=dict)              # engineer decisions/corrections
    ai_meta: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    project = relationship("Project", back_populates="drawings")


class Supplier(Base):
    __tablename__ = "suppliers"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(256), unique=True)
    country: Mapped[str] = mapped_column(String(64), default="")
    contact: Mapped[str] = mapped_column(String(256), default="")
    lead_time: Mapped[str] = mapped_column(String(128), default="")
    notes: Mapped[str] = mapped_column(Text, default="")


class SupplierPrice(Base):
    __tablename__ = "supplier_prices"
    id: Mapped[int] = mapped_column(primary_key=True)
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True)
    supplier_name: Mapped[str] = mapped_column(String(256), default="")
    category: Mapped[str] = mapped_column(String(64), default="")       # Plate / Pipe / Flange / Gasket / Bolt ...
    material: Mapped[str] = mapped_column(String(128), default="")      # Ti.Gr.2, A36, PTFE ...
    description: Mapped[str] = mapped_column(String(512), default="")
    thk: Mapped[float | None] = mapped_column(Float, nullable=True)
    width: Mapped[float | None] = mapped_column(Float, nullable=True)
    length: Mapped[float | None] = mapped_column(Float, nullable=True)
    od: Mapped[float | None] = mapped_column(Float, nullable=True)
    unit: Mapped[str] = mapped_column(String(16), default="pc")          # pc / kg / m
    unit_price: Mapped[float] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String(8), default="USD")
    unit_weight: Mapped[float | None] = mapped_column(Float, nullable=True)
    quote_date: Mapped[str] = mapped_column(String(32), default="")
    valid_until: Mapped[str] = mapped_column(String(32), default="")
    source: Mapped[str] = mapped_column(String(512), default="")
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    action: Mapped[str] = mapped_column(String(64))
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


def init_db():
    Base.metadata.create_all(engine)
