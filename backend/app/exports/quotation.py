"""Customer quotation export (Excel + PDF) built on Prolog's original '5. Quotation' / 'Disclaimers' sheets.

The template (app/templates/quotation_template.xlsx) is the original workbook's sheets with their
fonts, borders, fills, column widths, print setup, print titles and footer. Body rows are rebuilt from
prototype rows of that same template, so any number of description lines keeps the original styling.
"""
from __future__ import annotations

import copy
import json
import math
import os
import shutil
import subprocess
import tempfile
from datetime import datetime, date

import openpyxl
from openpyxl.cell.rich_text import CellRichText, TextBlock
from openpyxl.cell.text import InlineFont
from openpyxl.drawing.image import Image
from openpyxl.drawing.spreadsheet_drawing import TwoCellAnchor, AnchorMarker
from openpyxl.styles import Border, Side, Font, Alignment
from openpyxl.utils import get_column_letter, column_index_from_string
from openpyxl.utils.cell import coordinate_from_string
from openpyxl.worksheet.pagebreak import Break, RowBreak

TPL_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "templates"))
TEMPLATE = os.path.join(TPL_DIR, "quotation_template.xlsx")
META = json.load(open(os.path.join(TPL_DIR, "template_meta.json")))
QS, DS = "5. Quotation", "Disclaimers"
NCOL = 25  # A..Y

# prototype rows in the template for each body row kind
PROTO = {"title": 18, "item": 19, "line": 20, "blank": 27, "bullet": 37, "bullet_line": 38,
         "highlight_head": 54, "highlight_line": 55, "section_head": 58, "text": 59}
TOTAL_ROWS = (73, 74, 75)
TRAIL_ROWS = (76, 77, 78, 79)
BODY_START = 18
PAGE_BODY_CAPACITY_PT = None   # computed from template rows 18..50 (page 1 body of the original)
# LibreOffice prints this sheet ~2.4% smaller than Excel did for the reference PDF (measured line pitch
# 13.95pt vs 14.28pt); the PDF render copy is calibrated, the delivered .xlsx keeps the original 98%.
PDF_SCALE_CALIBRATION = {"Disclaimers": 100}
# footer: Angsana New 14 (not on Linux) -> Liberation Serif 9 (same printed width); LibreOffice places the
# footer lower than Excel did, so the footer margin of the render copy is raised to the measured position.
PDF_FOOTER_MARGIN_IN = {QS: (0.505, 0.544), DS: (0.385, 0.818)}   # (footer, bottom) in inches
PDF_FOOTER_FONT = ("Liberation Serif,Regular", 9)
ACC_FMT = '_-* #,##0.00_-;\\-* #,##0.00_-;_-* \\-??_-;_-@_-'


def _snapshot_row(ws, r):
    cells = {}
    for c in range(1, NCOL + 1):
        cell = ws.cell(r, c)
        cells[c] = {"font": copy.copy(cell.font), "fill": copy.copy(cell.fill), "border": copy.copy(cell.border),
                    "alignment": copy.copy(cell.alignment), "number_format": cell.number_format,
                    "protection": copy.copy(cell.protection), "value": cell.value}
    merges = [(m.min_col, m.max_col) for m in ws.merged_cells.ranges if m.min_row == r and m.max_row == r]
    return {"cells": cells, "merges": merges, "height": ws.row_dimensions[r].height}


def _apply_row(ws, r, snap, keep_values=False):
    for c, st in snap["cells"].items():
        cell = ws.cell(r, c)
        cell.font, cell.fill, cell.border = copy.copy(st["font"]), copy.copy(st["fill"]), copy.copy(st["border"])
        cell.alignment, cell.number_format = copy.copy(st["alignment"]), st["number_format"]
        cell.protection = copy.copy(st["protection"])
        if keep_values:
            cell.value = st["value"]
    for a, b in snap["merges"]:
        ws.merge_cells(start_row=r, start_column=a, end_row=r, end_column=b)
    ws.row_dimensions[r].height = snap["height"]


def _rich(runs, base_font: Font):
    if not runs:
        return None
    if len(runs) == 1 and not runs[0].get("color") and bool(runs[0].get("bold")) == bool(base_font.b) \
            and bool(runs[0].get("underline")) == bool(base_font.u) and bool(runs[0].get("italic")) == bool(base_font.i):
        return runs[0]["text"]
    parts = []
    for r in runs:
        col = r.get("color") or "FF000000"
        if len(col) == 6:
            col = "FF" + col
        f = InlineFont(rFont=base_font.name or "Cambria", sz=base_font.sz or 8, b=bool(r.get("bold")),
                       i=bool(r.get("italic")), u="single" if r.get("underline") else None, color=col)
        parts.append(TextBlock(f, r.get("text", "")))
    return CellRichText(parts)


_FONT_CACHE = {}


def _text_width_pt(text, size, bold=False):
    from PIL import ImageFont
    key = (size, bold)
    if key not in _FONT_CACHE:
        path = "/usr/share/fonts/truetype/crosextra/Caladea-Bold.ttf" if bold else "/usr/share/fonts/truetype/crosextra/Caladea-Regular.ttf"
        try:
            _FONT_CACHE[key] = ImageFont.truetype(path, int(size * 10))
        except OSError:
            _FONT_CACHE[key] = None
    f = _FONT_CACHE[key]
    if f is None:
        return len(text) * size * 0.47
    return f.getlength(text) / 10.0


def _desc_width_pt(ws):
    # merged B:O width in points (Excel width unit ~ 7px; 1px = 0.75pt) minus cell padding
    w = 0.0
    for c in range(2, 16):
        letter = get_column_letter(c)
        dim = None
        for k, d in ws.column_dimensions.items():
            if d.min and d.max and d.min <= c <= d.max:
                dim = d
                break
        width = (dim.width if dim and dim.width else 8.43)
        w += (width * 7 + 5) * 0.75
    return w - 6


def _row_height_for(runs, kind, explicit, width_pt, size):
    if explicit:
        return explicit
    text = "".join(r.get("text", "") for r in runs or [])
    if not text.strip():
        return None
    bold = bool(runs and runs[0].get("bold"))
    # word wrap simulation
    lines, cur = 1, 0.0
    space = _text_width_pt(" ", size, bold)
    for word in text.split(" "):
        ww = _text_width_pt(word, size, bold)
        if cur and cur + space + ww > width_pt:
            lines += 1
            cur = ww
        else:
            cur = cur + (space if cur else 0) + ww
    if lines <= 1:
        return None
    return 13.5 * lines


def _to_date(v):
    if not v:
        return None
    if isinstance(v, (datetime, date)):
        return v
    for fmt in ("%Y-%m-%d", "%d-%b-%y", "%d/%m/%Y", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(str(v)[:19], fmt)
        except ValueError:
            pass
    return None


def _place_image(ws, name, anchor_from, anchor_to, row_shift=0):
    img = Image(os.path.join(TPL_DIR, name + ".png"))

    def mk(a, shift):
        col, row = coordinate_from_string(a["cell"])
        return AnchorMarker(col=column_index_from_string(col) - 1, colOff=a["col_off_emu"], row=row - 1 + shift,
                            rowOff=a["row_off_emu"])

    img.anchor = TwoCellAnchor(_from=mk(anchor_from, row_shift), to=mk(anchor_to, row_shift), editAs="oneCell")
    ws.add_image(img)


def page_body_capacity(ws_heights) -> float:
    return sum(ws_heights[r] for r in range(18, 51))


def auto_breaks(heights: list[float], kinds: list[str], capacity: float) -> list[int]:
    """Return body-row indexes after which a page break is placed (greedy, prefers blank/heading boundaries)."""
    breaks, used, last_good = [], 0.0, None
    i = 0
    start = 0
    while i < len(heights):
        h = heights[i]
        if used + h > capacity and i > start:
            cut = last_good if (last_good is not None and last_good >= start + (i - start) // 2) else i - 1
            breaks.append(cut)
            start = cut + 1
            used, last_good = 0.0, None
            i = start
            continue
        used += h
        if kinds[i] == "blank" or (i + 1 < len(kinds) and kinds[i + 1] in ("item", "section_head", "highlight_head")):
            last_good = i
        i += 1
    return breaks


def build_quotation_workbook(doc: dict, result: dict, out_path: str) -> dict:
    """Write the customer quotation .xlsx. Returns layout info (rows, breaks)."""
    wb = openpyxl.load_workbook(TEMPLATE)
    ws = wb[QS]
    protos = {k: _snapshot_row(ws, r) for k, r in PROTO.items()}
    totals_snap = [_snapshot_row(ws, r) for r in TOTAL_ROWS]
    trail_snap = [_snapshot_row(ws, r) for r in TRAIL_ROWS]
    heights_tpl = {r: (ws.row_dimensions[r].height or 15.0) for r in range(1, 80)}
    capacity = page_body_capacity(heights_tpl)
    width_pt = _desc_width_pt(ws)
    border50 = _snapshot_row(ws, 50)["cells"]

    # ---------- header fields ----------
    def setv(coord, v):
        ws[coord].value = v

    setv("E8", doc.get("quotation_no", ""))
    setv("U8", doc.get("job_no", ""))
    setv("E9", doc.get("customer_name", ""))
    setv("E10", doc.get("contact_person", ""))
    setv("E11", doc.get("tel") or "-")
    setv("E12", doc.get("fax") or "-")
    setv("E13", doc.get("email") or "-")
    setv("E14", doc.get("product_subject", ""))
    setv("E15", doc.get("drawing_no") or "-")
    for coord, key in (("U9", "enquiry_date"), ("U10", "quotation_date"), ("U11", "validity_date")):
        d = _to_date(doc.get(key))
        ws[coord].value = d if d else (doc.get(key) or "-")
        if '"B1"' in ws[coord].number_format or "mmm" not in ws[coord].number_format:
            ws[coord].number_format = "[$-409]d\\-mmm\\-yy;@"   # original's format (B1 prefix = xls conversion artifact)
    setv("U12", doc.get("payment_term") or "-")
    ws["U13"].value = doc.get("delivery_time")
    setv("X13", doc.get("delivery_unit") or "Months")
    setv("U14", doc.get("currency_label") or "USD.")
    cur = (result.get("totals") or {}).get("currency", "USD")
    curlab = (doc.get("currency_label") or f"{cur}.").rstrip(".") + "."
    for coord, txt in (("P17", f"Unit Price ({curlab})"), ("V17", f"Total Price ({curlab})")):
        ws[coord].value = txt

    # ---------- clear body region 18..79 ----------
    for m in list(ws.merged_cells.ranges):
        if m.max_row >= BODY_START:
            ws.unmerge_cells(str(m))
    max_r = max(ws.max_row, 80)
    for r in range(BODY_START, max_r + 1):
        for c in range(1, NCOL + 1):
            cell = ws.cell(r, c)
            cell.value = None
            cell.style = "Normal"
        ws.row_dimensions[r].height = None
    ws.row_breaks = RowBreak()

    # ---------- body rows ----------
    items = {it["no"]: it for it in (result.get("items") or [])}
    body = [{"kind": "title", "runs": (doc.get("title") or {}).get("runs") or []}] + list(doc.get("rows") or [])
    r = BODY_START
    heights, kinds = [], []
    for row in body:
        kind = row.get("kind", "line")
        proto = protos.get(kind) or protos["line"]
        if kind == "line" and row.get("indent"):
            proto = protos["bullet_line"]
        _apply_row(ws, r, proto)
        base_font = proto["cells"][2]["font"]
        runs = row.get("runs") or []
        cellB = ws.cell(r, 2)
        if len(runs) == 1:
            r0 = runs[0]
            col = r0.get("color")
            cellB.font = Font(name=base_font.name, sz=base_font.sz, b=bool(r0.get("bold")), i=bool(r0.get("italic")),
                              u="single" if r0.get("underline") else None,
                              color=(("FF" + col) if col and len(col) == 6 else col) or base_font.color)
            cellB.value = r0.get("text", "")
        else:
            cellB.value = _rich(runs, base_font)
        if row.get("align"):
            a = row["align"]
            cellB.alignment = Alignment(horizontal=a.get("horizontal") or cellB.alignment.horizontal,
                                        vertical=a.get("vertical"), wrap_text=a.get("wrap") or None)
        if kind in ("line", "text", "bullet_line", "highlight_line") or row.get("height"):
            h = _row_height_for(runs, kind, row.get("height"), width_pt, base_font.sz or 8)
            if h:
                ws.row_dimensions[r].height = h
                if not row.get("align"):
                    ws.cell(r, 2).alignment = Alignment(
                        wrap_text=True, vertical="center", horizontal=proto["cells"][2]["alignment"].horizontal)
        if kind == "title":
            hp = (result.get("totals") or {}).get("header_price")
            t = doc.get("title") or {}
            ws.cell(r, 16).value = hp
            ws.cell(r, 19).value = t.get("qty", 1)
            ws.cell(r, 21).value = t.get("unit", "Set.")
            ws.cell(r, 22).value = f"=P{r}*S{r}"
            if doc.get("show_title_price"):
                for c in (16, 19, 21, 22):
                    f = copy.copy(ws.cell(r, c).font)
                    ws.cell(r, c).font = Font(name=f.name, sz=f.sz, b=f.b, color="FF000000")
        if kind == "item":
            no = row.get("item_no")
            it = items.get(no)
            ws.cell(r, 1).value = no
            if it is None:
                ws.cell(r, 16).value = None
            else:
                ws.cell(r, 16).value = it["unit_price"]
                ws.cell(r, 19).value = it["qty"]
                ws.cell(r, 21).value = row.get("unit") or it.get("unit") or "Lot."
                ws.cell(r, 22).value = f"=P{r}*S{r}"
                for c in (16, 19, 22):
                    ws.cell(r, c).number_format = ACC_FMT
        heights.append(ws.row_dimensions[r].height or 15.0)
        kinds.append(kind)
        r += 1
    body_end = r - 1
    first_item_row = BODY_START + 1

    # ---------- totals block ----------
    tot_row = r
    for i, snap in enumerate(totals_snap):
        _apply_row(ws, tot_row + i, snap, keep_values=True)
    ws.cell(tot_row, 22).value = f"=SUM(V{first_item_row}:Y{body_end})"
    disc_pct = (result.get("totals") or {}).get("discount_pct", 0)
    ws.cell(tot_row + 1, 20).value = disc_pct
    ws.cell(tot_row + 1, 22).value = f"=V{tot_row}*T{tot_row + 1}"
    ws.cell(tot_row + 2, 22).value = f"=V{tot_row}-V{tot_row + 1}"
    ws.cell(tot_row, 16).value = f"Total Price ({curlab})"
    ws.cell(tot_row + 1, 16).value = f"Discount ({cur})" if disc_pct else f"Discount ({cur})"
    ws.cell(tot_row + 2, 16).value = f"Net Total Price ({curlab})"
    ws.cell(tot_row + 1, 1).value = doc.get("prepared_by", "")
    ws.cell(tot_row + 1, 5).value = doc.get("reviewed_by", "")
    ws.cell(tot_row + 1, 9).value = doc.get("approved_by", "")
    trail = tot_row + 3
    for i, snap in enumerate(trail_snap):
        _apply_row(ws, trail + i, snap)
    last = trail + len(trail_snap) - 1
    shift = tot_row - TOTAL_ROWS[0]

    # ---------- page breaks ----------
    pb = doc.get("page_breaks")
    if pb in (None, "auto") or not isinstance(pb, list):
        all_h = heights + [heights_tpl[x] for x in TOTAL_ROWS] + [heights_tpl[x] for x in TRAIL_ROWS]
        all_k = kinds + ["section_head"] * 3 + ["blank"] * 4
        breaks = auto_breaks(all_h, all_k, capacity)
    else:
        breaks = [b for b in pb if 0 <= b < len(body)]
    for b in breaks:
        row_no = BODY_START + b
        ws.row_breaks.append(Break(id=row_no))
        if row_no <= body_end:     # close the table frame at the bottom of the page (thin line as original)
            for c in range(1, NCOL + 1):
                cell = ws.cell(row_no, c)
                old = cell.border
                cell.border = Border(left=old.left, right=old.right, top=old.top,
                                     bottom=copy.copy(border50[c]["border"].bottom))

    ws.print_area = f"A1:Y{last}"
    ws.print_title_rows = "1:17"

    # ---------- images ----------
    ws._images = []
    for im in META[QS]["images"]:
        sh = 0 if im["name"] == "logo" else shift
        _place_image(ws, im["name"], im["anchor_from"], im["anchor_to"], sh)

    # ---------- Disclaimers ----------
    wd = wb[DS]
    for coord, key in (META.get("disclaimer_variables") or {}).items():
        wd[coord].value = doc.get(key, "")
    wd._images = []
    for im in META[DS]["images"]:
        _place_image(wd, im["name"], im["anchor_from"], im["anchor_to"], 0)
    if doc.get("include_disclaimers") is False:
        del wb[DS]
    wb.save(out_path)
    return {"body_rows": len(body), "breaks": breaks, "last_row": last, "totals_row": tot_row}


FONTS_DIR = os.environ.get("PROLOG_FONTS_DIR") or os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "fonts"))


def _font_env(tmp: str) -> dict:
    env = dict(os.environ, HOME=tmp)
    if os.path.isdir(FONTS_DIR) and any(f.lower().endswith((".ttf", ".ttc", ".otf")) for f in os.listdir(FONTS_DIR)):
        conf = os.path.join(tmp, "fonts.conf")
        with open(conf, "w") as f:
            f.write(f'<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig>'
                    f'<include ignore_missing="yes">/etc/fonts/fonts.conf</include><dir>{FONTS_DIR}</dir>'
                    f'<cachedir>{tmp}/fc-cache</cachedir></fontconfig>')
        env["FONTCONFIG_FILE"] = conf
    return env


def has_font(name: str) -> bool:
    try:
        out = subprocess.run(["fc-list", ":family"], capture_output=True, text=True, timeout=20,
                             env=_font_env(tempfile.mkdtemp(prefix="fc_"))).stdout
        return name.lower() in out.lower()
    except Exception:
        return False


def xlsx_to_pdf(xlsx_path: str, out_dir: str, pdf_font_fix: bool = True) -> str:
    """Render with LibreOffice. Footer font Angsana New is not available on Linux, so a print copy uses a
    metric substitute (the .xlsx delivered to customers keeps the original footer font)."""
    from ..platform_tools import excel_available, excel_export_pdf, require_soffice
    dst = os.path.join(out_dir, os.path.splitext(os.path.basename(xlsx_path))[0] + ".pdf")
    if excel_available():
        excel_export_pdf(xlsx_path, dst)   # Windows + Excel: same renderer and fonts as the original
        return dst
    tmp = tempfile.mkdtemp(prefix="pdf_")
    try:
        src = os.path.join(tmp, os.path.basename(xlsx_path))
        if pdf_font_fix and has_font("Angsana New"):
            pdf_font_fix = False      # real footer font installed: render exactly like the original
        if pdf_font_fix:
            wb = openpyxl.load_workbook(xlsx_path, rich_text=True)
            for ws in wb.worksheets:
                if ws.title in PDF_SCALE_CALIBRATION:
                    ws.page_setup.scale = PDF_SCALE_CALIBRATION[ws.title]
                for hf in (ws.oddFooter, ws.evenFooter, ws.firstFooter):
                    for part in (hf.left, hf.center, hf.right):
                        if part.text and part.font and "Angsana" in part.font:
                            part.font, part.size = PDF_FOOTER_FONT
                if ws.title in PDF_FOOTER_MARGIN_IN:
                    ws.page_margins.footer, ws.page_margins.bottom = PDF_FOOTER_MARGIN_IN[ws.title]
            wb.save(src)
        else:
            shutil.copy(xlsx_path, src)
        env = _font_env(tmp)
        subprocess.run([require_soffice(), "--headless", "--norestore", "--convert-to", "pdf", "--outdir", tmp, src],
                       check=True, capture_output=True, timeout=180, env=env)
        pdf = os.path.splitext(src)[0] + ".pdf"
        shutil.move(pdf, dst)
        return dst
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
