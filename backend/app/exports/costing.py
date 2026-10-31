"""Internal costing workbook with LIVE Excel formulas (fully editable; recalculates in Excel/LibreOffice).

Mirrors the engine 1:1 so a LibreOffice recalculation of this file can be checked against the engine.
"""
from __future__ import annotations

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter as L
from openpyxl.workbook.defined_name import DefinedName

from ..calc.numeric import eval_expr

HDR = Font(bold=True, color="FFFFFF")
HFILL = PatternFill("solid", fgColor="1F3A5F")
INP = PatternFill("solid", fgColor="FFF4CC")   # input cells (editable)
TOT = Font(bold=True)
NUM = "#,##0.00"
THIN = Border(bottom=Side(style="thin", color="BBBBBB"))


def _hdr(ws, row, titles, widths=None):
    for i, t in enumerate(titles, 1):
        c = ws.cell(row, i, t)
        c.font, c.fill = HDR, HFILL
        c.alignment = Alignment(wrap_text=True, vertical="center")
    if widths:
        for i, w in enumerate(widths, 1):
            ws.column_dimensions[L(i)].width = w


def _inp(ws, coord, value, fmt=None):
    v = value
    if isinstance(v, str):
        try:
            ev = eval_expr(v)
            v = ("=" + v.lstrip("=")) if ev is not None and any(ch in v for ch in "+-*/") else ev
        except Exception:
            pass
    c = ws[coord]
    c.value = v
    c.fill = INP
    if fmt:
        c.number_format = fmt
    return c


def _name(wb, name, ref):
    wb.defined_names[name] = DefinedName(name, attr_text=ref)


def build_costing_workbook(est: dict, result: dict, project: dict, out_path: str) -> dict:
    wb = Workbook()
    S = result["settings"]
    cells = {}   # engine node key -> 'Sheet'!Cell for verification

    # ---------------- Settings ----------------
    ws = wb.active
    ws.title = "Settings"
    ws["A1"] = f"Costing workbook — {project.get('job_no','')} {project.get('product_subject','')}"
    ws["A1"].font = Font(bold=True, size=13)
    ws["A2"] = "Yellow cells are inputs. All other values are formulas."
    rows = [("FX", "Exchange rate THB per USD", S["fx_thb_per_usd"]),
            ("TU_FACTOR", "THB->USD conversion factor", S["thb_to_usd_factor"]),
            ("UT_FACTOR", "USD->THB conversion factor", S["usd_to_thb_factor"]),
            ("OVH", "Overhead %", S["ovh_pct"]), ("RISK", "Risk %", S["risk_pct"]),
            ("DIVISOR", "Margin divisor (1 - gross margin)", S["margin_divisor"]),
            ("ITEM_DIGITS", "Quote item ROUNDUP digits", S["item_round_digits"]),
            ("CES_DIGITS", "CES total ROUNDUP digits", S["ces_round_digits"]),
            ("CES_DISC", "CES discount %", S["ces_discount_pct"]),
            ("QUOTE_DISC", "Quotation discount %", S["quote_discount_pct"]),
            ("SET_QTY", "Set quantity", S["set_qty"])]
    _hdr(ws, 4, ["Name", "Description", "Value"], [16, 40, 16])
    r = 5
    for nm, desc, val in rows:
        ws.cell(r, 1, nm)
        ws.cell(r, 2, desc)
        _inp(ws, f"C{r}", val)
        _name(wb, nm, f"Settings!$C${r}")
        r += 1
    ws.cell(r, 1, "TU"); ws.cell(r, 2, "THB per USD used to convert THB costs"); ws.cell(r, 3, "=TU_FACTOR*FX")
    _name(wb, "TU", f"Settings!$C${r}"); cells["set.TU"] = f"Settings!C{r}"; r += 1
    ws.cell(r, 1, "UT"); ws.cell(r, 2, "THB per USD used to convert USD costs"); ws.cell(r, 3, "=UT_FACTOR*FX")
    _name(wb, "UT", f"Settings!$C${r}"); r += 1
    qcur = S.get("quote_currency", "USD")

    def conv(expr, cur):
        cur = (cur or qcur).upper()
        if cur == qcur:
            return expr
        return f"({expr})/TU" if cur == "THB" else f"({expr})*UT"

    # ---------------- Labor ----------------
    wl = wb.create_sheet("Labor")
    LP = est.get("labor_params") or {}
    wl["A1"], wl["A2"], wl["A3"] = "Salary adjustment", "Days / month", "Hours / day"
    _inp(wl, "B1", LP.get("salary_adj", 1.07)); _inp(wl, "B2", LP.get("days_per_month", 30)); _inp(wl, "B3", LP.get("hours_per_day", 8))
    _hdr(wl, 5, ["Rate ID", "Position", "Site", "Salary THB/month", "Hourly rate override", "THB / hour"], [10, 26, 12, 16, 16, 14])
    rate_cell = {}
    r = 6
    for rr in result["labor_rates"]:
        wl.cell(r, 1, rr["id"]); wl.cell(r, 2, rr.get("position")); wl.cell(r, 3, rr.get("site"))
        _inp(wl, f"D{r}", rr.get("salary"), NUM)
        if rr.get("hourly_rate") not in (None, ""):
            _inp(wl, f"E{r}", rr.get("hourly_rate"), NUM)
        wl.cell(r, 6, f'=IF(E{r}<>"",E{r},D{r}*$B$1/$B$2/$B$3)').number_format = NUM
        rate_cell[rr["id"]] = f"Labor!$F${r}"
        cells[f"rate.{rr['id']}"] = f"Labor!F{r}"
        r += 1
    r += 1
    crew_total_cells = []
    for cr in result["crews"]:
        wl.cell(r, 1, cr["name"]).font = Font(bold=True, size=12)
        r += 1
        p0 = r
        for lab, key in (("Days", "days"), ("Per diem / person / day", "per_diem"), ("OT x1.5 hours", "ot15_hours"),
                         ("OT x3 hours", "ot3_hours"), ("Confined premium %", "confined_pct")):
            wl.cell(r, 1, lab)
            _inp(wl, f"B{r}", cr.get(key) if cr.get(key) not in (None, "") else 0)
            r += 1
        D, PD, O15, O3, CF = (f"$B${p0 + i}" for i in range(5))
        _hdr(wl, r, ["Role", "Rate THB/h", "THB/day", "Per diem", "OT1.5", "OT3", "Premium", "Persons", "Cost / day"])
        r += 1
        m0 = r
        for m in cr["members"]:
            wl.cell(r, 1, m.get("role"))
            wl.cell(r, 2, f"={rate_cell[m['rate_id']]}" if m.get("rate_id") in rate_cell else 0)
            wl.cell(r, 3, f"=B{r}*$B$3")
            wl.cell(r, 4, f"={PD}")
            wl.cell(r, 5, f"=B{r}*1.5*{O15}")
            wl.cell(r, 6, f"=B{r}*3*{O3}")
            wl.cell(r, 7, f"=C{r}*{CF}")
            _inp(wl, f"H{r}", m.get("persons") or 0)
            wl.cell(r, 9, f"=(C{r}*H{r})+G{r}+(H{r}*D{r})+(E{r}*H{r})+(F{r}*H{r})").number_format = NUM
            r += 1
        m1 = r - 1
        ext = []
        for x in cr.get("extras_per_day") or []:
            wl.cell(r, 1, x.get("name"))
            _inp(wl, f"B{r}", x.get("amount"))
            if x.get("basis") == "per_person":
                _inp(wl, f"C{r}", x.get("persons_per_unit") or 1)
                wl.cell(r, 9, f"=B{r}*SUM(H{m0}:H{m1})/C{r}" if m1 >= m0 else "=0")
            else:
                wl.cell(r, 9, f"=B{r}")
            ext.append(f"I{r}")
            r += 1
        wl.cell(r, 8, "Cost / day").font = TOT
        sum_rng = f"SUM(I{m0}:I{m1})" if m1 >= m0 else "0"
        wl.cell(r, 9, "=" + "+".join([sum_rng] + ext)).number_format = NUM
        cells[f"crew.{cr['id']}.per_day"] = f"Labor!I{r}"
        r += 1
        wl.cell(r, 8, "Total THB").font = TOT
        wl.cell(r, 9, f"=I{r-1}*{D}").number_format = NUM
        cells[f"crew.{cr['id']}.total"] = f"Labor!I{r}"
        crew_total_cells.append(f"Labor!I{r}")
        r += 2
    wl.cell(r, 8, "All crews THB").font = TOT
    wl.cell(r, 9, "=" + ("+".join(crew_total_cells) or "0")).number_format = NUM
    crews_total = f"Labor!$I${r}"
    cells["crews.total"] = f"Labor!I{r}"

    # ---------------- Machines ----------------
    wm = wb.create_sheet("Machines")
    MP = est.get("machine_params") or {}
    wm["A1"], wm["A2"], wm["A3"], wm["A4"] = "Hours / year", "Depreciation years", "Electricity THB/kWh", "Operator THB/h"
    _inp(wm, "B1", MP.get("hours_per_year", 1200)); _inp(wm, "B2", MP.get("dep_years", 5)); _inp(wm, "B3", MP.get("electricity_rate", 5))
    if MP.get("operator_rate_id") in rate_cell:
        wm["B4"] = f"={rate_cell[MP['operator_rate_id']]}"
    else:
        _inp(wm, "B4", MP.get("operator_rate") or 0)
    _hdr(wm, 6, ["Machine", "Price THB", "kWh/h", "Consumables ratio", "Depreciation/h", "Consumables/h", "Electricity/h",
                 "Operator/h", "Rate override", "Rate THB/h"], [32, 14, 8, 12, 12, 12, 12, 12, 12, 12])
    r = 7
    m_first = r
    for m in result["machines"]:
        wm.cell(r, 1, m.get("name"))
        if m.get("price") in (None, "") and m.get("rate_override") in (None, ""):
            wm.cell(r, 10, 0)
        else:
            _inp(wm, f"B{r}", m.get("price"), NUM); _inp(wm, f"C{r}", m.get("kwh") or 0); _inp(wm, f"D{r}", m.get("consumable_ratio"))
            wm.cell(r, 5, f"=B{r}/$B$1/$B$2"); wm.cell(r, 6, f"=B{r}*D{r}/$B$1"); wm.cell(r, 7, f"=C{r}*$B$3"); wm.cell(r, 8, "=$B$4")
            if m.get("rate_override") not in (None, ""):
                _inp(wm, f"I{r}", m.get("rate_override"))
            wm.cell(r, 10, f'=IF(I{r}<>"",I{r},ROUNDUP(E{r}+F{r}+G{r}+H{r},0))')
        r += 1
    m_last = r - 1
    mrng_name, mrng_rate = f"Machines!$A${m_first}:$A${m_last}", f"Machines!$J${m_first}:$J${m_last}"

    # ---------------- Parts ----------------
    wp = wb.create_sheet("Parts")
    _hdr(wp, 1, ["Part", "Grade", "Pricing", "Shape", "Size1", "Size2", "Size3", "Density", "Weight/pc kg", "Qty",
                 "THB/kg", "Disc %", "Material THB"] + sum(([f"Process{i}", f"Hours{i}", f"Cost{i}"] for i in range(1, 6)), [])
         + ["Multiplier", "Machine THB"], [28, 10, 11, 7, 8, 8, 8, 8, 11, 6, 9, 6, 12] + [18, 6, 9] * 5 + [8, 12])
    r = 2
    p_first = r
    for p in result["parts"]:
        wp.cell(r, 1, p.get("name")); wp.cell(r, 2, p.get("grade") or p.get("grade_code")); wp.cell(r, 3, p.get("pricing"))
        shape = p.get("shape") or "TWL"
        wp.cell(r, 4, shape)
        for col, k in ((5, "s1"), (6, "s2"), (7, "s3")):
            if p.get(k) not in (None, ""):
                _inp(wp, f"{L(col)}{r}", p.get(k))
        if p.get("density") is not None:
            _inp(wp, f"H{r}", p.get("density"))
        wt = {"TWL": f"E{r}*F{r}/1000*G{r}/1000*H{r}", "DiaL": f"PI()/4*(E{r}/1000)^2*F{r}*H{r}",
              "ODTL": f"(PI()/4*(E{r}/1000)^2-PI()/4*((E{r}-2*F{r})/1000)^2)*G{r}*H{r}"}.get(shape, f"E{r}*F{r}/1000*G{r}/1000*H{r}")
        wp.cell(r, 9, f'=IF(OR(E{r}="",H{r}=""),0,{wt})').number_format = "0.000"
        _inp(wp, f"J{r}", p.get("qty") or 0)
        up = None
        if p.get("pricing") == "by_weight":
            n = result["nodes"].get(f"part.{p.get('id')}.up")
            up = n["value"] if n else None
        _inp(wp, f"K{r}", up or 0, NUM)
        _inp(wp, f"L{r}", p.get("discount_pct") or 0)
        wp.cell(r, 13, f'=IF(C{r}="by_weight",I{r}*K{r}*(100-L{r})/100*J{r},0)').number_format = NUM
        costs = []
        for j, pr in enumerate((p.get("processes") or [])[:5]):
            c0 = 14 + 3 * j
            wp.cell(r, c0, pr.get("machine"))
            _inp(wp, f"{L(c0+1)}{r}", pr.get("hours") if pr.get("hours") not in (None, "") else 0)
            wp.cell(r, c0 + 2, f"=IFERROR(INDEX({mrng_rate},MATCH({L(c0)}{r},{mrng_name},0)),0)*{L(c0+1)}{r}")
            costs.append(f"{L(c0+2)}{r}")
        _inp(wp, f"AC{r}", p.get("machine_multiplier") or 1)
        wp.cell(r, 30, f"=({'+'.join(costs) or '0'})*AC{r}").number_format = NUM
        r += 1
    p_last = max(r - 1, p_first)
    wp.cell(r, 12, "Totals").font = TOT
    wp.cell(r, 13, f"=SUM(M{p_first}:M{p_last})" if result["parts"] else "=0").number_format = NUM
    wp.cell(r, 30, f"=SUM(AD{p_first}:AD{p_last})" if result["parts"] else "=0").number_format = NUM
    parts_mat, parts_mach = f"Parts!$M${r}", f"Parts!$AD${r}"
    cells["parts.material"], cells["parts.machine"] = f"Parts!M{r}", f"Parts!AD{r}"

    # ---------------- Services ----------------
    wsv = wb.create_sheet("Services")
    _hdr(wsv, 1, ["Group", "Service", "Currency", "Rate", "Qty", "Minimum", "Fixed amount", "Amount", "Amount THB", "Source"],
         [18, 34, 9, 12, 12, 12, 14, 14, 14, 40])
    r = 2
    for s_ in result["services"]:
        wsv.cell(r, 1, s_.get("group")); wsv.cell(r, 2, s_.get("name")); wsv.cell(r, 3, (s_.get("currency") or "THB").upper())
        if s_.get("rate") not in (None, ""):
            _inp(wsv, f"D{r}", s_.get("rate")); _inp(wsv, f"E{r}", s_.get("qty")); _inp(wsv, f"F{r}", s_.get("minimum") or 0)
            wsv.cell(r, 8, f"=MAX(D{r}*E{r},F{r})")
        else:
            _inp(wsv, f"G{r}", s_.get("amount") if s_.get("amount") not in (None, "") else 0)
            wsv.cell(r, 8, f"=G{r}")
        wsv.cell(r, 9, f'=IF(C{r}="THB",H{r},H{r}*TU)').number_format = NUM
        wsv.cell(r, 10, s_.get("source", ""))
        r += 1
    wsv.cell(r, 8, "Total THB").font = TOT
    wsv.cell(r, 9, f"=SUM(I2:I{r-1})" if r > 2 else "=0").number_format = NUM
    svc_total = f"Services!$I${r}"
    cells["svc.total"] = f"Services!I{r}"

    # ---------------- Price sheets ----------------
    sheet_total = {}
    for ps in result["price_sheets"]:
        title = (ps.get("name") or ps["id"])[:28].replace("/", "-")
        w = wb.create_sheet(title)
        cur = ps.get("currency", "USD")
        w["A1"] = f"{ps.get('name')} ({cur})"; w["A1"].font = Font(bold=True, size=12)
        w["A2"], w["C2"], w["E2"], w["G2"] = "Tax %", "Margin divisor", "Exchange", "ROUNDUP digits"
        _inp(w, "B2", ps.get("tax_pct") or 0); _inp(w, "D2", ps.get("margin_divisor") or 1)
        _inp(w, "F2", ps.get("exchange") or 1); _inp(w, "H2", ps.get("round_digits", -1))
        _hdr(w, 4, ["Group", "Material", "Description", "Weight/pc", "Qty (F)", "Unit price (H)", "J = F x H", "L = J x exch",
                    "M = L x tax", "N = L / margin", "O = allocated", "P = O + M", "R = ROUNDUP(P/F)", "S = R x F", "Source"],
             [14, 12, 34, 10, 8, 12, 12, 12, 10, 12, 12, 12, 14, 12, 40])
        r = 5
        first = r
        n = len(ps["lines"])
        last = first + n - 1
        tot_r = last + 1
        for i, ln in enumerate(ps["lines"]):
            w.cell(r, 1, ln.get("group")); w.cell(r, 2, ln.get("material")); w.cell(r, 3, ln.get("description"))
            if ln.get("unit_weight") not in (None, ""):
                w.cell(r, 4, ln.get("unit_weight"))
            _inp(w, f"E{r}", ln.get("qty")); _inp(w, f"F{r}", ln.get("unit_price"), NUM)
            w.cell(r, 7, f"=E{r}*F{r}"); w.cell(r, 8, f"=G{r}*$F$2"); w.cell(r, 9, f"=H{r}*$B$2"); w.cell(r, 10, f"=H{r}/$D$2")
            w.cell(r, 11, f"=IFERROR(J{r}/$J${tot_r}*$J${tot_r + 2 + len(ps.get('freight') or [])},0)")
            w.cell(r, 12, f"=K{r}+I{r}"); w.cell(r, 13, f"=IFERROR(ROUNDUP(L{r}/E{r},$H$2),0)"); w.cell(r, 14, f"=M{r}*E{r}")
            w.cell(r, 15, ln.get("price_source") or "")
            for c in range(7, 15):
                w.cell(r, c).number_format = NUM
            cells[f"ps.{ps['id']}.l{i}.R"] = f"'{title}'!M{r}"
            r += 1
        w.cell(tot_r, 3, "Total material").font = TOT
        rng = lambda col: f"=SUM({col}{first}:{col}{last})" if n else "=0"
        w.cell(tot_r, 10, rng("J")); w.cell(tot_r, 14, rng("N")).font = TOT
        for c in (10, 14):
            w.cell(tot_r, c).number_format = NUM
        r = tot_r + 1
        w.cell(r, 3, "Freight / other charges").font = TOT
        w.cell(r, 6, "Amount"); w.cell(r, 7, "Currency"); w.cell(r, 10, f"In {cur}")
        r += 1
        fr0 = r
        for fr in ps.get("freight") or []:
            w.cell(r, 3, fr.get("label"))
            _inp(w, f"F{r}", fr.get("amount"))
            fc = (fr.get("currency") or cur).upper()
            w.cell(r, 7, fc)
            if fc == cur:
                w.cell(r, 10, f"=F{r}")
            elif fc == "THB":
                w.cell(r, 10, f"=F{r}/TU")
            else:
                w.cell(r, 10, f"=F{r}*TU")
            w.cell(r, 10).number_format = NUM
            r += 1
        grand_r = r
        assert grand_r == tot_r + 2 + len(ps.get("freight") or [])
        w.cell(grand_r, 3, "Material + freight").font = TOT
        w.cell(grand_r, 10, f"=J{tot_r}" + (f"+SUM(J{fr0}:J{grand_r-1})" if grand_r > fr0 else "")).number_format = NUM
        sheet_total[ps["id"]] = (f"'{title}'!$N${tot_r}", cur)
        cells[f"ps.{ps['id']}.total"] = f"'{title}'!N{tot_r}"

    # ---------------- Summary (quote items + CES) ----------------
    wsum = wb.create_sheet("Summary", 0)
    wsum["A1"] = f"{project.get('product_subject','')} — {project.get('quotation_no','')}"
    wsum["A1"].font = Font(bold=True, size=13)
    _hdr(wsum, 3, ["Item", "Heading", "Cost base", "Markup", "Calculated price", "Override", "Unit price", "Qty", "Total", "Margin %"],
         [6, 34, 14, 8, 16, 12, 14, 7, 14, 9])
    r = 4
    first_item = r
    dm, dl1, dl2 = [], [], []
    for b, it in zip(est.get("buckets") or [], result["items"]):
        terms = []
        for src in b.get("sources") or []:
            t = src.get("type")
            if t == "price_sheet" and src.get("id") in sheet_total:
                ref, cur = sheet_total[src["id"]]
                terms.append(conv(ref, cur)); dm.append(terms[-1])
            elif t == "services":
                terms.append(conv(svc_total, "THB")); dl1.append(terms[-1])
            elif t == "crews":
                terms.append(conv(crews_total, "THB")); dl1.append(terms[-1])
            elif t == "machines":
                terms.append(conv(parts_mach, "THB")); dl2.append(terms[-1])
            elif t == "parts_material":
                terms.append(conv(parts_mat, "THB")); dm.append(terms[-1])
            elif t == "fixed":
                amt = src.get("amount")
                terms.append(conv(str(amt), src.get("currency", qcur)))
        wsum.cell(r, 1, it["no"]); wsum.cell(r, 2, it["heading"])
        wsum.cell(r, 3, "=" + ("+".join(terms) or "0"))
        wsum.cell(r, 4, "Yes" if it["markup"] else "No")
        wsum.cell(r, 5, f'=IF(D{r}="Yes",ROUNDUP(C{r}*(1+OVH+RISK)/DIVISOR,ITEM_DIGITS),ROUNDUP(C{r},ITEM_DIGITS))')
        if b.get("override_price") not in (None, ""):
            _inp(wsum, f"F{r}", b.get("override_price"))
        wsum.cell(r, 7, f'=IF(F{r}<>"",F{r},E{r})')
        _inp(wsum, f"H{r}", it["qty"])
        wsum.cell(r, 9, f"=G{r}*H{r}")
        wsum.cell(r, 10, f"=IFERROR((I{r}-C{r}*H{r})/I{r},0)").number_format = "0.0%"
        for c in (3, 5, 7, 9):
            wsum.cell(r, c).number_format = NUM
        cells[f"item.{it['no']}.price"] = f"Summary!G{r}"
        cells[f"item.{it['no']}.base"] = f"Summary!C{r}"
        r += 1
    last_item = r - 1
    r += 1
    def line(label, formula, key=None, bold=False):
        nonlocal r
        wsum.cell(r, 8, label).font = Font(bold=bold)
        c = wsum.cell(r, 9, formula)
        c.number_format = NUM
        c.font = Font(bold=bold)
        if key:
            cells[key] = f"Summary!I{r}"
        r += 1
        return f"I{r-1}"
    t = line("Total price", f"=SUM(I{first_item}:I{last_item})", "totals.total", True)
    d = line("Discount", f"={t}*QUOTE_DISC", "totals.discount")
    line("Net total price", f"={t}-{d}", "totals.net", True)
    r += 1
    wsum.cell(r, 7, "CES (cost estimate sheet)").font = TOT
    r += 1
    a = line("Material cost (DM)", "=" + ("+".join(dm) or "0"), "ces.dm")
    b1 = line("Labor cost (DL1)", "=" + ("+".join(dl1) or "0"), "ces.dl1")
    b2 = line("Machine cost (DL2)", "=" + ("+".join(dl2) or "0"), "ces.dl2")
    dr = line("Direct cost", f"={a}+{b1}+{b2}", "ces.direct")
    full = line("Full cost (x (1+OVH+Risk))", f"={dr}*(1+OVH+RISK)", "ces.full")
    pr = line("CES total price", f"=ROUNDUP({full}/DIVISOR,CES_DIGITS)", "ces.price")
    net = line("CES net price", f"=({pr}-{pr}*CES_DISC)*SET_QTY", "ces.net")
    mode = S.get("header_price_mode", "ces")
    if mode == "ces":
        line("Product line price / set", f"=ROUNDUP({net},ITEM_DIGITS)", "header.price", True)
    elif mode == "sum_items":
        line("Product line price / set", f"={t}", "header.price", True)
    else:
        line("Product line price / set", S.get("header_price_manual") or 0, "header.price", True)

    for wsx in wb.worksheets:
        wsx.freeze_panes = None
    wb.save(out_path)
    return cells


def verify_with_libreoffice(xlsx_path: str, cells: dict, result: dict, tol: float = 1e-6) -> dict:
    """Recalculate the workbook in LibreOffice and compare every mapped cell with the engine."""
    import os, shutil, subprocess, tempfile
    import openpyxl
    tmp = tempfile.mkdtemp(prefix="verify_")
    try:
        src = os.path.join(tmp, "in.xlsx")
        shutil.copy(xlsx_path, src)
        outdir = os.path.join(tmp, "out")
        os.makedirs(outdir)
        subprocess.run(["soffice", "--headless", "--norestore", "--convert-to", "xlsx:Calc MS Excel 2007 XML",
                        "--outdir", outdir, src], check=True, capture_output=True, timeout=180, env=dict(os.environ, HOME=tmp))
        wb = openpyxl.load_workbook(os.path.join(outdir, "in.xlsx"), data_only=True)
        nodes = result["nodes"]
        report = {"checked": 0, "mismatches": []}
        for key, ref in cells.items():
            sheet, coord = ref.rsplit("!", 1)
            sheet = sheet.strip("'")
            v = wb[sheet][coord.replace("$", "")].value
            if key not in nodes:
                continue
            e = nodes[key]["value"]
            report["checked"] += 1
            if not isinstance(v, (int, float)) or abs(v - e) > tol * max(1, abs(e)):
                report["mismatches"].append({"key": key, "cell": ref, "excel": v, "engine": e})
        return report
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
