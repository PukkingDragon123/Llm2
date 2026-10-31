"""Claude integration (Anthropic Python SDK).

- Drawing reading: rendered page images (overview + zoomed tiles) -> structured extraction with confidence,
  page/bbox locations and an explicit list of unclear items that engineers must confirm.
- Estimating assistant: proposes crews / machine processes / services from Prolog's own factory tables and
  historical projects. It never proposes supplier prices; missing prices become questions.
- Quotation text drafting in Prolog's house style (few-shot from historical quotations).
All outputs are suggestions that an engineer accepts or edits; nothing is applied automatically.
"""
from __future__ import annotations

import base64
import io
import json
import os
from typing import Literal, Optional

from pydantic import BaseModel, Field

from ..db import DATA_DIR

DEFAULT_MODEL = os.environ.get("PROLOG_CLAUDE_MODEL", "claude-opus-5-5")
CONFIG_PATH = os.path.join(DATA_DIR, "ai_config.json")


class AIUnavailable(RuntimeError):
    pass


def _config() -> dict:
    try:
        return json.load(open(CONFIG_PATH, encoding="utf-8"))
    except Exception:
        return {}


def save_config(api_key: str | None = None, model: str | None = None):
    cfg = _config()
    if api_key is not None:
        cfg["api_key"] = api_key.strip()
    if model:
        cfg["model"] = model.strip()
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f)
    os.chmod(CONFIG_PATH, 0o600)


def status() -> dict:
    cfg = _config()
    key = os.environ.get("ANTHROPIC_API_KEY") or cfg.get("api_key")
    return {"configured": bool(key), "source": "env" if os.environ.get("ANTHROPIC_API_KEY") else ("settings" if key else None),
            "model": cfg.get("model") or DEFAULT_MODEL}


_test_client = None   # tests inject a fake client here


def set_test_client(c):
    global _test_client
    _test_client = c


def client():
    if _test_client is not None:
        return _test_client
    import anthropic
    cfg = _config()
    key = os.environ.get("ANTHROPIC_API_KEY") or cfg.get("api_key")
    if not key:
        raise AIUnavailable("Claude API key is not configured. Set ANTHROPIC_API_KEY or add a key in Settings.")
    return anthropic.Anthropic(api_key=key, max_retries=3, timeout=600)


def model() -> str:
    return _config().get("model") or DEFAULT_MODEL


_FALLBACK_OK = {"claude-opus-5-5", "claude-fable-5-1", "claude-opus-5", "claude-sonnet-5-5"}


def _model_chain() -> list[str]:
    chain = [model(), "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]
    return list(dict.fromkeys(chain))


def test_connection() -> dict:
    """Small real request to confirm the key, network and model access."""
    import time
    import anthropic
    c = client()
    errors = []
    for m in _model_chain():
        t = time.time()
        try:
            r = c.messages.create(model=m, max_tokens=64, output_config={"effort": "low"},
                                  messages=[{"role": "user", "content": "Reply with the single word OK."}])
            text = "".join(getattr(b, "text", "") for b in r.content)
            return {"ok": True, "model": r.model, "reply": text.strip()[:40], "seconds": round(time.time() - t, 2),
                    "skipped_models": errors}
        except anthropic.AuthenticationError as e:
            raise AIUnavailable("Claude API key was rejected") from e
        except (anthropic.NotFoundError, anthropic.PermissionDeniedError, anthropic.BadRequestError) as e:
            errors.append(f"{m}: {e.__class__.__name__}")
        except anthropic.APIConnectionError as e:
            return {"ok": False, "error": "Could not reach api.anthropic.com (internet / proxy / firewall)"}
    return {"ok": False, "error": "No model available for this key", "skipped_models": errors}


def _parse(system: str, content: list, schema, effort: str = "high", max_tokens: int = 16000):
    """Structured-output call with adaptive thinking and server-side refusal fallback."""
    import anthropic
    c = client()
    resp, last_err = None, None
    for m in _model_chain():
        try:
            kw = dict(model=m, max_tokens=max_tokens,
                      system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
                      messages=[{"role": "user", "content": content}],
                      thinking={"type": "adaptive"}, output_config={"effort": effort}, output_format=schema)
            if m in _FALLBACK_OK:
                kw.update(betas=["server-side-fallback-2026-07-01"], fallbacks="default")
            resp = c.beta.messages.parse(**kw)
            break
        except anthropic.AuthenticationError as e:
            raise AIUnavailable("Claude API key was rejected") from e
        except (anthropic.NotFoundError, anthropic.PermissionDeniedError) as e:
            last_err = e          # model not available for this key -> try the next model
            continue
        except anthropic.BadRequestError as e:
            if "model" in str(e).lower() or "fallback" in str(e).lower():
                last_err = e
                continue
            raise RuntimeError(f"Claude rejected the request: {e}") from e
        except anthropic.RateLimitError as e:
            raise RuntimeError("Claude rate limit reached; retry shortly") from e
        except anthropic.APIConnectionError as e:
            raise RuntimeError("Could not reach the Claude API (check internet / proxy)") from e
    if resp is None:
        raise AIUnavailable(f"No Claude model available for this API key ({last_err})")
    if getattr(resp, "stop_reason", None) == "refusal":
        raise RuntimeError("Claude declined this request")
    if getattr(resp, "stop_reason", None) == "max_tokens":
        raise RuntimeError("Claude response was truncated (max_tokens); split the drawing or retry")
    out = resp.parsed_output
    if out is None:
        raise RuntimeError("Claude returned no structured output")
    usage = getattr(resp, "usage", None)
    meta = {"model": getattr(resp, "model", model()),
            "input_tokens": getattr(usage, "input_tokens", None), "output_tokens": getattr(usage, "output_tokens", None)}
    return out, meta


# ======================================================================================
# Drawing extraction
# ======================================================================================
class Loc(BaseModel):
    page: int = Field(description="1-based page number")
    bbox: list[float] = Field(description="[x0,y0,x1,y1] normalised 0..1 of the full page (not the tile)")


class Field_(BaseModel):
    key: str
    value: str
    unit: Optional[str] = None
    confidence: float = Field(description="0..1")
    location: Optional[Loc] = None


class Part(BaseModel):
    mark: Optional[str] = Field(None, description="part / item mark or balloon number on the drawing")
    name: str
    category: Literal["shell", "head", "nozzle_neck", "flange", "stub_end", "lining", "pad", "support", "base_plate",
                      "lug", "gusset", "ring", "pipe", "plate", "bar", "gasket", "bolting", "internal", "other"]
    material_spec: Optional[str] = Field(None, description="e.g. ASTM B265 Gr.2, SB-265 Gr.2, A36, SS400, PTFE")
    form: Literal["plate", "pipe", "tube", "bar", "forging", "flange", "fitting", "gasket", "bolt", "other"]
    thk_mm: Optional[float] = None
    width_mm: Optional[float] = None
    length_mm: Optional[float] = None
    od_mm: Optional[float] = None
    id_mm: Optional[float] = None
    nominal_size: Optional[str] = Field(None, description="e.g. 16B / 16\" / DN400")
    rating: Optional[str] = Field(None, description="e.g. JIS10K, ASME 150#")
    qty: Optional[float] = None
    unit_weight_kg: Optional[float] = None
    notes: Optional[str] = None
    confidence: float = Field(description="0..1 overall confidence for this row")
    unclear_fields: list[str] = Field(default_factory=list, description="names of fields that are illegible/ambiguous")
    location: Optional[Loc] = None


class Nozzle(BaseModel):
    mark: str
    service: Optional[str] = None
    size: Optional[str] = None
    schedule_or_thk: Optional[str] = None
    flange_rating: Optional[str] = None
    facing: Optional[str] = None
    type: Optional[str] = Field(None, description="e.g. stub end + lap joint flange, lining, pad")
    qty: Optional[float] = None
    projection_mm: Optional[float] = None
    confidence: float
    location: Optional[Loc] = None


class Unclear(BaseModel):
    field: str
    description: str
    question: str = Field(description="question to ask the engineer/customer to resolve it")
    location: Optional[Loc] = None


class DrawingExtraction(BaseModel):
    drawing_type: Literal["vendor_fabrication", "customer_reference", "as_built", "general_arrangement", "detail", "other"]
    title_block: list[Field_]
    design_data: list[Field_] = Field(description="code, pressure, temperature, test pressure, NDE, joint efficiency, CA, capacity, weights, fluid ...")
    main_dimensions: list[Field_] = Field(description="ID, OD, tangent length, overall height, shell thk ...")
    parts: list[Part]
    nozzles: list[Nozzle]
    welding_and_nde: list[Field_]
    surface_finish_and_painting: list[Field_]
    general_notes: list[str]
    unclear_items: list[Unclear]
    summary: str = Field(description="2-4 sentence description of the equipment")


DRAWING_SYSTEM = """You are a senior pressure-vessel / titanium fabrication estimator at Prolog Titanium Corporation (Thailand).
You read engineering drawings (often scanned, rotated, Japanese/English, with handwritten red mark-ups) and extract the data
needed for a bill of materials and cost estimate.

Rules:
- Extract only what is written or unambiguously dimensioned on the drawing. Never guess a number. If a value is illegible,
  partially visible, or must be inferred, leave it null, list the field in `unclear_fields`, lower `confidence`, and add an
  `unclear_items` entry with a concrete question.
- Handwritten mark-ups (often red) override printed values; mention them in notes and design data with key "markup: ...".
- Units: convert to mm / kg where the drawing is metric; keep nominal pipe sizes as written (e.g. 16B, 16").
- Every extracted row must carry `location` (page number and a normalised bbox on the FULL page) so engineers can verify it.
  The images you receive are an overview of each page plus zoomed tiles; tile captions give the tile's position on the page —
  convert tile coordinates back to full-page coordinates.
- Parts list / bill of material tables, nozzle schedules and design-data tables are the primary sources; cross-check them
  against the views and report contradictions as unclear items.
- Material specs: keep the exact designation (ASTM B265 Gr.2, SB-265 Gr.2, SB-338, A36, SS400, A105, SUS304, PTFE ...).
"""


def _page_images(path: str, mime: str, max_px: int = 1568) -> list[tuple[int, str, bytes]]:
    """Return (page, caption, png bytes): overview + 2x2 tiles per page."""
    import pymupdf as fitz
    from PIL import Image
    out = []
    if mime == "application/pdf":
        doc = fitz.open(path)
        pages = [(i + 1, doc[i]) for i in range(len(doc))]
        renders = []
        for pno, page in pages:
            rect = page.rect
            zoom = 2 * max_px / max(rect.width, rect.height)
            pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
            renders.append((pno, Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")))
    else:
        renders = [(1, Image.open(path).convert("RGB"))]
    for pno, im in renders:
        w, h = im.size
        ov = im.copy()
        ov.thumbnail((max_px, max_px))
        out.append((pno, f"Page {pno} — overview (full page)", _png(ov)))
        ox, oy = int(w * 0.05), int(h * 0.05)
        for ty in range(2):
            for tx in range(2):
                x0, y0 = max(0, tx * w // 2 - ox), max(0, ty * h // 2 - oy)
                x1, y1 = min(w, (tx + 1) * w // 2 + ox), min(h, (ty + 1) * h // 2 + oy)
                tile = im.crop((x0, y0, x1, y1))
                tile.thumbnail((max_px, max_px))
                cap = (f"Page {pno} — zoomed tile covering x {x0 / w:.2f}–{x1 / w:.2f}, y {y0 / h:.2f}–{y1 / h:.2f} "
                       f"of the full page")
                out.append((pno, cap, _png(tile)))
    return out


def _png(im) -> bytes:
    b = io.BytesIO()
    im.save(b, "PNG", optimize=True)
    return b.getvalue()


def analyze_drawing(path: str, mime: str, context: str = "") -> tuple[dict, dict]:
    imgs = _page_images(path, mime)
    content = []
    for _, cap, data in imgs:
        content.append({"type": "text", "text": cap})
        content.append({"type": "image", "source": {"type": "base64", "media_type": "image/png",
                                                   "data": base64.b64encode(data).decode()}})
    content.append({"type": "text", "text": (
        "Extract the drawing data as specified. Project context from the engineer (may be empty):\n"
        f"{context or '-'}\n"
        "List every part of the bill of materials, every nozzle, the design data and all unclear items.")})
    out, meta = _parse(DRAWING_SYSTEM, content, DrawingExtraction, effort="high", max_tokens=32000)
    meta["images"] = len(imgs)
    return out.model_dump(), meta


# ======================================================================================
# Estimating assistant
# ======================================================================================
class CrewSuggestion(BaseModel):
    role: str
    rate_id: str = Field(description="id from the labor rate table")
    persons: float
    rationale: str


class ProcessSuggestion(BaseModel):
    part_ref: str = Field(description="part id or name from the BOM")
    machine: str = Field(description="exact machine name from the machine table")
    hours: float
    rationale: str


class ServiceSuggestion(BaseModel):
    group: str
    name: str
    basis: Literal["rate_x_qty", "fixed_from_history", "minimum_charge"]
    rate: Optional[float] = None
    qty: Optional[float] = None
    minimum: Optional[float] = None
    amount: Optional[float] = None
    currency: Literal["THB", "USD"] = "THB"
    rationale: str
    evidence: str = Field(description="which historical project or table row this figure comes from")


class MaterialNeed(BaseModel):
    sheet: Literal["import", "import_wfn", "domestic"]
    group: str
    material: str
    description: str = Field(description="stock size in Prolog style e.g. '2000x6000x6t mm.' or '3\" Sch.40 x L.1000 mm.'")
    qty: float
    unit_weight_kg: Optional[float] = None
    rationale: str


class EstimateSuggestion(BaseModel):
    crew_days: Optional[float] = None
    crew_days_rationale: str
    crew: list[CrewSuggestion]
    processes: list[ProcessSuggestion]
    services: list[ServiceSuggestion]
    material_needs: list[MaterialNeed]
    questions: list[str] = Field(description="information that is missing and must be provided (never invent it)")
    confidence_note: str


ESTIMATE_SYSTEM = """You are Prolog Titanium's estimating assistant. You help engineers build a cost estimate in the company's
own costing structure (supplier price sheets -> freight allocation; in-house crew persons x days; machine-hour processes per
part; outsourced/NDT/finishing services; quote buckets with OVH, Risk and margin divisor).

Hard rules:
- Use ONLY the factory tables provided (labor rate ids, machine names, service rate tables) and the historical projects
  provided as evidence. Quote the evidence for every figure (project number + what it was).
- NEVER propose supplier material prices. Material needs list stock sizes and quantities only; prices come from verified
  supplier quotations entered by purchasing.
- If something cannot be justified from the drawing data, BOM or history, do not fill it — add a question instead.
- Scale historical figures explicitly (e.g. by weight, weld length, surface area, diameter x length) and state the scaling.
"""


def suggest_estimate(project_ctx: dict, history: list[dict], tables: dict) -> tuple[dict, dict]:
    content = [{"type": "text", "text": "FACTORY TABLES (JSON):\n" + json.dumps(tables, ensure_ascii=False)[:60000]},
               {"type": "text", "text": "HISTORICAL PROJECTS (JSON):\n" + json.dumps(history, ensure_ascii=False)[:120000]},
               {"type": "text", "text": "CURRENT PROJECT (JSON):\n" + json.dumps(project_ctx, ensure_ascii=False)[:120000] +
                "\n\nPropose crew, machine processes per part, services and material stock needs for this project."}]
    out, meta = _parse(ESTIMATE_SYSTEM, content, EstimateSuggestion, effort="high")
    return out.model_dump(), meta


# ======================================================================================
# Quotation text drafting
# ======================================================================================
class Run(BaseModel):
    text: str
    bold: bool = False
    underline: bool = False
    color: Optional[str] = Field(None, description="'FFFF0000' for red emphasis, else null")


class QuoteRow(BaseModel):
    kind: Literal["item", "line", "bullet", "blank", "highlight_head", "highlight_line", "section_head", "text"]
    item_no: Optional[int] = None
    runs: list[Run]


class QuoteDraft(BaseModel):
    title: str = Field(description="product line e.g. 'Titanium Recycle Drum  ( SIZE : ID 2,800 x TL 6,700 mm. )'")
    rows: list[QuoteRow]
    notes_for_engineer: list[str]


QUOTE_SYSTEM = """You write Prolog Titanium customer quotation descriptions in the company's exact house style.
Copy the style of the example quotations precisely: item heading rows ("Main Part. : Titanium.", "Other Accessories.",
"Labor cost", ...), sub-lines starting with " - " in the form "<Part>. : <Material spec> : Size. Thk <t> mm. ; Q'ty = <n> <Unit>.",
labor bullets "• Assembly & Fabrication" with "    - " sub-lines, a yellow Transportation block, "Remark :" section, and
"Term of Payment." section. Use red runs only where the examples use them (special conditions, scope inclusions).
Only state materials, thicknesses, quantities and tests that appear in the provided BOM / drawing data / estimate.
If something needed for the text is missing, write a placeholder like "[TBC]" and add a note for the engineer.
"""


def draft_quote_text(ctx: dict, examples: list[dict]) -> tuple[dict, dict]:
    content = [{"type": "text", "text": "EXAMPLE QUOTATIONS (house style):\n" + json.dumps(examples, ensure_ascii=False)[:80000]},
               {"type": "text", "text": "THIS PROJECT:\n" + json.dumps(ctx, ensure_ascii=False)[:80000] +
                "\n\nDraft the quotation body rows (items in the same order and numbering as the quote buckets)."}]
    out, meta = _parse(QUOTE_SYSTEM, content, QuoteDraft, effort="medium")
    return out.model_dump(), meta


class Questions(BaseModel):
    for_customer: list[str]
    for_purchasing: list[str]
    for_engineering: list[str]


def consolidate_questions(issues: list[dict], unclear: list[dict], ctx: dict) -> tuple[dict, dict]:
    content = [{"type": "text", "text": json.dumps({"calculation_issues": issues, "drawing_unclear_items": unclear,
                                                    "project": ctx}, ensure_ascii=False)[:100000] +
                "\n\nGroup these into concise, non-duplicated questions for the customer (design/scope), purchasing "
                "(supplier prices, lead times) and engineering (hours, processes). Do not answer them."}]
    out, meta = _parse("You are Prolog Titanium's estimating coordinator.", content, Questions, effort="low")
    return out.model_dump(), meta
