"""Prolog Titanium estimating & quotation API (FastAPI)."""
from __future__ import annotations

import copy
import io
import mimetypes
import os
import shutil
import tempfile
import threading
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Depends, Body
from fastapi.responses import FileResponse, Response, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy.orm import Session

from . import services as svc
from .ai import claude
from .calc.engine import compute, trace
from .db import (SessionLocal, init_db, Project, Revision, Drawing, Supplier, SupplierPrice, AuditLog, FILES_DIR)
from .learning import calibration, similarity, estimate_categories, CATEGORIES, CATEGORY_SOURCES

app = FastAPI(title="Prolog Titanium Estimator", version="1.0")
executor = ThreadPoolExecutor(max_workers=2)
JOBS: dict[str, dict] = {}
_jobs_lock = threading.Lock()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@app.on_event("startup")
def _startup():
    init_db()
    with SessionLocal() as db:
        svc.seed(db)


def _job(kind: str, fn, *args) -> str:
    jid = uuid.uuid4().hex[:12]
    with _jobs_lock:
        JOBS[jid] = {"id": jid, "kind": kind, "status": "running", "result": None, "error": None,
                     "started": datetime.now(timezone.utc).replace(tzinfo=None).isoformat()}

    def run():
        try:
            res = fn(*args)
            JOBS[jid].update(status="done", result=res)
        except claude.AIUnavailable as e:
            JOBS[jid].update(status="error", error=str(e), code="ai_unavailable")
        except Exception as e:  # noqa
            traceback.print_exc()
            JOBS[jid].update(status="error", error=f"{type(e).__name__}: {e}")
        JOBS[jid]["finished"] = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()

    executor.submit(run)
    return jid


@app.get("/api/jobs/{jid}")
def job_status(jid: str):
    j = JOBS.get(jid)
    if not j:
        raise HTTPException(404, "job not found")
    return j


def _project(db, pid) -> Project:
    p = db.get(Project, pid)
    if not p:
        raise HTTPException(404, "project not found")
    return p


def _pdict(p: Project, full=False) -> dict:
    d = {"id": p.id, "job_no": p.job_no, "quotation_no": p.quotation_no, "customer_name": p.customer_name,
         "product_subject": p.product_subject, "drawing_no": p.drawing_no, "status": p.status, "job_class": p.job_class,
         "meta": p.meta, "summary": p.summary, "created_at": p.created_at.isoformat(), "updated_at": p.updated_at.isoformat(),
         "has_actuals": bool((p.actuals or {}).get("categories"))}
    if full:
        d.update(estimate=p.estimate, quote_doc=p.quote_doc, actuals=p.actuals,
                 revisions=[{"id": r.id, "rev_no": r.rev_no, "quotation_no": r.quotation_no, "note": r.note,
                             "created_at": r.created_at.isoformat(), "totals": r.summary.get("totals"), "files": r.files}
                            for r in sorted(p.revisions, key=lambda x: x.rev_no)],
                 drawings=[_ddict(dw) for dw in p.drawings])
    return d


def _ddict(d: Drawing) -> dict:
    return {"id": d.id, "project_id": d.project_id, "filename": d.filename, "mime": d.mime, "pages": d.pages,
            "page_sizes": d.page_sizes, "status": d.status, "error": d.error, "extraction": d.extraction,
            "review": d.review, "ai_meta": d.ai_meta, "created_at": d.created_at.isoformat()}


# =============================================================== settings / AI status
@app.get("/api/health")
def health():
    return {"ok": True, "ai": claude.status(), "soffice": shutil.which("soffice") is not None}


@app.get("/api/settings/factory")
def get_factory(db: Session = Depends(get_db)):
    return svc.get_factory(db)


@app.put("/api/settings/factory")
def put_factory(value: dict = Body(...), db: Session = Depends(get_db)):
    svc.set_factory(db, value)
    db.add(AuditLog(action="factory_update", detail={"keys": list(value.keys())}))
    db.commit()
    return {"ok": True}


class AIConfig(BaseModel):
    api_key: Optional[str] = None
    model: Optional[str] = None


@app.get("/api/settings/ai")
def get_ai():
    return claude.status()


@app.put("/api/settings/ai")
def put_ai(cfg: AIConfig):
    claude.save_config(cfg.api_key, cfg.model)
    return claude.status()


# =============================================================== projects
@app.get("/api/projects")
def list_projects(db: Session = Depends(get_db)):
    return [_pdict(p) for p in db.query(Project).order_by(Project.updated_at.desc()).all()]


class NewProject(BaseModel):
    job_no: str = ""
    quotation_no: str = ""
    customer_name: str = ""
    product_subject: str = ""
    drawing_no: str = ""
    job_class: str = "CUSTOM MADE"
    copy_from: Optional[int] = None


@app.post("/api/projects")
def create_project(np: NewProject, db: Session = Depends(get_db)):
    f = svc.get_factory(db)
    p = Project(job_no=np.job_no, quotation_no=np.quotation_no, customer_name=np.customer_name,
                product_subject=np.product_subject, drawing_no=np.drawing_no, job_class=np.job_class, status="draft", meta={})
    if np.copy_from:
        src = _project(db, np.copy_from)
        p.estimate = copy.deepcopy(src.estimate)
        p.quote_doc = copy.deepcopy(src.quote_doc)
        p.meta = {"copied_from": src.id}
        for k, v in (("quotation_no", np.quotation_no), ("job_no", np.job_no), ("customer_name", np.customer_name),
                     ("product_subject", np.product_subject), ("drawing_no", np.drawing_no)):
            p.quote_doc[k] = v
        p.quote_doc["page_breaks"] = "auto"
    else:
        p.estimate = svc.new_estimate(f)
        p.quote_doc = svc.new_quote_doc(f, p, p.estimate)
    db.add(p)
    db.commit()
    svc.refresh_summary(db, p)
    db.add(AuditLog(project_id=p.id, action="create", detail=np.model_dump()))
    db.commit()
    return _pdict(p, full=True)


@app.get("/api/projects/{pid}")
def get_project(pid: int, db: Session = Depends(get_db)):
    p = _project(db, pid)
    r = svc.compute_with_checks(db, p.estimate)
    return {**_pdict(p, full=True), "result": r}


class ProjectUpdate(BaseModel):
    job_no: Optional[str] = None
    quotation_no: Optional[str] = None
    customer_name: Optional[str] = None
    product_subject: Optional[str] = None
    drawing_no: Optional[str] = None
    status: Optional[str] = None
    job_class: Optional[str] = None
    meta: Optional[dict] = None
    estimate: Optional[dict] = None
    quote_doc: Optional[dict] = None


@app.put("/api/projects/{pid}")
def update_project(pid: int, up: ProjectUpdate, db: Session = Depends(get_db)):
    p = _project(db, pid)
    changed = []
    for k, v in up.model_dump(exclude_none=True).items():
        setattr(p, k, v)
        changed.append(k)
    if up.quote_doc is None:
        qd = dict(p.quote_doc or {})
        for k in ("quotation_no", "job_no", "customer_name", "product_subject", "drawing_no"):
            if getattr(up, k) is not None:
                qd[k] = getattr(up, k)
        p.quote_doc = qd
    p.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()
    r = svc.refresh_summary(db, p)
    db.add(AuditLog(project_id=p.id, action="update", detail={"fields": changed}))
    db.commit()
    return {**_pdict(p, full=True), "result": r}


@app.delete("/api/projects/{pid}")
def delete_project(pid: int, db: Session = Depends(get_db)):
    p = _project(db, pid)
    db.delete(p)
    db.commit()
    shutil.rmtree(os.path.join(FILES_DIR, f"project_{pid}"), ignore_errors=True)
    return {"ok": True}


@app.post("/api/calculate")
def calculate(estimate: dict = Body(...), db: Session = Depends(get_db)):
    """Live recalculation (no save) — used by the editor on every change."""
    return svc.compute_with_checks(db, estimate)


@app.post("/api/trace")
def trace_node(payload: dict = Body(...), db: Session = Depends(get_db)):
    r = compute(payload["estimate"])
    return trace(r, payload["key"], int(payload.get("depth", 8)))


@app.get("/api/projects/{pid}/audit")
def audit(pid: int, db: Session = Depends(get_db)):
    return [{"action": a.action, "detail": a.detail, "at": a.created_at.isoformat()}
            for a in db.query(AuditLog).filter_by(project_id=pid).order_by(AuditLog.id.desc()).limit(200)]


# =============================================================== import historical workbook
@app.post("/api/import/workbook")
async def import_workbook_ep(file: UploadFile = File(...), status: str = Form("quoted")):
    if not file.filename.lower().endswith((".xls", ".xlsx", ".xlsm")):
        raise HTTPException(400, "Upload a Prolog quotation workbook (.xls/.xlsx)")
    d = os.path.join(FILES_DIR, "imports")
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, f"{uuid.uuid4().hex[:8]}_{os.path.basename(file.filename)}")
    with open(path, "wb") as f:
        f.write(await file.read())

    def work():
        from .importer import import_workbook
        data = import_workbook(path)
        data["project"]["source_file"] = file.filename
        with SessionLocal() as db:
            p = svc.create_project_from_import(db, data, status=status)
            r = compute(p.estimate)
            ref = data["reference_values"]
            checks = []
            labels = {"item.1.price": "Item 1", "item.2.price": "Item 2", "item.3.price": "Item 3", "item.4.price": "Item 4",
                      "totals.total": "Total", "totals.net": "Net", "header.price": "Product line"}
            for k, label in labels.items():
                node = r["nodes"].get(k)
                if node and ref.get(k) is not None:
                    checks.append({"key": k, "label": label, "workbook": ref[k], "recomputed": node["value"],
                                   "match": abs(node["value"] - ref[k]) < 0.005})
                elif node:
                    checks.append({"key": k, "label": label, "workbook": None, "recomputed": node["value"], "match": None,
                                   "note": "value not available in the workbook file"})
            p.meta = {**p.meta, "import_checks": checks}
            db.commit()
            return {"project_id": p.id, "notes": data["notes"], "checks": checks}

    return {"job_id": _job("import", work)}


# =============================================================== revisions & exports
class IssueReq(BaseModel):
    note: str = ""


@app.post("/api/projects/{pid}/revisions")
def issue(pid: int, req: IssueReq, db: Session = Depends(get_db)):
    p = _project(db, pid)
    r = svc.compute_with_checks(db, p.estimate)
    blocking = [i for i in r["issues"] if i["severity"] in ("missing", "error")]
    if blocking:
        raise HTTPException(409, {"message": "Resolve missing inputs before issuing a quotation", "issues": blocking[:50]})
    rv = svc.issue_revision(db, p, req.note)
    return {"id": rv.id, "rev_no": rv.rev_no, "quotation_no": rv.quotation_no, "files": rv.files, "totals": rv.summary["totals"]}


@app.get("/api/revisions/{rid}")
def get_revision(rid: int, db: Session = Depends(get_db)):
    rv = db.get(Revision, rid)
    if not rv:
        raise HTTPException(404)
    return {"id": rv.id, "project_id": rv.project_id, "rev_no": rv.rev_no, "quotation_no": rv.quotation_no, "note": rv.note,
            "summary": rv.summary, "files": rv.files, "created_at": rv.created_at.isoformat(), "estimate": rv.estimate,
            "quote_doc": rv.quote_doc}


@app.get("/api/revisions/{rid}/files/{name}")
def revision_file(rid: int, name: str, inline: bool = False, db: Session = Depends(get_db)):
    rv = db.get(Revision, rid)
    if not rv or name not in (rv.files or {}).values():
        raise HTTPException(404)
    path = os.path.join(FILES_DIR, f"project_{rv.project_id}", f"rev_{rv.rev_no}", name)
    return FileResponse(path, filename=None if inline else name,
                        content_disposition_type="inline" if inline else "attachment")


@app.get("/api/projects/{pid}/revisions/compare")
def compare_revisions(pid: int, a: int, b: int, db: Session = Depends(get_db)):
    ra, rb = db.get(Revision, a), db.get(Revision, b)
    if not ra or not rb:
        raise HTTPException(404)
    return svc.diff_summaries(ra.summary, rb.summary)


@app.get("/api/projects/{pid}/export/{kind}")
def export_current(pid: int, kind: str, inline: bool = False, db: Session = Depends(get_db)):
    """Preview/export of the CURRENT (unissued) state: quotation.xlsx | quotation.pdf | costing.xlsx | costing.pdf"""
    p = _project(db, pid)
    r = svc.compute_with_checks(db, p.estimate)
    outdir = tempfile.mkdtemp(prefix="exp_")
    try:
        files = svc.export_files(p, r, outdir)
        key = {"quotation.xlsx": "quotation_xlsx", "quotation.pdf": "quotation_pdf", "costing.xlsx": "costing_xlsx",
               "costing.pdf": "costing_pdf"}.get(kind)
        if not key:
            raise HTTPException(404)
        path = os.path.join(outdir, files[key])
        data = open(path, "rb").read()
        mt = mimetypes.guess_type(path)[0] or "application/octet-stream"
        disp = "inline" if inline else "attachment"
        return Response(data, media_type=mt, headers={"Content-Disposition": f'{disp}; filename="{files[key]}"'})
    finally:
        shutil.rmtree(outdir, ignore_errors=True)


# =============================================================== drawings
@app.post("/api/projects/{pid}/drawings")
async def upload_drawing(pid: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    p = _project(db, pid)
    mime = file.content_type or mimetypes.guess_type(file.filename)[0] or ""
    if file.filename.lower().endswith(".pdf"):
        mime = "application/pdf"
    if mime not in ("application/pdf", "image/png", "image/jpeg", "image/tiff"):
        raise HTTPException(400, "Upload PDF, PNG, JPG or TIFF drawings")
    d = os.path.join(FILES_DIR, f"project_{p.id}", "drawings")
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, f"{uuid.uuid4().hex[:8]}_{os.path.basename(file.filename)}")
    with open(path, "wb") as f:
        f.write(await file.read())
    pages, sizes = 1, []
    if mime == "application/pdf":
        import pymupdf as fitz
        doc = fitz.open(path)
        pages = len(doc)
        sizes = [[pg.rect.width, pg.rect.height] for pg in doc]
    else:
        from PIL import Image
        im = Image.open(path)
        sizes = [list(im.size)]
    dw = Drawing(project_id=p.id, filename=file.filename, path=path, mime=mime, pages=pages, page_sizes=sizes)
    db.add(dw)
    db.commit()
    return _ddict(dw)


def _drawing(db, did) -> Drawing:
    d = db.get(Drawing, did)
    if not d:
        raise HTTPException(404, "drawing not found")
    return d


@app.get("/api/drawings/{did}")
def get_drawing(did: int, db: Session = Depends(get_db)):
    return _ddict(_drawing(db, did))


@app.get("/api/drawings/{did}/file")
def drawing_file(did: int, db: Session = Depends(get_db)):
    d = _drawing(db, did)
    return FileResponse(d.path, media_type=d.mime, content_disposition_type="inline")


@app.get("/api/drawings/{did}/page/{n}.png")
def drawing_page(did: int, n: int, w: int = 1600, db: Session = Depends(get_db)):
    d = _drawing(db, did)
    if d.mime == "application/pdf":
        import pymupdf as fitz
        doc = fitz.open(d.path)
        if not 1 <= n <= len(doc):
            raise HTTPException(404)
        pg = doc[n - 1]
        z = min(w, 6000) / pg.rect.width
        pix = pg.get_pixmap(matrix=fitz.Matrix(z, z), alpha=False)
        return Response(pix.tobytes("png"), media_type="image/png")
    from PIL import Image
    im = Image.open(d.path).convert("RGB")
    im.thumbnail((w, w * 2))
    b = io.BytesIO()
    im.save(b, "PNG")
    return Response(b.getvalue(), media_type="image/png")


@app.post("/api/drawings/{did}/analyze")
def analyze(did: int, payload: dict = Body(default={}), db: Session = Depends(get_db)):
    d = _drawing(db, did)
    claude.client()   # raises AIUnavailable early -> 503 below
    d.status = "analyzing"
    d.error = ""
    db.commit()
    path, mime, ctx = d.path, d.mime, payload.get("context", "")

    def work():
        try:
            ext, meta = claude.analyze_drawing(path, mime, ctx)
        except Exception as e:
            with SessionLocal() as s:
                dd = s.get(Drawing, did)
                dd.status, dd.error = "error", str(e)
                s.commit()
            raise
        with SessionLocal() as s:
            dd = s.get(Drawing, did)
            dd.extraction, dd.ai_meta, dd.status = ext, {**meta, "at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat()}, "extracted"
            dd.review = {}
            s.commit()
        return {"drawing_id": did, "parts": len(ext.get("parts", [])), "unclear": len(ext.get("unclear_items", []))}

    return {"job_id": _job("analyze_drawing", work)}


@app.put("/api/drawings/{did}/review")
def review_drawing(did: int, review: dict = Body(...), db: Session = Depends(get_db)):
    """Engineer corrections: {parts: {idx: {status, values}}, nozzles: {...}, fields: {...}, unclear: {idx: {answer}}}"""
    d = _drawing(db, did)
    d.review = review
    d.status = "reviewed" if review.get("complete") else d.status
    db.add(AuditLog(project_id=d.project_id, action="drawing_review", detail={"drawing": did}))
    db.commit()
    return _ddict(d)


@app.post("/api/drawings/{did}/to-bom")
def drawing_to_bom(did: int, db: Session = Depends(get_db)):
    """Append engineer-ACCEPTED (or corrected) drawing parts to the project's part list."""
    d = _drawing(db, did)
    p = _project(db, d.project_id)
    parts = (d.extraction or {}).get("parts") or []
    rv = (d.review or {}).get("parts") or {}
    est = copy.deepcopy(p.estimate)
    existing = {pp.get("id") for pp in est.get("parts") or []}
    added, skipped = [], []
    for i, dp in enumerate(parts):
        dec = rv.get(str(i)) or {}
        if dec.get("status") not in ("accepted", "edited"):
            skipped.append(i)
            continue
        merged = {**dp, **(dec.get("values") or {})}
        part = svc.part_from_drawing(merged, est.get("materials") or [], d.id, i)
        if part["id"] in existing:
            est["parts"] = [part if x.get("id") == part["id"] else x for x in est["parts"]]
        else:
            est.setdefault("parts", []).append(part)
        added.append(part["id"])
    p.estimate = est
    db.commit()
    r = svc.refresh_summary(db, p)
    return {"added": added, "not_accepted": skipped, "result_missing": r["missing_count"]}


@app.delete("/api/drawings/{did}")
def delete_drawing(did: int, db: Session = Depends(get_db)):
    d = _drawing(db, did)
    try:
        os.remove(d.path)
    except OSError:
        pass
    db.delete(d)
    db.commit()
    return {"ok": True}


# =============================================================== AI estimating assistance
def _history_examples(db, exclude_id=None, limit=5, ref: Project | None = None):
    ps = [p for p in db.query(Project).all() if p.id != exclude_id]
    if ref is not None:
        ps.sort(key=lambda p: -similarity(_pfeat(ref), _pfeat(p))[0])
    out = []
    for p in ps[:limit]:
        e = p.estimate or {}
        out.append({"job_no": p.job_no, "product": p.product_subject, "status": p.status,
                    "title": "".join(r.get("text", "") for r in ((p.quote_doc or {}).get("title") or {}).get("runs", [])),
                    "crews": [{"name": c.get("name"), "days": c.get("days"),
                               "members": [{"role": m.get("role"), "persons": m.get("persons")} for m in c.get("members", [])]}
                              for c in e.get("crews") or []],
                    "services": [{k: s.get(k) for k in ("group", "name", "rate", "qty", "minimum", "amount")} for s in e.get("services") or []],
                    "parts_processes": [{"name": pp.get("name"), "qty": pp.get("qty"), "processes": pp.get("processes")}
                                        for pp in e.get("parts") or []][:150],
                    "material_lines": [{k: l.get(k) for k in ("group", "material", "description", "qty", "unit_weight")}
                                       for s in e.get("price_sheets") or [] for l in s.get("lines") or []],
                    "summary": {"totals": (p.summary or {}).get("totals"), "weights": (p.summary or {}).get("weights")},
                    "actuals": (p.actuals or {}).get("categories")})
    return out


def _pfeat(p: Project) -> dict:
    return {"product_subject": p.product_subject, "quote_doc": p.quote_doc, "meta": p.meta, "estimate": p.estimate,
            "summary": p.summary}


@app.post("/api/projects/{pid}/ai/suggest")
def ai_suggest(pid: int, db: Session = Depends(get_db)):
    p = _project(db, pid)
    claude.client()
    f = svc.get_factory(db)
    tables = {"labor_rates": [{"id": r["id"], "position": r["position"], "site": r.get("site")} for r in f.get("labor_rates") or []],
              "crew_roles": [{"crew": c["name"], "roles": [{"role": m["role"], "rate_id": m.get("rate_id")} for m in c["members"]]}
                             for c in f.get("crews") or []],
              "machines": [m["name"] for m in f.get("machines") or []], "service_catalog": f.get("service_catalog")}
    drawings = [{"filename": d.filename, "summary": (d.extraction or {}).get("summary"),
                 "design_data": (d.extraction or {}).get("design_data"), "main_dimensions": (d.extraction or {}).get("main_dimensions"),
                 "nozzles": (d.extraction or {}).get("nozzles"), "review": d.review} for d in p.drawings if d.extraction]
    ctx = {"product": p.product_subject, "customer": p.customer_name, "quote_title": p.quote_doc.get("title"),
           "parts": [{k: pp.get(k) for k in ("id", "name", "grade", "material_spec", "shape", "s1", "s2", "s3", "qty")}
                     for pp in p.estimate.get("parts") or []], "drawings": drawings}
    hist = _history_examples(db, exclude_id=p.id, ref=p)

    def work():
        out, meta = claude.suggest_estimate(ctx, hist, tables)
        with SessionLocal() as s:
            pp = s.get(Project, pid)
            pp.meta = {**(pp.meta or {}), "ai_suggestion": {"suggestion": out, "meta": meta, "at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat()}}
            s.commit()
        return {"suggestion": out, "meta": meta}

    return {"job_id": _job("ai_suggest", work)}


@app.post("/api/projects/{pid}/ai/quote-text")
def ai_quote_text(pid: int, db: Session = Depends(get_db)):
    p = _project(db, pid)
    claude.client()
    r = svc.compute_with_checks(db, p.estimate)
    examples = [{"title": q.quote_doc.get("title"), "rows": q.quote_doc.get("rows")} for q in db.query(Project).all()
                if q.id != p.id and (q.quote_doc or {}).get("rows")][:3]
    ctx = {"product": p.product_subject, "buckets": [{"no": b["no"], "heading": b["heading"]} for b in p.estimate.get("buckets") or []],
           "parts": [{k: pp.get(k) for k in ("name", "grade", "material_spec", "s1", "s2", "s3", "qty")} for pp in p.estimate.get("parts") or []],
           "material_lines": [{k: l.get(k) for k in ("group", "material", "description", "qty")}
                              for s in p.estimate.get("price_sheets") or [] for l in s.get("lines") or []],
           "services": [{k: s.get(k) for k in ("group", "name")} for s in p.estimate.get("services") or []],
           "drawings": [(d.extraction or {}).get("design_data") for d in p.drawings if d.extraction],
           "weights_kg": r["weights"]}

    def work():
        out, meta = claude.draft_quote_text(ctx, examples)
        return {"draft": out, "meta": meta}

    return {"job_id": _job("ai_quote_text", work)}


@app.post("/api/projects/{pid}/ai/questions")
def ai_questions(pid: int, db: Session = Depends(get_db)):
    p = _project(db, pid)
    claude.client()
    r = svc.compute_with_checks(db, p.estimate)
    unclear = [u for d in p.drawings for i, u in enumerate((d.extraction or {}).get("unclear_items", []))
               if not (((d.review or {}).get("unclear") or {}).get(str(i)) or {}).get("answer")]
    ctx = {"product": p.product_subject, "customer": p.customer_name}

    def work():
        out, meta = claude.consolidate_questions(r["issues"], unclear, ctx)
        return {"questions": out, "meta": meta}

    return {"job_id": _job("ai_questions", work)}


@app.exception_handler(claude.AIUnavailable)
def _ai_unavailable(_, exc):
    return JSONResponse(status_code=503, content={"detail": str(exc), "code": "ai_unavailable"})


# =============================================================== suppliers & prices
@app.get("/api/suppliers")
def suppliers(db: Session = Depends(get_db)):
    out = []
    for s in db.query(Supplier).order_by(Supplier.name).all():
        n = db.query(SupplierPrice).filter_by(supplier_id=s.id).count()
        out.append({"id": s.id, "name": s.name, "country": s.country, "contact": s.contact, "lead_time": s.lead_time,
                    "notes": s.notes, "price_count": n})
    return out


@app.post("/api/suppliers")
def create_supplier(body: dict = Body(...), db: Session = Depends(get_db)):
    s = Supplier(**{k: body.get(k, "") for k in ("name", "country", "contact", "lead_time", "notes")})
    db.add(s)
    db.commit()
    return {"id": s.id}


@app.put("/api/suppliers/{sid}")
def update_supplier(sid: int, body: dict = Body(...), db: Session = Depends(get_db)):
    s = db.get(Supplier, sid)
    if not s:
        raise HTTPException(404)
    for k in ("name", "country", "contact", "lead_time", "notes"):
        if k in body:
            setattr(s, k, body[k])
    db.commit()
    return {"ok": True}


PRICE_FIELDS = ("supplier_id", "supplier_name", "category", "material", "description", "thk", "width", "length", "od", "unit",
                "unit_price", "currency", "unit_weight", "quote_date", "valid_until", "source", "verified")


def _price(sp: SupplierPrice) -> dict:
    d = {k: getattr(sp, k) for k in PRICE_FIELDS}
    d["id"] = sp.id
    try:
        d["age_days"] = (datetime.now() - datetime.strptime(sp.quote_date, "%Y-%m-%d")).days
    except Exception:
        d["age_days"] = None
    return d


@app.get("/api/prices")
def prices(q: str = "", material: str = "", category: str = "", db: Session = Depends(get_db)):
    qs = db.query(SupplierPrice)
    if material:
        qs = qs.filter(SupplierPrice.material.ilike(f"%{material}%"))
    if category:
        qs = qs.filter(SupplierPrice.category.ilike(f"%{category}%"))
    rows = qs.order_by(SupplierPrice.id.desc()).limit(2000).all()
    if q:
        terms = q.lower().split()
        rows = [r for r in rows if all(t in f"{r.description} {r.material} {r.category} {r.supplier_name}".lower() for t in terms)]
    return [_price(r) for r in rows]


@app.post("/api/prices")
def create_price(body: dict = Body(...), db: Session = Depends(get_db)):
    if body.get("unit_price") in (None, ""):
        raise HTTPException(400, "unit_price is required")
    if body.get("supplier_id"):
        s = db.get(Supplier, int(body["supplier_id"]))
        body["supplier_name"] = s.name if s else body.get("supplier_name", "")
    sp = SupplierPrice(**{k: body.get(k) for k in PRICE_FIELDS if k in body})
    db.add(sp)
    db.commit()
    return _price(sp)


@app.put("/api/prices/{prid}")
def update_price(prid: int, body: dict = Body(...), db: Session = Depends(get_db)):
    sp = db.get(SupplierPrice, prid)
    if not sp:
        raise HTTPException(404)
    for k in PRICE_FIELDS:
        if k in body:
            setattr(sp, k, body[k])
    db.commit()
    return _price(sp)


@app.delete("/api/prices/{prid}")
def delete_price(prid: int, db: Session = Depends(get_db)):
    sp = db.get(SupplierPrice, prid)
    if sp:
        db.delete(sp)
        db.commit()
    return {"ok": True}


# =============================================================== history & learning
@app.put("/api/projects/{pid}/actuals")
def put_actuals(pid: int, body: dict = Body(...), db: Session = Depends(get_db)):
    """body: {categories: {cat: {actual: number}}, note, basis_revision_id?}. Estimate side is snapshotted from the
    issued revision (or current estimate) so the comparison is fixed at the time of recording."""
    p = _project(db, pid)
    basis = None
    if body.get("basis_revision_id"):
        rv = db.get(Revision, int(body["basis_revision_id"]))
        basis = (rv.summary or {}).get("categories_thb") if rv else None
    if basis is None:
        latest = max(p.revisions, key=lambda x: x.rev_no) if p.revisions else None
        basis = (latest.summary or {}).get("categories_thb") if latest else None
    if basis is None:
        basis = estimate_categories(compute(p.estimate))
    cats = {}
    for k in CATEGORIES:
        a = ((body.get("categories") or {}).get(k) or {}).get("actual")
        if a not in (None, ""):
            cats[k] = {"estimate": basis.get(k), "actual": float(a)}
    p.actuals = {"categories": cats, "note": body.get("note", ""), "recorded_at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat()}
    if body.get("mark_completed"):
        p.status = "completed"
    db.commit()
    return p.actuals


@app.get("/api/learning/calibration")
def get_calibration(job_class: str = "", db: Session = Depends(get_db)):
    ps = [{"id": p.id, "job_no": p.job_no, "job_class": p.job_class, "actuals": p.actuals} for p in db.query(Project).all()]
    return calibration(ps, job_class or None)


@app.get("/api/projects/{pid}/similar")
def similar(pid: int, db: Session = Depends(get_db)):
    p = _project(db, pid)
    out = []
    for q in db.query(Project).all():
        if q.id == p.id:
            continue
        sc, why = similarity(_pfeat(p), _pfeat(q))
        out.append({"project": _pdict(q), "score": sc, "why": why})
    return sorted(out, key=lambda x: -x["score"])[:10]


@app.get("/api/projects/{pid}/learning")
def project_learning(pid: int, db: Session = Depends(get_db)):
    """Calibration factors applicable to this project's quote items (suggested adjustments, never auto-applied)."""
    p = _project(db, pid)
    cal = get_calibration(p.job_class, db)
    sugg = []
    for b in p.estimate.get("buckets") or []:
        types = {s.get("type") for s in b.get("sources") or []}
        for cat, srcs in CATEGORY_SOURCES.items():
            c = cal.get(cat) or {}
            if types & srcs and c.get("n"):
                sugg.append({"item": b["no"], "heading": b["heading"], "category": cat, "label": c["label"],
                             "suggested_pct": c["suggested_pct"], "n": c["n"], "reliable": c["reliable"],
                             "evidence": [f"{x['job_no']}: actual/estimate {x['ratio']:.3f}" for x in c["projects"]]})
    return {"calibration": cal, "suggestions": sugg}


# =============================================================== dashboard
@app.get("/api/dashboard")
def dashboard(db: Session = Depends(get_db)):
    ps = db.query(Project).all()
    by_status = {}
    for p in ps:
        by_status[p.status] = by_status.get(p.status, 0) + 1
    pipeline = sum(((p.summary or {}).get("totals") or {}).get("net") or 0 for p in ps if p.status in ("draft", "quoted"))
    won = sum(((p.summary or {}).get("totals") or {}).get("net") or 0 for p in ps if p.status in ("won", "in_production", "completed"))
    missing = sum((p.summary or {}).get("missing_count") or 0 for p in ps if p.status == "draft")
    recent = [_pdict(p) for p in sorted(ps, key=lambda x: x.updated_at, reverse=True)[:8]]
    n_prices = db.query(SupplierPrice).count()
    return {"projects": len(ps), "by_status": by_status, "pipeline_net": pipeline, "won_net": won, "open_missing_inputs": missing,
            "recent": recent, "supplier_prices": n_prices, "ai": claude.status(),
            "with_actuals": sum(1 for p in ps if (p.actuals or {}).get("categories"))}


# =============================================================== static frontend
DIST = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist"))
if os.path.isdir(DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(DIST, "assets")), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        f = os.path.join(DIST, path)
        if path and os.path.isfile(f):
            return FileResponse(f)
        return FileResponse(os.path.join(DIST, "index.html"))
