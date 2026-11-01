// Prolog Titanium cost engine — JavaScript port of backend/app/calc/engine.py (same formulas, same traces).
(function (root) {
  "use strict";
  function excel15(x) { return Number(Number(x).toPrecision(15)); }
  function roundup(x, digits) {
    const d = Math.trunc(digits || 0);
    const v = excel15(x);
    const f = Math.pow(10, -d);
    let n = excel15(v / f);
    n = v >= 0 ? Math.ceil(n) : Math.floor(n);
    return d <= 0 ? n * f : Number((n * f).toFixed(d));
  }
  function evalExpr(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "boolean") throw new Error("boolean is not a number");
    if (typeof value === "number") { if (!isFinite(value)) throw new Error("not a finite number"); return value; }
    let s = String(value).trim().replace(/,/g, "");
    if (s === "") return null;
    if (s[0] === "=") s = s.slice(1);
    if (!/^[0-9+\-*/().\s eEpiPI]*$/.test(s)) throw new Error("invalid expression '" + value + "'");
    // tiny recursive-descent parser (no eval)
    let i = 0;
    const peek = () => s[i], skip = () => { while (s[i] === " ") i++; };
    function num() {
      skip();
      if (s.slice(i, i + 2).toLowerCase() === "pi") { i += 2; return Math.PI; }
      const m = /^[0-9]*\.?[0-9]+(e[+-]?[0-9]+)?/i.exec(s.slice(i));
      if (!m) throw new Error("invalid expression '" + value + "'");
      i += m[0].length; return parseFloat(m[0]);
    }
    function factor() {
      skip();
      if (peek() === "-") { i++; return -factor(); }
      if (peek() === "+") { i++; return factor(); }
      if (peek() === "(") { i++; const v = expr(); skip(); if (s[i] !== ")") throw new Error("invalid expression '" + value + "'"); i++; return v; }
      return num();
    }
    function power() { let b = factor(); skip(); if (s.slice(i, i + 2) === "**") { i += 2; return Math.pow(b, power()); } return b; }
    function term() { let v = power(); for (;;) { skip(); const c = peek(); if (c === "*" && s[i + 1] !== "*") { i++; v *= power(); } else if (c === "/") { i++; const d = power(); if (d === 0) throw new Error("division by zero in '" + value + "'"); v /= d; } else return v; } }
    function expr() { let v = term(); for (;;) { skip(); const c = peek(); if (c === "+") { i++; v += term(); } else if (c === "-") { i++; v -= term(); } else return v; } }
    const out = expr(); skip();
    if (i !== s.length) throw new Error("invalid expression '" + value + "'");
    return out;
  }
  function fmt(x, nd) {
    if (x === null || x === undefined) return "—";
    nd = nd === undefined ? 4 : nd;
    if (Math.abs(x - Math.round(x)) < 1e-9) return Math.round(x).toLocaleString("en-US");
    return x.toLocaleString("en-US", { maximumFractionDigits: nd });
  }
  const DEFAULT_SETTINGS = { quote_currency: "USD", fx_thb_per_usd: 33.47113, thb_to_usd_factor: 0.9, usd_to_thb_factor: 1.05,
    ovh_pct: 0.10, risk_pct: 0.06, margin_divisor: 0.75, item_round_digits: -1, ces_round_digits: -2, ces_discount_pct: 0.07,
    quote_discount_pct: 0.10, set_qty: 1, header_price_mode: "ces", header_price_manual: null, gm_factor: 1.0 };

  function compute(estimate) {
    const est = JSON.parse(JSON.stringify(estimate || {}));
    const nodes = {}, issues = [];
    const issue = (severity, path, message, question) => issues.push({ severity, path, message, question: question || "" });
    function inp(key, label, raw, unit, o) {
      o = o || {};
      const required = o.required !== false;
      let v, missing = false;
      try { v = evalExpr(raw); } catch (e) { issue("error", o.path || key, label + ": " + e.message); v = null; missing = true; }
      if (v === null) {
        if (required && (o.default === undefined || o.default === null)) {
          missing = true;
          issue("missing", o.path || key, label + " is missing", o.question || ("Please provide: " + label));
        }
        v = (o.default !== undefined && o.default !== null) ? o.default : 0;
      }
      const expr = (typeof raw === "string" && raw.trim() !== "" && raw.trim() !== fmt(v)) ? String(raw) : "";
      nodes[key] = { key, label, value: v, unit: unit || "", formula: expr ? "= " + raw : "input", expr, inputs: [],
        kind: o.kind || "input", source: o.source || "", missing };
      return v;
    }
    function calc(key, label, value, formula, expr, inputs, unit) {
      nodes[key] = { key, label, value, unit: unit || "", formula, expr: expr || "", inputs: inputs || [], kind: "calc", source: "", missing: false };
      return value;
    }
    const S = Object.assign({}, DEFAULT_SETTINGS, est.settings || {});
    const fx = inp("set.fx", "Exchange rate THB per USD", S.fx_thb_per_usd, "THB/USD", { kind: "setting", path: "settings.fx_thb_per_usd" });
    const tuf = inp("set.tu_factor", "THB->USD conversion factor", S.thb_to_usd_factor, "", { kind: "setting", path: "settings.thb_to_usd_factor" });
    const utf = inp("set.ut_factor", "USD->THB conversion factor", S.usd_to_thb_factor, "", { kind: "setting", path: "settings.usd_to_thb_factor" });
    const TU = calc("set.TU", "THB per USD used for conversion (TU)", tuf * fx, "TU = factor x FX", fmt(tuf) + " x " + fmt(fx), ["set.tu_factor", "set.fx"], "THB/USD");
    const UT = calc("set.UT", "THB per USD for USD->THB (UT)", utf * fx, "UT = factor x FX", fmt(utf) + " x " + fmt(fx), ["set.ut_factor", "set.fx"], "THB/USD");
    const ovh = inp("set.ovh", "Overhead %", S.ovh_pct, "%", { kind: "setting", path: "settings.ovh_pct" });
    const risk = inp("set.risk", "Risk %", S.risk_pct, "%", { kind: "setting", path: "settings.risk_pct" });
    let div = inp("set.divisor", "Margin divisor (1 - gross margin)", S.margin_divisor, "", { kind: "setting", path: "settings.margin_divisor" });
    if (div <= 0) { issue("error", "settings.margin_divisor", "Margin divisor must be > 0"); div = 1; }
    const itemDigits = Math.trunc(S.item_round_digits), cesDigits = Math.trunc(S.ces_round_digits);
    const qcur = S.quote_currency || "USD";
    function toQuote(amount, cur) {
      cur = (cur || qcur).toUpperCase();
      if (cur === qcur) return [amount, "", []];
      if (cur === "THB" && qcur === "USD") return [amount / TU, " / TU", ["set.TU"]];
      if (cur === "USD" && qcur === "THB") return [amount * UT, " x UT", ["set.UT"]];
      issue("error", "settings.quote_currency", "No conversion from " + cur + " to " + qcur);
      return [amount, "", []];
    }
    const toThb = (amount, cur) => ((cur || "THB").toUpperCase() === "THB" ? amount : amount * TU);
    const sumExpr = keys => keys.map(k => fmt(nodes[k].value)).join(" + ") || "0";
    const materials = {};
    (est.materials || []).forEach(m => { materials[String(m.code || "").trim()] = m; });

    // labor rates
    const LP = Object.assign({ salary_adj: 1.07, days_per_month: 30, hours_per_day: 8 }, est.labor_params || {});
    const adj = inp("lab.adj", "Salary adjustment factor", LP.salary_adj, "", { kind: "setting" });
    const dpm = inp("lab.dpm", "Working days per month", LP.days_per_month, "day", { kind: "setting" });
    const hpd = inp("lab.hpd", "Hours per day", LP.hours_per_day, "h", { kind: "setting" });
    const rates = {}, rateRows = [];
    (est.labor_rates || []).forEach((r, i) => {
      const rid = String(r.id || "r" + i), k = "rate." + rid;
      let v;
      if (r.hourly_rate !== null && r.hourly_rate !== undefined && r.hourly_rate !== "") {
        v = inp(k, "Hourly rate " + (r.position || ""), r.hourly_rate, "THB/h", { path: "labor_rates." + i });
      } else {
        const sal = inp(k + ".salary", "Monthly salary " + (r.position || ""), r.salary, "THB/month",
          { path: "labor_rates." + i + ".salary", default: ((r.salary === null || r.salary === undefined || r.salary === "") && r.optional) ? 0 : undefined });
        v = calc(k, "Hourly rate " + (r.position || ""), sal * adj / dpm / hpd, "salary x adj / days / hours",
          fmt(sal) + " x " + fmt(adj) + " / " + fmt(dpm) + " / " + fmt(hpd), [k + ".salary", "lab.adj", "lab.dpm", "lab.hpd"], "THB/h");
      }
      rates[rid] = v; rateRows.push(Object.assign({}, r, { id: rid, rate: v }));
    });
    // crews
    const crewRows = []; let crewsTotal = 0; const crewKeys = [];
    (est.crews || []).forEach((cr, ci) => {
      const cid = String(cr.id || "c" + ci), base = "crew." + cid, nm = cr.name || "Crew";
      const days = inp(base + ".days", nm + ": working days", cr.days, "day", { path: "crews." + ci + ".days" });
      const perdiem = inp(base + ".perdiem", nm + ": per diem / person / day", cr.per_diem === undefined ? 0 : cr.per_diem, "THB", { default: 0 });
      const ot15 = inp(base + ".ot15", "OT x1.5 hours / day", cr.ot15_hours === undefined ? 0 : cr.ot15_hours, "h", { default: 0 });
      const ot3 = inp(base + ".ot3", "OT x3 hours / day", cr.ot3_hours === undefined ? 0 : cr.ot3_hours, "h", { default: 0 });
      const conf = inp(base + ".conf", "Confined-space premium %", cr.confined_pct === undefined ? 0 : cr.confined_pct, "%", { default: 0 });
      const members = [], dayKeys = []; let daySum = 0;
      (cr.members || []).forEach((m, mi) => {
        const mk = base + ".m" + mi;
        const persons = inp(mk + ".persons", (m.role || "") + ": persons", m.persons, "person",
          { path: "crews." + ci + ".members." + mi + ".persons", default: (m.persons === null || m.persons === undefined || m.persons === "") ? 0 : undefined });
        const rid = String(m.rate_id || "");
        let B = 0;
        if (!(rid in rates)) { if (persons) issue("missing", "crews." + ci + ".members." + mi + ".rate_id", "Crew role '" + m.role + "' has no valid labor rate", "Select the labor rate for this role"); }
        else B = rates[rid];
        const C = B * hpd, F = B * 1.5 * ot15, G = B * 3 * ot3, H = C * conf;
        const J = C * persons + H + persons * perdiem + F * persons + G * persons;
        calc(mk, (m.role || "") + " cost / day", J, "rate x hours/day x persons + premium + persons x per diem + OT",
          fmt(B) + " x " + fmt(hpd) + " x " + fmt(persons) + " + " + fmt(H) + " + " + fmt(persons) + " x " + fmt(perdiem) + " + " + fmt(F) + " x " + fmt(persons) + " + " + fmt(G) + " x " + fmt(persons),
          (rid in rates ? ["rate." + rid] : []).concat(["lab.hpd", mk + ".persons", base + ".perdiem", base + ".ot15", base + ".ot3", base + ".conf"]), "THB/day");
        dayKeys.push(mk); daySum += J;
        members.push(Object.assign({}, m, { rate: B, day_rate: C, cost_per_day: J }));
      });
      let extras = 0;
      const crewPersons = (cr.members || []).reduce((a, m) => a + (evalExpr(m.persons) || 0), 0);
      (cr.extras_per_day || []).forEach((x, xi) => {
        const xk = base + ".x" + xi;
        const amt = inp(xk + ".amt", (x.name || "Extra") + " rate", x.amount, "THB", { path: "crews." + ci + ".extras_per_day." + xi + ".amount" });
        let xv;
        if (x.basis === "per_person") {
          const per = evalExpr(x.persons_per_unit) || 1;
          xv = calc(xk, (x.name || "Extra") + " / day", amt * crewPersons / per, "rate x persons / persons per unit", fmt(amt) + " x " + fmt(crewPersons) + " / " + fmt(per), [xk + ".amt"], "THB/day");
        } else xv = calc(xk, (x.name || "Extra") + " / day", amt, "fixed per day", fmt(amt), [xk + ".amt"], "THB/day");
        extras += xv; dayKeys.push(xk);
      });
      const perDay = calc(base + ".per_day", nm + " cost per day", daySum + extras, "SUM(member cost/day) + extras", sumExpr(dayKeys), dayKeys, "THB/day");
      const total = calc(base + ".total", nm + " total", perDay * days, "cost/day x days", fmt(perDay) + " x " + fmt(days), [base + ".per_day", base + ".days"], "THB");
      crewsTotal += total; crewKeys.push(base + ".total");
      crewRows.push(Object.assign({}, cr, { id: cid, members, per_day: perDay, total_thb: total, persons: crewPersons }));
    });
    calc("crews.total", "Total crew labor cost", crewsTotal, "SUM(crew totals)", sumExpr(crewKeys), crewKeys, "THB");

    // machines
    const MP = Object.assign({ hours_per_year: 1200, dep_years: 5, electricity_rate: 5, operator_rate_id: null, operator_rate: null }, est.machine_params || {});
    const hy = inp("mach.hy", "Machine hours per year", MP.hours_per_year, "h", { kind: "setting" });
    const dy = inp("mach.dy", "Depreciation years", MP.dep_years, "yr", { kind: "setting" });
    const el = inp("mach.el", "Electricity rate", MP.electricity_rate, "THB/kWh", { kind: "setting" });
    let op;
    const hasMachines = (est.machines || []).length > 0;
    if (MP.operator_rate_id && String(MP.operator_rate_id) in rates) {
      op = rates[String(MP.operator_rate_id)];
      calc("mach.op", "Machine operator rate", op, "= labor rate", fmt(op), ["rate." + MP.operator_rate_id], "THB/h");
    } else op = inp("mach.op", "Machine operator rate", MP.operator_rate, "THB/h", { path: "machine_params.operator_rate", required: hasMachines, default: hasMachines ? undefined : 0 });
    const machines = {}, machRows = [];
    const blank = v => v === null || v === undefined || v === "";
    (est.machines || []).forEach((m, i) => {
      const name = String(m.name || "").trim(), mk = "mach." + i;
      if (blank(m.price) && blank(m.rate_override)) {
        machines[name] = 0; calc(mk, "Rate " + name, 0, "no machine price (outsourced)", "0", [], "THB/h");
        machRows.push(Object.assign({}, m, { rate: 0 })); return;
      }
      let v;
      if (!blank(m.rate_override)) v = inp(mk, "Rate " + name, m.rate_override, "THB/h", { source: "manual override" });
      else {
        const price = inp(mk + ".price", name + ": machine price", m.price, "THB", { path: "machines." + i + ".price" });
        const kwh = inp(mk + ".kwh", name + ": power", m.kwh, "kWh/h", { default: 0 });
        const cr = inp(mk + ".cons", name + ": consumables ratio / yr", m.consumable_ratio, "", { path: "machines." + i + ".consumable_ratio" });
        const dep = price / hy / dy, cons = price * cr / hy, elec = kwh * el;
        v = calc(mk, "Rate " + name, roundup(dep + cons + elec + op, 0),
          "ROUNDUP(price/hours/yrs + price x cons/hours + kWh x elec + operator, 0)",
          "ROUNDUP(" + fmt(dep) + " + " + fmt(cons) + " + " + fmt(elec) + " + " + fmt(op) + ", 0)",
          [mk + ".price", "mach.hy", "mach.dy", mk + ".cons", mk + ".kwh", "mach.el", "mach.op"], "THB/h");
      }
      machines[name] = v; machRows.push(Object.assign({}, m, { rate: v }));
    });

    // parts
    const partRows = []; let partsMat = 0, partsMach = 0; const pmKeys = [], pmachKeys = [];
    (est.parts || []).forEach((p, i) => {
      const pk = "part." + (p.id || i), label = p.name || ("Part " + (i + 1));
      const grade = String(p.grade_code || "").trim();
      const mat = materials[grade] || materials[grade.slice(0, 2)] || {};
      const pricing = p.pricing || "price_sheet";
      const qty = inp(pk + ".qty", label + ": qty / set", p.qty, "pcs", { path: "parts." + i + ".qty" });
      const shape = p.shape || mat.shape || "TWL";
      const dens = !blank(p.density) ? evalExpr(p.density) : evalExpr(mat.density);
      const s1 = evalExpr(p.s1), s2 = evalExpr(p.s2), s3 = evalExpr(p.s3);
      let weight = null;
      if (pricing === "by_weight" || [s1, s2, s3].some(v => v !== null)) {
        const need = shape === "DiaL" ? [s1, s2] : [s1, s2, s3];
        if (dens === null || dens === undefined || need.some(v => v === null)) {
          if (pricing === "by_weight") issue("missing", "parts." + i, label + ": dimensions/density incomplete for weight", "Provide " + shape + " dimensions for '" + label + "' (Size1/Size2/Size3 mm) and material grade");
        } else {
          let f_, e_;
          if (shape === "TWL") { weight = s1 * s2 / 1000 * s3 / 1000 * dens; f_ = "T x W/1000 x L/1000 x density"; e_ = fmt(s1) + " x " + fmt(s2) + "/1000 x " + fmt(s3) + "/1000 x " + fmt(dens); }
          else if (shape === "DiaL") { weight = Math.PI / 4 * Math.pow(s1 / 1000, 2) * s2 * dens; f_ = "pi/4 x (Dia/1000)^2 x L x density"; e_ = "pi/4 x (" + fmt(s1) + "/1000)^2 x " + fmt(s2) + " x " + fmt(dens); }
          else { weight = (Math.PI / 4 * Math.pow(s1 / 1000, 2) - Math.PI / 4 * Math.pow((s1 - 2 * s2) / 1000, 2)) * s3 * dens; f_ = "(pi/4 x (OD/1000)^2 - pi/4 x ((OD-2t)/1000)^2) x L x density"; e_ = "(pi/4 x (" + fmt(s1) + "/1000)^2 - pi/4 x ((" + fmt(s1) + "-2x" + fmt(s2) + ")/1000)^2) x " + fmt(s3) + " x " + fmt(dens); }
          calc(pk + ".weight", label + ": weight / pc", weight, f_, e_, [], "kg");
        }
      }
      let matCost = 0;
      if (pricing === "by_weight") {
        let up, src;
        if (blank(p.unit_price_thb_kg)) { const bp = evalExpr(mat.thb_per_kg); up = bp ? bp / Number(S.gm_factor || 1) : null; src = "material list " + grade; }
        else { up = evalExpr(p.unit_price_thb_kg); src = p.price_source || "engineer"; }
        if (!up) { issue("missing", "parts." + i + ".unit_price_thb_kg", label + ": no THB/kg price for grade '" + grade + "'", "Provide a verified THB/kg price for " + (grade || "this material")); up = 0; }
        inp(pk + ".up", label + ": unit price", up, "THB/kg", { source: src });
        const disc = inp(pk + ".disc", label + ": discount %", p.discount_pct === undefined ? 0 : p.discount_pct, "%", { default: 0 });
        if (weight !== null) {
          matCost = weight * up * (100 - disc) / 100 * qty;
          calc(pk + ".mat", label + ": material cost", matCost, "weight x price x (100-disc)/100 x qty",
            fmt(weight) + " x " + fmt(up) + " x (100-" + fmt(disc) + ")/100 x " + fmt(qty), [pk + ".weight", pk + ".up", pk + ".disc", pk + ".qty"], "THB");
          pmKeys.push(pk + ".mat");
        }
      }
      partsMat += matCost;
      let procTotal = 0; const procs = [], pkeys = [];
      (p.processes || []).forEach((pr, j) => {
        const mname = String(pr.machine || "").trim(); if (!mname) return;
        const outsourced = (mname in machines) && machines[mname] === 0;
        const hrs = inp(pk + ".p" + j + ".h", label + ": " + mname + " hours", pr.hours, "h", { path: "parts." + i + ".processes." + j + ".hours", default: outsourced ? 0 : undefined });
        let rate = 0;
        if (!(mname in machines)) issue("missing", "parts." + i + ".processes." + j, "Machine '" + mname + "' not in machine-rate table", "Add a machine-hour rate for '" + mname + "'");
        else rate = machines[mname];
        const mi = (est.machines || []).findIndex(mm => String(mm.name || "").trim() === mname);
        const amt = calc(pk + ".p" + j, label + ": " + mname, rate * hrs, "rate x hours", fmt(rate) + " x " + fmt(hrs), (mi >= 0 ? ["mach." + mi] : []).concat([pk + ".p" + j + ".h"]), "THB");
        procTotal += amt; pkeys.push(pk + ".p" + j); procs.push(Object.assign({}, pr, { rate, amount: amt }));
      });
      const mult = !blank(p.machine_multiplier) ? evalExpr(p.machine_multiplier) : 1;
      const machCost = procTotal * mult;
      if (pkeys.length) { calc(pk + ".mach", label + ": machine cost", machCost, "SUM(process) x multiplier", "(" + sumExpr(pkeys) + ") x " + fmt(mult), pkeys, "THB"); pmachKeys.push(pk + ".mach"); }
      partsMach += machCost;
      partRows.push(Object.assign({}, p, { weight, density: dens, material_cost_thb: matCost, machine_cost_thb: machCost, processes: procs, total_weight: (weight || 0) * qty }));
    });
    calc("parts.material", "Parts material cost (by weight)", partsMat, "SUM(part material)", sumExpr(pmKeys), pmKeys, "THB");
    calc("parts.machine", "Machine process cost", partsMach, "SUM(part machine cost)", sumExpr(pmachKeys), pmachKeys, "THB");

    // services
    const svcRows = []; let svcThb = 0; const svcKeys = [];
    (est.services || []).forEach((s, i) => {
      const sk = "svc." + (s.id || i), name = s.name || s.group || ("Service " + (i + 1)), cur = (s.currency || "THB").toUpperCase();
      let amt;
      if (!blank(s.rate)) {
        const rate = inp(sk + ".rate", name + ": rate", s.rate, cur + "/" + (s.unit || "unit"), { path: "services." + i + ".rate" });
        const q = inp(sk + ".qty", name + ": quantity", s.qty, s.unit || "", { path: "services." + i + ".qty" });
        const mn = inp(sk + ".min", name + ": minimum charge", s.minimum === undefined ? 0 : s.minimum, cur, { default: 0 });
        amt = Math.max(rate * q, mn);
        calc(sk, name, amt, "MAX(rate x qty, minimum)", "MAX(" + fmt(rate) + " x " + fmt(q) + ", " + fmt(mn) + ")", [sk + ".rate", sk + ".qty", sk + ".min"], cur);
      } else amt = inp(sk, name, s.amount, cur, { path: "services." + i + ".amount", source: s.source || "", default: s.optional ? 0 : undefined });
      const amtThb = toThb(amt, cur); svcThb += amtThb; svcKeys.push(sk);
      svcRows.push(Object.assign({}, s, { amount_v: amt, amount_thb: amtThb }));
    });
    calc("svc.total", "Total services / outsource / NDT", svcThb, "SUM(services)", sumExpr(svcKeys), svcKeys, "THB");

    // price sheets
    const sheets = {}, sheetRows = [];
    (est.price_sheets || []).forEach((sh, si) => {
      const sid = String(sh.id || "s" + si), base = "ps." + sid, cur = (sh.currency || "USD").toUpperCase();
      const digits = Math.trunc(sh.round_digits === undefined ? -1 : sh.round_digits);
      const tax = inp(base + ".tax", sh.name + ": tax %", sh.tax_pct === undefined ? 0 : sh.tax_pct, "%", { default: 0 });
      const mdiv = inp(base + ".mdiv", sh.name + ": margin divisor", sh.margin_divisor === undefined ? 1 : sh.margin_divisor, "", { default: 1 });
      const exch = inp(base + ".exch", sh.name + ": line exchange factor", sh.exchange === undefined ? 1 : sh.exchange, "", { default: 1 });
      const lines = [];
      (sh.lines || []).forEach((ln, li) => {
        const lk = base + ".l" + li, desc = ln.description || ("line " + (li + 1));
        const F = inp(lk + ".qty", desc + ": qty", ln.qty, "pcs", { path: "price_sheets." + si + ".lines." + li + ".qty" });
        const H = inp(lk + ".up", desc + ": supplier unit price", ln.unit_price, cur + "/pc", { path: "price_sheets." + si + ".lines." + li + ".unit_price", source: ln.price_source || "", question: "Supplier price needed for '" + desc + "' (" + sh.name + ")" });
        const J = F * H, L = exch * J, M = L * tax, N = mdiv ? L / mdiv : 0;
        lines.push({ F, H, J, L, M, N, lk, desc, src: ln });
      });
      const nTotal = lines.reduce((a, x) => a + x.N, 0);
      calc(base + ".N", sh.name + ": material cost", nTotal, "SUM(qty x unit price x exch / margin)", lines.map(x => fmt(x.N)).join(" + ") || "0", lines.map(x => x.lk + ".up"), cur);
      let frTotal = 0; const frKeys = [];
      (sh.freight || []).forEach((fr, fi) => {
        const fk = base + ".f" + fi, fcur = (fr.currency || cur).toUpperCase();
        const amt = inp(fk + ".amt", sh.name + ": " + (fr.label || "freight"), fr.amount, fcur, { path: "price_sheets." + si + ".freight." + fi + ".amount", default: (blank(fr.amount) && fr.optional) ? 0 : undefined });
        let conv = amt, cexpr = fmt(amt), ckeys = [];
        if (fcur !== cur && fcur === "THB" && cur === "USD") { conv = amt / TU; cexpr = fmt(amt) + " / " + fmt(TU); ckeys = ["set.TU"]; }
        else if (fcur !== cur && fcur === "USD" && cur === "THB") { conv = amt * TU; cexpr = fmt(amt) + " x " + fmt(TU); ckeys = ["set.TU"]; }
        calc(fk, sh.name + ": " + (fr.label || "freight") + " (" + cur + ")", conv, "amount in " + cur, cexpr, [fk + ".amt"].concat(ckeys), cur);
        frTotal += conv; frKeys.push(fk);
      });
      const grand = calc(base + ".grand", sh.name + ": material + freight", nTotal + frTotal, "material cost + freight", fmt(nTotal) + " + " + fmt(frTotal), [base + ".N"].concat(frKeys), cur);
      let sTotal = 0; const outLines = [], sKeys = [];
      lines.forEach(x => {
        const lk = x.lk, O = nTotal ? x.N / nTotal * grand : 0, P = O + x.M, per = x.F ? P / x.F : 0;
        const R = roundup(per, digits), Sv = R * x.F;
        calc(lk + ".R", x.desc + ": selling price / pc", R, "ROUNDUP((cost x (material+freight)/material + tax) / qty, " + digits + ")",
          "ROUNDUP((" + fmt(x.N) + " x " + fmt(grand) + " / " + fmt(nTotal) + " + " + fmt(x.M) + ") / " + fmt(x.F) + ", " + digits + ")",
          [lk + ".up", lk + ".qty", base + ".grand", base + ".N", base + ".tax"], cur + "/pc");
        calc(lk + ".S", x.desc + ": amount", Sv, "price/pc x qty", fmt(R) + " x " + fmt(x.F), [lk + ".R", lk + ".qty"], cur);
        sKeys.push(lk + ".S"); sTotal += Sv;
        const w = !blank(x.src.unit_weight) ? evalExpr(x.src.unit_weight) : null;
        outLines.push(Object.assign({}, x.src, { qty_v: x.F, unit_price_v: x.H, cost: x.J, allocated: O, selling_unit: R, amount: Sv, unit_weight_v: w, weight_total: (w || 0) * x.F }));
      });
      calc(base + ".total", sh.name + ": total", sTotal, "SUM(line amounts)", sumExpr(sKeys), sKeys, cur);
      sheets[sid] = { total: sTotal, currency: cur };
      sheetRows.push(Object.assign({}, sh, { id: sid, lines: outLines, material_cost: nTotal, freight_total: frTotal, grand, total: sTotal }));
    });

    // buckets
    function sourceValue(src, bk, si) {
      const t = src.type;
      if (t === "price_sheet") {
        const sid = String(src.id);
        if (!(sid in sheets)) { issue("error", bk, "Unknown price sheet '" + sid + "'"); return [0, "0", []]; }
        const r = toQuote(sheets[sid].total, sheets[sid].currency);
        return [r[0], fmt(sheets[sid].total) + r[1], ["ps." + sid + ".total"].concat(r[2])];
      }
      if (t === "services" || t === "crews" || t === "machines" || t === "parts_material") {
        const key = { services: "svc.total", crews: "crews.total", machines: "parts.machine", parts_material: "parts.material" }[t];
        const r = toQuote(nodes[key].value, "THB");
        return [r[0], fmt(nodes[key].value) + r[1], [key].concat(r[2])];
      }
      if (t === "fixed") {
        const fk = bk + ".fixed" + si;
        const amt = inp(fk, src.label || "Fixed amount", src.amount, src.currency || qcur);
        const r = toQuote(amt, src.currency || qcur);
        return [r[0], fmt(amt) + r[1], [fk].concat(r[2])];
      }
      issue("error", bk, "Unknown source type '" + t + "'"); return [0, "0", []];
    }
    const items = [], used = new Set();
    let cesDm = 0, cesDl1 = 0, cesDl2 = 0; const dmK = [], dl1K = [], dl2K = [];
    (est.buckets || []).forEach((b, bi) => {
      const bk = "item." + (b.no === undefined ? bi + 1 : b.no);
      const parts = [], exprs = []; let keys = [];
      const adjList = (b.adjustments || []).filter(a => !blank(a.pct));
      let fct = 1; adjList.forEach(a => { const pv = evalExpr(a.pct); if (pv !== null) fct *= (1 + pv); });
      (b.sources || []).forEach((src, si) => {
        const r = sourceValue(src, bk, si);
        parts.push(r[0]); exprs.push(r[1]); keys = keys.concat(r[2]);
        const sig = src.type + "|" + (src.id === undefined ? "" : String(src.id));
        if (src.type !== "fixed") {
          if (used.has(sig)) issue("warning", bk, "Source " + sig + " is counted in more than one quote item");
          used.add(sig);
          if (src.type === "price_sheet" || src.type === "parts_material") { cesDm += r[0] * fct; dmK.push(bk + ".base"); }
          else if (src.type === "services" || src.type === "crews") { cesDl1 += r[0] * fct; dl1K.push(bk + ".base"); }
          else if (src.type === "machines") { cesDl2 += r[0] * fct; dl2K.push(bk + ".base"); }
        }
      });
      const rawBase = parts.reduce((a, v) => a + v, 0);
      let baseV;
      if (adjList.length) {
        calc(bk + ".raw", "Item " + b.no + " " + (b.heading || "") + ": cost before adjustments", rawBase, "SUM(sources)", exprs.join(" + ") || "0", keys, qcur);
        const akeys = [bk + ".raw"], aexpr = []; let factor = 1;
        adjList.forEach((a, ai) => {
          const ak = bk + ".adj" + ai;
          const pct = inp(ak, "Item " + b.no + ": " + (a.label || "adjustment"), a.pct, "%", { source: a.source || a.reason || "engineer" });
          if (!a.reason) issue("warning", "buckets." + bi + ".adjustments." + ai, "Adjustment without a stated reason", "State why this adjustment is applied");
          factor *= (1 + pct); aexpr.push("(1 + " + fmt(pct) + ")"); akeys.push(ak);
        });
        baseV = calc(bk + ".base", "Item " + b.no + " " + (b.heading || "") + ": cost base", rawBase * factor, "cost x PRODUCT(1 + adjustment)", fmt(rawBase) + " x " + aexpr.join(" x "), akeys, qcur);
      } else baseV = calc(bk + ".base", "Item " + b.no + " " + (b.heading || "") + ": cost base", rawBase, "SUM(sources)", exprs.join(" + ") || "0", keys, qcur);
      const markup = b.markup !== false;
      const qty = inp(bk + ".qty", "Item " + b.no + ": quantity", b.qty === undefined ? 1 : b.qty, b.unit || "", { default: 1 });
      let calcPrice;
      if (markup) {
        calcPrice = roundup(baseV * (1 + ovh + risk) / div, itemDigits);
        calc(bk + ".calc_price", "Item " + b.no + ": calculated unit price", calcPrice, "ROUNDUP(base x (1 + OVH + Risk) / divisor, " + itemDigits + ")",
          "ROUNDUP(" + fmt(baseV) + " x (1 + " + fmt(ovh) + " + " + fmt(risk) + ") / " + fmt(div) + ", " + itemDigits + ")", [bk + ".base", "set.ovh", "set.risk", "set.divisor"], qcur);
      } else {
        calcPrice = roundup(baseV, itemDigits);
        calc(bk + ".calc_price", "Item " + b.no + ": calculated unit price", calcPrice, "ROUNDUP(base, " + itemDigits + ")  (no markup)", "ROUNDUP(" + fmt(baseV) + ", " + itemDigits + ")", [bk + ".base"], qcur);
      }
      let price = calcPrice;
      if (!blank(b.override_price)) {
        price = inp(bk + ".override", "Item " + b.no + ": manual price override", b.override_price, qcur, { source: b.override_reason || "manual" });
        if (!b.override_reason) issue("warning", "buckets." + bi + ".override_reason", "Item " + b.no + " price overridden without a reason", "State the reason for the manual price override");
      }
      calc(bk + ".price", "Item " + b.no + ": unit price", price, price === calcPrice ? "calculated price" : "manual override", fmt(price), [bk + (price === calcPrice ? ".calc_price" : ".override")], qcur);
      const total = calc(bk + ".total", "Item " + b.no + ": total", price * qty, "unit price x qty", fmt(price) + " x " + fmt(qty), [bk + ".price", bk + ".qty"], qcur);
      if (baseV === 0 && (b.sources || []).length) issue("warning", "buckets." + bi, "Item " + b.no + " '" + b.heading + "' has zero cost base");
      items.push({ no: b.no === undefined ? bi + 1 : b.no, heading: b.heading || "", unit: b.unit || "Lot.", qty, base: baseV, calc_price: calcPrice,
        unit_price: price, total, markup, overridden: price !== calcPrice, margin: price ? (price * qty - baseV * qty) / (price * qty) : null });
    });
    Object.keys(sheets).forEach(sid => { if (!used.has("price_sheet|" + sid) && sheets[sid].total) issue("warning", "price_sheets." + sid, "Price sheet '" + sid + "' total is not assigned to any quote item"); });
    [["services", "svc.total"], ["crews", "crews.total"], ["machines", "parts.machine"], ["parts_material", "parts.material"]].forEach(([t, key]) => {
      if (nodes[key].value && !used.has(t + "|")) issue("warning", key, nodes[key].label + " is not assigned to any quote item");
    });
    const sheetLines = (est.price_sheets || []).reduce((a, sh) => a + (sh.lines || []).length, 0);
    const viaSheet = (est.parts || []).filter(p => (p.pricing || "price_sheet") === "price_sheet");
    if (viaSheet.length && sheetLines === 0) issue("missing", "price_sheets", viaSheet.length + " BOM parts are priced through supplier price sheets, but no price-sheet lines exist", "Add the stock material (plates/pipes/flanges) to the supplier price sheets with verified supplier prices, or set the parts to 'by_weight' with a THB/kg price");

    const itemKeys = items.map(it => "item." + it.no + ".total");
    const total = calc("totals.total", "Total price", items.reduce((a, it) => a + it.total, 0), "SUM(item totals)", items.map(it => fmt(it.total)).join(" + ") || "0", itemKeys, qcur);
    const dpct = inp("set.qdisc", "Quotation discount %", S.quote_discount_pct, "%", { kind: "setting", default: 0 });
    const disc = calc("totals.discount", "Discount", total * dpct, "total x discount %", fmt(total) + " x " + fmt(dpct), ["totals.total", "set.qdisc"], qcur);
    const net = calc("totals.net", "Net total price", total - disc, "total - discount", fmt(total) + " - " + fmt(disc), ["totals.total", "totals.discount"], qcur);
    const dm = calc("ces.dm", "Total material cost (DM)", cesDm, "SUM(material sources)", fmt(cesDm), dmK, qcur);
    const dl1 = calc("ces.dl1", "Total labor cost (DL1)", cesDl1, "SUM(services + crews)", fmt(cesDl1), dl1K, qcur);
    const dl2 = calc("ces.dl2", "Total machine cost (DL2)", cesDl2, "SUM(machine cost)", fmt(cesDl2), dl2K, qcur);
    const direct = calc("ces.direct", "Direct cost (DM + DL)", dm + dl1 + dl2, "DM + DL1 + DL2", fmt(dm) + " + " + fmt(dl1) + " + " + fmt(dl2), ["ces.dm", "ces.dl1", "ces.dl2"], qcur);
    const cOvh = calc("ces.ovh", "Overhead", direct * ovh, "direct x OVH%", fmt(direct) + " x " + fmt(ovh), ["ces.direct", "set.ovh"], qcur);
    const cRisk = calc("ces.risk", "Risk", direct * risk, "direct x Risk%", fmt(direct) + " x " + fmt(risk), ["ces.direct", "set.risk"], qcur);
    const full = calc("ces.full", "Full cost (incl. OVH & Risk)", direct + cOvh + cRisk, "direct + OVH + Risk", fmt(direct) + " + " + fmt(cOvh) + " + " + fmt(cRisk), ["ces.direct", "ces.ovh", "ces.risk"], qcur);
    const cesPrice = calc("ces.price", "CES total price", roundup(full / div, cesDigits), "ROUNDUP(full cost / divisor, " + cesDigits + ")", "ROUNDUP(" + fmt(full) + " / " + fmt(div) + ", " + cesDigits + ")", ["ces.full", "set.divisor"], qcur);
    const cdisc = inp("set.cesdisc", "CES discount %", S.ces_discount_pct, "%", { kind: "setting", default: 0 });
    const setq = inp("set.setqty", "Set quantity", S.set_qty, "set", { kind: "setting", default: 1 });
    const cesNet = calc("ces.net", "CES net price", (cesPrice - cesPrice * cdisc) * setq, "(price - price x disc) x qty", "(" + fmt(cesPrice) + " - " + fmt(cesPrice) + " x " + fmt(cdisc) + ") x " + fmt(setq), ["ces.price", "set.cesdisc", "set.setqty"], qcur);
    let hp;
    const mode = S.header_price_mode || "ces";
    if (mode === "sum_items") hp = calc("header.price", "Product line price (per set)", total, "= total price", fmt(total), ["totals.total"], qcur);
    else if (mode === "manual") hp = inp("header.price", "Product line price (per set)", S.header_price_manual, qcur, { source: "manual" });
    else hp = calc("header.price", "Product line price (per set)", roundup(cesNet, itemDigits), "ROUNDUP(CES net, " + itemDigits + ")", "ROUNDUP(" + fmt(cesNet) + ", " + itemDigits + ")", ["ces.net"], qcur);
    return { nodes, issues, settings: S, TU, UT, labor_rates: rateRows, crews: crewRows, machines: machRows, parts: partRows, services: svcRows,
      price_sheets: sheetRows, items,
      totals: { total, discount_pct: dpct, discount: disc, net, header_price: hp, currency: qcur },
      ces: { dm, dl1, dl2, direct, ovh: cOvh, risk: cRisk, full, price: cesPrice, discount_pct: cdisc, net: cesNet, gross_margin_on_net: net ? (net - direct) / net : null },
      summary_thb: { crews: crewsTotal, services: svcThb, machines: partsMach, parts_material: partsMat },
      weights: { price_sheet_kg: sheetRows.reduce((a, s) => a + s.lines.reduce((b, l) => b + l.weight_total, 0), 0), parts_kg: partRows.reduce((a, p) => a + p.total_weight, 0) },
      missing_count: issues.filter(i => i.severity === "missing").length };
  }
  function trace(result, key, depth) {
    depth = depth === undefined ? 6 : depth;
    const nodes = result.nodes;
    function rec(k, d) {
      const n = nodes[k];
      if (!n) return { key: k, label: "(unknown)", value: null, children: [] };
      const out = Object.assign({}, n);
      out.children = d > 0 ? n.inputs.map(ch => rec(ch, d - 1)) : [];
      return out;
    }
    return rec(key, depth);
  }
  const api = { compute, trace, roundup, evalExpr, fmt };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.PrologEngine = api;
})(this);
