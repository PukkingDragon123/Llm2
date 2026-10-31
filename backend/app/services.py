"""Domain services shared by the API: factory defaults, new-project templates, BOM conversion, revisions, exports."""
from __future__ import annotations

import copy
import json
import os
import re
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from .calc.engine import compute
from .db import Project, Revision, Setting, Supplier, SupplierPrice, FILES_DIR, AuditLog
from .exports.costing import build_costing_workbook
from .exports.quotation import build_quotation_workbook, xlsx_to_pdf
from .learning import estimate_categories

SEED = os.path.join(os.path.dirname(__file__), "seed", "reference_import.json")
REFERENCE_XLS = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "reference",
                                             "QT-2608533_Rev.4_JI-263937_Titanium_Recycle_Drum.xls"))

FACTORY_KEYS = ("settings", "labor_params", "labor_rates", "crews", "machine_params", "machines", "materials")


# ------------------------------------------------------------------ factory defaults
def factory_from_import(est: dict, quote_doc: dict) -> dict:
    f = {k: copy.deepcopy(est.get(k)) for k in FACTORY_KEYS}
    # crews template keeps roles but no persons/days (must be estimated per job)
    for c in f["crews"] or []:
        c["days"] = None
        for m in c["members"]:
            m["persons"] = 0
    f["service_catalog"] = [{k: s.get(k) for k in ("group", "name", "rate", "qty", "minimum", "amount", "currency", "unit", "source")}
                            for s in est.get("services") or []]
    f["price_sheet_templates"] = [{"id": s["id"], "name": s["name"], "currency": s["currency"], "round_digits": s["round_digits"],
                                   "tax_pct": s.get("tax_pct", 0), "margin_divisor": s.get("margin_divisor", 1),
                                   "freight": [{"label": fr["label"], "amount": None, "currency": fr.get("currency")}
                                               for fr in s.get("freight") or []], "lines": []}
                                  for s in est.get("price_sheets") or []]
    f["bucket_template"] = copy.deepcopy(est.get("buckets"))
    for b in f["bucket_template"] or []:
        for src in b.get("sources") or []:
            if src.get("type") == "fixed":
                src["amount"] = src.get("amount")
    tail = []
    seen_tail = False
    for row in quote_doc.get("rows") or []:
        if row.get("kind") == "highlight_head":
            seen_tail = True
        if seen_tail:
            tail.append(row)
    f["quote_defaults"] = {
        "payment_term": quote_doc.get("payment_term"), "delivery_unit": quote_doc.get("delivery_unit", "Months"),
        "currency_label": quote_doc.get("currency_label", "USD."), "prepared_by": quote_doc.get("prepared_by"),
        "reviewed_by": quote_doc.get("reviewed_by"), "approved_by": quote_doc.get("approved_by"),
        "tail_rows_example": tail,
    }
    f["price_max_age_days"] = 90
    return f


def get_factory(db: Session) -> dict:
    s = db.get(Setting, "factory")
    return s.value if s else {}


def set_factory(db: Session, value: dict):
    s = db.get(Setting, "factory")
    if s:
        s.value = value
    else:
        db.add(Setting(key="factory", value=value))
    db.commit()


def seed(db: Session):
    """First start: load the reference project (imported from Prolog's workbook) and derive factory defaults."""
    if db.get(Setting, "factory") is not None:
        return
    d = json.load(open(SEED))
    set_factory(db, factory_from_import(d["estimate"], d["quote_doc"]))
    create_project_from_import(db, d, status="quoted")


def create_project_from_import(db: Session, d: dict, status="quoted") -> Project:
    pj = d["project"]
    p = Project(job_no=pj.get("job_no", ""), quotation_no=pj.get("quotation_no", ""), customer_name=pj.get("customer_name", ""),
                product_subject=pj.get("product_subject", ""), drawing_no=pj.get("drawing_no", ""), status=status,
                job_class=(d["estimate"].get("settings") or {}).get("job_class") or "CUSTOM MADE",
                meta={"source_file": pj.get("source_file"), "import_notes": d.get("notes", []),
                      "reference_values": d.get("reference_values", {}), "imported": True},
                estimate=d["estimate"], quote_doc=d["quote_doc"])
    db.add(p)
    db.commit()
    refresh_summary(db, p)
    for sp in d.get("supplier_prices") or []:
        add_supplier_price(db, sp, verified=True)
    db.add(AuditLog(project_id=p.id, action="import", detail={"file": pj.get("source_file")}))
    db.commit()
    return p


def add_supplier_price(db: Session, sp: dict, verified=False):
    name = (sp.get("supplier") or "").strip() or "Unknown"
    sup = db.query(Supplier).filter_by(name=name).first()
    if not sup:
        sup = Supplier(name=name)
        db.add(sup)
        db.flush()
    dims = _dims_from_desc(sp.get("description", ""))
    db.add(SupplierPrice(supplier_id=sup.id, supplier_name=name, category=sp.get("group") or "", material=sp.get("material") or "",
                         description=sp.get("description") or "", unit=sp.get("unit") or "pc",
                         unit_price=float(sp.get("unit_price") or 0), currency=sp.get("currency") or "USD",
                         unit_weight=sp.get("unit_weight"), quote_date=_norm_date(sp.get("quote_date")),
                         source=sp.get("source") or "", verified=verified, **dims))


def _norm_date(s):
    s = (s or "").strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%b-%y"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    return s


def _dims_from_desc(desc: str) -> dict:
    m = re.search(r"([\d.]+)\s*[xX]\s*([\d.]+)\s*[xX]\s*([\d.]+)\s*t", desc.replace(" ", ""))
    if m:
        a, b, t = (float(x) for x in m.groups())
        return {"width": a, "length": b, "thk": t}
    return {}


# ------------------------------------------------------------------ new project
def new_estimate(f: dict) -> dict:
    est = {k: copy.deepcopy(f.get(k)) for k in FACTORY_KEYS}
    est["parts"] = []
    est["services"] = []
    est["price_sheets"] = copy.deepcopy(f.get("price_sheet_templates") or [])
    est["buckets"] = copy.deepcopy(f.get("bucket_template") or [
        {"no": 1, "heading": "Main Part. : Titanium.", "unit": "Lot.", "qty": 1, "markup": True, "sources": [{"type": "price_sheet", "id": "import"}]},
        {"no": 2, "heading": "Other Accessories.", "unit": "Lot.", "qty": 1, "markup": True,
         "sources": [{"type": "price_sheet", "id": "domestic"}, {"type": "price_sheet", "id": "import_wfn"}]},
        {"no": 3, "heading": "Labor cost", "unit": "Lot.", "qty": 1, "markup": True,
         "sources": [{"type": "services"}, {"type": "crews"}, {"type": "machines"}]}])
    return est


def new_quote_doc(f: dict, p: Project, est: dict) -> dict:
    qd = f.get("quote_defaults") or {}
    rows = []
    for b in est.get("buckets") or []:
        rows.append({"kind": "item", "item_no": b["no"], "runs": [{"text": b["heading"], "bold": True}]})
        rows.append({"kind": "blank", "runs": []})
    rows += copy.deepcopy(qd.get("tail_rows_example") or [])
    return {"quotation_no": p.quotation_no, "job_no": p.job_no, "customer_name": p.customer_name,
            "contact_person": "", "tel": "-", "fax": "-", "email": "", "product_subject": p.product_subject,
            "drawing_no": p.drawing_no, "enquiry_date": "", "quotation_date": datetime.now().strftime("%Y-%m-%d"),
            "validity_date": (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d"),
            "payment_term": qd.get("payment_term") or "-", "delivery_time": None, "delivery_unit": qd.get("delivery_unit") or "Months",
            "currency_label": qd.get("currency_label") or "USD.",
            "title": {"runs": [{"text": p.product_subject, "bold": True}], "qty": 1, "unit": "Set."},
            "rows": rows, "page_breaks": "auto", "prepared_by": qd.get("prepared_by") or "",
            "reviewed_by": qd.get("reviewed_by") or "", "approved_by": qd.get("approved_by") or ""}


# ------------------------------------------------------------------ computation helpers
def compute_with_checks(db: Session, est: dict) -> dict:
    r = compute(est)
    f = get_factory(db)
    max_age = f.get("price_max_age_days", 90)
    ids = [ln.get("supplier_price_id") for s in est.get("price_sheets") or [] for ln in s.get("lines") or [] if ln.get("supplier_price_id")]
    if ids:
        prices = {sp.id: sp for sp in db.query(SupplierPrice).filter(SupplierPrice.id.in_(ids)).all()}
        for si, s in enumerate(est.get("price_sheets") or []):
            for li, ln in enumerate(s.get("lines") or []):
                sp = prices.get(ln.get("supplier_price_id"))
                if not sp:
                    continue
                if sp.unit_price != ln.get("unit_price"):
                    r["issues"].append({"severity": "warning", "path": f"price_sheets.{si}.lines.{li}.unit_price",
                                        "message": f"'{ln.get('description')}' price differs from linked supplier price ({sp.unit_price} {sp.currency})",
                                        "question": ""})
                try:
                    age = (datetime.now() - datetime.strptime(sp.quote_date, "%Y-%m-%d")).days
                except Exception:
                    age = None
                if age is not None and age > max_age:
                    r["issues"].append({"severity": "warning", "path": f"price_sheets.{si}.lines.{li}.unit_price",
                                        "message": f"Supplier price for '{ln.get('description')}' is {age} days old (> {max_age})",
                                        "question": f"Re-confirm supplier price for {ln.get('description')}"})
    r["categories_thb"] = estimate_categories(r)
    return r


def summary_of(r: dict) -> dict:
    return {"items": [{k: it[k] for k in ("no", "heading", "unit", "qty", "base", "unit_price", "total", "margin")} for it in r["items"]],
            "totals": r["totals"], "ces": r["ces"], "weights": r["weights"], "categories_thb": r.get("categories_thb"),
            "missing_count": r["missing_count"], "issue_count": len(r["issues"]), "TU": r["TU"]}


def refresh_summary(db: Session, p: Project) -> dict:
    r = compute_with_checks(db, p.estimate)
    p.summary = summary_of(r)
    db.commit()
    return r


# ------------------------------------------------------------------ drawing -> BOM
def grade_code_for(part: dict, materials: list[dict]) -> str:
    spec = (part.get("material_spec") or "").upper().replace(" ", "").replace("-", "")
    form = part.get("form") or "plate"
    gr = re.search(r"GR\.?(\d+)", spec)
    g = gr.group(1) if gr else None
    if "B265" in spec or "SB265" in spec or ("TI" in spec and form == "plate"):
        return {"1": "01", "2": "02", "4": "03", "5": "04", "7": "05"}.get(g or "", "25")
    if form in ("pipe", "tube") and ("B861" in spec or "B862" in spec or "B338" in spec or "TI" in spec):
        return {"1": "17", "2": "20"}.get(g or "", "25")
    if form == "bar" and g == "2":
        return "10"
    return "25"


def part_from_drawing(dp: dict, materials: list[dict], drawing_id: int, idx: int) -> dict:
    form = dp.get("form") or "plate"
    if form in ("pipe", "tube"):
        shape, s1, s2, s3 = "ODTL", dp.get("od_mm"), dp.get("thk_mm"), dp.get("length_mm")
    elif form == "bar":
        shape, s1, s2, s3 = "DiaL", dp.get("od_mm"), dp.get("length_mm"), None
    else:
        shape, s1, s2, s3 = "TWL", dp.get("thk_mm"), dp.get("width_mm"), dp.get("length_mm")
    code = grade_code_for(dp, materials)
    name = dp.get("name") or "Part"
    if dp.get("mark"):
        name = f"{name} [{dp['mark']}]"
    return {"id": f"d{drawing_id}_{idx}", "group": dp.get("category", ""), "name": name, "grade_code": code,
            "grade": next((m["name"] for m in materials if m.get("code") == code), code),
            "material_spec": dp.get("material_spec"), "shape": shape, "s1": s1, "s2": s2, "s3": s3,
            "qty": dp.get("qty"), "pricing": "price_sheet", "processes": [],
            "source": f"drawing #{drawing_id} row {idx + 1}", "remark": dp.get("notes") or ""}


# ------------------------------------------------------------------ revisions / exports
def bump_rev(qno: str, rev: int) -> str:
    if re.search(r"REV\.?\s*\d+", qno, re.I):
        return re.sub(r"(REV\.?\s*)\d+", lambda m: f"{m.group(1)}{rev}", qno, flags=re.I)
    return f"{qno}-REV.{rev}" if qno else f"REV.{rev}"


def export_files(p: Project, r: dict, outdir: str, quote_doc: dict | None = None) -> dict:
    os.makedirs(outdir, exist_ok=True)
    base = re.sub(r"[^A-Za-z0-9._-]+", "_", (quote_doc or p.quote_doc).get("quotation_no") or f"project_{p.id}")
    qx = os.path.join(outdir, f"{base}.xlsx")
    build_quotation_workbook(quote_doc or p.quote_doc, r, qx)
    qpdf = xlsx_to_pdf(qx, outdir)
    cx = os.path.join(outdir, f"{base}_costing.xlsx")
    cells = build_costing_workbook(p.estimate, r, {"job_no": p.job_no, "product_subject": p.product_subject,
                                                   "quotation_no": (quote_doc or p.quote_doc).get("quotation_no")}, cx)
    cpdf = costing_pdf(cx, outdir)
    return {"quotation_xlsx": os.path.basename(qx), "quotation_pdf": os.path.basename(qpdf),
            "costing_xlsx": os.path.basename(cx), "costing_pdf": os.path.basename(cpdf), "_cells": cells}


def costing_pdf(xlsx: str, outdir: str) -> str:
    import openpyxl, tempfile, shutil
    tmp = tempfile.mkdtemp(prefix="cpdf_")
    try:
        wb = openpyxl.load_workbook(xlsx)
        for ws in wb.worksheets:
            ws.page_setup.orientation = "landscape"
            ws.page_setup.paperSize = 9
            ws.sheet_properties.pageSetUpPr.fitToPage = True
            ws.page_setup.fitToWidth = 1
            ws.page_setup.fitToHeight = 0
            ws.oddFooter.left.text = "Prolog Titanium — internal costing (confidential)"
            ws.oddFooter.right.text = "&P / &N"
        src = os.path.join(tmp, os.path.basename(xlsx))
        wb.save(src)
        out = xlsx_to_pdf(src, outdir, pdf_font_fix=False)
        return out
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def issue_revision(db: Session, p: Project, note: str = "") -> Revision:
    last = max([rv.rev_no for rv in p.revisions], default=None)
    if last is None:
        m = re.search(r"REV\.?\s*(\d+)", p.quotation_no or "", re.I)
        rev = int(m.group(1)) + 1 if m else 0
    else:
        rev = last + 1
    qd = copy.deepcopy(p.quote_doc)
    qd["quotation_no"] = bump_rev(p.quotation_no or qd.get("quotation_no", ""), rev)
    r = compute_with_checks(db, p.estimate)
    outdir = os.path.join(FILES_DIR, f"project_{p.id}", f"rev_{rev}")
    files = export_files(p, r, outdir, qd)
    files.pop("_cells", None)
    rv = Revision(project_id=p.id, rev_no=rev, quotation_no=qd["quotation_no"], note=note, estimate=copy.deepcopy(p.estimate),
                  quote_doc=qd, summary=summary_of(r), files=files)
    db.add(rv)
    p.quotation_no = qd["quotation_no"]
    p.quote_doc = {**p.quote_doc, "quotation_no": qd["quotation_no"]}
    if p.status == "draft":
        p.status = "quoted"
    db.add(AuditLog(project_id=p.id, action="issue_revision", detail={"rev": rev, "net": r["totals"]["net"]}))
    db.commit()
    return rv


def diff_summaries(a: dict, b: dict) -> list[dict]:
    out = []
    ia = {i["no"]: i for i in a.get("items", [])}
    ib = {i["no"]: i for i in b.get("items", [])}
    for no in sorted(set(ia) | set(ib)):
        x, y = ia.get(no), ib.get(no)
        out.append({"item": no, "heading": (y or x)["heading"], "a": x and x["total"], "b": y and y["total"],
                    "delta": (y["total"] if y else 0) - (x["total"] if x else 0)})
    for k in ("total", "discount", "net", "header_price"):
        va, vb = (a.get("totals") or {}).get(k), (b.get("totals") or {}).get(k)
        out.append({"item": k, "heading": k, "a": va, "b": vb, "delta": (vb or 0) - (va or 0)})
    return out
