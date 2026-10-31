"""Prolog Titanium cost & price engine.

Reproduces the calculation chain of Prolog's FM-SAL-001 quotation workbook:
  supplier price sheets (Import / Import WFN / Domestic) -> freight allocation -> per-piece ROUNDUP
  labor rate table -> crew cost; machine-hour rate table -> part process cost; service/outsource/NDT lines
  -> quote buckets: ROUNDUP(base x (1 + OVH + Risk) / margin_divisor, -1)
  -> CES header price: ROUNDUP(sum x (1+OVH+Risk) / divisor, -2) less CES discount -> ROUNDUP(,-1)
Every computed value is recorded as a trace node (formula + numeric expression + input keys).
Missing inputs are reported as issues; they are never invented.
"""
from __future__ import annotations

import copy
import math
from dataclasses import dataclass, field, asdict
from typing import Any

from .numeric import roundup, eval_expr, ExprError, fmt

DEFAULT_SETTINGS = {
    "quote_currency": "USD",
    "fx_thb_per_usd": 33.47113,          # Ex-change rate THB per USD
    "fx_date": "",
    "thb_to_usd_factor": 0.9,            # TU = factor x FX  (THB / TU = USD) - conservative conversion
    "usd_to_thb_factor": 1.05,           # UT = factor x FX  (USD x UT = THB)
    "ovh_pct": 0.10,
    "risk_pct": 0.06,
    "margin_divisor": 0.75,              # price = cost x (1+OVH+Risk) / divisor  (25% gross margin)
    "item_round_digits": -1,             # quote item ROUNDUP digits (tens)
    "ces_round_digits": -2,              # CES total ROUNDUP digits (hundreds)
    "ces_discount_pct": 0.07,
    "quote_discount_pct": 0.10,
    "set_qty": 1,
    "header_price_mode": "ces",          # 'ces' (workbook E180 path) | 'sum_items' | 'manual'
    "header_price_manual": None,
    "gm_factor": 1.0,                    # material list price column: BZ (GM0%) / factor
}

DEFAULT_LABOR_PARAMS = {"salary_adj": 1.07, "days_per_month": 30, "hours_per_day": 8}
DEFAULT_MACHINE_PARAMS = {"hours_per_year": 1200, "dep_years": 5, "electricity_rate": 5, "operator_rate_id": None,
                          "operator_rate": None}


@dataclass
class Node:
    key: str
    label: str
    value: float | None
    unit: str = ""
    formula: str = ""
    expr: str = ""
    inputs: list[str] = field(default_factory=list)
    kind: str = "calc"         # 'input' | 'calc' | 'setting'
    source: str = ""           # provenance for inputs (supplier quote, drawing, engineer, AI suggestion ...)
    missing: bool = False


class Calc:
    def __init__(self):
        self.nodes: dict[str, Node] = {}
        self.issues: list[dict] = []

    def issue(self, severity: str, path: str, message: str, question: str | None = None):
        self.issues.append({"severity": severity, "path": path, "message": message,
                            "question": question or ""})

    def inp(self, key, label, raw, unit="", required=True, default=None, source="", path="", question=None,
            kind="input") -> float:
        missing = False
        try:
            v = eval_expr(raw)
        except ExprError as e:
            self.issue("error", path or key, f"{label}: {e}")
            v, missing = None, True
        if v is None:
            if required and default is None:
                missing = True
                self.issue("missing", path or key, f"{label} is missing",
                           question or f"Please provide: {label}")
            v = default if default is not None else 0.0
        expr = str(raw) if isinstance(raw, str) and raw.strip() not in ("", fmt(v)) else ""
        self.nodes[key] = Node(key, label, v, unit, "input" if not expr else f"= {raw}", expr, [], kind, source,
                               missing)
        return v

    def calc(self, key, label, value, formula, expr="", inputs=(), unit=""):
        self.nodes[key] = Node(key, label, value, unit, formula, expr, list(inputs), "calc")
        return value


def _num(c: Calc, key, label, raw, **kw):
    return c.inp(key, label, raw, **kw)


def compute(estimate: dict) -> dict:
    """Compute a full estimate. Returns dict(nodes, issues, results...). Pure function of the input."""
    est = copy.deepcopy(estimate or {})
    c = Calc()
    S = {**DEFAULT_SETTINGS, **(est.get("settings") or {})}

    # ---------------- settings ----------------
    fx = c.inp("set.fx", "Exchange rate THB per USD", S["fx_thb_per_usd"], "THB/USD", kind="setting",
               path="settings.fx_thb_per_usd")
    tuf = c.inp("set.tu_factor", "THB->USD conversion factor", S["thb_to_usd_factor"], "", kind="setting",
                path="settings.thb_to_usd_factor")
    utf = c.inp("set.ut_factor", "USD->THB conversion factor", S["usd_to_thb_factor"], "", kind="setting",
                path="settings.usd_to_thb_factor")
    TU = c.calc("set.TU", "THB per USD used for conversion (TU)", tuf * fx, "TU = factor x FX",
                f"{fmt(tuf)} x {fmt(fx)}", ["set.tu_factor", "set.fx"], "THB/USD")
    UT = c.calc("set.UT", "THB per USD for USD->THB (UT)", utf * fx, "UT = factor x FX",
                f"{fmt(utf)} x {fmt(fx)}", ["set.ut_factor", "set.fx"], "THB/USD")
    ovh = c.inp("set.ovh", "Overhead %", S["ovh_pct"], "%", kind="setting", path="settings.ovh_pct")
    risk = c.inp("set.risk", "Risk %", S["risk_pct"], "%", kind="setting", path="settings.risk_pct")
    div = c.inp("set.divisor", "Margin divisor (1 - gross margin)", S["margin_divisor"], "", kind="setting",
                path="settings.margin_divisor")
    if div <= 0:
        c.issue("error", "settings.margin_divisor", "Margin divisor must be > 0")
        div = 1.0
    item_digits = int(S["item_round_digits"])
    ces_digits = int(S["ces_round_digits"])
    qcur = S.get("quote_currency", "USD")

    def to_quote(amount: float, cur: str) -> tuple[float, str, list[str]]:
        cur = (cur or qcur).upper()
        if cur == qcur:
            return amount, "", []
        if cur == "THB" and qcur == "USD":
            return amount / TU, " / TU", ["set.TU"]
        if cur == "USD" and qcur == "THB":
            return amount * UT, " x UT", ["set.UT"]
        c.issue("error", "settings.quote_currency", f"No conversion from {cur} to {qcur}")
        return amount, "", []

    def to_thb(amount: float, cur: str) -> float:
        return amount if (cur or "THB").upper() == "THB" else amount * TU

    # ---------------- materials (density / list price) ----------------
    materials = {}
    for i, m in enumerate(est.get("materials") or []):
        code = str(m.get("code", "")).strip()
        materials[code] = m

    # ---------------- labor rates ----------------
    LP = {**DEFAULT_LABOR_PARAMS, **(est.get("labor_params") or {})}
    adj = c.inp("lab.adj", "Salary adjustment factor", LP["salary_adj"], kind="setting", path="labor_params.salary_adj")
    dpm = c.inp("lab.dpm", "Working days per month", LP["days_per_month"], "day", kind="setting",
                path="labor_params.days_per_month")
    hpd = c.inp("lab.hpd", "Hours per day", LP["hours_per_day"], "h", kind="setting", path="labor_params.hours_per_day")
    rates = {}
    rate_rows = []
    for i, r in enumerate(est.get("labor_rates") or []):
        rid = str(r.get("id") or f"r{i}")
        k = f"rate.{rid}"
        if r.get("hourly_rate") not in (None, ""):
            v = c.inp(k, f"Hourly rate {r.get('position','')}", r.get("hourly_rate"), "THB/h", path=f"labor_rates.{i}")
        else:
            sal = c.inp(k + ".salary", f"Monthly salary {r.get('position','')}", r.get("salary"), "THB/month",
                        path=f"labor_rates.{i}.salary", default=0.0 if r.get("salary") in (None, "") and r.get("optional") else None)
            v = c.calc(k, f"Hourly rate {r.get('position','')}", sal * adj / dpm / hpd,
                       "salary x adj / days / hours", f"{fmt(sal)} x {fmt(adj)} / {fmt(dpm)} / {fmt(hpd)}",
                       [k + ".salary", "lab.adj", "lab.dpm", "lab.hpd"], "THB/h")
        rates[rid] = v
        rate_rows.append({**r, "id": rid, "rate": v})

    # ---------------- crews ----------------
    crew_rows = []
    crews_total_thb = 0.0
    crew_keys = []
    for ci, cr in enumerate(est.get("crews") or []):
        cid = str(cr.get("id") or f"c{ci}")
        base = f"crew.{cid}"
        days = c.inp(base + ".days", f"{cr.get('name','Crew')}: working days", cr.get("days"), "day",
                     path=f"crews.{ci}.days")
        perdiem = c.inp(base + ".perdiem", f"{cr.get('name','Crew')}: per diem / person / day", cr.get("per_diem", 0),
                        "THB", path=f"crews.{ci}.per_diem", default=0.0)
        ot15 = c.inp(base + ".ot15", "OT x1.5 hours / day", cr.get("ot15_hours", 0), "h", default=0.0)
        ot3 = c.inp(base + ".ot3", "OT x3 hours / day", cr.get("ot3_hours", 0), "h", default=0.0)
        conf = c.inp(base + ".conf", "Confined-space premium %", cr.get("confined_pct", 0), "%", default=0.0)
        members = []
        day_keys = []
        day_sum = 0.0
        for mi, m in enumerate(cr.get("members") or []):
            mk = f"{base}.m{mi}"
            persons = c.inp(mk + ".persons", f"{m.get('role','')}: persons", m.get("persons"), "person",
                            path=f"crews.{ci}.members.{mi}.persons", default=0.0 if m.get("persons") in (None, "") else None)
            rid = str(m.get("rate_id") or "")
            if rid not in rates:
                if persons:
                    c.issue("missing", f"crews.{ci}.members.{mi}.rate_id",
                            f"Crew role '{m.get('role')}' has no valid labor rate", "Select the labor rate for this role")
                B = 0.0
            else:
                B = rates[rid]
            C = B * hpd
            F = B * 1.5 * ot15
            G = B * 3 * ot3
            H = C * conf
            J = C * persons + H + persons * perdiem + F * persons + G * persons
            c.calc(mk, f"{m.get('role','')} cost / day", J,
                   "rate x hours/day x persons + premium + persons x per diem + OT",
                   f"{fmt(B)} x {fmt(hpd)} x {fmt(persons)} + {fmt(H)} + {fmt(persons)} x {fmt(perdiem)} + {fmt(F)} x {fmt(persons)} + {fmt(G)} x {fmt(persons)}",
                   ([f"rate.{rid}"] if rid in rates else []) + ["lab.hpd", mk + ".persons", base + ".perdiem", base + ".ot15", base + ".ot3",
                    base + ".conf"], "THB/day")
            day_keys.append(mk)
            day_sum += J
            members.append({**m, "rate": B, "day_rate": C, "cost_per_day": J})
        extras = 0.0
        crew_persons = sum(m["persons"] if isinstance(m.get("persons"), (int, float)) else (eval_expr(m.get("persons")) or 0)
                           for m in (cr.get("members") or []))
        for xi, x in enumerate(cr.get("extras_per_day") or []):
            xk = f"{base}.x{xi}"
            amt = c.inp(xk + ".amt", f"{x.get('name','Extra')} rate", x.get("amount"), "THB",
                        path=f"crews.{ci}.extras_per_day.{xi}.amount")
            if x.get("basis") == "per_person":
                per = eval_expr(x.get("persons_per_unit")) or 1.0
                xv = c.calc(xk, f"{x.get('name','Extra')} / day", amt * crew_persons / per,
                            "rate x persons / persons per unit", f"{fmt(amt)} x {fmt(crew_persons)} / {fmt(per)}",
                            [xk + ".amt"], "THB/day")
            else:
                xv = c.calc(xk, f"{x.get('name','Extra')} / day", amt, "fixed per day", fmt(amt), [xk + ".amt"], "THB/day")
            extras += xv
            day_keys.append(xk)
        per_day = c.calc(base + ".per_day", f"{cr.get('name','Crew')} cost per day", day_sum + extras,
                         "SUM(member cost/day) + extras", " + ".join(fmt(c.nodes[k].value) for k in day_keys) or "0",
                         day_keys, "THB/day")
        total = c.calc(base + ".total", f"{cr.get('name','Crew')} total", per_day * days, "cost/day x days",
                       f"{fmt(per_day)} x {fmt(days)}", [base + ".per_day", base + ".days"], "THB")
        crews_total_thb += total
        crew_keys.append(base + ".total")
        crew_rows.append({**cr, "id": cid, "members": members, "per_day": per_day, "total_thb": total,
                          "persons": sum((eval_expr(m.get("persons")) or 0) for m in cr.get("members") or [])})
    c.calc("crews.total", "Total crew labor cost", crews_total_thb, "SUM(crew totals)",
           " + ".join(fmt(c.nodes[k].value) for k in crew_keys) or "0", crew_keys, "THB")

    # ---------------- machine-hour rates ----------------
    MP = {**DEFAULT_MACHINE_PARAMS, **(est.get("machine_params") or {})}
    hy = c.inp("mach.hy", "Machine hours per year", MP["hours_per_year"], "h", kind="setting")
    dy = c.inp("mach.dy", "Depreciation years", MP["dep_years"], "yr", kind="setting")
    el = c.inp("mach.el", "Electricity rate", MP["electricity_rate"], "THB/kWh", kind="setting")
    if MP.get("operator_rate_id") and str(MP["operator_rate_id"]) in rates:
        op = rates[str(MP["operator_rate_id"])]
        c.calc("mach.op", "Machine operator rate", op, "= labor rate", fmt(op), [f"rate.{MP['operator_rate_id']}"], "THB/h")
    else:
        op = c.inp("mach.op", "Machine operator rate", MP.get("operator_rate"), "THB/h",
                   path="machine_params.operator_rate", required=bool(est.get("machines")), default=None if est.get("machines") else 0.0)
    machines = {}
    mach_rows = []
    for i, m in enumerate(est.get("machines") or []):
        name = str(m.get("name", "")).strip()
        mk = f"mach.{i}"
        if m.get("price") in (None, "") and m.get("rate_override") in (None, ""):
            machines[name] = 0.0      # e.g. "Outsource": no in-house rate
            c.calc(mk, f"Rate {name}", 0.0, "no machine price (outsourced)", "0", [], "THB/h")
            mach_rows.append({**m, "rate": 0.0})
            continue
        if m.get("rate_override") not in (None, ""):
            v = c.inp(mk, f"Rate {name}", m.get("rate_override"), "THB/h", source="manual override")
        else:
            price = c.inp(mk + ".price", f"{name}: machine price", m.get("price"), "THB", path=f"machines.{i}.price")
            kwh = c.inp(mk + ".kwh", f"{name}: power", m.get("kwh"), "kWh/h", default=0.0)
            cr_ = c.inp(mk + ".cons", f"{name}: consumables ratio / yr", m.get("consumable_ratio"), "",
                        path=f"machines.{i}.consumable_ratio")
            dep = price / hy / dy
            cons = price * cr_ / hy
            elec = kwh * el
            raw = dep + cons + elec + op
            v = c.calc(mk, f"Rate {name}", roundup(raw, 0),
                       "ROUNDUP(price/hours/yrs + price x cons/hours + kWh x elec + operator, 0)",
                       f"ROUNDUP({fmt(dep)} + {fmt(cons)} + {fmt(elec)} + {fmt(op)}, 0)",
                       [mk + ".price", "mach.hy", "mach.dy", mk + ".cons", mk + ".kwh", "mach.el", "mach.op"], "THB/h")
        machines[name] = v
        mach_rows.append({**m, "rate": v})

    # ---------------- parts (CES rows) ----------------
    part_rows = []
    parts_mat_thb = 0.0
    parts_mach_thb = 0.0
    pm_keys, pmach_keys = [], []
    for i, p in enumerate(est.get("parts") or []):
        pk = f"part.{p.get('id') or i}"
        label = p.get("name") or f"Part {i+1}"
        grade = str(p.get("grade_code") or "").strip()
        mat = materials.get(grade) or materials.get(grade[:2]) or {}
        pricing = p.get("pricing", "price_sheet")   # 'by_weight' or 'price_sheet' (bought via supplier sheet)
        qty = c.inp(pk + ".qty", f"{label}: qty / set", p.get("qty"), "pcs", path=f"parts.{i}.qty")
        shape = p.get("shape") or mat.get("shape") or "TWL"
        dens = eval_expr(p.get("density")) if p.get("density") not in (None, "") else eval_expr(mat.get("density"))
        s1, s2, s3 = (eval_expr(p.get(k)) for k in ("s1", "s2", "s3"))
        weight = None
        if pricing == "by_weight" or any(v is not None for v in (s1, s2, s3)):
            need = {"TWL": (s1, s2, s3), "DiaL": (s1, s2), "ODTL": (s1, s2, s3)}.get(shape, (s1, s2, s3))
            if dens is None or any(v is None for v in need):
                if pricing == "by_weight":
                    c.issue("missing", f"parts.{i}", f"{label}: dimensions/density incomplete for weight",
                            f"Provide {shape} dimensions for '{label}' (Size1/Size2/Size3 mm) and material grade")
            else:
                if shape == "TWL":
                    weight = s1 * s2 / 1000 * s3 / 1000 * dens
                    f_ = "T x W/1000 x L/1000 x density"
                    e_ = f"{fmt(s1)} x {fmt(s2)}/1000 x {fmt(s3)}/1000 x {fmt(dens)}"
                elif shape == "DiaL":
                    weight = math.pi / 4 * (s1 / 1000) ** 2 * s2 * dens
                    f_ = "pi/4 x (Dia/1000)^2 x L x density"
                    e_ = f"pi/4 x ({fmt(s1)}/1000)^2 x {fmt(s2)} x {fmt(dens)}"
                else:
                    weight = (math.pi / 4 * (s1 / 1000) ** 2 - math.pi / 4 * ((s1 - 2 * s2) / 1000) ** 2) * s3 * dens
                    f_ = "(pi/4 x (OD/1000)^2 - pi/4 x ((OD-2t)/1000)^2) x L x density"
                    e_ = f"(pi/4 x ({fmt(s1)}/1000)^2 - pi/4 x (({fmt(s1)}-2x{fmt(s2)})/1000)^2) x {fmt(s3)} x {fmt(dens)}"
                c.calc(pk + ".weight", f"{label}: weight / pc", weight, f_, e_, [], "kg")
        mat_cost = 0.0
        if pricing == "by_weight":
            up_raw = p.get("unit_price_thb_kg")
            if up_raw in (None, ""):
                base_price = eval_expr(mat.get("thb_per_kg"))
                up = (base_price / float(S.get("gm_factor") or 1)) if base_price else None
                src = f"material list {grade}"
            else:
                up, src = eval_expr(up_raw), p.get("price_source", "engineer")
            if not up:
                c.issue("missing", f"parts.{i}.unit_price_thb_kg", f"{label}: no THB/kg price for grade '{grade}'",
                        f"Provide a verified THB/kg price for {grade or 'this material'}")
                up = 0.0
            c.inp(pk + ".up", f"{label}: unit price", up, "THB/kg", source=src)
            disc = c.inp(pk + ".disc", f"{label}: discount %", p.get("discount_pct", 0), "%", default=0.0)
            if weight is not None:
                mat_cost = weight * up * (100 - disc) / 100 * qty
                c.calc(pk + ".mat", f"{label}: material cost", mat_cost, "weight x price x (100-disc)/100 x qty",
                       f"{fmt(weight)} x {fmt(up)} x (100-{fmt(disc)})/100 x {fmt(qty)}",
                       [pk + ".weight", pk + ".up", pk + ".disc", pk + ".qty"], "THB")
                pm_keys.append(pk + ".mat")
        parts_mat_thb += mat_cost
        proc_total = 0.0
        procs = []
        pkeys = []
        for j, pr in enumerate(p.get("processes") or []):
            mname = str(pr.get("machine", "")).strip()
            if not mname:
                continue
            outsourced = mname in machines and machines[mname] == 0.0
            hrs = c.inp(f"{pk}.p{j}.h", f"{label}: {mname} hours", pr.get("hours"), "h",
                        path=f"parts.{i}.processes.{j}.hours", default=0.0 if outsourced else None)
            if mname not in machines:
                c.issue("missing", f"parts.{i}.processes.{j}", f"Machine '{mname}' not in machine-rate table",
                        f"Add a machine-hour rate for '{mname}'")
                rate = 0.0
            else:
                rate = machines[mname]
            mi = next((ii for ii, mm in enumerate(est.get("machines") or []) if str(mm.get('name', '')).strip() == mname), None)
            amt = c.calc(f"{pk}.p{j}", f"{label}: {mname}", rate * hrs, "rate x hours", f"{fmt(rate)} x {fmt(hrs)}",
                         ([f"mach.{mi}"] if mi is not None else []) + [f"{pk}.p{j}.h"], "THB")
            proc_total += amt
            pkeys.append(f"{pk}.p{j}")
            procs.append({**pr, "rate": rate, "amount": amt})
        mult = eval_expr(p.get("machine_multiplier")) if p.get("machine_multiplier") not in (None, "") else 1.0
        mach_cost = proc_total * mult
        if pkeys:
            c.calc(pk + ".mach", f"{label}: machine cost", mach_cost, "SUM(process) x multiplier",
                   f"({' + '.join(fmt(c.nodes[k].value) for k in pkeys)}) x {fmt(mult)}", pkeys, "THB")
            pmach_keys.append(pk + ".mach")
        parts_mach_thb += mach_cost
        part_rows.append({**p, "weight": weight, "density": dens, "material_cost_thb": mat_cost,
                          "machine_cost_thb": mach_cost, "processes": procs,
                          "total_weight": (weight or 0) * qty})
    c.calc("parts.material", "Parts material cost (by weight)", parts_mat_thb, "SUM(part material)",
           " + ".join(fmt(c.nodes[k].value) for k in pm_keys) or "0", pm_keys, "THB")
    c.calc("parts.machine", "Machine process cost", parts_mach_thb, "SUM(part machine cost)",
           " + ".join(fmt(c.nodes[k].value) for k in pmach_keys) or "0", pmach_keys, "THB")

    # ---------------- services / outsource / NDT / finishing ----------------
    svc_rows = []
    svc_thb = 0.0
    svc_keys = []
    for i, s in enumerate(est.get("services") or []):
        sk = f"svc.{s.get('id') or i}"
        name = s.get("name") or s.get("group") or f"Service {i+1}"
        cur = (s.get("currency") or "THB").upper()
        if s.get("rate") not in (None, ""):
            rate = c.inp(sk + ".rate", f"{name}: rate", s.get("rate"), f"{cur}/{s.get('unit','unit')}", path=f"services.{i}.rate")
            q = c.inp(sk + ".qty", f"{name}: quantity", s.get("qty"), s.get("unit", ""), path=f"services.{i}.qty")
            mn = c.inp(sk + ".min", f"{name}: minimum charge", s.get("minimum", 0), cur, default=0.0)
            amt = max(rate * q, mn)
            c.calc(sk, name, amt, "MAX(rate x qty, minimum)", f"MAX({fmt(rate)} x {fmt(q)}, {fmt(mn)})",
                   [sk + ".rate", sk + ".qty", sk + ".min"], cur)
        else:
            amt = c.inp(sk, name, s.get("amount"), cur, path=f"services.{i}.amount",
                        source=s.get("source", ""), default=0.0 if s.get("optional") else None)
        amt_thb = to_thb(amt, cur)
        svc_thb += amt_thb
        svc_keys.append(sk)
        svc_rows.append({**s, "amount": amt, "amount_thb": amt_thb})
    c.calc("svc.total", "Total services / outsource / NDT", svc_thb, "SUM(services)",
           " + ".join(fmt(c.nodes[k].value) for k in svc_keys) or "0", svc_keys, "THB")

    # ---------------- supplier price sheets ----------------
    sheets = {}
    sheet_rows = []
    for si, sh in enumerate(est.get("price_sheets") or []):
        sid = str(sh.get("id") or f"s{si}")
        base = f"ps.{sid}"
        cur = (sh.get("currency") or "USD").upper()
        digits = int(sh.get("round_digits", -1))
        tax = c.inp(base + ".tax", f"{sh.get('name')}: tax %", sh.get("tax_pct", 0), "%", default=0.0)
        mdiv = c.inp(base + ".mdiv", f"{sh.get('name')}: margin divisor", sh.get("margin_divisor", 1), default=1.0)
        exch = c.inp(base + ".exch", f"{sh.get('name')}: line exchange factor", sh.get("exchange", 1), default=1.0)
        lines = []
        for li, ln in enumerate(sh.get("lines") or []):
            lk = f"{base}.l{li}"
            desc = ln.get("description") or f"line {li+1}"
            F = c.inp(lk + ".qty", f"{desc}: qty", ln.get("qty"), "pcs", path=f"price_sheets.{si}.lines.{li}.qty")
            H = c.inp(lk + ".up", f"{desc}: supplier unit price", ln.get("unit_price"), f"{cur}/pc",
                      path=f"price_sheets.{si}.lines.{li}.unit_price", source=ln.get("price_source", ""),
                      question=f"Supplier price needed for '{desc}' ({sh.get('name')})")
            J = F * H
            L = exch * J
            M = L * tax
            N = L / mdiv if mdiv else 0.0
            lines.append({"F": F, "H": H, "J": J, "L": L, "M": M, "N": N, "lk": lk, "desc": desc, "src": ln})
        n_total = sum(x["N"] for x in lines)
        c.calc(base + ".N", f"{sh.get('name')}: material cost", n_total, "SUM(qty x unit price x exch / margin)",
               " + ".join(fmt(x["N"]) for x in lines) or "0", [x["lk"] + ".up" for x in lines], cur)
        fr_total = 0.0
        fr_keys = []
        for fi, fr in enumerate(sh.get("freight") or []):
            fk = f"{base}.f{fi}"
            fcur = (fr.get("currency") or cur).upper()
            amt = c.inp(fk + ".amt", f"{sh.get('name')}: {fr.get('label','freight')}", fr.get("amount"), fcur,
                        path=f"price_sheets.{si}.freight.{fi}.amount", default=0.0 if fr.get("amount") in (None, "") and fr.get("optional") else None)
            if fcur == cur:
                conv, cexpr, ckeys = amt, fmt(amt), []
            elif fcur == "THB" and cur == "USD":
                conv, cexpr, ckeys = amt / TU, f"{fmt(amt)} / {fmt(TU)}", ["set.TU"]
            elif fcur == "USD" and cur == "THB":
                conv, cexpr, ckeys = amt * TU, f"{fmt(amt)} x {fmt(TU)}", ["set.TU"]
            else:
                conv, cexpr, ckeys = amt, fmt(amt), []
            c.calc(fk, f"{sh.get('name')}: {fr.get('label','freight')} ({cur})", conv, f"amount in {cur}", cexpr,
                   [fk + ".amt"] + ckeys, cur)
            fr_total += conv
            fr_keys.append(fk)
        grand = c.calc(base + ".grand", f"{sh.get('name')}: material + freight", n_total + fr_total,
                       "material cost + freight", f"{fmt(n_total)} + {fmt(fr_total)}", [base + ".N"] + fr_keys, cur)
        s_total = 0.0
        out_lines = []
        s_keys = []
        for x in lines:
            lk = x["lk"]
            O = x["N"] / n_total * grand if n_total else 0.0
            P = O + x["M"]
            per = P / x["F"] if x["F"] else 0.0
            R = roundup(per, digits)
            Sv = R * x["F"]
            c.calc(lk + ".R", f"{x['desc']}: selling price / pc", R,
                   f"ROUNDUP((cost x (material+freight)/material + tax) / qty, {digits})",
                   f"ROUNDUP(({fmt(x['N'])} x {fmt(grand)} / {fmt(n_total)} + {fmt(x['M'])}) / {fmt(x['F'])}, {digits})",
                   [lk + ".up", lk + ".qty", base + ".grand", base + ".N", base + ".tax"], f"{cur}/pc")
            c.calc(lk + ".S", f"{x['desc']}: amount", Sv, "price/pc x qty", f"{fmt(R)} x {fmt(x['F'])}",
                   [lk + ".R", lk + ".qty"], cur)
            s_keys.append(lk + ".S")
            s_total += Sv
            ln = x["src"]
            w = eval_expr(ln.get("unit_weight")) if ln.get("unit_weight") not in (None, "") else None
            out_lines.append({**ln, "qty_v": x["F"], "unit_price_v": x["H"], "cost": x["J"], "allocated": O,
                              "selling_unit": R, "amount": Sv, "unit_weight_v": w,
                              "weight_total": (w or 0) * x["F"]})
        c.calc(base + ".total", f"{sh.get('name')}: total", s_total, "SUM(line amounts)",
               " + ".join(fmt(c.nodes[k].value) for k in s_keys) or "0", s_keys, cur)
        sheets[sid] = {"total": s_total, "currency": cur}
        sheet_rows.append({**sh, "id": sid, "lines": out_lines, "material_cost": n_total, "freight_total": fr_total,
                           "grand": grand, "total": s_total})

    # ---------------- quote buckets ----------------
    src_cache: dict[str, tuple[float, str, str, list[str]]] = {}

    def source_value(src: dict, bkey: str, si: int) -> tuple[float, str, list[str]]:
        t = src.get("type")
        if t == "price_sheet":
            sid = str(src.get("id"))
            if sid not in sheets:
                c.issue("error", bkey, f"Unknown price sheet '{sid}'")
                return 0.0, "0", []
            v, e, k = to_quote(sheets[sid]["total"], sheets[sid]["currency"])
            return v, f"{fmt(sheets[sid]['total'])}{e}", [f"ps.{sid}.total"] + k
        if t in ("services", "crews", "machines", "parts_material"):
            key = {"services": "svc.total", "crews": "crews.total", "machines": "parts.machine",
                   "parts_material": "parts.material"}[t]
            v, e, k = to_quote(c.nodes[key].value, "THB")
            return v, f"{fmt(c.nodes[key].value)}{e}", [key] + k
        if t == "fixed":
            fk = f"{bkey}.fixed{si}"
            amt = c.inp(fk, src.get("label") or "Fixed amount", src.get("amount"), src.get("currency", qcur))
            v, e, k = to_quote(amt, src.get("currency", qcur))
            return v, f"{fmt(amt)}{e}", [fk] + k
        c.issue("error", bkey, f"Unknown source type '{t}'")
        return 0.0, "0", []

    items = []
    used_sources = set()
    ces_dm, ces_dl1, ces_dl2 = 0.0, 0.0, 0.0
    dm_keys, dl1_keys, dl2_keys = [], [], []
    for bi, b in enumerate(est.get("buckets") or []):
        bk = f"item.{b.get('no', bi + 1)}"
        parts_, exprs, keys = [], [], []
        for si, src in enumerate(b.get("sources") or []):
            v, e, k = source_value(src, bk, si)
            parts_.append(v)
            exprs.append(e)
            keys += k
            sig = (src.get("type"), str(src.get("id", "")))
            if src.get("type") != "fixed":
                if sig in used_sources:
                    c.issue("warning", bk, f"Source {sig} is counted in more than one quote item")
                used_sources.add(sig)
                if src.get("type") in ("price_sheet", "parts_material"):
                    ces_dm += v; dm_keys.append(bk + ".base")
                elif src.get("type") in ("services", "crews"):
                    ces_dl1 += v; dl1_keys.append(bk + ".base")
                elif src.get("type") == "machines":
                    ces_dl2 += v; dl2_keys.append(bk + ".base")
        base_v = c.calc(bk + ".base", f"Item {b.get('no')} {b.get('heading','')}: cost base", sum(parts_),
                        "SUM(sources)", " + ".join(exprs) or "0", keys, qcur)
        markup = b.get("markup", True)
        qty = c.inp(bk + ".qty", f"Item {b.get('no')}: quantity", b.get("qty", 1), b.get("unit", ""), default=1.0)
        if markup:
            calc_price = roundup(base_v * (1 + ovh + risk) / div, item_digits)
            c.calc(bk + ".calc_price", f"Item {b.get('no')}: calculated unit price", calc_price,
                   f"ROUNDUP(base x (1 + OVH + Risk) / divisor, {item_digits})",
                   f"ROUNDUP({fmt(base_v)} x (1 + {fmt(ovh)} + {fmt(risk)}) / {fmt(div)}, {item_digits})",
                   [bk + ".base", "set.ovh", "set.risk", "set.divisor"], qcur)
        else:
            calc_price = roundup(base_v, item_digits)
            c.calc(bk + ".calc_price", f"Item {b.get('no')}: calculated unit price", calc_price,
                   f"ROUNDUP(base, {item_digits})  (no markup)", f"ROUNDUP({fmt(base_v)}, {item_digits})",
                   [bk + ".base"], qcur)
        price = calc_price
        if b.get("override_price") not in (None, ""):
            price = c.inp(bk + ".override", f"Item {b.get('no')}: manual price override", b.get("override_price"), qcur,
                          source=b.get("override_reason") or "manual")
            if not b.get("override_reason"):
                c.issue("warning", f"buckets.{bi}.override_reason", f"Item {b.get('no')} price overridden without a reason",
                        "State the reason for the manual price override")
        c.calc(bk + ".price", f"Item {b.get('no')}: unit price", price, "calculated price" if price == calc_price else "manual override",
               fmt(price), [bk + (".calc_price" if price == calc_price else ".override")], qcur)
        total = c.calc(bk + ".total", f"Item {b.get('no')}: total", price * qty, "unit price x qty",
                       f"{fmt(price)} x {fmt(qty)}", [bk + ".price", bk + ".qty"], qcur)
        if base_v == 0 and b.get("sources"):
            c.issue("warning", f"buckets.{bi}", f"Item {b.get('no')} '{b.get('heading')}' has zero cost base")
        items.append({"no": b.get("no", bi + 1), "heading": b.get("heading", ""), "unit": b.get("unit", "Lot."),
                      "qty": qty, "base": base_v, "calc_price": calc_price, "unit_price": price, "total": total,
                      "markup": markup, "overridden": price != calc_price,
                      "margin": (price * qty - base_v * qty) / (price * qty) if price else None})

    # unused cost sources -> warn (cost would silently not be priced)
    if sheets:
        for sid in sheets:
            if ("price_sheet", sid) not in used_sources and sheets[sid]["total"]:
                c.issue("warning", f"price_sheets.{sid}", f"Price sheet '{sid}' total is not assigned to any quote item")
    for t, key in (("services", "svc.total"), ("crews", "crews.total"), ("machines", "parts.machine"),
                   ("parts_material", "parts.material")):
        if c.nodes[key].value and (t, "") not in used_sources:
            c.issue("warning", key, f"{c.nodes[key].label} is not assigned to any quote item")

    keys_items = [f"item.{it['no']}.total" for it in items]
    total = c.calc("totals.total", "Total price", sum(it["total"] for it in items), "SUM(item totals)",
                   " + ".join(fmt(it["total"]) for it in items) or "0", keys_items, qcur)
    dpct = c.inp("set.qdisc", "Quotation discount %", S["quote_discount_pct"], "%", kind="setting", default=0.0)
    disc = c.calc("totals.discount", "Discount", total * dpct, "total x discount %", f"{fmt(total)} x {fmt(dpct)}",
                  ["totals.total", "set.qdisc"], qcur)
    net = c.calc("totals.net", "Net total price", total - disc, "total - discount", f"{fmt(total)} - {fmt(disc)}",
                 ["totals.total", "totals.discount"], qcur)

    # ---------------- CES (cost estimate sheet) header price ----------------
    dm = c.calc("ces.dm", "Total material cost (DM)", ces_dm, "SUM(material sources)", fmt(ces_dm), dm_keys, qcur)
    dl1 = c.calc("ces.dl1", "Total labor cost (DL1)", ces_dl1, "SUM(services + crews)", fmt(ces_dl1), dl1_keys, qcur)
    dl2 = c.calc("ces.dl2", "Total machine cost (DL2)", ces_dl2, "SUM(machine cost)", fmt(ces_dl2), dl2_keys, qcur)
    direct = c.calc("ces.direct", "Direct cost (DM + DL)", dm + dl1 + dl2, "DM + DL1 + DL2",
                    f"{fmt(dm)} + {fmt(dl1)} + {fmt(dl2)}", ["ces.dm", "ces.dl1", "ces.dl2"], qcur)
    c_ovh = c.calc("ces.ovh", "Overhead", direct * ovh, "direct x OVH%", f"{fmt(direct)} x {fmt(ovh)}",
                   ["ces.direct", "set.ovh"], qcur)
    c_risk = c.calc("ces.risk", "Risk", direct * risk, "direct x Risk%", f"{fmt(direct)} x {fmt(risk)}",
                    ["ces.direct", "set.risk"], qcur)
    full = c.calc("ces.full", "Full cost (incl. OVH & Risk)", direct + c_ovh + c_risk, "direct + OVH + Risk",
                  f"{fmt(direct)} + {fmt(c_ovh)} + {fmt(c_risk)}", ["ces.direct", "ces.ovh", "ces.risk"], qcur)
    ces_price = c.calc("ces.price", "CES total price", roundup(full / div, ces_digits),
                       f"ROUNDUP(full cost / divisor, {ces_digits})", f"ROUNDUP({fmt(full)} / {fmt(div)}, {ces_digits})",
                       ["ces.full", "set.divisor"], qcur)
    cdisc = c.inp("set.cesdisc", "CES discount %", S["ces_discount_pct"], "%", kind="setting", default=0.0)
    setq = c.inp("set.setqty", "Set quantity", S["set_qty"], "set", kind="setting", default=1.0)
    ces_net = c.calc("ces.net", "CES net price", (ces_price - ces_price * cdisc) * setq, "(price - price x disc) x qty",
                     f"({fmt(ces_price)} - {fmt(ces_price)} x {fmt(cdisc)}) x {fmt(setq)}",
                     ["ces.price", "set.cesdisc", "set.setqty"], qcur)
    mode = S.get("header_price_mode", "ces")
    if mode == "sum_items":
        hp = c.calc("header.price", "Product line price (per set)", total, "= total price", fmt(total), ["totals.total"], qcur)
    elif mode == "manual":
        hp = c.inp("header.price", "Product line price (per set)", S.get("header_price_manual"), qcur, source="manual")
    else:
        hp = c.calc("header.price", "Product line price (per set)", roundup(ces_net, item_digits),
                    f"ROUNDUP(CES net, {item_digits})", f"ROUNDUP({fmt(ces_net)}, {item_digits})", ["ces.net"], qcur)
    gross_margin = (net - direct) / net if net else None

    # weights summary
    ti_weight = sum(l["weight_total"] for sh in sheet_rows for l in sh["lines"])
    parts_weight = sum(p["total_weight"] for p in part_rows)

    return {
        "nodes": {k: asdict(v) for k, v in c.nodes.items()},
        "issues": c.issues,
        "settings": S,
        "TU": TU, "UT": UT,
        "labor_rates": rate_rows, "crews": crew_rows, "machines": mach_rows, "parts": part_rows,
        "services": svc_rows, "price_sheets": sheet_rows,
        "items": items,
        "totals": {"total": total, "discount_pct": dpct, "discount": disc, "net": net, "header_price": hp,
                   "currency": qcur},
        "ces": {"dm": dm, "dl1": dl1, "dl2": dl2, "direct": direct, "ovh": c_ovh, "risk": c_risk, "full": full,
                "price": ces_price, "discount_pct": cdisc, "net": ces_net,
                "gross_margin_on_net": gross_margin},
        "summary_thb": {"crews": crews_total_thb, "services": svc_thb, "machines": parts_mach_thb,
                        "parts_material": parts_mat_thb},
        "weights": {"price_sheet_kg": ti_weight, "parts_kg": parts_weight},
        "missing_count": sum(1 for i in c.issues if i["severity"] == "missing"),
    }


def trace(result: dict, key: str, depth: int = 6) -> dict:
    """Expand a node into its dependency tree (for the UI's 'explain this number')."""
    nodes = result["nodes"]

    def rec(k, d):
        n = nodes.get(k)
        if not n:
            return {"key": k, "label": "(unknown)", "value": None}
        out = {kk: n[kk] for kk in ("key", "label", "value", "unit", "formula", "expr", "kind", "source", "missing")}
        out["children"] = [rec(ch, d - 1) for ch in n["inputs"]] if d > 0 else []
        return out

    return rec(key, depth)
