"use strict";
/* Prolog Titanium Estimator — in-browser app (engine = exact port of the backend engine). */
const E = window.PrologEngine;
const SEED = JSON.parse(document.getElementById("seed").textContent);
const IMGS = JSON.parse(document.getElementById("imgs").textContent);
const LS_KEY = "prolog.estimator.projects.v1";
const S = { projects: [], cur: null, tab: "overview", result: null, caps: {}, ai: {}, drawer: null, saveState: "saved", uid: null };
const $ = (sel, el) => (el || document).querySelector(sel);
const esc = s => String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (x, d) => (x === null || x === undefined || isNaN(x)) ? "—" : Number(x).toLocaleString("en-US", { minimumFractionDigits: d === undefined ? 2 : d, maximumFractionDigits: d === undefined ? 2 : d });
const num = x => (x === null || x === undefined || isNaN(x)) ? "—" : E.fmt(Number(x), 4);
const clone = o => JSON.parse(JSON.stringify(o));
const uid = () => Math.random().toString(36).slice(2, 10);
function toast(msg) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }

/* ---------------- projects & persistence ---------------- */
function referenceProject() {
  return { id: "ref-" + uid(), name: SEED.project.product_subject + " — " + SEED.project.job_no, status: "quoted",
    meta: { source: SEED.project.source_file, reference_values: SEED.reference_values }, estimate: clone(SEED.estimate), quote_doc: clone(SEED.quote_doc),
    actuals: {}, drawings: [], updated: Date.now() };
}
function factory() {
  const e = SEED.estimate;
  const crews = clone(e.crews).map(c => Object.assign(c, { days: null, members: c.members.map(m => Object.assign(m, { persons: 0 })) }));
  return { settings: clone(e.settings), labor_params: clone(e.labor_params), labor_rates: clone(e.labor_rates), crews,
    machine_params: clone(e.machine_params), machines: clone(e.machines), materials: clone(e.materials), parts: [], services: [],
    price_sheets: clone(e.price_sheets).map(s => Object.assign(s, { lines: [], workbook_total: undefined, freight: (s.freight || []).map(f => ({ label: f.label, amount: null, currency: f.currency })) })),
    buckets: clone(e.buckets).filter(b => !(b.sources || []).some(s => s.type === "fixed")) };
}
function blankProject(name) {
  const est = factory();
  const qd = clone(SEED.quote_doc);
  const tail = []; let seen = false;
  qd.rows.forEach(r => { if (r.kind === "highlight_head") seen = true; if (seen) tail.push(r); });
  const rows = [];
  est.buckets.forEach(b => { rows.push({ kind: "item", item_no: b.no, runs: [{ text: b.heading, bold: true }] }); rows.push({ kind: "blank", runs: [] }); });
  const today = new Date().toISOString().slice(0, 10), valid = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  Object.assign(qd, { quotation_no: "", job_no: "", customer_name: "", contact_person: "", tel: "-", fax: "-", email: "", product_subject: name || "",
    drawing_no: "", enquiry_date: "", quotation_date: today, validity_date: valid, delivery_time: null,
    title: { runs: [{ text: name || "New product", bold: true }], qty: 1, unit: "Set." }, rows: rows.concat(tail), page_breaks: "auto" });
  return { id: "p-" + uid(), name: name || "New project", status: "draft", meta: {}, estimate: est, quote_doc: qd, actuals: {}, drawings: [], updated: Date.now() };
}
async function loadProjects() {
  let list = null;
  try { const raw = localStorage.getItem(LS_KEY); if (raw) list = JSON.parse(raw); } catch (e) { list = null; }
  if (S.caps.db && S.uid) {
    try {
      const snap = await S.caps.db.collection("data/users/" + S.uid).get();
      const rows = (snap.docs || []).map(d => (typeof d.data === "function" ? d.data() : d.data)).filter(Boolean).map(d => JSON.parse(d.json));
      if (rows.length) list = rows;
    } catch (e) { /* keep local */ }
  }
  if (!list || !list.length) list = [referenceProject()];
  S.projects = list;
  S.cur = list[0].id;
}
let saveTimer = null;
function scheduleSave() {
  S.saveState = "saving"; renderTop();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 700);
}
async function saveNow() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(S.projects)); } catch (e) { /* storage unavailable */ }
  if (S.caps.db && S.uid) {
    try {
      const p = cur();
      await S.caps.db.doc("data/users/" + S.uid + "/" + p.id).set({ json: JSON.stringify(p), name: p.name, updated: p.updated });
    } catch (e) { /* offline: local copy kept */ }
  }
  S.saveState = "saved"; renderTop();
}
const cur = () => S.projects.find(p => p.id === S.cur);

/* ---------------- paths & edits ---------------- */
function getPath(obj, path) { return path.split(".").reduce((o, k) => (o === undefined || o === null) ? undefined : o[k], obj); }
function setPath(obj, path, val) {
  const ks = path.split("."); let o = obj;
  for (let i = 0; i < ks.length - 1; i++) { if (o[ks[i]] === undefined || o[ks[i]] === null) o[ks[i]] = /^\d+$/.test(ks[i + 1]) ? [] : {}; o = o[ks[i]]; }
  o[ks[ks.length - 1]] = val;
}
function parseVal(raw, type) {
  if (type === "text") return raw;
  if (type === "bool") return !!raw;
  const s = String(raw).trim();
  if (s === "") return null;
  if (/[+\-*/()]/.test(s.replace(/^-/, "")) ) { try { E.evalExpr(s); return s; } catch (e) { return s; } }
  const n = Number(s.replace(/,/g, ""));
  return isNaN(n) ? s : n;
}
function recompute() { S.result = E.compute(cur().estimate); }
function changed() { const p = cur(); p.updated = Date.now(); recompute(); scheduleSave(); render(); }

/* ---------------- small builders ---------------- */
function inp(path, opts) {
  opts = opts || {};
  const p = cur();
  const v = getPath(p, path);
  const type = opts.type || "num";
  if (type === "select") {
    return `<select class="i" data-path="${path}" data-type="text">${opts.options.map(o => `<option value="${esc(o[0])}" ${String(v) === String(o[0]) ? "selected" : ""}>${esc(o[1])}</option>`).join("")}</select>`;
  }
  if (type === "bool") return `<input type="checkbox" data-path="${path}" data-type="bool" ${v ? "checked" : ""}>`;
  const cls = "i" + (type === "num" ? " n" : "") + (opts.wide ? " w" : "");
  return `<input class="${cls}" id="f-${path}" data-path="${path}" data-type="${type}" value="${esc(v === null || v === undefined ? "" : v)}" ${opts.ph ? `placeholder="${esc(opts.ph)}"` : ""} aria-label="${esc(opts.label || path)}">`;
}
function calcCell(key, value, opts) {
  opts = opts || {};
  if (value === undefined && S.result.nodes[key]) value = S.result.nodes[key].value;
  if (!S.result.nodes[key]) return `<span class="muted">${opts.text || num(value)}</span>`;
  return `<span class="calc${opts.big ? " big" : ""}" data-node="${key}" title="Show calculation">${opts.money ? money(value, opts.d) : (opts.text || num(value))}</span>`;
}
const btn = (label, act, extra) => `<button class="btn ${extra || ""}" data-act="${act}">${label}</button>`;

/* ---------------- top bar ---------------- */
function renderTop() {
  const p = cur(); if (!p || !S.result) return;
  const r = S.result, t = r.totals;
  const miss = r.issues.filter(i => i.severity === "missing" || i.severity === "error").length;
  $("#top").innerHTML = `
    <div><h1>${esc(p.quote_doc.product_subject || p.name)}</h1><div class="sub">${esc(p.quote_doc.quotation_no || "no quotation no.")} · ${esc(p.quote_doc.customer_name || "no customer")}</div></div>
    <select class="i" style="width:auto" data-act="switch" aria-label="Project">${S.projects.map(x => `<option value="${x.id}" ${x.id === p.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>
    <span class="grow"></span>
    <span class="pill ${miss ? "bad" : "ok"}" data-act="tab:overview" style="cursor:pointer">${miss ? miss + " open questions" : "complete"}</span>
    <span class="small muted">${S.saveState === "saving" ? "Saving…" : "Saved"}</span>
    <div class="netbox"><div class="lbl">Net total ${esc(t.currency)}</div><div class="val">${calcCell("totals.net", t.net, { money: true })}</div></div>
    ${btn("PDF", "export:pdf", "primary")}${btn("Quotation .xlsx", "export:qxlsx")}${btn("Costing .xlsx", "export:cxlsx")}`;
}

/* ---------------- tabs ---------------- */
const TABS = [["overview", "Overview"], ["prices", "Material prices"], ["parts", "BOM / parts"], ["labor", "Labor"], ["machines", "Machines"],
  ["services", "Services & NDT"], ["pricing", "Quote items & pricing"], ["quote", "Quotation document"], ["ai", "AI assistant"], ["suppliers", "Supplier prices"], ["projects", "Projects"]];
function renderRail() {
  $("#tabs").innerHTML = TABS.map(([k, l]) => `<button data-act="tab:${k}" aria-current="${S.tab === k}">${l}</button>`).join("");
}
function render() {
  renderRail(); renderTop();
  const fn = { overview: vOverview, prices: vPrices, parts: vParts, labor: vLabor, machines: vMachines, services: vServices,
    pricing: vPricing, quote: vQuote, ai: vAI, suppliers: vSuppliers, projects: vProjects }[S.tab];
  const focus = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.path : null;
  $("#content").innerHTML = fn();
  if (focus) { const el = document.querySelector(`[data-path="${CSS.escape(focus)}"]`); if (el) el.focus(); }
  if (S.drawer) renderDrawer();
}

function vOverview() {
  const p = cur(), r = S.result, q = p.quote_doc;
  const iss = r.issues;
  const sev = { missing: "bad", error: "bad", warning: "warn", info: "ok" };
  const ref = (p.meta || {}).reference_values;
  let refRow = "";
  if (ref && ref["totals.net"]) {
    const checks = ["item.1.price", "item.2.price", "item.3.price", "item.4.price", "totals.total", "totals.net", "header.price"].filter(k => ref[k] !== undefined && r.nodes[k]);
    const ok = checks.filter(k => Math.abs(r.nodes[k].value - ref[k]) < 0.005).length;
    refRow = `<div class="card"><h2>Check against the original Excel workbook <span class="pill ${ok === checks.length ? "ok" : "warn"}">${ok}/${checks.length} equal</span></h2>
      <div class="tw"><table><tr><th>Value</th><th class="n">Excel (cached)</th><th class="n">This app</th><th></th></tr>
      ${checks.map(k => `<tr><td>${esc(r.nodes[k].label)}</td><td class="n">${money(ref[k])}</td><td class="n">${calcCell(k, undefined, { money: true })}</td><td>${Math.abs(r.nodes[k].value - ref[k]) < 0.005 ? '<span class="pill ok">equal</span>' : '<span class="pill warn">changed</span>'}</td></tr>`).join("")}
      </table></div><p class="small muted">Values Excel saved in ${esc((p.meta || {}).source || "the workbook")}. They stay equal until you edit inputs.</p></div>`;
  }
  return `
  <div class="grid2">
    <div class="card"><h2>Project</h2><div class="form">
      <label>Project name${inp("name", { type: "text" })}</label>
      <label>Status${inp("status", { type: "select", options: [["draft", "Draft"], ["quoted", "Quoted"], ["won", "Won"], ["lost", "Lost"], ["in_production", "In production"], ["completed", "Completed"]] })}</label>
      <label>Quotation no.${inp("quote_doc.quotation_no", { type: "text" })}</label>
      <label>Job information no.${inp("quote_doc.job_no", { type: "text" })}</label>
      <label>Customer${inp("quote_doc.customer_name", { type: "text" })}</label>
      <label>Product subject${inp("quote_doc.product_subject", { type: "text" })}</label>
      <label>Drawing no.${inp("quote_doc.drawing_no", { type: "text" })}</label>
      <label>Contact person${inp("quote_doc.contact_person", { type: "text" })}</label>
    </div></div>
    <div class="card"><h2>Open questions <span class="pill ${iss.length ? "warn" : "ok"}">${iss.length}</span></h2>
      ${iss.length ? `<div class="issues">${iss.map((i, k) => `<div class="issue" data-act="goto:${esc(i.path)}"><span class="pill ${sev[i.severity]}">${i.severity}</span><div><div>${esc(i.message)}</div>${i.question ? `<div class="small muted">${esc(i.question)}</div>` : ""}</div></div>`).join("")}</div>`
        : `<p class="muted">Nothing missing. Every number is backed by an input you can trace.</p>`}
      <p class="small muted">Missing inputs are never filled in automatically. Click a question to jump to the field.</p></div>
  </div>
  <div class="card"><h2>Quote items <span class="small muted">click any ƒ number to see how it was calculated</span></h2><div class="tw"><table>
    <tr><th>Item</th><th>Heading</th><th class="n">Cost base</th><th class="n">Unit price</th><th class="n">Qty</th><th>Unit</th><th class="n">Total</th><th class="n">Margin</th></tr>
    ${r.items.map(it => `<tr><td>${it.no}</td><td>${esc(it.heading)} ${it.markup ? "" : '<span class="pill warn">no markup</span>'}</td>
      <td class="n">${calcCell("item." + it.no + ".base", it.base, { money: true })}</td><td class="n">${calcCell("item." + it.no + ".price", it.unit_price, { money: true })}</td>
      <td class="n">${num(it.qty)}</td><td>${esc(it.unit)}</td><td class="n">${calcCell("item." + it.no + ".total", it.total, { money: true })}</td>
      <td class="n">${it.margin === null ? "—" : (it.margin * 100).toFixed(1) + "%"}</td></tr>`).join("")}
    <tr><td></td><td><b>Total price</b></td><td></td><td></td><td></td><td></td><td class="n">${calcCell("totals.total", undefined, { money: true })}</td><td></td></tr>
    <tr><td></td><td>Discount ${(r.totals.discount_pct * 100).toFixed(0)}%</td><td></td><td></td><td></td><td></td><td class="n">${calcCell("totals.discount", undefined, { money: true })}</td><td></td></tr>
    <tr><td></td><td><b>Net total price</b></td><td></td><td></td><td></td><td></td><td class="n">${calcCell("totals.net", undefined, { money: true, big: true })}</td><td></td></tr>
    <tr><td></td><td>Product line price / set</td><td></td><td></td><td></td><td></td><td class="n">${calcCell("header.price", undefined, { money: true })}</td><td></td></tr>
  </table></div></div>
  <div class="grid2">
    <div class="card"><h2>Cost estimate sheet (CES)</h2><div class="tw"><table>
      ${[["ces.dm", "Material cost (DM)"], ["ces.dl1", "Labor cost (DL1: services + crews)"], ["ces.dl2", "Machine cost (DL2)"], ["ces.direct", "Direct cost"], ["ces.ovh", "Overhead"], ["ces.risk", "Risk"], ["ces.full", "Full cost"], ["ces.price", "CES price"], ["ces.net", "CES net (after CES discount)"]]
        .map(([k, l]) => `<tr><td>${l}</td><td class="n">${calcCell(k, undefined, { money: true })}</td></tr>`).join("")}
      <tr><td>Gross margin on net</td><td class="n">${r.ces.gross_margin_on_net === null ? "—" : (r.ces.gross_margin_on_net * 100).toFixed(1) + "%"}</td></tr>
    </table></div></div>
    <div class="card"><h2>Cost categories (THB)</h2><div class="kpis">
      <div class="kpi"><div class="l">Crews</div>${calcCell("crews.total", undefined, { money: true })}</div>
      <div class="kpi"><div class="l">Services / NDT</div>${calcCell("svc.total", undefined, { money: true })}</div>
      <div class="kpi"><div class="l">Machines</div>${calcCell("parts.machine", undefined, { money: true })}</div>
      <div class="kpi"><div class="l">Material by weight</div>${calcCell("parts.material", undefined, { money: true })}</div>
      <div class="kpi"><div class="l">Stock weight (price sheets)</div><b>${money(r.weights.price_sheet_kg, 1)} kg</b></div>
      <div class="kpi"><div class="l">FX used (TU)</div>${calcCell("set.TU")}</div>
    </div></div>
  </div>${refRow}`;
}

function vPrices() {
  const p = cur(), r = S.result;
  return p.estimate.price_sheets.map((sh, si) => {
    const rs = r.price_sheets[si] || { lines: [] };
    const base = "estimate.price_sheets." + si;
    return `<div class="card"><h2>${esc(sh.name)} <span class="pill ok">${esc(sh.currency)}</span><span class="grow"></span>
      Total ${calcCell("ps." + rs.id + ".total", undefined, { money: true, big: true })}</h2>
      <div class="form">
        <label>Currency${inp(base + ".currency", { type: "select", options: [["USD", "USD"], ["THB", "THB"]] })}</label>
        <label>Per-piece ROUNDUP digits${inp(base + ".round_digits")}</label>
        <label>Import tax %${inp(base + ".tax_pct")}</label>
        <label>Margin divisor${inp(base + ".margin_divisor")}</label>
      </div>
      <h2 style="margin-top:12px">Freight and charges <span class="small muted">spread over lines by value</span></h2>
      <div class="tw"><table><tr><th>Charge</th><th class="n">Amount</th><th>Currency</th><th class="n">In ${esc(sh.currency)}</th><th></th></tr>
        ${(sh.freight || []).map((f, fi) => `<tr><td>${inp(base + ".freight." + fi + ".label", { type: "text", wide: true })}</td><td>${inp(base + ".freight." + fi + ".amount")}</td>
          <td>${inp(base + ".freight." + fi + ".currency", { type: "select", options: [["THB", "THB"], ["USD", "USD"]] })}</td><td class="n">${calcCell("ps." + rs.id + ".f" + fi, undefined, { money: true })}</td>
          <td>${btn("Remove", "del:" + base + ".freight." + fi, "small")}</td></tr>`).join("")}
      </table></div>${btn("+ Charge", "add:freight:" + si, "small")}
      <h2 style="margin-top:12px">Lines</h2>
      <div class="tw"><table><tr><th>Group</th><th>Material</th><th>Description / size</th><th class="n">kg/pc</th><th class="n">Qty</th><th class="n">Supplier price/pc</th><th>Price source</th><th class="n">Selling/pc</th><th class="n">Amount</th><th></th></tr>
        ${(sh.lines || []).map((l, li) => `<tr><td>${inp(base + ".lines." + li + ".group", { type: "text" })}</td><td>${inp(base + ".lines." + li + ".material", { type: "text" })}</td>
          <td>${inp(base + ".lines." + li + ".description", { type: "text", wide: true })}</td><td>${inp(base + ".lines." + li + ".unit_weight")}</td>
          <td>${inp(base + ".lines." + li + ".qty")}</td><td>${inp(base + ".lines." + li + ".unit_price", { ph: "required" })}</td>
          <td>${inp(base + ".lines." + li + ".price_source", { type: "text" })}</td>
          <td class="n">${calcCell("ps." + rs.id + ".l" + li + ".R", undefined, { money: true })}</td><td class="n">${calcCell("ps." + rs.id + ".l" + li + ".S", undefined, { money: true })}</td>
          <td>${btn("Pick price", "pick:" + si + ":" + li, "small")} ${btn("✕", "del:" + base + ".lines." + li, "small")}</td></tr>`).join("")}
      </table></div>${btn("+ Line", "add:line:" + si, "small")}
      <p class="small muted">Selling price per piece = ROUNDUP((line cost × (material + freight) / material + tax) / qty, digits). Material ${money(rs.material_cost)} + freight ${money(rs.freight_total)} = ${money(rs.grand)} ${esc(sh.currency)}.</p></div>`;
  }).join("") + `<div class="card">${btn("+ Price sheet", "add:sheet")}</div>`;
}

function vParts() {
  const p = cur(), r = S.result, mats = p.estimate.materials || [], machs = (p.estimate.machines || []).map(m => m.name);
  const matOpts = [["", "—"]].concat(mats.map(m => [m.code, m.name]));
  const machOpts = [["", "—"]].concat(machs.map(m => [m, m]));
  return `<div class="card"><h2>Bill of materials <span class="grow"></span>${btn("+ Part", "add:part", "small")}</h2>
  <p class="small muted">Shape TWL = plate (thk, width, length mm) · DiaL = bar (dia, length) · ODTL = pipe (OD, wall, length). Pricing "price_sheet" means the material is bought through the supplier sheets; "by_weight" prices it at THB/kg here.</p>
  <div class="tw"><table><tr><th>Part</th><th>Grade</th><th>Shape</th><th class="n">Size1</th><th class="n">Size2</th><th class="n">Size3</th><th class="n">Qty</th><th>Pricing</th><th class="n">THB/kg</th><th class="n">kg/pc</th><th class="n">Material THB</th><th>Processes (machine · hours)</th><th class="n">Machine THB</th><th></th></tr>
  ${(p.estimate.parts || []).map((pt, i) => {
    const rp = r.parts[i] || {}, b = "estimate.parts." + i, pk = "part." + (pt.id || i);
    const procs = (pt.processes || []).map((pr, j) => `<div style="display:flex;gap:4px;margin:1px 0">${inp(b + ".processes." + j + ".machine", { type: "select", options: machOpts })}<span style="width:70px">${inp(b + ".processes." + j + ".hours")}</span>${btn("✕", "del:" + b + ".processes." + j, "small")}</div>`).join("");
    return `<tr><td>${inp(b + ".name", { type: "text", wide: true })}</td><td>${inp(b + ".grade_code", { type: "select", options: matOpts })}</td>
      <td>${inp(b + ".shape", { type: "select", options: [["TWL", "TWL"], ["DiaL", "DiaL"], ["ODTL", "ODTL"]] })}</td>
      <td>${inp(b + ".s1")}</td><td>${inp(b + ".s2")}</td><td>${inp(b + ".s3")}</td><td>${inp(b + ".qty")}</td>
      <td>${inp(b + ".pricing", { type: "select", options: [["price_sheet", "price_sheet"], ["by_weight", "by_weight"]] })}</td><td>${inp(b + ".unit_price_thb_kg", { ph: "list" })}</td>
      <td class="n">${rp.weight === null || rp.weight === undefined ? "—" : calcCell(pk + ".weight")}</td><td class="n">${r.nodes[pk + ".mat"] ? calcCell(pk + ".mat", undefined, { money: true }) : "—"}</td>
      <td>${procs}${btn("+ Process", "add:proc:" + i, "small")}</td><td class="n">${r.nodes[pk + ".mach"] ? calcCell(pk + ".mach", undefined, { money: true }) : "—"}</td>
      <td>${btn("✕", "del:" + b, "small")}</td></tr>`;
  }).join("")}</table></div>
  <p class="small muted">Totals: material ${calcCell("parts.material", undefined, { money: true })} THB · machine ${calcCell("parts.machine", undefined, { money: true })} THB</p></div>`;
}

function vLabor() {
  const p = cur(), r = S.result, rateOpts = [["", "—"]].concat((p.estimate.labor_rates || []).map(x => [x.id, x.position + " (" + (x.site || "") + ")"]));
  return `<div class="card"><h2>Labor rate table <span class="grow"></span>${btn("+ Position", "add:rate", "small")}</h2>
    <div class="form"><label>Salary adjustment${inp("estimate.labor_params.salary_adj")}</label><label>Days / month${inp("estimate.labor_params.days_per_month")}</label><label>Hours / day${inp("estimate.labor_params.hours_per_day")}</label></div>
    <div class="tw" style="margin-top:8px"><table><tr><th>ID</th><th>Position</th><th>Site</th><th class="n">Salary THB/month</th><th class="n">Hourly override</th><th class="n">THB/hour</th><th></th></tr>
    ${(p.estimate.labor_rates || []).map((x, i) => `<tr><td>${esc(x.id)}</td><td>${inp("estimate.labor_rates." + i + ".position", { type: "text", wide: true })}</td><td>${inp("estimate.labor_rates." + i + ".site", { type: "text" })}</td>
      <td>${inp("estimate.labor_rates." + i + ".salary")}</td><td>${inp("estimate.labor_rates." + i + ".hourly_rate")}</td><td class="n">${calcCell("rate." + x.id)}</td><td>${btn("✕", "del:estimate.labor_rates." + i, "small")}</td></tr>`).join("")}
    </table></div></div>` +
    (p.estimate.crews || []).map((c, ci) => {
      const b = "estimate.crews." + ci, rc = r.crews[ci] || {};
      return `<div class="card"><h2>${esc(c.name)} crew <span class="grow"></span>Total ${calcCell("crew." + rc.id + ".total", undefined, { money: true, big: true })} THB</h2>
      <div class="form"><label>Working days${inp(b + ".days", { ph: "required" })}</label><label>Per diem / person / day${inp(b + ".per_diem")}</label>
        <label>OT ×1.5 hours / day${inp(b + ".ot15_hours")}</label><label>OT ×3 hours / day${inp(b + ".ot3_hours")}</label><label>Confined premium (fraction)${inp(b + ".confined_pct")}</label></div>
      <div class="tw" style="margin-top:8px"><table><tr><th>Role</th><th>Labor rate</th><th class="n">Persons</th><th class="n">THB/hour</th><th class="n">Cost / day</th><th></th></tr>
      ${(c.members || []).map((m, mi) => `<tr><td>${inp(b + ".members." + mi + ".role", { type: "text", wide: true })}</td><td>${inp(b + ".members." + mi + ".rate_id", { type: "select", options: rateOpts })}</td>
        <td>${inp(b + ".members." + mi + ".persons")}</td><td class="n">${num((rc.members || [])[mi] && rc.members[mi].rate)}</td><td class="n">${calcCell("crew." + rc.id + ".m" + mi, undefined, { money: true })}</td>
        <td>${btn("✕", "del:" + b + ".members." + mi, "small")}</td></tr>`).join("")}
      </table></div>${btn("+ Role", "add:member:" + ci, "small")}
      <p class="small muted">Cost/day per role = rate × 8 h × persons + premium + persons × per diem + OT. Crew per day ${calcCell("crew." + rc.id + ".per_day", undefined, { money: true })} THB.</p></div>`;
    }).join("");
}

function vMachines() {
  const p = cur();
  return `<div class="card"><h2>Machine-hour rates <span class="grow"></span>${btn("+ Machine", "add:machine", "small")}</h2>
    <div class="form"><label>Hours / year${inp("estimate.machine_params.hours_per_year")}</label><label>Depreciation years${inp("estimate.machine_params.dep_years")}</label>
      <label>Electricity THB/kWh${inp("estimate.machine_params.electricity_rate")}</label><label>Operator rate (labor rate ID)${inp("estimate.machine_params.operator_rate_id", { type: "text" })}</label></div>
    <div class="tw" style="margin-top:8px"><table><tr><th>Machine</th><th class="n">Price THB</th><th class="n">kWh/h</th><th class="n">Consumables ratio</th><th class="n">Rate override</th><th class="n">THB/hour</th><th></th></tr>
    ${(p.estimate.machines || []).map((m, i) => `<tr><td>${inp("estimate.machines." + i + ".name", { type: "text", wide: true })}</td><td>${inp("estimate.machines." + i + ".price")}</td><td>${inp("estimate.machines." + i + ".kwh")}</td>
      <td>${inp("estimate.machines." + i + ".consumable_ratio")}</td><td>${inp("estimate.machines." + i + ".rate_override")}</td><td class="n">${calcCell("mach." + i)}</td><td>${btn("✕", "del:estimate.machines." + i, "small")}</td></tr>`).join("")}
    </table></div><p class="small muted">Rate = ROUNDUP(price ÷ hours ÷ years + price × consumables ÷ hours + kWh × electricity + operator, 0). A machine without price counts as outsourced (rate 0).</p></div>`;
}

function vServices() {
  const p = cur();
  return `<div class="card"><h2>Outsourcing, NDT, finishing, packing <span class="grow"></span>${btn("+ Service", "add:service", "small")} Total ${calcCell("svc.total", undefined, { money: true, big: true })} THB</h2>
    <p class="small muted">Either a fixed amount, or rate × qty with a minimum charge (amount = MAX(rate × qty, minimum)). Arithmetic like 45000+42000 stays visible in the trace.</p>
    <div class="tw"><table><tr><th>Group</th><th>Service</th><th class="n">Fixed amount</th><th class="n">Rate</th><th class="n">Qty</th><th class="n">Minimum</th><th>Currency</th><th class="n">Amount</th><th>Source</th><th></th></tr>
    ${(p.estimate.services || []).map((s, i) => { const b = "estimate.services." + i; return `<tr><td>${inp(b + ".group", { type: "text" })}</td><td>${inp(b + ".name", { type: "text", wide: true })}</td>
      <td>${inp(b + ".amount")}</td><td>${inp(b + ".rate")}</td><td>${inp(b + ".qty")}</td><td>${inp(b + ".minimum")}</td><td>${inp(b + ".currency", { type: "select", options: [["THB", "THB"], ["USD", "USD"]] })}</td>
      <td class="n">${calcCell("svc." + (s.id || i), undefined, { money: true })}</td><td>${inp(b + ".source", { type: "text" })}</td><td>${btn("✕", "del:" + b, "small")}</td></tr>`; }).join("")}
    </table></div></div>`;
}

function vPricing() {
  const p = cur(), r = S.result, sheets = p.estimate.price_sheets || [];
  const srcOpts = sheets.map(s => ["price_sheet:" + s.id, s.name]).concat([["services", "Services / NDT"], ["crews", "Crews"], ["machines", "Machine cost"], ["parts_material", "Material by weight"]]);
  return `<div class="card"><h2>Pricing settings</h2><div class="form">
    ${[["fx_thb_per_usd", "FX THB per USD"], ["thb_to_usd_factor", "THB→USD factor"], ["usd_to_thb_factor", "USD→THB factor"], ["ovh_pct", "Overhead (fraction)"], ["risk_pct", "Risk (fraction)"],
      ["margin_divisor", "Margin divisor (1 − margin)"], ["item_round_digits", "Item ROUNDUP digits"], ["ces_round_digits", "CES ROUNDUP digits"], ["ces_discount_pct", "CES discount (fraction)"],
      ["quote_discount_pct", "Quotation discount (fraction)"], ["set_qty", "Set quantity"]].map(([k, l]) => `<label>${l}${inp("estimate.settings." + k)}</label>`).join("")}
    <label>Quote currency${inp("estimate.settings.quote_currency", { type: "select", options: [["USD", "USD"], ["THB", "THB"]] })}</label>
    <label>Product line price${inp("estimate.settings.header_price_mode", { type: "select", options: [["ces", "CES path (workbook)"], ["sum_items", "Sum of items"], ["manual", "Manual"]] })}</label>
    <label>Manual product line price${inp("estimate.settings.header_price_manual")}</label></div>
    <p class="small muted">Item price = ROUNDUP(cost base × (1 + overhead + risk) ÷ divisor, digits). TU = factor × FX = ${calcCell("set.TU")} THB per USD.</p></div>` +
    (p.estimate.buckets || []).map((b, bi) => {
      const it = r.items[bi] || {}, base = "estimate.buckets." + bi;
      const has = k => (b.sources || []).some(s => (s.type === "price_sheet" ? "price_sheet:" + s.id : s.type) === k);
      const fixed = (b.sources || []).map((s, si) => s.type === "fixed" ? `<div class="form" style="margin-top:6px"><label>Fixed amount label${inp(base + ".sources." + si + ".label", { type: "text" })}</label><label>Amount${inp(base + ".sources." + si + ".amount")}</label><label>Currency${inp(base + ".sources." + si + ".currency", { type: "select", options: [["THB", "THB"], ["USD", "USD"]] })}</label></div>` : "").join("");
      return `<div class="card"><h2>Item ${esc(b.no)} <span class="grow"></span>Unit price ${calcCell("item." + b.no + ".price", undefined, { money: true, big: true })}</h2>
        <div class="form"><label>Item no.${inp(base + ".no")}</label><label>Heading${inp(base + ".heading", { type: "text" })}</label><label>Unit${inp(base + ".unit", { type: "text" })}</label><label>Qty${inp(base + ".qty")}</label>
          <label>Apply OVH/Risk/margin${inp(base + ".markup", { type: "bool" })}</label><label>Manual price override${inp(base + ".override_price")}</label><label>Override reason${inp(base + ".override_reason", { type: "text" })}</label></div>
        <div class="chips" style="margin-top:8px">${srcOpts.map(([k, l]) => `<label class="chip"><input type="checkbox" data-act="src:${bi}:${k}" ${has(k) ? "checked" : ""}> ${esc(l)}</label>`).join("")}
          <span class="chip">${btn("+ Fixed amount", "add:fixed:" + bi, "small")}</span></div>${fixed}
        <h2 style="margin-top:10px">Adjustments <span class="small muted">e.g. historical calibration; applied to the cost base before markup, always with a reason</span></h2>
        ${(b.adjustments || []).map((a, ai) => `<div class="form"><label>Label${inp(base + ".adjustments." + ai + ".label", { type: "text" })}</label><label>Percent (fraction)${inp(base + ".adjustments." + ai + ".pct")}</label><label>Reason${inp(base + ".adjustments." + ai + ".reason", { type: "text" })}</label><label>&nbsp;${btn("Remove", "del:" + base + ".adjustments." + ai, "small")}</label></div>`).join("")}
        ${btn("+ Adjustment", "add:adj:" + bi, "small")} ${btn("Delete item", "del:" + base, "small")}
        <p class="small muted">Cost base ${calcCell("item." + b.no + ".base", undefined, { money: true })} · margin ${it.margin === null || it.margin === undefined ? "—" : (it.margin * 100).toFixed(1) + "%"}</p></div>`;
    }).join("") + `<div class="card">${btn("+ Quote item", "add:bucket")}</div>`;
}

/* ---------------- quotation document ---------------- */
const KINDS = [["item", "Item heading"], ["line", "Line"], ["bullet", "Bullet"], ["blank", "Blank"], ["highlight_head", "Yellow heading"], ["highlight_line", "Yellow line"], ["section_head", "Section heading"], ["text", "Text"]];
function runsText(runs) { return (runs || []).map(r => r.text).join(""); }
function vQuote() {
  const p = cur(), q = p.quote_doc;
  const f = (k, l, t) => `<label>${l}${inp("quote_doc." + k, { type: t || "text" })}</label>`;
  return `<div class="grid2"><div class="card"><h2>Header</h2><div class="form">
    ${f("quotation_no", "Quotation no.")}${f("job_no", "Job information no.")}${f("customer_name", "Customer name")}${f("contact_person", "Contact person")}${f("tel", "Telephone")}${f("fax", "Fax")}${f("email", "E-mail")}
    ${f("product_subject", "Product subject")}${f("drawing_no", "Drawing no.")}${f("enquiry_date", "Enquiry date (YYYY-MM-DD)")}${f("quotation_date", "Quotation date")}${f("validity_date", "Validity")}
    ${f("payment_term", "Term of payment")}${f("delivery_time", "Delivery time", "num")}${f("delivery_unit", "Delivery unit")}${f("currency_label", "Currency label")}
    ${f("prepared_by", "Prepared by")}${f("reviewed_by", "Reviewed by")}${f("approved_by", "Approved by")}</div>
    <h2 style="margin-top:12px">Product line</h2><div class="form"><label>Title text${`<input class="i w" data-act="title" value="${esc(runsText(q.title.runs))}">`}</label>${f("title.qty", "Qty", "num")}${f("title.unit", "Unit")}</div></div>
    <div class="card"><h2>Body rows <span class="grow"></span>${btn("+ Row", "add:row", "small")}</h2>
    <p class="small muted">Item headings get the green fill, yellow rows the highlight. Toggle bold / red per row; rows with mixed formatting from the original keep their runs.</p>
    <div class="tw" style="max-height:520px;overflow:auto"><table><tr><th>#</th><th>Kind</th><th>Item</th><th>Text</th><th>B</th><th>Red</th><th></th></tr>
    ${q.rows.map((row, i) => { const multi = (row.runs || []).length > 1; const r0 = (row.runs || [])[0] || {};
      return `<tr><td>${i + 1}</td><td><select class="i" data-act="rowkind:${i}">${KINDS.map(k => `<option value="${k[0]}" ${row.kind === k[0] ? "selected" : ""}>${k[1]}</option>`).join("")}</select></td>
      <td>${row.kind === "item" ? `<input class="i n" style="width:50px" data-act="rowitem:${i}" value="${esc(row.item_no)}">` : ""}</td>
      <td><input class="i w" data-act="rowtext:${i}" value="${esc(runsText(row.runs))}" ${multi ? 'title="mixed formatting – editing keeps the first run style"' : ""}></td>
      <td><input type="checkbox" data-act="rowbold:${i}" ${r0.bold ? "checked" : ""}></td><td><input type="checkbox" data-act="rowred:${i}" ${(row.runs || []).some(x => x.color && /FF0000$/i.test(x.color)) ? "checked" : ""}></td>
      <td style="white-space:nowrap">${btn("↑", "rowup:" + i, "small")}${btn("↓", "rowdn:" + i, "small")}${btn("✕", "rowdel:" + i, "small")}</td></tr>`; }).join("")}
    </table></div></div></div>
    <div class="card"><h2>Preview <span class="small muted">A4 layout of the Prolog FM-SAL-001 quotation</span><span class="grow"></span>${btn("Download PDF", "export:pdf", "primary small")}</h2>
    <div class="paperwrap" id="paper">${paperHTML()}</div></div>`;
}
function fmtDate(s) {
  if (!s) return "-";
  const d = new Date(String(s).slice(0, 10) + "T00:00:00");
  if (isNaN(d)) return esc(s);
  return d.getDate() + "-" + d.toLocaleString("en-US", { month: "short" }) + "-" + String(d.getFullYear()).slice(2);
}
function runHTML(r) {
  const red = r.color && /FF0000$/i.test(r.color);
  return `<span style="${r.bold ? "font-weight:700;" : ""}${r.underline ? "text-decoration:underline;" : ""}${r.italic ? "font-style:italic;" : ""}${red ? "color:#f00;" : ""}">${esc(r.text).replace(/^ +/, m => "&nbsp;".repeat(m.length))}</span>`;
}
function pageHead() {
  return `<div class="hd"><img src="${IMGS.logo}" alt="Prolog Titanium logo"><b>PROLOG TITANIUM CORPORATION CO.,LTD.</b></div>
    <div class="addr">Address : 48/107 Moo2 Bangkruai-Sainoi Rd., Bang Rak Yai, Bangbuathong Nonthaburi Thailand 11110<br>Tel : (66) 0-2920-4046&nbsp; Mobile : (66) 086-627-9830 &nbsp; Fax : (66) 0-2920-4044 E-mail :&nbsp; info@titanium.co.th&nbsp; http://www.titanium.co.th</div>`;
}
const pageFoot = `<div class="pfoot"><span>Prolog Titanium Corporation Co.,Ltd.</span><span>FM-SAL-001 REV.NO.03 EFF.DATE 05/03/25</span></div>`;
function infoBlock(q, cur_) {
  const L = [["Quotation No. :", q.quotation_no], ["Customer Name :", q.customer_name], ["Contact Person :", q.contact_person], ["Telehone No. :", q.tel || "-"], ["Fax No. :", q.fax || "-"], ["E-mail :", q.email || "-"], ["Product Subject :", q.product_subject], ["Drawing No. :", q.drawing_no || "-"]];
  const R = [["Job Information No. :", q.job_no, ""], ["Enquiry Date :", fmtDate(q.enquiry_date), ""], ["Quotation Date :", fmtDate(q.quotation_date), ""], ["Quotation Validity :", fmtDate(q.validity_date), "hl"],
    ["Term of Payment :", q.payment_term || "-", "hl"], ["Delivery Time :", (q.delivery_time === null || q.delivery_time === undefined || q.delivery_time === "" ? "-" : Number(q.delivery_time).toFixed(2) + "&nbsp;&nbsp; " + esc(q.delivery_unit || "Months")), "hl"], ["Currency :", q.currency_label || cur_ + ".", "hl"]];
  return `<div class="qinfo"><div class="left">${L.map(([k, v]) => `<div class="r"><span class="k">${k}</span><span class="v">${esc(v || "")}</span></div>`).join("")}</div>
    <div class="right">${R.map(([k, v, c]) => `<div class="r"><span class="k">${k}</span><span class="v ${c}">${String(v).includes("&nbsp;") ? v : esc(v)}</span></div>`).join("")}</div></div>`;
}
function paperHTML() {
  const p = cur(), q = p.quote_doc, r = S.result, cu = r.totals.currency;
  const items = {}; r.items.forEach(it => items[it.no] = it);
  const thead = `<tr><th style="width:24px">Item</th><th>Description</th><th style="width:74px">Unit Price (${esc(cu)}.)</th><th style="width:40px">Q'ty</th><th style="width:22px">Unit</th><th style="width:84px">Total Price (${esc(cu)}.)</th></tr>`;
  const rowsAll = [{ kind: "title", runs: q.title.runs }].concat(q.rows);
  const H = row => (row.height && row.height > 15.5) ? row.height : 15;
  // page break: explicit list (row index after which to break) or auto by height
  let breaks = Array.isArray(q.page_breaks) ? q.page_breaks.slice() : null;
  if (!breaks) {
    breaks = []; let used = 0; const cap = 546;
    rowsAll.forEach((row, i) => { used += H(row); if (used > cap) { let cut = i - 1; for (let k = i - 1; k > i - 12 && k > 0; k--) if (rowsAll[k].kind === "blank") { cut = k; break; } breaks.push(cut); used = rowsAll.slice(cut + 1, i + 1).reduce((a, x) => a + H(x), 0); } });
    const tail = rowsAll.slice((breaks[breaks.length - 1] || -1) + 1).reduce((a, x) => a + H(x), 0);
    if (tail + 45 + 60 > 600) breaks.push(rowsAll.length - 1);
  }
  const chunks = []; let start = 0;
  breaks.filter(b => b >= 0 && b < rowsAll.length).forEach(b => { chunks.push(rowsAll.slice(start, b + 1)); start = b + 1; });
  chunks.push(rowsAll.slice(start));
  const rowTR = (row, last) => {
    const h = H(row);
    const cls = (row.kind === "item" ? "item" : "") + (row.kind.startsWith("highlight") ? " yl" : "") + (last ? " lastrow" : "");
    let d = (row.runs || []).map(runHTML).join("");
    if (row.kind === "item") d = `<span class="h">${d || "&nbsp;"}</span>`;
    if (row.kind.startsWith("highlight")) d = `<span class="yv">${d || "&nbsp;"}</span>`;
    let a = "", up = "", qt = "", un = "", tot = "";
    if (row.kind === "item") { const it = items[row.item_no]; a = `<b>${esc(row.item_no)}</b>`; if (it) { up = money(it.unit_price); qt = money(it.qty); un = esc(row.unit || it.unit); tot = money(it.total); } }
    if (row.kind === "title") { d = d.replace(/<span style="/g, '<span style="font-weight:700;'); }
    return `<tr class="${cls}" style="height:${h * 0.95}px"><td class="c">${a}</td><td class="d">${d}</td><td class="num">${up}</td><td class="num">${qt}</td><td class="c">${un}</td><td class="num">${tot}</td></tr>`;
  };
  const totals = `<div class="qtot"><div><div class="sig"><div class="h">Prepared By</div><div class="h">Reviewed By</div><div class="h">Approved By</div><div class="h">Confirm Order</div>
      <div style="font-size:10.5px">${esc(q.prepared_by)}</div><div style="font-size:10.5px">${esc(q.reviewed_by)}</div><div style="font-size:10.5px">${esc(q.approved_by)}</div><div></div><div>&nbsp;</div><div></div><div></div><div></div></div></div>
    <div class="tots"><div class="r"><b>Total Price (${esc(cu)}.)</b><span></span><span class="n">${money(r.totals.total)}</span></div>
      <div class="r y"><b>Discount (${esc(cu)})</b><b style="text-align:center">${(r.totals.discount_pct * 100).toFixed(0)}%</b><span class="n">${money(r.totals.discount)}</span></div>
      <div class="r y"><b>Net Total Price (${esc(cu)}.)</b><span></span><span class="n">${money(r.totals.net)}</span></div></div></div>`;
  const pages = chunks.map((ch, ci) => {
    const last = ci === chunks.length - 1;
    const body = ch.map((row, k) => rowTR(row, !last && k === ch.length - 1)).join("");
    return `<div class="page">${pageHead()}<div class="qbox"><div class="qtitle">QUOTATION</div>${infoBlock(q, cu)}<table class="qt">${thead}${body}</table>${last ? totals : ""}</div>
      ${last ? `<img class="certs" src="${IMGS.certs}" alt="Certifications: ISO, DBD governance, Titanium member, Green Industry, ASME U, R, NB stamps">` : ""}${pageFoot}</div>`;
  });
  if (q.include_disclaimers !== false) pages.push(disclaimerPage(q));
  return pages.join("");
}
function disclaimerPage(q) {
  const P = `<span class="pn">${esc(q.product_subject)}</span>`, C = `<span class="cn">${esc(q.customer_name)}</span>`;
  return `<div class="page">${pageHead()}<div class="disc">
    <b><u>Disclaimers</u></b><br>
    1. As the ${P} ordered by the ${C} is custom-made, the PROLOG TITANIUM CORPORATION CO.,LTD. is required to make advance payments for, including but not limited to, plat, bar, tube, pipe, and fitting as a raw material. In the event that the ${C} elects to terminate the order under this Quotation, the ${C} acknowledges and agrees to pay: (i) the Price, specified in this Quotation, of the ${P} as completed at the time of termination; (ii) the actual cost of any remaining raw materials that have not yet been processed into the ${P}; and (iii) the actual operating expenses and labor costs incurred in the manufacturing process of the ${P}<br><br>
    2. The ${C} also acknowledges that the ${P} is made to order and, therefore, cannot be sold to other clients of the PROLOG TITANIUM CORPORATION CO.,LTD. Accordingly, the ${C} agrees that this Quotation does not provide any return policy for the ${P} In addition, in the case that the ${C} terminates the order under this Quotation after the PROLOG TITANIUM CORPORATION CO.,LTD. starts the manufacturing process, the ${C} agree to accept the delivery of the ${P} in the condition it was manufactured at the time of termination.<br><br>
    3. ${P} shall mean the list of items in this Quotation.<br><br><br>
    <b>Green Procurement</b><br>
    &nbsp;- Green materials:Titanium scraps management and recycling<br>&nbsp;- Green Energy: 200 KW Solar Energy<br>&nbsp;- Green Water: Hydrotest water recycling systems<br>&nbsp;- Green Transportation: 4 Electric Vehicles<br>&nbsp;- Green Technology: Plasma Welding Robot<br>&nbsp;- Green Workshop: Cleanroom workshop with humidity control systems<br>&nbsp;- Green Labour: Certified Thai Labour Standard TLS8001<br>&nbsp;- Green Standard: Certified ISO9001, 45001, 14000, U-Stamp, R-Stamp, NB-Stamp<br>&nbsp;- Green Industry: Certified Green Industrial Standard Level3</div>
    <img class="certs" style="position:absolute;bottom:60px;left:38px" src="${IMGS.certs}" alt="Certifications">${pageFoot}</div>`;
}

/* ---------------- supplier prices ---------------- */
function vSuppliers() {
  const list = supplierPrices();
  const q = (S.supQ || "").toLowerCase();
  const rows = list.filter(s => !q || (s.supplier + " " + s.material + " " + s.description + " " + s.group).toLowerCase().includes(q));
  return `<div class="card"><h2>Supplier price database <span class="grow"></span><input class="i" style="max-width:260px" placeholder="Search material, size, supplier" data-act="supq" value="${esc(S.supQ || "")}"></h2>
    <p class="small muted">Verified prices from imported quotations. Use "Pick price" on a price-sheet line to apply one; the source is recorded with the line.</p>
    <div class="tw" style="max-height:600px;overflow:auto"><table><tr><th>Supplier</th><th>Group</th><th>Material</th><th>Description</th><th class="n">Unit price</th><th>Cur.</th><th class="n">kg/pc</th><th>Source</th></tr>
    ${rows.map(s => `<tr><td>${esc(s.supplier)}</td><td>${esc(s.group)}</td><td>${esc(s.material)}</td><td>${esc(s.description)}</td><td class="n">${money(s.unit_price)}</td><td>${esc(s.currency)}</td><td class="n">${s.unit_weight ? num(s.unit_weight) : "—"}</td><td class="small muted">${esc(s.source)}</td></tr>`).join("")}
    </table></div></div>`;
}
function supplierPrices() {
  const extra = []; S.projects.forEach(p => (p.estimate.price_sheets || []).forEach(sh => (sh.lines || []).forEach(l => { if (l.unit_price && l.price_source && /^manual/.test(l.price_source)) extra.push({ supplier: "Manual entry", group: l.group, material: l.material, description: l.description, unit_price: l.unit_price, currency: sh.currency, unit_weight: l.unit_weight, source: p.name }); })));
  return SEED.supplier_prices.concat(extra);
}

/* ---------------- projects ---------------- */
function vProjects() {
  return `<div class="card"><h2>Projects <span class="grow"></span>${btn("+ New blank project", "proj:new", "primary small")}${btn("Duplicate current", "proj:dup", "small")}${btn("Import JSON", "proj:import", "small")}${btn("Export JSON", "export:json", "small")}</h2>
    <p class="small muted">${S.caps.db ? "Projects are saved to your account and on this browser." : "Projects are saved on this browser."} New projects start from Prolog's factory rate tables (labor, machines, materials, price-sheet structure) with no quantities, so every missing input shows up as a question.</p>
    <div class="tw"><table><tr><th>Project</th><th>Status</th><th>Customer</th><th class="n">Net</th><th>Updated</th><th></th></tr>
    ${S.projects.map(p => { const r = E.compute(p.estimate); return `<tr><td>${esc(p.name)}</td><td>${esc(p.status)}</td><td>${esc(p.quote_doc.customer_name)}</td><td class="n">${money(r.totals.net)} ${esc(r.totals.currency)}</td>
      <td>${new Date(p.updated).toLocaleString()}</td><td>${btn("Open", "proj:open:" + p.id, "small")} ${S.projects.length > 1 ? btn("Delete", "proj:del:" + p.id, "small") : ""}</td></tr>`; }).join("")}
    </table></div><input type="file" id="importfile" accept=".json" hidden></div>
    <div class="card"><h2>How the numbers are built</h2><p class="small">This app reproduces Prolog's FM-SAL-001 quotation workbook: supplier price sheets with freight spread by value and per-piece ROUNDUP; labor rate table → crews (persons × days); machine-hour rates → part processes; services with minimum charges; quote items priced at ROUNDUP(cost × (1 + OVH + Risk) ÷ divisor, −1). The reference project reproduces the original quotation QT-2608533 to the cent.</p></div>`;
}

/* ---------------- AI assistant (Claude via the page's sample capability) ---------------- */
function vAI() {
  const a = S.ai, has = !!S.caps.sample;
  const off = has ? "" : `<p class="pill warn">Claude is not available in this view. Open the page on claude.ai while signed in.</p>`;
  const ext = a.extraction;
  return `${off}
  <div class="card"><h2>1. Read an engineering drawing</h2>
    <p class="small muted">Upload a drawing (PDF or image, scans included). Claude reads the parts list, nozzle schedule and design data, marks what is unclear, and you accept rows into the BOM. Nothing is added without your approval.</p>
    <div class="dropzone"><input type="file" id="dwgfile" accept=".pdf,image/*" ${has ? "" : "disabled"}> <div class="small">PDF pages are rendered at high resolution with zoomed tiles so small text stays readable.</div></div>
    <label class="small muted" style="display:block;margin-top:6px">Context for Claude (optional)<input class="i" id="dwgctx" placeholder="e.g. customer drawing; red mark-ups override printed values; material Ti Gr.2"></label>
    ${a.dwgThumbs ? `<div class="thumbs" style="margin-top:8px">${a.dwgThumbs.map(t => `<img src="${t}" alt="drawing page">`).join("")}</div>` : ""}
    <div style="margin-top:8px">${btn(a.busy === "dwg" ? "Reading drawing…" : "Analyze with Claude", "ai:dwg", "primary")} <span class="small muted">${esc(a.dwgStatus || "")}</span></div>
    ${ext ? extractionHTML(ext) : ""}</div>
  <div class="card"><h2>2. Suggest crew, processes and services</h2>
    <p class="small muted">Claude proposes estimates using only your factory tables and the reference project as evidence, and lists what must be confirmed. It never proposes supplier prices.</p>
    ${btn(a.busy === "est" ? "Thinking…" : "Suggest estimate", "ai:est", "primary")}
    ${a.est ? estHTML(a.est) : ""}</div>
  <div class="card"><h2>3. Draft quotation text in house style</h2>
    ${btn(a.busy === "qt" ? "Drafting…" : "Draft description rows", "ai:qt", "primary")}
    ${a.qt ? `<div class="ai-out" style="margin-top:8px">${esc(a.qt.title || "")}\n${(a.qt.rows || []).map(r => (r.kind === "item" ? "[" + r.item_no + "] " : "   ") + runsText(r.runs)).join("\n")}</div>
      <div style="margin-top:6px">${btn("Replace quotation body rows", "ai:qtapply", "small")} <span class="small muted">${esc((a.qt.notes_for_engineer || []).join(" · "))}</span></div>` : ""}</div>
  <div class="card"><h2>4. Ask about this estimate</h2>
    <div style="display:flex;gap:6px"><input class="i" id="askq" placeholder="e.g. Why is the labor item 68,820? What drives the material cost? What is still missing?"> ${btn(a.busy === "ask" ? "…" : "Ask", "ai:ask", "primary")}</div>
    ${a.answer ? `<div class="ai-out" style="margin-top:8px">${esc(a.answer)}</div>` : ""}</div>`;
}
function extractionHTML(x) {
  const parts = x.parts || [];
  return `<h2 style="margin-top:12px">Extracted <span class="pill ok">${parts.length} parts</span> <span class="pill ${x.unclear_items && x.unclear_items.length ? "warn" : "ok"}">${(x.unclear_items || []).length} unclear</span></h2>
    <p class="small">${esc(x.summary || "")}</p>
    ${(x.design_data || []).length ? `<div class="chips">${x.design_data.map(d => `<span class="chip">${esc(d.key)}: <b>${esc(d.value)}</b> ${esc(d.unit || "")}</span>`).join("")}</div>` : ""}
    <div class="tw" style="margin-top:8px"><table><tr><th>Use</th><th>Mark</th><th>Part</th><th>Material</th><th>Form</th><th class="n">Thk</th><th class="n">Width</th><th class="n">Length</th><th class="n">OD</th><th class="n">Qty</th><th class="n">Conf.</th><th>Unclear</th></tr>
    ${parts.map((p, i) => `<tr><td><input type="checkbox" data-act="xacc:${i}" ${p._accept ? "checked" : ""}></td><td>${esc(p.mark || "")}</td>
      ${["name", "material_spec", "form", "thk_mm", "width_mm", "length_mm", "od_mm", "qty"].map(k => `<td><input class="i ${/mm|qty/.test(k) ? "n" : ""}" data-act="xedit:${i}:${k}" value="${esc(p[k] === null || p[k] === undefined ? "" : p[k])}"></td>`).join("")}
      <td class="n"><span class="pill ${p.confidence >= 0.8 ? "ok" : "warn"}">${Math.round((p.confidence || 0) * 100)}%</span></td><td class="small">${esc((p.unclear_fields || []).join(", "))}</td></tr>`).join("")}
    </table></div>
    <div style="margin-top:6px">${btn("Add ticked parts to BOM", "ai:tobom", "primary small")} ${btn("Also add as price-sheet stock lines (no price)", "ai:tostock", "small")}</div>
    ${(x.nozzles || []).length ? `<h2 style="margin-top:10px">Nozzles</h2><div class="tw"><table><tr><th>Mark</th><th>Service</th><th>Size</th><th>Rating</th><th>Type</th><th class="n">Qty</th></tr>${x.nozzles.map(n => `<tr><td>${esc(n.mark)}</td><td>${esc(n.service || "")}</td><td>${esc(n.size || "")}</td><td>${esc(n.flange_rating || "")}</td><td>${esc(n.type || "")}</td><td class="n">${esc(n.qty || "")}</td></tr>`).join("")}</table></div>` : ""}
    ${(x.unclear_items || []).length ? `<h2 style="margin-top:10px">Questions to resolve</h2><ul>${x.unclear_items.map(u => `<li><b>${esc(u.field)}</b>: ${esc(u.description)} — <i>${esc(u.question)}</i></li>`).join("")}</ul>` : ""}`;
}
function estHTML(s) {
  return `<div style="margin-top:8px">
    ${s.crew_days ? `<p>Crew days: <b>${esc(s.crew_days)}</b> — ${esc(s.crew_days_rationale || "")} ${btn("Apply days", "ai:days", "small")}</p>` : ""}
    ${(s.crew || []).length ? `<div class="tw"><table><tr><th>Role</th><th>Rate ID</th><th class="n">Persons</th><th>Why</th><th></th></tr>${s.crew.map((c, i) => `<tr><td>${esc(c.role)}</td><td>${esc(c.rate_id)}</td><td class="n">${esc(c.persons)}</td><td class="wrap small">${esc(c.rationale)}</td><td>${btn("Apply", "ai:crew:" + i, "small")}</td></tr>`).join("")}</table></div>` : ""}
    ${(s.services || []).length ? `<div class="tw" style="margin-top:6px"><table><tr><th>Service</th><th class="n">Rate</th><th class="n">Qty</th><th class="n">Min</th><th class="n">Amount</th><th>Evidence</th><th></th></tr>${s.services.map((c, i) => `<tr><td>${esc(c.group)} · ${esc(c.name)}</td><td class="n">${esc(c.rate ?? "")}</td><td class="n">${esc(c.qty ?? "")}</td><td class="n">${esc(c.minimum ?? "")}</td><td class="n">${esc(c.amount ?? "")}</td><td class="wrap small">${esc(c.evidence || c.rationale)}</td><td>${btn("Add", "ai:svc:" + i, "small")}</td></tr>`).join("")}</table></div>` : ""}
    ${(s.processes || []).length ? `<div class="tw" style="margin-top:6px"><table><tr><th>Part</th><th>Machine</th><th class="n">Hours</th><th>Why</th><th></th></tr>${s.processes.map((c, i) => `<tr><td>${esc(c.part_ref)}</td><td>${esc(c.machine)}</td><td class="n">${esc(c.hours)}</td><td class="wrap small">${esc(c.rationale)}</td><td>${btn("Add", "ai:proc:" + i, "small")}</td></tr>`).join("")}</table></div>` : ""}
    ${(s.questions || []).length ? `<p><b>Needs confirmation:</b></p><ul>${s.questions.map(q => `<li>${esc(q)}</li>`).join("")}</ul>` : ""}
    <p class="small muted">${esc(s.confidence_note || "")}</p></div>`;
}

async function aiDrawing() {
  const sample = S.caps.sample; if (!sample) return;
  const blobs = S.ai.dwgBlobs; if (!blobs || !blobs.length) { toast("Choose a drawing file first"); return; }
  S.ai.busy = "dwg"; S.ai.dwgStatus = "Sending " + blobs.length + " images to Claude…"; render();
  const ctx = ($("#dwgctx") || {}).value || "";
  const schema = `{"drawing_type":"vendor_fabrication|customer_reference|as_built|general_arrangement|detail|other","summary":"2-4 sentences",
"title_block":[{"key":"","value":""}],"design_data":[{"key":"","value":"","unit":"","confidence":0.0}],"main_dimensions":[{"key":"","value":"","unit":""}],
"parts":[{"mark":"","name":"","category":"shell|head|nozzle_neck|flange|stub_end|lining|pad|support|base_plate|lug|gusset|ring|pipe|plate|bar|gasket|bolting|other","material_spec":"","form":"plate|pipe|tube|bar|forging|flange|fitting|gasket|bolt|other","thk_mm":null,"width_mm":null,"length_mm":null,"od_mm":null,"qty":null,"notes":"","confidence":0.0,"unclear_fields":[]}],
"nozzles":[{"mark":"","service":"","size":"","flange_rating":"","type":"","qty":null,"confidence":0.0}],
"unclear_items":[{"field":"","description":"","question":""}]}`;
  const prompt = `You are a senior pressure-vessel / titanium fabrication estimator at Prolog Titanium (Thailand). The images are an engineering drawing: for each page an overview and then zoomed tiles (in order).
Extract only what is written or unambiguously dimensioned. Never guess a number: if illegible or inferred, leave it null, list the field in unclear_fields, lower confidence and add an unclear_items entry with a concrete question. Handwritten (often red) mark-ups override printed values. Use mm. Keep exact material designations (ASTM B265 Gr.2, SB-265 Gr.2, A36, SS400, A105, PTFE ...).
Engineer context: ${ctx || "-"}
Return ONLY JSON in this shape:\n${schema}`;
  try {
    const x = await sample.json(prompt, { images: blobs, modelTier: "complex", cache: false });
    (x.parts || []).forEach(p => { p._accept = (p.confidence || 0) >= 0.8 && !(p.unclear_fields || []).length; });
    S.ai.extraction = x; S.ai.dwgStatus = "Done. Review the rows, untick anything wrong, correct values, then add.";
    const pj = cur(); pj.drawings = (pj.drawings || []).concat([{ at: Date.now(), name: S.ai.dwgName, extraction: x }]); scheduleSave();
  } catch (e) { S.ai.dwgStatus = aiErr(e); }
  S.ai.busy = null; render();
}
function aiErr(e) {
  if (e && e.code === "not_granted") return "Claude access was declined for this page.";
  if (e && e.code === "rate_limited") return "Claude is busy (rate limited). Try again in a minute.";
  return "Claude could not complete this: " + ((e && e.message) || e);
}
async function loadDrawing(file) {
  S.ai.dwgName = file.name; S.ai.dwgStatus = "Preparing pages…"; render();
  const blobs = [], thumbs = [];
  const canvasToBlob = c => new Promise(res => c.toBlob(b => res(b), "image/png"));
  async function addCanvas(c) {
    thumbs.push(c.toDataURL("image/jpeg", 0.5));
    const max = 1568;
    const ov = document.createElement("canvas"); const k = Math.min(1, max / Math.max(c.width, c.height));
    ov.width = Math.round(c.width * k); ov.height = Math.round(c.height * k); ov.getContext("2d").drawImage(c, 0, 0, ov.width, ov.height); blobs.push(await canvasToBlob(ov));
    const w = c.width, h = c.height, ox = w * 0.05, oy = h * 0.05;
    for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 2; tx++) {
      const x0 = Math.max(0, tx * w / 2 - ox), y0 = Math.max(0, ty * h / 2 - oy), x1 = Math.min(w, (tx + 1) * w / 2 + ox), y1 = Math.min(h, (ty + 1) * h / 2 + oy);
      const t = document.createElement("canvas"); const kk = Math.min(1, max / Math.max(x1 - x0, y1 - y0));
      t.width = Math.round((x1 - x0) * kk); t.height = Math.round((y1 - y0) * kk);
      t.getContext("2d").drawImage(c, x0, y0, x1 - x0, y1 - y0, 0, 0, t.width, t.height); blobs.push(await canvasToBlob(t));
    }
  }
  try {
    if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) {
      const pdfjs = window.pdfjsLib; pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
      for (let i = 1; i <= Math.min(doc.numPages, 3); i++) {
        const page = await doc.getPage(i); const vp0 = page.getViewport({ scale: 1 }); const scale = 3136 / Math.max(vp0.width, vp0.height);
        const vp = page.getViewport({ scale }); const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
        await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise; await addCanvas(c);
      }
    } else {
      const img = await createImageBitmap(file); const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; c.getContext("2d").drawImage(img, 0, 0); await addCanvas(c);
    }
    let lim = null; try { lim = await S.caps.sample.limits(); } catch (e) { lim = null; }
    const maxImgs = lim && lim.images && lim.images.maxCount ? lim.images.maxCount : 15;
    S.ai.dwgBlobs = blobs.slice(0, maxImgs); S.ai.dwgThumbs = thumbs;
    S.ai.dwgStatus = S.ai.dwgBlobs.length + " images ready" + (blobs.length > S.ai.dwgBlobs.length ? " (limited to " + S.ai.dwgBlobs.length + ")" : "") + ".";
  } catch (e) { S.ai.dwgStatus = "Could not read this file: " + e.message; }
  render();
}
function gradeFor(p) {
  const spec = String(p.material_spec || "").toUpperCase().replace(/[\s-]/g, ""); const g = (/GR\.?(\d+)/.exec(spec) || [])[1]; const form = p.form || "plate";
  if (/B265|SB265/.test(spec) || (/TI/.test(spec) && form === "plate")) return { 1: "01", 2: "02", 4: "03", 5: "04", 7: "05" }[g] || "25";
  if ((form === "pipe" || form === "tube") && /B861|B862|B338|TI/.test(spec)) return { 1: "17", 2: "20" }[g] || "25";
  if (form === "bar" && g === "2") return "10";
  return "25";
}
function aiToBom(stock) {
  const p = cur(), x = S.ai.extraction; let n = 0;
  (x.parts || []).forEach((dp, i) => {
    if (!dp._accept) return;
    const form = dp.form || "plate", N = v => (v === "" || v === null || v === undefined) ? null : Number(v);
    let shape = "TWL", s1 = N(dp.thk_mm), s2 = N(dp.width_mm), s3 = N(dp.length_mm);
    if (form === "pipe" || form === "tube") { shape = "ODTL"; s1 = N(dp.od_mm); s2 = N(dp.thk_mm); s3 = N(dp.length_mm); }
    else if (form === "bar") { shape = "DiaL"; s1 = N(dp.od_mm); s2 = N(dp.length_mm); s3 = null; }
    const code = gradeFor(dp), mat = (p.estimate.materials || []).find(m => m.code === code);
    p.estimate.parts.push({ id: "d" + uid(), name: (dp.name || "Part") + (dp.mark ? " [" + dp.mark + "]" : ""), group: dp.category || "", grade_code: code, grade: mat ? mat.name : code,
      material_spec: dp.material_spec, shape, s1, s2, s3, qty: N(dp.qty), pricing: "price_sheet", processes: [], source: "drawing " + (S.ai.dwgName || ""), remark: dp.notes || "" });
    if (stock) {
      const sheet = /SS400|A36|A105|PTFE|SUS|CARBON|NBR/i.test(dp.material_spec || "") ? p.estimate.price_sheets.find(s => s.id === "domestic") : p.estimate.price_sheets.find(s => s.id === "import");
      if (sheet) sheet.lines.push({ id: "l" + uid(), group: form === "plate" ? "Plate" : form, material: dp.material_spec || "", description: [dp.width_mm, dp.length_mm, dp.thk_mm].every(v => v) ? `${dp.width_mm}x${dp.length_mm}x${dp.thk_mm}t mm.` : (dp.name || ""), qty: N(dp.qty), unit_price: null, price_source: "" });
    }
    n++;
  });
  toast(n + " parts added" + (stock ? " (stock lines need supplier prices)" : "")); changed();
}
function contextForAI() {
  const p = cur(), r = S.result, ref = S.projects.find(x => x.id.startsWith("ref-")) || referenceProject();
  return { project: { product: p.quote_doc.product_subject, customer: p.quote_doc.customer_name, title: runsText(p.quote_doc.title.runs) },
    bom: (p.estimate.parts || []).map(pt => ({ id: pt.id, name: pt.name, grade: pt.grade || pt.grade_code, shape: pt.shape, s1: pt.s1, s2: pt.s2, s3: pt.s3, qty: pt.qty, processes: pt.processes })),
    drawings: (p.drawings || []).map(d => ({ summary: d.extraction.summary, design_data: d.extraction.design_data, main_dimensions: d.extraction.main_dimensions, nozzles: d.extraction.nozzles })),
    factory: { labor_rates: (p.estimate.labor_rates || []).map(x => ({ id: x.id, position: x.position, site: x.site })), crew_roles: (p.estimate.crews || []).map(c => ({ crew: c.name, roles: c.members.map(m => ({ role: m.role, rate_id: m.rate_id })) })),
      machines: (p.estimate.machines || []).map(m => m.name) },
    reference_project: { title: runsText(ref.quote_doc.title.runs), crews: ref.estimate.crews.map(c => ({ name: c.name, days: c.days, members: c.members.map(m => ({ role: m.role, persons: m.persons })) })),
      services: ref.estimate.services.map(s => ({ group: s.group, name: s.name, rate: s.rate, qty: s.qty, minimum: s.minimum, amount: s.amount })),
      parts_processes: ref.estimate.parts.map(x => ({ name: x.name, qty: x.qty, processes: x.processes })), stock_weight_kg: E.compute(ref.estimate).weights.price_sheet_kg },
    current_totals: r.totals };
}
async function aiEstimate() {
  const sample = S.caps.sample; if (!sample) return;
  S.ai.busy = "est"; render();
  const prompt = `You are Prolog Titanium's estimating assistant. Use ONLY the factory tables and the reference project below as evidence; quote the evidence and scaling for every figure.
NEVER propose supplier material prices. If something cannot be justified, add a question instead of a number.
DATA:\n${JSON.stringify(contextForAI())}
Return ONLY JSON: {"crew_days":number|null,"crew_days_rationale":"","crew":[{"role":"","rate_id":"","persons":0,"rationale":""}],"processes":[{"part_ref":"part id or name","machine":"exact machine name","hours":0,"rationale":""}],"services":[{"group":"","name":"","rate":null,"qty":null,"minimum":null,"amount":null,"currency":"THB","rationale":"","evidence":""}],"questions":[""],"confidence_note":""}`;
  try { S.ai.est = await sample.json(prompt, { modelTier: "complex", cache: false }); } catch (e) { toast(aiErr(e)); }
  S.ai.busy = null; render();
}
async function aiQuoteText() {
  const sample = S.caps.sample; if (!sample) return;
  S.ai.busy = "qt"; render();
  const p = cur(), ref = SEED.quote_doc;
  const prompt = `Write Prolog Titanium customer quotation description rows in the company's exact house style. Example quotation rows (JSON): ${JSON.stringify(ref.rows.slice(0, 54))}
This project: ${JSON.stringify({ buckets: p.estimate.buckets.map(b => ({ no: b.no, heading: b.heading })), bom: p.estimate.parts.map(x => ({ name: x.name, grade: x.grade, s1: x.s1, qty: x.qty })), stock: p.estimate.price_sheets.flatMap(s => s.lines.map(l => ({ group: l.group, material: l.material, description: l.description, qty: l.qty }))), services: p.estimate.services.map(s => s.name), title: runsText(p.quote_doc.title.runs) })}
Use the same item order and numbering as the buckets. Only state materials/thicknesses/tests present in the data; use "[TBC]" where unknown and add a note.
Return ONLY JSON: {"title":"","rows":[{"kind":"item|line|bullet|blank|highlight_head|highlight_line|section_head|text","item_no":null,"runs":[{"text":"","bold":false,"underline":false,"color":null}]}],"notes_for_engineer":[""]}`;
  try { S.ai.qt = await sample.json(prompt, { modelTier: "default", cache: false }); } catch (e) { toast(aiErr(e)); }
  S.ai.busy = null; render();
}
async function aiAsk() {
  const sample = S.caps.sample; if (!sample) return;
  const q = ($("#askq") || {}).value; if (!q) return;
  S.ai.busy = "ask"; S.ai.answer = ""; render();
  const r = S.result;
  const tools = [{ name: "trace", description: "Explain how a computed value was calculated. Keys: item.N.price, item.N.base, totals.net, ces.direct, ps.import.total, crew.in-house.total, svc.total, parts.machine, rate.<id>, mach.<i>", inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
    execute: ({ key }) => { const t = E.trace(r, key, 3); const strip = n => ({ label: n.label, value: n.value, unit: n.unit, formula: n.formula, expr: n.expr, children: (n.children || []).map(strip) }); return strip(t); } }];
  const prompt = `You answer questions about a Prolog Titanium cost estimate. Be concise and exact; cite formulas and numbers. Use the trace tool to inspect calculations.
Summary: ${JSON.stringify({ items: r.items, totals: r.totals, ces: r.ces, open_issues: r.issues.slice(0, 30), categories_thb: r.summary_thb })}
Question: ${q}`;
  try { await sample(prompt, { tools, cache: false, onText: u => { S.ai.answer = u.text; const el = document.querySelector(".ai-out:last-child"); if (el && S.tab === "ai") el.textContent = u.text; } }); }
  catch (e) { S.ai.answer = aiErr(e); }
  S.ai.busy = null; render();
}

/* ---------------- trace drawer ---------------- */
function renderDrawer() {
  let d = $("#drawer");
  if (!S.drawer) { if (d) d.remove(); return; }
  if (!d) { d = document.createElement("aside"); d.id = "drawer"; d.className = "drawer"; d.setAttribute("aria-label", "Calculation trace"); document.body.appendChild(d); }
  const t = E.trace(S.result, S.drawer, 30);
  const open = S.traceOpen || (S.traceOpen = {});
  const node = (n, depth) => {
    const kids = n.children || [], key = n.key + "@" + depth, isOpen = depth < 2 || open[key];
    return `<div class="tnode"><div class="trow ${n.missing ? "miss" : ""}"><div>${kids.length ? `<button class="tog" data-act="tt:${esc(key)}">${isOpen ? "▾" : "▸"}</button>` : '<span class="tog">·</span>'}
      <span class="lab">${esc(n.label)}</span><div class="f">${esc(n.formula)}${n.expr ? "<br>" + esc(n.expr) : ""}${n.source ? "<br>source: " + esc(n.source) : ""}${n.missing ? "<br>MISSING INPUT" : ""}</div></div>
      <b style="font-family:var(--mono);white-space:nowrap">${num(n.value)} <span class="muted small">${esc(n.unit)}</span></b></div>
      ${isOpen ? kids.map(c => node(c, depth + 1)).join("") : ""}</div>`;
  };
  d.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0;font-size:15px">Calculation trace</h2>${btn("Close", "closedrawer", "small")}</div>
    <p class="small muted">Every number is derived from the inputs below. Red marks a missing input.</p>${node(t, 0)}`;
}

/* ---------------- exports ---------------- */
async function saveFile(filename, data) {
  if (S.caps.downloads) {
    try { await S.caps.downloads.save({ filename, data }); toast("Saved " + filename); return; }
    catch (e) { if (e && e.code === "declined") return; toast("Download failed: " + (e.message || e.code)); return; }
  }
  toast("Downloads are not available in this view.");
}
const fileBase = () => (cur().quote_doc.quotation_no || cur().name).replace(/[^A-Za-z0-9._-]+/g, "_");
async function exportPDF() {
  const prev = S.tab; if (S.tab !== "quote") { S.tab = "quote"; render(); }
  toast("Building PDF…");
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const pages = document.querySelectorAll("#paper .page");
  for (let i = 0; i < pages.length; i++) {
    const c = await html2canvas(pages[i], { scale: 2.5, backgroundColor: "#ffffff", useCORS: true });
    if (i) pdf.addPage();
    pdf.addImage(c.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 595.28, 841.89);
  }
  await saveFile(fileBase() + ".pdf", pdf.output("blob"));
  if (prev !== "quote") { S.tab = prev; render(); }
}
function colLetter(n) { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
async function exportQuoteXlsx() {
  const p = cur(), q = p.quote_doc, r = S.result, cu = r.totals.currency;
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("5. Quotation", { pageSetup: { paperSize: 9, orientation: "portrait", scale: 95, horizontalCentered: true,
    margins: { left: 0.472, right: 0.197, top: 0.433, bottom: 0.354, header: 0.157, footer: 0.315 }, printTitlesRow: "1:17" } });
  ws.headerFooter.oddFooter = '&L&"Angsana New,Regular"&14Prolog Titanium Corporation Co.,Ltd.&R&"Angsana New,Regular"&14FM-SAL-001 REV.NO.03 EFF.DATE 05/03/25';
  const widths = [4.41].concat(Array(11).fill(3.7), [3.85, 6.41, 6.28, 4.7, 4.7, 4.7, 3.7, 3.7, 3.99, 3.7, 3.7, 3.7, 3.7]);
  widths.forEach((w, i) => ws.getColumn(i + 1).width = w);
  const F = (o) => Object.assign({ name: "Cambria", size: 9 }, o || {});
  const med = { style: "medium" }, thin = { style: "thin" };
  const put = (addr, v, font, align) => { const c = ws.getCell(addr); c.value = v; c.font = F(font); if (align) c.alignment = align; return c; };
  const mergeSet = (rng, v, font, align, fill) => { ws.mergeCells(rng); const c = put(rng.split(":")[0], v, font, align); if (fill) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } }; return c; };
  [20.25, 20.25, 14.25, 14.25, 7.5, 18.75, 19.5].forEach((h, i) => ws.getRow(i + 1).height = h);
  const logoId = wb.addImage({ base64: IMGS.logo, extension: "png" });
  ws.addImage(logoId, { tl: { col: 0, row: 0.1 }, ext: { width: 136, height: 47 } });
  mergeSet("F1:Y2", "PROLOG TITANIUM CORPORATION CO.,LTD.", { size: 18, bold: true }, { vertical: "middle" });
  mergeSet("A3:Y3", "Address : 48/107 Moo2 Bangkruai-Sainoi Rd., Bang Rak Yai, Bangbuathong Nonthaburi Thailand 11110", { size: 8 }, { horizontal: "center" });
  mergeSet("A4:Y4", "Tel : (66) 0-2920-4046  Mobile : (66) 086-627-9830   Fax : (66) 0-2920-4044 E-mail :  info@titanium.co.th  http://www.titanium.co.th", { size: 8 }, { horizontal: "center" });
  mergeSet("A6:Y7", "QUOTATION", { size: 20, bold: true }, { horizontal: "center", vertical: "middle" });
  const L = [["Quotation No. :", q.quotation_no], ["Customer Name :", q.customer_name], ["Contact Person :", q.contact_person], ["Telehone No. :", q.tel || "-"], ["Fax No. :", q.fax || "-"], ["E-mail :", q.email || "-"], ["Product Subject :", q.product_subject], ["Drawing No. :", q.drawing_no || "-"]];
  const R = [["Job Information No. :", q.job_no], ["Enquiry Date :", q.enquiry_date], ["Quotation Date :", q.quotation_date], ["Quotation Validity :", q.validity_date], ["Term of Payment :", q.payment_term || "-"], ["Delivery Time :", q.delivery_time], ["Currency :", q.currency_label || cu + "."]];
  L.forEach(([k, v], i) => { const rr = 8 + i; ws.getRow(rr).height = 14.25; mergeSet(`A${rr}:D${rr}`, k, {}, { horizontal: "right" }); const c = mergeSet(`E${rr}:N${rr}`, v || "", {}, { horizontal: "center" }); c.border = { bottom: thin }; });
  R.forEach(([k, v], i) => { const rr = 8 + i; mergeSet(`P${rr}:T${rr}`, k, {}, { horizontal: "right" });
    const isDate = /Date|Validity/.test(k) && v; const val = isDate ? new Date(String(v).slice(0, 10) + "T00:00:00") : (v === null || v === undefined ? "-" : v);
    const c = mergeSet(i === 5 ? `U${rr}:W${rr}` : `U${rr}:Y${rr}`, val, i >= 3 ? { bold: true } : {}, { horizontal: "center" }, i >= 3 ? "FFFFFF00" : null);
    if (isDate) c.numFmt = "[$-409]d-mmm-yy;@"; if (i === 5) { c.numFmt = "#,##0.00"; mergeSet(`X${rr}:Y${rr}`, q.delivery_unit || "Months", { bold: true }, { horizontal: "center" }, "FFFFFF00"); }
    c.border = { bottom: thin }; });
  for (let rr = 6; rr <= 15; rr++) { ws.getCell("A" + rr).border = Object.assign({}, ws.getCell("A" + rr).border, { left: med }); ws.getCell("Y" + rr).border = Object.assign({}, ws.getCell("Y" + rr).border, { right: med }); }
  const hdr = [["A17", "A17", "Item"], ["B17", "O17", "Description"], ["P17", "R17", `Unit Price (${cu}.)`], ["S17", "T17", "Q'ty"], ["U17", "U17", "Unit"], ["V17", "Y17", `Total Price (${cu}.)`]];
  hdr.forEach(([a, b, t]) => { if (a !== b) ws.mergeCells(a + ":" + b); const c = put(a, t, { bold: true, size: a === "A17" || a === "U17" ? 8 : 9 }, { horizontal: "center", vertical: "middle" }); c.border = { top: med, bottom: med, left: med, right: med }; });
  const items = {}; r.items.forEach(it => items[it.no] = it);
  const rows = [{ kind: "title", runs: q.title.runs }].concat(q.rows);
  let rr = 18; const firstItem = 19;
  rows.forEach(row => {
    ws.getRow(rr).height = row.height || 15;
    ws.mergeCells(`B${rr}:O${rr}`); ws.mergeCells(`P${rr}:R${rr}`); ws.mergeCells(`S${rr}:T${rr}`); ws.mergeCells(`V${rr}:Y${rr}`);
    const runs = row.runs || [];
    const dcell = ws.getCell("B" + rr);
    dcell.value = runs.length > 1 ? { richText: runs.map(x => ({ text: x.text, font: F({ size: 8, bold: !!x.bold || row.kind === "title", underline: !!x.underline, color: x.color && /FF0000$/i.test(x.color) ? { argb: "FFFF0000" } : undefined }) })) } : (runs[0] ? runs[0].text : "");
    const r0 = runs[0] || {};
    dcell.font = F({ size: 8, bold: row.kind === "title" || row.kind === "item" || !!r0.bold, underline: !!r0.underline, color: r0.color && /FF0000$/i.test(r0.color) ? { argb: "FFFF0000" } : undefined });
    dcell.alignment = { vertical: "middle", wrapText: (row.height || 15) > 15.5 };
    if (row.kind === "item") dcell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD8E4BC" } };
    if (String(row.kind).startsWith("highlight")) dcell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
    const acc = '_-* #,##0.00_-;\\-* #,##0.00_-;_-* "-"??_-;_-@_-';
    if (row.kind === "item" && items[row.item_no]) {
      const it = items[row.item_no]; put("A" + rr, row.item_no, { bold: true }, { horizontal: "center" });
      const c1 = put("P" + rr, it.unit_price, { size: 9 }); c1.numFmt = acc; const c2 = put("S" + rr, it.qty, { size: 9 }); c2.numFmt = acc; put("U" + rr, row.unit || it.unit, { size: 9 });
      const c3 = ws.getCell("V" + rr); c3.value = { formula: `P${rr}*S${rr}`, result: it.total }; c3.numFmt = acc; c3.font = F();
    }
    if (row.kind === "title") { const c1 = put("P" + rr, r.totals.header_price, { color: { argb: "FFFFFFFF" } }); c1.numFmt = acc; put("S" + rr, q.title.qty || 1, { color: { argb: "FFFFFFFF" } }); put("U" + rr, q.title.unit || "Set.", { color: { argb: "FFFFFFFF" } }); }
    ["A", "B", "P", "S", "U", "V"].forEach(c => { const cell = ws.getCell(c + rr); cell.border = Object.assign({}, cell.border, { left: med }); });
    ["O", "R", "T", "U", "Y"].forEach(c => { const cell = ws.getCell(c + rr); cell.border = Object.assign({}, cell.border, { right: med }); });
    rr++;
  });
  const last = rr - 1, t = rr;
  [["A", "D", "Prepared By"], ["E", "H", "Reviewed By"], ["I", "L", "Approved By"], ["M", "O", "Confirm Order"]].forEach(([a, b, l]) => {
    ws.mergeCells(`${a}${t}:${b}${t}`); const c = put(a + t, l, { bold: true }, { horizontal: "center" }); c.border = { top: med, bottom: thin, left: med, right: med };
    ws.mergeCells(`${a}${t + 1}:${b}${t + 1}`); ws.mergeCells(`${a}${t + 2}:${b}${t + 2}`);
    const nm = { A: q.prepared_by, E: q.reviewed_by, I: q.approved_by, M: "" }[a]; const c2 = put(a + (t + 1), nm || "", { size: 11 }, { horizontal: "center" }); c2.border = { left: med, right: med };
    ws.getCell(a + (t + 2)).border = { left: med, right: med, bottom: med };
  });
  ws.mergeCells(`P${t}:U${t}`); put("P" + t, `Total Price (${cu}.)`, { bold: true, size: 11 }).border = { top: med, left: med };
  ws.mergeCells(`V${t}:Y${t}`); const ct = ws.getCell("V" + t); ct.value = { formula: `SUM(V${firstItem}:Y${last})`, result: r.totals.total }; ct.font = F({ bold: true, size: 11 }); ct.numFmt = "#,##0.00"; ct.border = { top: med, right: med };
  ws.mergeCells(`P${t + 1}:S${t + 1}`); const yl = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
  const d1 = put("P" + (t + 1), `Discount (${cu})`, { bold: true, size: 11 }); d1.fill = yl; d1.border = { left: med };
  ws.mergeCells(`T${t + 1}:U${t + 1}`); const d2 = put("T" + (t + 1), r.totals.discount_pct, { bold: true }, { horizontal: "center" }); d2.numFmt = "0%"; d2.fill = yl;
  ws.mergeCells(`V${t + 1}:Y${t + 1}`); const d3 = ws.getCell("V" + (t + 1)); d3.value = { formula: `V${t}*T${t + 1}`, result: r.totals.discount }; d3.numFmt = "#,##0.00"; d3.font = F({ bold: true, size: 11 }); d3.fill = yl; d3.border = { right: med };
  ws.mergeCells(`P${t + 2}:U${t + 2}`); const n1 = put("P" + (t + 2), `Net Total Price (${cu}.)`, { bold: true, size: 11 }); n1.fill = yl; n1.border = { left: med, bottom: med };
  ws.mergeCells(`V${t + 2}:Y${t + 2}`); const n2 = ws.getCell("V" + (t + 2)); n2.value = { formula: `V${t}-V${t + 1}`, result: r.totals.net }; n2.numFmt = "#,##0.00"; n2.font = F({ bold: true, size: 11 }); n2.fill = yl; n2.border = { right: med, bottom: med };
  const certId = wb.addImage({ base64: IMGS.certs, extension: "jpeg" });
  ws.addImage(certId, { tl: { col: 0.2, row: t + 2.3 }, ext: { width: 716, height: 74 } });
  ws.pageSetup.printArea = `A1:Y${t + 6}`;
  if (Array.isArray(q.page_breaks)) q.page_breaks.forEach(b => { const row = ws.getRow(18 + b); row.addPageBreak && row.addPageBreak(); });
  const dw = wb.addWorksheet("Disclaimers", { pageSetup: { paperSize: 9, scale: 98, margins: { left: 0.354, right: 0.079, top: 0.669, bottom: 0.748, header: 0.315, footer: 0.315 } } });
  dw.headerFooter.oddFooter = ws.headerFooter.oddFooter; dw.getColumn(1).width = 110;
  const txt = $("#paper") ? null : null;
  const lines = [["Disclaimers", { bold: true, underline: true }], ["1. As the " + q.product_subject + " ordered by the " + q.customer_name + " is custom-made, the PROLOG TITANIUM CORPORATION CO.,LTD. is required to make advance payments for, including but not limited to, plat, bar, tube, pipe, and fitting as a raw material. In the event that the " + q.customer_name + " elects to terminate the order under this Quotation, the " + q.customer_name + " acknowledges and agrees to pay: (i) the Price, specified in this Quotation, of the " + q.product_subject + " as completed at the time of termination; (ii) the actual cost of any remaining raw materials that have not yet been processed into the " + q.product_subject + "; and (iii) the actual operating expenses and labor costs incurred in the manufacturing process of the " + q.product_subject],
    ["2. The " + q.customer_name + " also acknowledges that the " + q.product_subject + " is made to order and, therefore, cannot be sold to other clients of the PROLOG TITANIUM CORPORATION CO.,LTD. Accordingly, the " + q.customer_name + " agrees that this Quotation does not provide any return policy for the " + q.product_subject + " In addition, in the case that the " + q.customer_name + " terminates the order under this Quotation after the PROLOG TITANIUM CORPORATION CO.,LTD. starts the manufacturing process, the " + q.customer_name + " agree to accept the delivery of the " + q.product_subject + " in the condition it was manufactured at the time of termination."],
    ["3. " + q.product_subject + " shall mean the list of items in this Quotation."], ["Green Procurement", { bold: true }],
    [" - Green materials:Titanium scraps management and recycling"], [" - Green Energy: 200 KW Solar Energy"], [" - Green Water: Hydrotest water recycling systems"], [" - Green Transportation: 4 Electric Vehicles"], [" - Green Technology: Plasma Welding Robot"], [" - Green Workshop: Cleanroom workshop with humidity control systems"], [" - Green Labour: Certified Thai Labour Standard TLS8001"], [" - Green Standard: Certified ISO9001, 45001, 14000, U-Stamp, R-Stamp, NB-Stamp"], [" - Green Industry: Certified Green Industrial Standard Level3"]];
  dw.getCell("A1").value = "PROLOG TITANIUM CORPORATION CO.,LTD."; dw.getCell("A1").font = F({ size: 18, bold: true }); dw.getCell("A1").alignment = { horizontal: "center" };
  lines.forEach((l, i) => { const c = dw.getCell("A" + (i + 3)); c.value = l[0]; c.font = F(l[1] || {}); c.alignment = { wrapText: true, vertical: "top" }; });
  const buf = await wb.xlsx.writeBuffer();
  await saveFile(fileBase() + ".xlsx", new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
}
async function exportCostingXlsx() {
  const p = cur(), est = p.estimate, r = S.result, Sx = r.settings;
  const wb = new ExcelJS.Workbook();
  const INP = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF4CC" } }, HDR = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A5F" } };
  const hdr = (ws, row, titles, widths) => { titles.forEach((t, i) => { const c = ws.getCell(row, i + 1); c.value = t; c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = HDR; c.alignment = { wrapText: true }; }); (widths || []).forEach((w, i) => ws.getColumn(i + 1).width = w); };
  const inputCell = (ws, addr, v) => { const c = ws.getCell(addr); if (typeof v === "string" && /[+\-*/]/.test(v.replace(/^-/, ""))) c.value = { formula: v.replace(/^=/, "") }; else c.value = (v === null || v === undefined || v === "") ? null : (isNaN(Number(v)) ? v : Number(v)); c.fill = INP; return c; };
  const f = (ws, addr, formula, result) => { const c = ws.getCell(addr); c.value = { formula, result }; c.numFmt = "#,##0.00"; return c; };
  // Settings
  const st = wb.addWorksheet("Settings"); st.getCell("A1").value = "Costing workbook — " + (p.quote_doc.job_no || "") + " " + (p.quote_doc.product_subject || ""); st.getCell("A1").font = { bold: true, size: 13 };
  st.getCell("A2").value = "Yellow cells are inputs; everything else is a formula.";
  hdr(st, 4, ["Name", "Description", "Value"], [16, 40, 16]);
  const sets = [["FX", "Exchange rate THB per USD", Sx.fx_thb_per_usd], ["TU_FACTOR", "THB->USD factor", Sx.thb_to_usd_factor], ["UT_FACTOR", "USD->THB factor", Sx.usd_to_thb_factor], ["OVH", "Overhead", Sx.ovh_pct], ["RISK", "Risk", Sx.risk_pct],
    ["DIVISOR", "Margin divisor", Sx.margin_divisor], ["ITEM_DIGITS", "Item ROUNDUP digits", Sx.item_round_digits], ["CES_DIGITS", "CES ROUNDUP digits", Sx.ces_round_digits], ["CES_DISC", "CES discount", Sx.ces_discount_pct], ["QUOTE_DISC", "Quotation discount", Sx.quote_discount_pct], ["SET_QTY", "Set quantity", Sx.set_qty]];
  const ref = {};
  sets.forEach(([n, d, v], i) => { const rr = 5 + i; st.getCell("A" + rr).value = n; st.getCell("B" + rr).value = d; inputCell(st, "C" + rr, v); ref[n] = "Settings!$C$" + rr; });
  let rr = 5 + sets.length; st.getCell("A" + rr).value = "TU"; st.getCell("B" + rr).value = "THB per USD for THB costs"; f(st, "C" + rr, `${ref.TU_FACTOR}*${ref.FX}`, r.TU); ref.TU = "Settings!$C$" + rr; rr++;
  st.getCell("A" + rr).value = "UT"; f(st, "C" + rr, `${ref.UT_FACTOR}*${ref.FX}`, r.UT); ref.UT = "Settings!$C$" + rr;
  const qcur = Sx.quote_currency || "USD";
  const conv = (expr, cur) => { cur = (cur || qcur).toUpperCase(); if (cur === qcur) return expr; return cur === "THB" ? `(${expr})/${ref.TU}` : `(${expr})*${ref.UT}`; };
  // Labor
  const wl = wb.addWorksheet("Labor"); const LP = est.labor_params || {};
  wl.getCell("A1").value = "Salary adjustment"; inputCell(wl, "B1", LP.salary_adj); wl.getCell("A2").value = "Days / month"; inputCell(wl, "B2", LP.days_per_month); wl.getCell("A3").value = "Hours / day"; inputCell(wl, "B3", LP.hours_per_day);
  hdr(wl, 5, ["Rate ID", "Position", "Site", "Salary THB/month", "Hourly override", "THB/hour", "", "", ""], [10, 26, 12, 16, 14, 14, 10, 12, 14]);
  const rateCell = {}; rr = 6;
  r.labor_rates.forEach(x => { wl.getCell("A" + rr).value = x.id; wl.getCell("B" + rr).value = x.position; wl.getCell("C" + rr).value = x.site; inputCell(wl, "D" + rr, x.salary);
    if (x.hourly_rate !== null && x.hourly_rate !== undefined && x.hourly_rate !== "") inputCell(wl, "E" + rr, x.hourly_rate);
    f(wl, "F" + rr, `IF(E${rr}<>"",E${rr},D${rr}*$B$1/$B$2/$B$3)`, x.rate); rateCell[x.id] = "Labor!$F$" + rr; rr++; });
  rr++; const crewTotals = [];
  r.crews.forEach((c, ci) => {
    wl.getCell("A" + rr).value = c.name + " crew"; wl.getCell("A" + rr).font = { bold: true, size: 12 }; rr++;
    const p0 = rr; [["Days", c.days], ["Per diem", c.per_diem || 0], ["OT x1.5 hours", c.ot15_hours || 0], ["OT x3 hours", c.ot3_hours || 0], ["Confined premium", c.confined_pct || 0]].forEach(([l, v]) => { wl.getCell("A" + rr).value = l; inputCell(wl, "B" + rr, v); rr++; });
    const [D, PD, O15, O3, CF] = [0, 1, 2, 3, 4].map(k => "$B$" + (p0 + k));
    hdr(wl, rr, ["Role", "Rate THB/h", "THB/day", "Per diem", "OT1.5", "OT3", "Premium", "Persons", "Cost / day"]); rr++;
    const m0 = rr;
    c.members.forEach(m => { wl.getCell("A" + rr).value = m.role; const rc = rateCell[m.rate_id]; const cc = wl.getCell("B" + rr); cc.value = rc ? { formula: rc.replace("Labor!", ""), result: m.rate } : 0;
      f(wl, "C" + rr, `B${rr}*$B$3`, m.day_rate); f(wl, "D" + rr, PD, c.per_diem || 0); f(wl, "E" + rr, `B${rr}*1.5*${O15}`, 0); f(wl, "F" + rr, `B${rr}*3*${O3}`, 0); f(wl, "G" + rr, `C${rr}*${CF}`, 0);
      inputCell(wl, "H" + rr, m.persons || 0); f(wl, "I" + rr, `(C${rr}*H${rr})+G${rr}+(H${rr}*D${rr})+(E${rr}*H${rr})+(F${rr}*H${rr})`, m.cost_per_day); rr++; });
    const m1 = rr - 1, ext = [];
    (est.crews[ci].extras_per_day || []).forEach(x => { wl.getCell("A" + rr).value = x.name; inputCell(wl, "B" + rr, x.amount);
      if (x.basis === "per_person") { inputCell(wl, "C" + rr, x.persons_per_unit || 1); f(wl, "I" + rr, m1 >= m0 ? `B${rr}*SUM(H${m0}:H${m1})/C${rr}` : "0", 0); } else f(wl, "I" + rr, `B${rr}`, x.amount);
      ext.push("I" + rr); rr++; });
    wl.getCell("H" + rr).value = "Cost / day"; f(wl, "I" + rr, [m1 >= m0 ? `SUM(I${m0}:I${m1})` : "0"].concat(ext).join("+"), c.per_day); rr++;
    wl.getCell("H" + rr).value = "Total THB"; f(wl, "I" + rr, `I${rr - 1}*${D}`, c.total_thb); crewTotals.push("Labor!$I$" + rr); rr += 2;
  });
  wl.getCell("H" + rr).value = "All crews THB"; f(wl, "I" + rr, crewTotals.join("+") || "0", r.summary_thb.crews); const crewsTotal = "Labor!$I$" + rr;
  // Machines
  const wm = wb.addWorksheet("Machines"); const MP = est.machine_params || {};
  [["Hours / year", MP.hours_per_year], ["Depreciation years", MP.dep_years], ["Electricity THB/kWh", MP.electricity_rate]].forEach(([l, v], i) => { wm.getCell("A" + (i + 1)).value = l; inputCell(wm, "B" + (i + 1), v); });
  wm.getCell("A4").value = "Operator THB/h"; if (MP.operator_rate_id && rateCell[MP.operator_rate_id]) wm.getCell("B4").value = { formula: rateCell[MP.operator_rate_id], result: r.nodes["mach.op"] ? r.nodes["mach.op"].value : null }; else inputCell(wm, "B4", MP.operator_rate || 0);
  hdr(wm, 6, ["Machine", "Price THB", "kWh/h", "Consumables ratio", "Depreciation/h", "Consumables/h", "Electricity/h", "Operator/h", "Rate override", "Rate THB/h"], [32, 14, 8, 12, 12, 12, 12, 12, 12, 12]);
  rr = 7; const mFirst = rr;
  r.machines.forEach(m => { wm.getCell("A" + rr).value = m.name;
    if ((m.price === null || m.price === undefined || m.price === "") && (m.rate_override === null || m.rate_override === undefined || m.rate_override === "")) wm.getCell("J" + rr).value = 0;
    else { inputCell(wm, "B" + rr, m.price); inputCell(wm, "C" + rr, m.kwh || 0); inputCell(wm, "D" + rr, m.consumable_ratio);
      f(wm, "E" + rr, `B${rr}/$B$1/$B$2`); f(wm, "F" + rr, `B${rr}*D${rr}/$B$1`); f(wm, "G" + rr, `C${rr}*$B$3`); f(wm, "H" + rr, "$B$4");
      if (m.rate_override !== null && m.rate_override !== undefined && m.rate_override !== "") inputCell(wm, "I" + rr, m.rate_override);
      f(wm, "J" + rr, `IF(I${rr}<>"",I${rr},ROUNDUP(E${rr}+F${rr}+G${rr}+H${rr},0))`, m.rate); }
    rr++; });
  const mLast = Math.max(rr - 1, mFirst), mName = `Machines!$A$${mFirst}:$A$${mLast}`, mRate = `Machines!$J$${mFirst}:$J$${mLast}`;
  // Parts
  const wp = wb.addWorksheet("Parts");
  hdr(wp, 1, ["Part", "Grade", "Pricing", "Shape", "Size1", "Size2", "Size3", "Density", "Weight/pc kg", "Qty", "THB/kg", "Disc %", "Material THB", "Process1", "Hours1", "Cost1", "Process2", "Hours2", "Cost2", "Process3", "Hours3", "Cost3", "Process4", "Hours4", "Cost4", "Process5", "Hours5", "Cost5", "Multiplier", "Machine THB"],
    [28, 10, 11, 7, 8, 8, 8, 8, 11, 6, 9, 6, 12, 18, 6, 9, 18, 6, 9, 18, 6, 9, 18, 6, 9, 18, 6, 9, 8, 12]);
  rr = 2; const pFirst = rr;
  r.parts.forEach(pt => { const shape = pt.shape || "TWL";
    wp.getCell("A" + rr).value = pt.name; wp.getCell("B" + rr).value = pt.grade || pt.grade_code; wp.getCell("C" + rr).value = pt.pricing || "price_sheet"; wp.getCell("D" + rr).value = shape;
    ["E", "F", "G"].forEach((c, k) => { const v = pt["s" + (k + 1)]; if (v !== null && v !== undefined && v !== "") inputCell(wp, c + rr, v); });
    if (pt.density !== null && pt.density !== undefined) inputCell(wp, "H" + rr, pt.density);
    const wt = { TWL: `E${rr}*F${rr}/1000*G${rr}/1000*H${rr}`, DiaL: `PI()/4*(E${rr}/1000)^2*F${rr}*H${rr}`, ODTL: `(PI()/4*(E${rr}/1000)^2-PI()/4*((E${rr}-2*F${rr})/1000)^2)*G${rr}*H${rr}` }[shape];
    f(wp, "I" + rr, `IF(OR(E${rr}="",H${rr}=""),0,${wt})`, pt.weight || 0); inputCell(wp, "J" + rr, pt.qty || 0);
    const up = r.nodes["part." + pt.id + ".up"]; inputCell(wp, "K" + rr, pt.pricing === "by_weight" && up ? up.value : 0); inputCell(wp, "L" + rr, pt.discount_pct || 0);
    f(wp, "M" + rr, `IF(C${rr}="by_weight",I${rr}*K${rr}*(100-L${rr})/100*J${rr},0)`, pt.material_cost_thb);
    const costs = [];
    (pt.processes || []).slice(0, 5).forEach((pr, j) => { const c0 = 14 + 3 * j; wp.getCell(rr, c0).value = pr.machine; inputCell(wp, colLetter(c0 + 1) + rr, pr.hours === null || pr.hours === undefined || pr.hours === "" ? 0 : pr.hours);
      f(wp, colLetter(c0 + 2) + rr, `IFERROR(INDEX(${mRate},MATCH(${colLetter(c0)}${rr},${mName},0)),0)*${colLetter(c0 + 1)}${rr}`, pr.amount); costs.push(colLetter(c0 + 2) + rr); });
    inputCell(wp, "AC" + rr, pt.machine_multiplier || 1); f(wp, "AD" + rr, `(${costs.join("+") || "0"})*AC${rr}`, pt.machine_cost_thb); rr++; });
  const pLast = Math.max(rr - 1, pFirst);
  f(wp, "M" + rr, r.parts.length ? `SUM(M${pFirst}:M${pLast})` : "0", r.summary_thb.parts_material); f(wp, "AD" + rr, r.parts.length ? `SUM(AD${pFirst}:AD${pLast})` : "0", r.summary_thb.machines);
  const partsMat = "Parts!$M$" + rr, partsMach = "Parts!$AD$" + rr;
  // Services
  const wsv = wb.addWorksheet("Services");
  hdr(wsv, 1, ["Group", "Service", "Currency", "Rate", "Qty", "Minimum", "Fixed amount", "Amount", "Amount THB", "Source"], [18, 34, 9, 12, 12, 12, 14, 14, 14, 40]);
  rr = 2;
  r.services.forEach(s => { wsv.getCell("A" + rr).value = s.group; wsv.getCell("B" + rr).value = s.name; wsv.getCell("C" + rr).value = (s.currency || "THB").toUpperCase();
    if (s.rate !== null && s.rate !== undefined && s.rate !== "") { inputCell(wsv, "D" + rr, s.rate); inputCell(wsv, "E" + rr, s.qty); inputCell(wsv, "F" + rr, s.minimum || 0); f(wsv, "H" + rr, `MAX(D${rr}*E${rr},F${rr})`, s.amount_v); }
    else { inputCell(wsv, "G" + rr, s.amount === null || s.amount === undefined ? 0 : s.amount); f(wsv, "H" + rr, `G${rr}`, s.amount_v); }
    f(wsv, "I" + rr, `IF(C${rr}="THB",H${rr},H${rr}*${ref.TU})`, s.amount_thb); wsv.getCell("J" + rr).value = s.source || ""; rr++; });
  f(wsv, "I" + rr, rr > 2 ? `SUM(I2:I${rr - 1})` : "0", r.summary_thb.services); const svcTotal = "Services!$I$" + rr;
  // Price sheets
  const sheetTotal = {};
  r.price_sheets.forEach(ps => {
    const title = String(ps.name || ps.id).slice(0, 28).replace(/[\\/?*[\]:]/g, "-"); const w = wb.addWorksheet(title); const q = `'${title}'`;
    w.getCell("A1").value = ps.name + " (" + ps.currency + ")"; w.getCell("A1").font = { bold: true, size: 12 };
    w.getCell("A2").value = "Tax %"; inputCell(w, "B2", ps.tax_pct || 0); w.getCell("C2").value = "Margin divisor"; inputCell(w, "D2", ps.margin_divisor || 1); w.getCell("E2").value = "Exchange"; inputCell(w, "F2", ps.exchange || 1); w.getCell("G2").value = "ROUNDUP digits"; inputCell(w, "H2", ps.round_digits === undefined ? -1 : ps.round_digits);
    hdr(w, 4, ["Group", "Material", "Description", "Weight/pc", "Qty (F)", "Unit price (H)", "J = F x H", "L = J x exch", "M = L x tax", "N = L / margin", "O = allocated", "P = O + M", "R = ROUNDUP(P/F)", "S = R x F", "Source"], [14, 12, 34, 10, 8, 12, 12, 12, 10, 12, 12, 12, 14, 12, 40]);
    const first = 5, n = ps.lines.length, lastL = first + n - 1, totR = lastL + 1, frN = (ps.freight || []).length, grandR = totR + 2 + frN;
    ps.lines.forEach((l, i) => { const x = first + i; w.getCell("A" + x).value = l.group; w.getCell("B" + x).value = l.material; w.getCell("C" + x).value = l.description; if (l.unit_weight_v) w.getCell("D" + x).value = l.unit_weight_v;
      inputCell(w, "E" + x, l.qty); inputCell(w, "F" + x, l.unit_price);
      f(w, "G" + x, `E${x}*F${x}`, l.cost); f(w, "H" + x, `G${x}*$F$2`); f(w, "I" + x, `H${x}*$B$2`); f(w, "J" + x, `H${x}/$D$2`);
      f(w, "K" + x, `IFERROR(J${x}/$J$${totR}*$J$${grandR},0)`, l.allocated); f(w, "L" + x, `K${x}+I${x}`); f(w, "M" + x, `IFERROR(ROUNDUP(L${x}/E${x},$H$2),0)`, l.selling_unit); f(w, "N" + x, `M${x}*E${x}`, l.amount);
      w.getCell("O" + x).value = l.price_source || ""; });
    w.getCell("C" + totR).value = "Total material"; f(w, "J" + totR, n ? `SUM(J${first}:J${lastL})` : "0", ps.material_cost); f(w, "N" + totR, n ? `SUM(N${first}:N${lastL})` : "0", ps.total).font = { bold: true };
    w.getCell("C" + (totR + 1)).value = "Freight / other charges";
    (ps.freight || []).forEach((fr, i) => { const x = totR + 2 + i; w.getCell("C" + x).value = fr.label; inputCell(w, "F" + x, fr.amount); const fc = (fr.currency || ps.currency).toUpperCase(); w.getCell("G" + x).value = fc;
      f(w, "J" + x, fc === ps.currency ? `F${x}` : (fc === "THB" ? `F${x}/${ref.TU}` : `F${x}*${ref.TU}`)); });
    w.getCell("C" + grandR).value = "Material + freight"; f(w, "J" + grandR, `J${totR}` + (frN ? `+SUM(J${totR + 2}:J${grandR - 1})` : ""), ps.grand);
    sheetTotal[ps.id] = [`${q}!$N$${totR}`, ps.currency];
  });
  // Summary
  const sm = wb.addWorksheet("Summary"); wb.views = [{ activeTab: wb.worksheets.length - 1 }];
  sm.getCell("A1").value = (p.quote_doc.product_subject || "") + " — " + (p.quote_doc.quotation_no || ""); sm.getCell("A1").font = { bold: true, size: 13 };
  hdr(sm, 3, ["Item", "Heading", "Cost base", "Markup", "Calculated price", "Override", "Unit price", "Qty", "Total", "Margin %", "Adjustments"], [6, 34, 14, 8, 16, 12, 14, 7, 14, 9, 40]);
  rr = 4; const fi = rr; const dm = [], dl1 = [], dl2 = [];
  est.buckets.forEach((b, bi) => { const it = r.items[bi]; const terms = [];
    const adj = (b.adjustments || []).filter(a => a.pct !== null && a.pct !== undefined && a.pct !== ""); const fac = adj.map(a => `*(1+${E.evalExpr(a.pct)})`).join("");
    (b.sources || []).forEach(src => { let t = null, lst = null;
      if (src.type === "price_sheet" && sheetTotal[src.id]) { t = conv(sheetTotal[src.id][0], sheetTotal[src.id][1]); lst = dm; }
      else if (src.type === "services") { t = conv(svcTotal, "THB"); lst = dl1; } else if (src.type === "crews") { t = conv(crewsTotal, "THB"); lst = dl1; }
      else if (src.type === "machines") { t = conv(partsMach, "THB"); lst = dl2; } else if (src.type === "parts_material") { t = conv(partsMat, "THB"); lst = dm; }
      else if (src.type === "fixed") t = conv(String(src.amount), src.currency || qcur);
      if (t) { terms.push(t); if (lst) lst.push(fac ? `(${t})${fac}` : t); } });
    sm.getCell("A" + rr).value = it.no; sm.getCell("B" + rr).value = it.heading;
    f(sm, "C" + rr, "(" + (terms.join("+") || "0") + ")" + fac, it.base); sm.getCell("D" + rr).value = it.markup ? "Yes" : "No";
    f(sm, "E" + rr, `IF(D${rr}="Yes",ROUNDUP(C${rr}*(1+${ref.OVH}+${ref.RISK})/${ref.DIVISOR},${ref.ITEM_DIGITS}),ROUNDUP(C${rr},${ref.ITEM_DIGITS}))`, it.calc_price);
    if (b.override_price !== null && b.override_price !== undefined && b.override_price !== "") inputCell(sm, "F" + rr, b.override_price);
    f(sm, "G" + rr, `IF(F${rr}<>"",F${rr},E${rr})`, it.unit_price); inputCell(sm, "H" + rr, it.qty); f(sm, "I" + rr, `G${rr}*H${rr}`, it.total);
    const mc = f(sm, "J" + rr, `IFERROR((I${rr}-C${rr}*H${rr})/I${rr},0)`, it.margin); mc.numFmt = "0.0%";
    if (adj.length) sm.getCell("K" + rr).value = adj.map(a => `${a.label || "adj"} ${E.evalExpr(a.pct)} (${a.reason || ""})`).join("; ");
    rr++; });
  const li = rr - 1; rr++;
  const line = (label, formula, result, bold) => { sm.getCell("H" + rr).value = label; sm.getCell("H" + rr).font = { bold: !!bold }; const c = f(sm, "I" + rr, formula, result); c.font = { bold: !!bold }; rr++; return "I" + (rr - 1); };
  const T = line("Total price", `SUM(I${fi}:I${li})`, r.totals.total, true); const Dd = line("Discount", `${T}*${ref.QUOTE_DISC}`, r.totals.discount); line("Net total price", `${T}-${Dd}`, r.totals.net, true); rr++;
  sm.getCell("G" + rr).value = "CES (cost estimate sheet)"; sm.getCell("G" + rr).font = { bold: true }; rr++;
  const A = line("Material cost (DM)", dm.join("+") || "0", r.ces.dm), B1 = line("Labor cost (DL1)", dl1.join("+") || "0", r.ces.dl1), B2 = line("Machine cost (DL2)", dl2.join("+") || "0", r.ces.dl2);
  const DR = line("Direct cost", `${A}+${B1}+${B2}`, r.ces.direct), FU = line("Full cost", `${DR}*(1+${ref.OVH}+${ref.RISK})`, r.ces.full);
  const PR = line("CES total price", `ROUNDUP(${FU}/${ref.DIVISOR},${ref.CES_DIGITS})`, r.ces.price), NE = line("CES net price", `(${PR}-${PR}*${ref.CES_DISC})*${ref.SET_QTY}`, r.ces.net);
  const mode = Sx.header_price_mode || "ces";
  line("Product line price / set", mode === "ces" ? `ROUNDUP(${NE},${ref.ITEM_DIGITS})` : (mode === "sum_items" ? T : String(Sx.header_price_manual || 0)), r.totals.header_price, true);
  // move Summary first
  wb.worksheets.sort((a, b) => (a.name === "Summary" ? -1 : b.name === "Summary" ? 1 : 0));
  const buf = await wb.xlsx.writeBuffer();
  await saveFile(fileBase() + "_costing.xlsx", new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
}

/* ---------------- events ---------------- */
document.addEventListener("change", e => {
  const el = e.target;
  if (el.dataset.path) {
    const p = cur(); const type = el.dataset.type;
    const v = type === "bool" ? el.checked : parseVal(el.value, type);
    setPath(p, el.dataset.path, v);
    if (el.dataset.path === "quote_doc.product_subject" && !p.name) p.name = v;
    changed(); return;
  }
  const act = el.dataset.act || "";
  const p = cur(), q = p.quote_doc;
  if (act === "switch") { S.cur = el.value; S.ai = {}; recompute(); render(); return; }
  if (act === "title") { q.title.runs = [{ text: el.value, bold: true }]; changed(); return; }
  if (act.startsWith("rowkind:")) { const i = +act.split(":")[1]; q.rows[i].kind = el.value; if (el.value === "item" && !q.rows[i].item_no) q.rows[i].item_no = 1; changed(); return; }
  if (act.startsWith("rowitem:")) { q.rows[+act.split(":")[1]].item_no = Number(el.value); changed(); return; }
  if (act.startsWith("rowtext:")) { const row = q.rows[+act.split(":")[1]]; const r0 = (row.runs || [])[0] || {}; row.runs = [Object.assign({}, r0, { text: el.value })]; changed(); return; }
  if (act.startsWith("rowbold:")) { const row = q.rows[+act.split(":")[1]]; (row.runs.length ? row.runs : (row.runs = [{ text: "" }])).forEach(x => x.bold = el.checked); changed(); return; }
  if (act.startsWith("rowred:")) { const row = q.rows[+act.split(":")[1]]; (row.runs.length ? row.runs : (row.runs = [{ text: "" }])).forEach(x => x.color = el.checked ? "FFFF0000" : null); changed(); return; }
  if (act.startsWith("src:")) { const [, bi, ...k] = act.split(":"); const key = k.join(":"); const b = p.estimate.buckets[+bi]; b.sources = b.sources || [];
    const match = s => (s.type === "price_sheet" ? "price_sheet:" + s.id : s.type) === key;
    if (el.checked) b.sources.push(key.startsWith("price_sheet:") ? { type: "price_sheet", id: key.slice(12) } : { type: key }); else b.sources = b.sources.filter(s => !match(s));
    changed(); return; }
  if (act.startsWith("xacc:")) { S.ai.extraction.parts[+act.split(":")[1]]._accept = el.checked; return; }
  if (act.startsWith("xedit:")) { const [, i, k] = act.split(":"); const v = el.value; S.ai.extraction.parts[+i][k] = /mm|qty/.test(k) ? (v === "" ? null : Number(v)) : v; S.ai.extraction.parts[+i]._accept = true; render(); return; }
  if (el.id === "dwgfile" && el.files[0]) { loadDrawing(el.files[0]); return; }
  if (el.id === "importfile" && el.files[0]) { el.files[0].text().then(t => { try { const pj = JSON.parse(t); pj.id = "p-" + uid(); pj.updated = Date.now(); S.projects.unshift(pj); S.cur = pj.id; recompute(); scheduleSave(); render(); toast("Project imported"); } catch (x) { toast("Not a project file"); } }); return; }
});
document.addEventListener("input", e => { if (e.target.dataset.act === "supq") { S.supQ = e.target.value; const pos = e.target.selectionStart; render(); const el = document.querySelector('[data-act="supq"]'); if (el) { el.focus(); el.setSelectionRange(pos, pos); } } });
document.addEventListener("click", async e => {
  const c = e.target.closest("[data-node]"); if (c) { S.drawer = c.dataset.node; S.traceOpen = {}; renderDrawer(); return; }
  const b = e.target.closest("[data-act]"); if (!b || b.tagName === "SELECT" || (b.tagName === "INPUT" && b.type !== "button")) return;
  const act = b.dataset.act, p = cur(), est = p.estimate, q = p.quote_doc;
  if (act.startsWith("tab:")) { S.tab = act.slice(4); render(); window.scrollTo(0, 0); return; }
  if (act === "closedrawer") { S.drawer = null; renderDrawer(); return; }
  if (act.startsWith("tt:")) { const k = act.slice(3); S.traceOpen[k] = !S.traceOpen[k]; renderDrawer(); return; }
  if (act.startsWith("goto:")) { gotoPath(act.slice(5)); return; }
  if (act.startsWith("del:")) { const path = act.slice(4); const ks = path.split("."); const idx = +ks.pop(); const arr = getPath(p, ks.join(".")); if (Array.isArray(arr)) { arr.splice(idx, 1); changed(); } return; }
  if (act.startsWith("add:")) {
    const [, what, a1] = act.split(":");
    if (what === "freight") est.price_sheets[+a1].freight.push({ label: "Freight", amount: null, currency: "THB" });
    if (what === "line") est.price_sheets[+a1].lines.push({ id: "l" + uid(), group: "", material: "", description: "", qty: 1, unit_price: null, price_source: "" });
    if (what === "sheet") est.price_sheets.push({ id: "s" + uid(), name: "New price sheet", currency: "USD", round_digits: -1, tax_pct: 0, margin_divisor: 1, freight: [], lines: [] });
    if (what === "part") est.parts.push({ id: "p" + uid(), name: "New part", grade_code: "02", shape: "TWL", s1: null, s2: null, s3: null, qty: 1, pricing: "price_sheet", processes: [] });
    if (what === "proc") est.parts[+a1].processes.push({ machine: "", hours: null });
    if (what === "rate") est.labor_rates.push({ id: "R" + uid().slice(0, 4), position: "New position", site: "", salary: null });
    if (what === "member") est.crews[+a1].members.push({ role: "New role", rate_id: "", persons: 0 });
    if (what === "machine") est.machines.push({ name: "New machine", price: null, kwh: 0, consumable_ratio: 0.5 });
    if (what === "service") est.services.push({ id: "s" + uid(), group: "", name: "New service", amount: null, currency: "THB" });
    if (what === "bucket") { const no = Math.max(0, ...est.buckets.map(x => Number(x.no) || 0)) + 1; est.buckets.push({ no, heading: "New item", unit: "Lot.", qty: 1, markup: true, sources: [] }); q.rows.push({ kind: "item", item_no: no, runs: [{ text: "New item", bold: true }] }); }
    if (what === "fixed") est.buckets[+a1].sources.push({ type: "fixed", label: "Fixed amount", amount: null, currency: "THB" });
    if (what === "adj") (est.buckets[+a1].adjustments = est.buckets[+a1].adjustments || []).push({ label: "Adjustment", pct: null, reason: "" });
    if (what === "row") q.rows.push({ kind: "line", runs: [{ text: " - " }] });
    changed(); return;
  }
  if (act.startsWith("rowup:") || act.startsWith("rowdn:") || act.startsWith("rowdel:")) {
    const i = +act.split(":")[1];
    if (act.startsWith("rowdel:")) q.rows.splice(i, 1);
    else { const j = act.startsWith("rowup:") ? i - 1 : i + 1; if (j >= 0 && j < q.rows.length) [q.rows[i], q.rows[j]] = [q.rows[j], q.rows[i]]; }
    if (Array.isArray(q.page_breaks)) q.page_breaks = "auto";
    changed(); return;
  }
  if (act.startsWith("pick:")) { const [, si, li] = act.split(":"); pickPrice(+si, +li); return; }
  if (act.startsWith("pp:")) { const [, si, li, k] = act.split(":"); const sp = supplierPrices()[+k]; const ln = est.price_sheets[+si].lines[+li];
    ln.unit_price = sp.unit_price; ln.price_source = sp.supplier + " · " + (sp.source || ""); if (!ln.description) ln.description = sp.description; if (!ln.material) ln.material = sp.material; if (!ln.unit_weight && sp.unit_weight) ln.unit_weight = sp.unit_weight;
    $("#pickdlg") && $("#pickdlg").remove(); changed(); toast("Price applied"); return; }
  if (act === "closepick") { $("#pickdlg") && $("#pickdlg").remove(); return; }
  if (act === "export:pdf") return exportPDF().catch(x => toast("PDF failed: " + x.message));
  if (act === "export:qxlsx") return exportQuoteXlsx().catch(x => toast("Excel failed: " + x.message));
  if (act === "export:cxlsx") return exportCostingXlsx().catch(x => toast("Excel failed: " + x.message));
  if (act === "export:json") return saveFile(fileBase() + ".json", JSON.stringify(p, null, 1));
  if (act === "proj:new") { const nm = "New project"; const pj = blankProject(nm); S.projects.unshift(pj); S.cur = pj.id; S.tab = "overview"; recompute(); scheduleSave(); render(); toast("Blank project created"); return; }
  if (act === "proj:dup") { const pj = clone(p); pj.id = "p-" + uid(); pj.name = p.name + " (copy)"; pj.status = "draft"; pj.updated = Date.now(); pj.quote_doc.page_breaks = "auto"; S.projects.unshift(pj); S.cur = pj.id; recompute(); scheduleSave(); render(); return; }
  if (act === "proj:import") { $("#importfile").click(); return; }
  if (act.startsWith("proj:open:")) { S.cur = act.slice(10); S.tab = "overview"; S.ai = {}; recompute(); render(); return; }
  if (act.startsWith("proj:del:")) { const id = act.slice(9); if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Click again to delete"; return; }
    S.projects = S.projects.filter(x => x.id !== id); if (S.caps.db && S.uid) { try { await S.caps.db.doc("data/users/" + S.uid + "/" + id).delete(); } catch (x) { } }
    if (S.cur === id) S.cur = S.projects[0].id; recompute(); scheduleSave(); render(); return; }
  if (act === "ai:dwg") return aiDrawing();
  if (act === "ai:tobom") return aiToBom(false);
  if (act === "ai:tostock") return aiToBom(true);
  if (act === "ai:est") return aiEstimate();
  if (act === "ai:qt") return aiQuoteText();
  if (act === "ai:ask") return aiAsk();
  if (act === "ai:qtapply") { const d = S.ai.qt; q.rows = (d.rows || []).map(r => ({ kind: r.kind, item_no: r.item_no || undefined, runs: (r.runs || []).map(x => ({ text: x.text, bold: !!x.bold, underline: !!x.underline, color: x.color || null })) }));
    if (d.title) q.title.runs = [{ text: d.title, bold: true }]; q.page_breaks = "auto"; changed(); toast("Quotation body replaced"); return; }
  if (act === "ai:days") { const c0 = est.crews[0]; if (c0) c0.days = S.ai.est.crew_days; changed(); return; }
  if (act.startsWith("ai:crew:")) { const s = S.ai.est.crew[+act.slice(8)]; let done = false;
    est.crews.forEach(c => c.members.forEach(m => { if (!done && (m.rate_id === s.rate_id || m.role === s.role)) { m.persons = s.persons; done = true; } }));
    if (!done && est.crews[0]) est.crews[0].members.push({ role: s.role, rate_id: s.rate_id, persons: s.persons }); changed(); return; }
  if (act.startsWith("ai:svc:")) { const s = S.ai.est.services[+act.slice(7)];
    est.services.push({ id: "s" + uid(), group: s.group, name: s.name, rate: s.rate, qty: s.qty, minimum: s.minimum, amount: s.rate === null || s.rate === undefined ? s.amount : undefined, currency: s.currency || "THB", source: "AI suggestion: " + (s.evidence || s.rationale || "") });
    changed(); return; }
  if (act.startsWith("ai:proc:")) { const s = S.ai.est.processes[+act.slice(8)]; const pt = est.parts.find(x => x.id === s.part_ref || x.name === s.part_ref);
    if (!pt) { toast("Part '" + s.part_ref + "' not found in the BOM"); return; } pt.processes = pt.processes || []; pt.processes.push({ machine: s.machine, hours: s.hours }); changed(); return; }
});
function gotoPath(path) {
  const ks = path.split(".");
  const map = { price_sheets: "prices", crews: "labor", labor_rates: "labor", labor_params: "labor", services: "services", parts: "parts", machines: "machines", machine_params: "machines", settings: "pricing", buckets: "pricing" };
  S.tab = map[ks[0]] || (ks[0] === "svc.total" ? "services" : "overview"); render();
  setTimeout(() => {
    let el = document.querySelector(`[data-path="estimate.${CSS.escape(path)}"]`);
    if (!el) el = document.querySelector(`[data-path^="estimate.${CSS.escape(ks.slice(0, 2).join("."))}"]`);
    if (el) { el.scrollIntoView({ block: "center" }); el.focus(); el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1800); }
  }, 30);
}
function pickPrice(si, li) {
  const p = cur(), ln = p.estimate.price_sheets[si].lines[li], words = String(ln.description || ln.material || "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 3);
  const all = supplierPrices().map((s, k) => Object.assign({ k }, s));
  const ranked = all.map(s => ({ s, score: words.filter(w => (s.description + " " + s.material).toLowerCase().includes(w)).length })).sort((a, b) => b.score - a.score).slice(0, 40);
  const d = document.createElement("div"); d.id = "pickdlg"; d.className = "drawer";
  d.innerHTML = `<div style="display:flex;justify-content:space-between"><h2 style="margin:0;font-size:15px">Pick a verified supplier price</h2>${btn("Close", "closepick", "small")}</div>
    <p class="small muted">For: ${esc(ln.description || "(no description)")}</p><div class="tw"><table><tr><th>Supplier</th><th>Description</th><th class="n">Price</th><th></th></tr>
    ${ranked.map(({ s }) => `<tr><td>${esc(s.supplier)}</td><td>${esc(s.material)} ${esc(s.description)}</td><td class="n">${money(s.unit_price)} ${esc(s.currency)}</td><td>${btn("Use", "pp:" + si + ":" + li + ":" + s.k, "small")}</td></tr>`).join("")}</table></div>`;
  document.body.appendChild(d);
}

/* ---------------- boot ---------------- */
(async function boot() {
  await loadProjects(); recompute(); render();
  if (window.claude && window.claude.use) {
    const [sample, downloads, db, user] = await Promise.all(["sample", "downloads", "db", "user"].map(n => window.claude.use(n).catch(() => null)));
    S.caps = { sample, downloads, db, user };
    if (user && db) { try { S.uid = await user.id(); } catch (e) { S.uid = null; } if (S.uid) { const before = S.projects.length; await loadProjects(); recompute(); } }
    render();
  }
})();
