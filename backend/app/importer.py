"""Import a Prolog Titanium quotation workbook (FM-SAL-001 layout, .xls or .xlsx) into the app's data model.

Reads INPUTS (supplier prices, quantities, freight, labor salaries/crews, machine table, process hours,
service charges, quotation texts) - not the computed results - so the engine recomputes everything and
the recomputation is compared with the workbook's own cached prices (`reference_values`).
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, date

import openpyxl
from openpyxl.cell.rich_text import CellRichText, TextBlock

from .calc.numeric import eval_expr


def to_xlsx(path: str) -> tuple[str, str | None]:
    """Convert .xls to .xlsx with LibreOffice. Returns (xlsx_path, tmpdir_to_cleanup)."""
    if path.lower().endswith((".xlsx", ".xlsm")):
        return path, None
    tmp = tempfile.mkdtemp(prefix="imp_")
    src = os.path.join(tmp, "src" + os.path.splitext(path)[1].lower())
    shutil.copy(path, src)
    subprocess.run(["soffice", "--headless", "--convert-to", "xlsx", "--outdir", tmp, src],
                   check=True, capture_output=True, timeout=300)
    out = os.path.join(tmp, "src.xlsx")
    if not os.path.exists(out):
        raise RuntimeError("LibreOffice conversion failed")
    return out, tmp


def _num(v):
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return eval_expr(str(v))
    except Exception:
        return None


def _s(v):
    if v is None:
        return ""
    if isinstance(v, (datetime, date)):
        return v.strftime("%Y-%m-%d")
    return str(v).strip()


def _f(ws_f, coord):
    v = ws_f[coord].value
    if v is not None and not isinstance(v, str):
        v = getattr(v, "text", None) or str(v)
    return v if isinstance(v, str) else None


def _runs(cell_value, cell) -> list[dict]:
    """Convert a cell (plain or rich text) into styled runs."""
    base = {"bold": bool(cell.font.b), "italic": bool(cell.font.i), "underline": bool(cell.font.u),
            "color": (cell.font.color.rgb if cell.font.color is not None and isinstance(cell.font.color.rgb, str) else None)}
    if base["color"] in ("FF000000", "00000000"):
        base["color"] = None
    if isinstance(cell_value, CellRichText):
        out = []
        for part in cell_value:
            if isinstance(part, TextBlock):
                f = part.font
                col = None
                if f is not None and f.color is not None and isinstance(f.color.rgb, str) and f.color.rgb not in ("FF000000",):
                    col = f.color.rgb
                out.append({"text": part.text, "bold": bool(f.b) if f is not None and f.b is not None else base["bold"],
                            "italic": bool(f.i) if f is not None and f.i is not None else False,
                            "underline": bool(f.u) if f is not None and f.u else False, "color": col})
            else:
                out.append({**base, "text": str(part)})
        return [r for r in out if r["text"] != ""]
    if cell_value is None:
        return []
    txt = cell_value if isinstance(cell_value, str) else _s(cell_value)
    return [{**base, "text": txt}] if txt.strip() != "" else []


def _parse_freight_formula(formula: str | None, cached) -> list[dict]:
    """'=55500/V4' -> THB 55500; '=300+20000/V4' -> USD 300 + THB 20000. Fallback: cached sheet-currency value."""
    if formula:
        body = formula.lstrip("=").replace("$", "").replace(" ", "")
        terms = [t for t in re.split(r"\+(?![^(]*\))", body) if t]
        out = []
        ok = True
        for t in terms:
            m = re.fullmatch(r"\(?([\d.+\-*/()]+?)\)?/(V4|W4\*W3)", t)
            if m:
                out.append({"amount": m.group(1), "currency": "THB"})
            elif re.fullmatch(r"[\d.]+", t):
                out.append({"amount": t, "currency": None})
            else:
                ok = False
        if ok and out:
            return out
    v = _num(cached)
    return [{"amount": v, "currency": None}] if v else []


def import_workbook(path: str) -> dict:
    xlsx, tmp = to_xlsx(path)
    try:
        return _import(xlsx, os.path.basename(path))
    finally:
        if tmp:
            shutil.rmtree(tmp, ignore_errors=True)


def _import(xlsx: str, filename: str) -> dict:
    wv = openpyxl.load_workbook(xlsx, data_only=True)
    wf = openpyxl.load_workbook(xlsx, data_only=False)
    wr = openpyxl.load_workbook(xlsx, rich_text=True)
    notes: list[str] = []
    names = set(wv.sheetnames)

    def V(sheet, coord):
        return wv[sheet][coord].value if sheet in names else None

    # ---------------- header / job info ----------------
    ji = "1.Job Info"
    q = "5. Quotation"
    project = {
        "job_no": _s(V(ji, "F8")) or _s(V(q, "U8")),
        "customer_name": _s(V(ji, "F9")) or _s(V(q, "E9")),
        "contact_person": _s(V(ji, "F10")) or _s(V(q, "E10")),
        "tel": _s(V(ji, "F11")) or _s(V(q, "E11")),
        "fax": _s(V(ji, "F12")) or _s(V(q, "E12")),
        "email": _s(V(ji, "F13")) or _s(V(q, "E13")),
        "product_subject": _s(V(ji, "F14")) or _s(V(q, "E14")),
        "enquiry_date": _s(V(ji, "S11")) or _s(V(q, "U9")),
        "drawing_no": _s(V("3.Drawing", "F9")) or _s(V(q, "E15")),
        "quotation_no": _s(V(q, "E8")),
        "source_file": filename,
    }

    # ---------------- settings ----------------
    ces = "4. CES"
    fx = _num(V(ces, "O2")) or _num(V(q, "AE11")) or _num(V("Import Price", "W3"))
    settings = {
        "quote_currency": "USD" if "USD" in _s(V(q, "U14")).upper() else ("THB" if _s(V(q, "U14")) else "USD"),
        "fx_thb_per_usd": fx,
        "fx_date": _s(V(q, "AC11")).replace("Ex-Change", "").strip(),
        "thb_to_usd_factor": _num(V(ces, "O3")) or 0.9,
        "usd_to_thb_factor": _num(V(ces, "O4")) or 1.05,
        "ovh_pct": _num(V(q, "AC17")) if _num(V(q, "AC17")) is not None else _num(V(ces, "G173")),
        "risk_pct": _num(V(q, "AD17")) if _num(V(q, "AD17")) is not None else _num(V(ces, "G174")),
        "margin_divisor": _num(V(ces, "G176")) or 0.75,
        "item_round_digits": -1,
        "ces_round_digits": -2,
        "ces_discount_pct": _num(V(ces, "G178")) or 0.0,
        "quote_discount_pct": _num(V(q, "T74")) or 0.0,
        "set_qty": _num(V(ces, "E179")) or 1,
        "header_price_mode": "ces",
    }
    af = _f(wf[q], "AF19") if q in names else None
    if af and "/0.75" in af.replace(" ", "") and settings["margin_divisor"] != 0.75:
        notes.append("Quotation sheet hard-codes /0.75 while CES G176 differs; using 0.75 as the quotation does.")
        settings["margin_divisor"] = 0.75

    # ---------------- labor rates ----------------
    lc = "Labor Cost"
    labor_rates = []
    rate_by_cell = {}
    adj = _num(V(lc, "AF3")) or 1.07
    if lc in names:
        ws = wv[lc]
        site = "Nonthaburi"
        for r in range(4, 40):
            pos = _s(ws[f"AB{r}"].value)
            if pos in ("ตำแหน่ง", ""):
                if pos == "ตำแหน่ง" and r > 4:
                    site = "Rayong"
                continue
            sal = _num(ws[f"AE{r}"].value)
            rid = f"L{r}"
            labor_rates.append({"id": rid, "position": pos, "site": site, "salary": sal if sal is not None else 0,
                                "note": _s(ws[f"AD{r}"].value), "optional": sal in (None, 0)})
            rate_by_cell[f"AC{r}"] = rid
    labor_params = {"salary_adj": adj, "days_per_month": 30, "hours_per_day": 8}

    def crew_from(r0, r1, days_cell, perdiem_cell, ot15, ot3, conf, name, extras_rows=()):
        ws, wsf = wv[lc], wf[lc]
        members = []
        for r in range(r0, r1 + 1):
            role = _s(ws[f"A{r}"].value)
            if not role:
                continue
            fB = (_f(wsf, f"B{r}") or "").replace("$", "").lstrip("=")
            rid = rate_by_cell.get(fB)
            if rid is None and re.fullmatch(r"B\d+", fB):   # '=B8' (copied from first table)
                fB2 = (_f(wsf, fB) or "").replace("$", "").lstrip("=")
                rid = rate_by_cell.get(fB2)
            members.append({"role": role, "rate_id": rid, "persons": _num(ws[f"I{r}"].value) or 0})
        extras = []
        for r, basis, per in extras_rows:
            amt = _num(ws[f"H{r}"].value)
            if amt:
                extras.append({"name": _s(ws[f"A{r}"].value), "amount": amt, "basis": basis, "persons_per_unit": per})
        return {"id": name.lower().replace(" ", "_"), "name": name, "days": _num(ws[days_cell].value),
                "per_diem": _num(ws[perdiem_cell].value) or 0, "ot15_hours": _num(ws[ot15].value) or 0,
                "ot3_hours": _num(ws[ot3].value) or 0, "confined_pct": _num(ws[conf].value) or 0,
                "members": members, "extras_per_day": extras}

    crews = []
    if lc in names:
        crews.append(crew_from(8, 14, "J16", "I3", "I1", "I2", "I4", "In-House"))
        crews.append(crew_from(26, 33, "J38", "I21", "I19", "I20", "I22", "Onsite",
                               extras_rows=((35, "per_person", 2), (36, "per_person", 1))))

    # ---------------- machines / materials / parts (CES) ----------------
    machines, materials, parts = [], [], []
    machine_params = {"hours_per_year": _num(V(ces, "BS6")) or 1200, "dep_years": _num(V(ces, "BS7")) or 5,
                      "electricity_rate": _num(V(ces, "BU7")) or 5}
    if ces in names:
        ws, wsf = wv[ces], wf[ces]
        op = _num(ws["BV12"].value)
        match = [r for r in labor_rates if r.get("salary") and abs(r["salary"] * adj / 240 - (op or -1)) < 1e-6]
        if match:
            machine_params["operator_rate_id"] = match[0]["id"]
        else:
            machine_params["operator_rate"] = op
        for r in range(11, 40):
            name = _s(ws[f"BN{r}"].value)
            if not re.match(r"^\d\d ", name):
                continue
            fq = (_f(wsf, f"BQ{r}") or "").replace("$", "")
            mref = re.search(r"\*(B[ST]\d+)", fq)
            ratio = _num(ws[mref.group(1)].value) if mref else None
            if ratio is None and _num(ws[f"BP{r}"].value):
                ratio = (_num(ws[f"BQ{r}"].value) or 0) / _num(ws[f"BP{r}"].value)
            machines.append({"name": name, "description": _s(ws[f"BO{r}"].value), "price": _num(ws[f"BP{r}"].value),
                             "kwh": _num(ws[f"BR{r}"].value) or 0, "consumable_ratio": ratio,
                             "workbook_rate": _num(ws[f"BW{r}"].value)})
        for r in range(12, 37):
            nm = _s(ws[f"BY{r}"].value)
            if not nm:
                continue
            materials.append({"code": nm[:2], "name": nm, "thb_per_kg": _num(ws[f"BZ{r}"].value) or 0,
                              "density": _num(ws[f"CM{r}"].value), "shape": _s(ws[f"CN{r}"].value) or "TWL",
                              "size_labels": [_s(ws[f"CJ{r}"].value), _s(ws[f"CK{r}"].value), _s(ws[f"CL{r}"].value)]})
        group = ""
        for r in range(11, 133):
            desc, grade = _s(ws[f"D{r}"].value), _s(ws[f"E{r}"].value)
            if desc and not grade:
                group = desc
                continue
            if not grade:
                continue
            procs = []
            for pc, hc in (("AC", "AG"), ("AI", "AM"), ("AO", "AS"), ("AU", "AY"), ("BA", "BE")):
                m = _s(ws[f"{pc}{r}"].value)
                if m:
                    procs.append({"machine": m, "hours": _num(ws[f"{hc}{r}"].value)})
            s1, s2, s3 = (_num(ws[f"{c}{r}"].value) for c in ("G", "I", "K"))
            up = _num(ws[f"P{r}"].value)
            by_weight = bool(s1 and up)
            parts.append({"id": f"r{r}", "group": group, "name": desc, "grade_code": grade[:2], "grade": grade,
                          "s1": s1, "s2": s2, "s3": s3, "qty": _num(ws[f"R{r}"].value),
                          "discount_pct": _num(ws[f"U{r}"].value) or 0, "processes": procs,
                          "machine_multiplier": _num(ws[f"BH{r}"].value) or 1,
                          "pricing": "by_weight" if by_weight else "price_sheet", "remark": _s(ws[f"W{r}"].value)})
            if desc in ("Material Domectric", "Material Import", "Material Import (Flange WFN)"):
                parts.pop()   # these rows only pull price-sheet totals; modelled as price sheets
    machine_params["operator_rate"] = machine_params.get("operator_rate")

    # ---------------- services (CES rows 153-165) ----------------
    services = []
    if ces in names:
        ws, wsf = wv[ces], wf[ces]
        TUcell = "O169"
        lookup_tables = {}
        for r in list(range(38, 61)) + list(range(134, 144)):
            k = _s(ws[f"BN{r}"].value)
            if k:
                lookup_tables[k.strip()] = r
        for r in range(153, 166):
            label, sub = _s(ws[f"D{r}"].value), _s(ws[f"E{r}"].value)
            f = _f(wsf, f"F{r}") or ""
            cached = ws[f"F{r}"].value
            group = re.sub(r"\s*\d+.*$", "", label) or label
            name = sub or label
            unit = _s(ws[f"H{r}"].value)
            if not f and _num(cached) in (None, 0):
                continue
            body = f.replace("$", "")
            m = re.fullmatch(r"=\(?([\d.+\-*/() ]+?)\)?/" + TUcell, body)
            if m:
                services.append({"id": f"s{r}", "group": group, "name": name, "amount": m.group(1).replace(" ", ""),
                                 "currency": "THB", "unit": unit, "source": f"4. CES!F{r} {f}"})
                continue
            m = re.fullmatch(r"='(PBD FOR [A-Za-z]+)'!([A-Z]+)(\d+)/" + TUcell, body)
            if m:
                sh, col, row = m.group(1), m.group(2), int(m.group(3))
                val = _num(wv[sh][f"{col}{row}"].value)
                fsum = (_f(wf[sh], f"{col}{row}") or "").replace("$", "")
                rate = qty = None
                if fsum.startswith("=SUM("):
                    a, b = re.findall(r"[A-Z]+(\d+)", fsum)[:2]
                    for rr in range(int(a), int(b) + 1):
                        if _num(wv[sh][f"{col}{rr}"].value):
                            ff = (_f(wf[sh], f"{col}{rr}") or "").replace("$", "")
                            mm = re.fullmatch(r"=([A-Z]+\d+)\*([A-Z]+\d+)", ff)
                            if mm:
                                rate, qty = _num(wv[sh][mm.group(1)].value), _num(wv[sh][mm.group(2)].value)
                            break
                else:
                    mm = re.fullmatch(r"=([A-Z]+\d+)\*([A-Z]+\d+)", fsum)
                    if mm:
                        rate, qty = _num(wv[sh][mm.group(1)].value), _num(wv[sh][mm.group(2)].value)
                if rate is not None and qty is not None and abs(rate * qty - (val or 0)) < 1e-6:
                    services.append({"id": f"s{r}", "group": group, "name": name, "rate": rate, "qty": qty,
                                     "minimum": 0, "currency": "THB", "unit": "", "source": f"{sh}!{col}{row}"})
                else:
                    services.append({"id": f"s{r}", "group": group, "name": name, "amount": val, "currency": "THB",
                                     "source": f"{sh}!{col}{row}"})
                continue
            if "XLOOKUP" in body or "MAX(" in body or f.startswith("<"):
                key = sub.strip()
                if not key:
                    continue    # empty slot (no test/finish selected)
                tr = lookup_tables.get(key)
                if tr is None:
                    notes.append(f"Service '{name}' (CES F{r}) could not be resolved; amount left blank")
                    services.append({"id": f"s{r}", "group": group, "name": name, "amount": None, "currency": "THB"})
                    continue
                bo_f = _f(wsf, f"BO{tr}") or ""
                mn = _num(ws[f"BP{tr}"].value) or 0
                if bo_f.startswith("=") and "*" in bo_f:
                    rate, qty = _num(ws[f"BQ{tr}"].value), _num(ws[f"BR{tr}"].value)
                    services.append({"id": f"s{r}", "group": group, "name": name, "rate": rate, "qty": qty,
                                     "unit": "m²", "minimum": mn, "currency": "THB", "source": f"4. CES!BN{tr} table"})
                else:
                    services.append({"id": f"s{r}", "group": group, "name": name, "rate": _num(ws[f"BO{tr}"].value) or 0,
                                     "qty": 1, "unit": "job", "minimum": mn, "currency": "THB",
                                     "source": f"4. CES!BN{tr} table (MAX(cost, minimum))"})
                continue
            v = _num(cached)
            if v:
                services.append({"id": f"s{r}", "group": group, "name": name, "amount": v * (wv[ces][TUcell].value or 1),
                                 "currency": "THB", "source": f"4. CES!F{r} cached"})

    # ---------------- price sheets ----------------
    def price_sheet(sheet, sid, cur, digits, bucket):
        if sheet not in names:
            return None
        ws, wsf = wv[sheet], wf[sheet]
        total_row = None
        for r in range(5, 200):
            fS = _f(wsf, f"S{r}") or ""
            if fS.replace("$", "").startswith("=SUM(S5"):
                total_row = r
                break
        if not total_row:
            notes.append(f"{sheet}: total row not found")
            return None
        lines, grp, mat = [], "", ""
        for r in range(5, total_row):
            grp = _s(ws[f"B{r}"].value) or grp
            mat = _s(ws[f"C{r}"].value) or mat
            desc = _s(ws[f"D{r}"].value)
            qty, up = _num(ws[f"F{r}"].value), _num(ws[f"H{r}"].value)
            if not desc and not qty:
                continue
            if not up:
                if qty:
                    notes.append(f"{sheet} row {r} '{grp} {desc}' has qty {qty:g} but no price in workbook (not imported)")
                continue
            fh = _f(wsf, f"H{r}") or ""
            src = ""
            if fh and re.search(r"[-+*/]\s*\d", fh):
                src = f"workbook formula {fh}"
            elif fh:
                src = f"{fh.lstrip('=')}"
            lines.append({"id": f"r{r}", "group": grp, "material": mat, "description": desc, "qty": qty,
                          "unit_price": up, "unit_weight": _num(ws[f"E{r}"].value), "price_source": src})
        freight = []
        for r in range(total_row + 1, total_row + 8):
            lab = _s(ws[f"D{r}"].value)
            if not lab or lab.startswith("รวม"):
                if lab.startswith("รวม"):
                    break
                continue
            gh = sum((_num(ws[f"{c}{r}"].value) or 0) for c in ("G", "H"))
            if gh > 0:
                freight.append({"label": lab, "amount": gh, "currency": cur})
                continue
            fI = _f(wsf, f"I{r}")
            for part in _parse_freight_formula(fI, ws[f"I{r}"].value):
                freight.append({"label": lab, "amount": part["amount"], "currency": part["currency"] or cur})
        tax = _num(ws["M4"].value) or 0
        mdiv = _num(ws["N4"].value) or 1
        cached_total = _num(ws[f"S{total_row}"].value)
        return {"id": sid, "name": sheet, "currency": cur, "round_digits": digits, "tax_pct": tax,
                "margin_divisor": mdiv, "freight": freight, "lines": lines, "bucket": bucket,
                "workbook_total": cached_total}

    def sheet_digits(sheet):
        f = _f(wf[sheet], "R5") if sheet in names else None
        m = re.search(r"ROUNDUP\(P5/F5,(-?\d+)\)", (f or "").replace(" ", ""))
        return int(m.group(1)) if m else -1

    def sheet_currency(sheet):
        h4 = _s(V(sheet, "H4")).upper()
        return "THB" if "THB" in h4 else "USD"

    sheets = []
    for sheet, sid in (("Import Price", "import"), ("Import Price (WFN)", "import_wfn"), ("Domectric Price", "domestic")):
        ps = price_sheet(sheet, sid, sheet_currency(sheet), sheet_digits(sheet), None)
        if ps:
            sheets.append(ps)

    # ---------------- buckets (quote items) ----------------
    # Map quotation item rows -> cost sources by reading the quotation's hidden AA helper formulas.
    buckets = []
    quote_rows = []
    reference = {}
    if q in names:
        wsq, wsqf, wsr = wv[q], wf[q], wr[q]
        for r in range(18, 73):
            no = wsq[f"A{r}"].value
            if not isinstance(no, (int, float)):
                continue
            no = int(no)
            aa = (_f(wsqf, f"AA{r}") or "").replace("$", "")
            pf = (_f(wsqf, f"P{r}") or "").replace("$", "")
            heading = _s(wsq[f"B{r}"].value)
            srcs = []
            if "V135" in aa:
                srcs.append({"type": "price_sheet", "id": "import"})
            if "V134" in aa:
                srcs.append({"type": "price_sheet", "id": "domestic"})
            if "V136" in aa:
                srcs.append({"type": "price_sheet", "id": "import_wfn"})
            if "E170" in aa:
                srcs += [{"type": "services"}, {"type": "crews"}]
            if "E171" in aa:
                srcs.append({"type": "machines"})
            markup = True
            m = re.fullmatch(r"=\(?([\d.]+)\)?/(AD12|AE12\*AE11)", aa)
            if m:
                srcs.append({"type": "fixed", "label": heading, "amount": float(m.group(1)), "currency": "THB"})
                markup = "AF" in pf
            if not srcs:
                notes.append(f"Quotation item {no} '{heading}': cost source not recognised (AA{r}='{aa}')")
            buckets.append({"no": no, "heading": heading.strip(), "unit": _s(wsq[f"U{r}"].value) or "Lot.",
                            "qty": _num(wsq[f"S{r}"].value) or 1, "markup": markup, "sources": srcs})
            reference[f"item.{no}.price"] = _num(wsq[f"P{r}"].value)

        # ---- quotation document body rows (texts with styling) ----
        kinds = {}
        for r in range(18, 73):
            cell = wsr[f"B{r}"]
            runs = _runs(cell.value, wsq[f"B{r}"])
            no = wsq[f"A{r}"].value
            fill = wsq[f"B{r}"].fill.fgColor.rgb if wsq[f"B{r}"].fill.fill_type else None
            text = "".join(x["text"] for x in runs)
            h = wsq.row_dimensions[r].height
            if r == 18:
                kind = "title"
            elif isinstance(no, (int, float)):
                kind = "item"
            elif not text.strip():
                kind = "blank"
            elif fill and fill.endswith("FFFF00"):
                kind = "highlight_head" if text.lower().startswith("transportation") else "highlight_line"
            elif text.strip().startswith("•"):
                kind = "bullet"
            elif runs and runs[0]["bold"] and runs[0].get("underline"):
                kind = "section_head"
            elif runs and runs[0]["bold"]:
                kind = "section_head"
            else:
                kind = "line"
            row = {"kind": kind, "runs": runs}
            al = wsq[f"B{r}"].alignment
            row["align"] = {"vertical": al.vertical, "wrap": bool(al.wrap_text), "horizontal": al.horizontal}
            if kind == "item":
                row["item_no"] = int(no)
            if h and h > 15.5:
                row["height"] = h
            quote_rows.append(row)
        breaks = [b.id for b in wsqf.row_breaks.brk if 18 <= b.id <= 72]

    quote_doc = {
        "quotation_no": project["quotation_no"],
        "job_no": project["job_no"],
        "customer_name": project["customer_name"], "contact_person": project["contact_person"],
        "tel": project["tel"], "fax": project["fax"], "email": project["email"],
        "product_subject": project["product_subject"], "drawing_no": project["drawing_no"],
        "enquiry_date": project["enquiry_date"],
        "quotation_date": _s(V(q, "U10")),
        "validity_date": _s(V(q, "U11")),
        "payment_term": _s(V(q, "U12")),
        "delivery_time": _num(V(q, "U13")), "delivery_unit": _s(V(q, "X13")) or "Months",
        "currency_label": _s(V(q, "U14")) or "USD.",
        "title": {"runs": quote_rows[0]["runs"] if quote_rows else [], "unit": _s(V(q, "U18")) or "Set.",
                  "qty": _num(V(q, "S18")) or 1},
        "rows": quote_rows[1:],
        "page_breaks": [b - 18 for b in breaks] if q in names else [],     # break after body row index
        "prepared_by": _s(V(q, "A74")), "reviewed_by": _s(V(q, "E74")), "approved_by": _s(V(q, "I74")),
    }
    if quote_doc["page_breaks"]:
        quote_doc["page_breaks"] = [b for b in quote_doc["page_breaks"]]

    reference.update({"totals.total": _num(V(q, "V73")), "totals.net": _num(V(q, "V75")),
                      "header.price": _num(V(q, "P18"))})
    for ps in sheets:
        reference[f"ps.{ps['id']}.total"] = ps.get("workbook_total")
    for m in machines:
        if m.get("workbook_rate") is not None:
            reference[f"machine:{m['name']}"] = m["workbook_rate"]

    estimate = {
        "settings": settings, "labor_params": labor_params, "labor_rates": labor_rates, "crews": crews,
        "machine_params": machine_params, "machines": machines, "materials": materials, "parts": parts,
        "services": services, "price_sheets": sheets, "buckets": buckets,
    }
    if lc in names:
        reference["crews.total_thb"] = (_num(V(lc, "J17")) or 0) + (_num(V(lc, "J39")) or 0)

    # supplier price records for the supplier database
    supplier_prices = []
    boq_sup = {"import": _s(V("BOQ LIST (Import)", "H4")) or "Import supplier",
               "import_wfn": "WFN", "domestic": "Domestic"}
    for ps in sheets:
        for ln in ps["lines"]:
            supplier_prices.append({"supplier": boq_sup.get(ps["id"]) or ps["name"], "sheet": ps["name"],
                                    "group": ln["group"], "material": ln["material"], "description": ln["description"],
                                    "unit_price": ln["unit_price"], "currency": ps["currency"], "unit": "pc",
                                    "unit_weight": ln.get("unit_weight"), "source": f"{filename} / {ps['name']} {ln['id']}",
                                    "quote_date": settings.get("fx_date") or ""})
    return {"project": project, "estimate": estimate, "quote_doc": quote_doc, "reference_values": reference,
            "supplier_prices": supplier_prices, "notes": notes}
