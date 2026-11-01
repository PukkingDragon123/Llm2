"use strict";
/* Interactive guided tour. Steps can wait for the user to do something (open a trace, edit a price). */
(function () {
  const TUT_KEY = "prolog.estimator.tutorial.done";
  const PRICE_PATH = "estimate.price_sheets.0.lines.2.unit_price";
  const T = { i: -1, before: null, priceOrig: null };
  const refProject = () => cur() && cur().estimate.price_sheets[0] && cur().estimate.price_sheets[0].lines[2];

  const STEPS = [
    { title: "Welcome to the Prolog Titanium Estimator", body: "This short tour (about 2 minutes) shows how a quotation is built: every number is calculated from inputs you can see and change, and nothing missing is ever made up. You will try three things yourself.", center: true },
    { tab: "overview", target: ".netbox", title: "The net total", body: "This is the net quotation price for the open project — the reference job QT-2608533. It matches the original Excel quotation to the cent. Blue numbers with ƒ are calculated. <b>Click the net total</b> to see how it is built.",
      wait: () => !!S.drawer, waitText: "Waiting for you to click the net total…" },
    { target: "#drawer", title: "Every number explains itself", body: "The trace shows the formula, the actual numbers that went in, and each input below it. Expand ▸ rows to go deeper — all the way down to a supplier price or a salary. Red would mark a missing input.", place: "left", onLeave: () => { S.drawer = null; renderDrawer(); } },
    { tab: "overview", target: ".card:nth-of-type(2)", sel: () => document.querySelectorAll(".grid2 .card")[1], title: "Open questions", body: "When information is missing (a supplier price, crew days, a weld length), it appears here as a question instead of being guessed. Clicking a question jumps straight to the field. The reference project is complete, so this list is empty." },
    { tab: "prices", sel: () => document.querySelector(`[data-path="${PRICE_PATH}"]`), title: "Try it: change a supplier price", body: () => `This line is the 2000×6000×6t Ti Gr.2 plate from SINCEMAT at <b>${money(T.priceOrig, 0)} USD</b> per sheet. <b>Type 3500 and press Tab.</b> Watch the net total at the top.`,
      enter: () => { const l = refProject(); T.priceOrig = l ? l.unit_price : null; T.before = S.result.totals.net; },
      wait: () => { const l = refProject(); return l && l.unit_price !== T.priceOrig; }, waitText: "Waiting for you to change the price…" },
    { target: ".netbox", title: "Everything recalculated", body: () => `Net total moved from <b>${money(T.before)}</b> to <b>${money(S.result.totals.net)}</b>. Freight was re-spread over the lines by value, the per-sheet selling price was rounded up to 10, and item 1 was re-priced with overhead, risk and margin — all traceable.`,
      actions: [["Undo my change", () => { const l = refProject(); if (l && T.priceOrig !== null) { l.unit_price = T.priceOrig; changed(); toast("Price restored"); } }]] },
    { tab: "labor", sel: () => document.querySelector('[data-path="estimate.crews.0.days"]'), title: "Labor: crews × days", body: "Labor is your rate table (salary × 1.07 ÷ 30 ÷ 8) and crews: persons per role × working days, plus per diem and overtime. The reference job uses 11 people for 60 days." },
    { tab: "pricing", sel: () => document.querySelector('[data-path="estimate.settings.ovh_pct"]'), title: "Pricing rules", body: "Each quote item is priced as ROUNDUP(cost × (1 + overhead + risk) ÷ margin divisor, to 10). These are the live values from your workbook: overhead 10%, risk 6%, divisor 0.75. Change them here for a project, or per item with a reasoned adjustment." },
    { tab: "quote", sel: () => document.getElementById("paper"), title: "The customer quotation", body: "The preview follows your FM-SAL-001 form: header, info block, green item headings, yellow transport block, totals and the Disclaimers page. Edit header fields and description rows above it; prices fill in automatically.", place: "top" },
    { target: '[data-act="export:pdf"]', title: "Export", body: "Download the quotation as PDF or Excel, and the internal costing workbook — every cell in it is a live Excel formula, so engineers can keep working in Excel." },
    { tab: "ai", sel: () => document.querySelector(".dropzone"), title: "AI: read a drawing", body: "Upload a drawing (PDF or scan). Claude reads the parts list, nozzles and design data, flags anything unclear with a question, and you tick which rows go into the BOM. It can also suggest crew and machine hours from your own tables and draft the quotation text — always as suggestions you approve." },
    { tab: "projects", sel: () => document.querySelector('[data-act="proj:new"]'), title: "Start your own project", body: "Create a blank project: it starts from Prolog's rate tables with no quantities, so the open-questions list shows exactly what you need to fill in. Projects are saved automatically." },
    { title: "You're ready", body: "Reopen this tour any time from <b>Tutorial</b> in the left menu. Tip: click any ƒ number whenever you want to know where it comes from.", center: true },
  ];

  function step() { return STEPS[T.i]; }
  function start() { T.i = 0; show(); }
  function close(done) {
    T.i = -1; const o = document.getElementById("tut"); if (o) o.remove();
    if (done) { try { localStorage.setItem(TUT_KEY, "1"); } catch (e) { /* storage unavailable */ } }
  }
  function go(d) {
    const s = step(); if (s && s.onLeave) s.onLeave();
    T.i += d; if (T.i >= STEPS.length) return close(true); if (T.i < 0) T.i = 0; show();
  }
  function show() {
    const s = step();
    if (s.tab && S.tab !== s.tab) { S.tab = s.tab; render(); }
    if (s.enter) s.enter();
    window.scrollTo(0, 0);
    setTimeout(update, 60);
  }
  function target() {
    const s = step(); if (!s || s.center) return null;
    if (s.sel) return s.sel();
    return document.querySelector(s.target);
  }
  function update() {
    if (T.i < 0) return;
    const s = step();
    let o = document.getElementById("tut");
    if (!o) { o = document.createElement("div"); o.id = "tut"; document.body.appendChild(o); }
    const el = target();
    const waiting = s.wait && !s.wait();
    const body = typeof s.body === "function" ? s.body() : s.body;
    const acts = (s.actions || []).map((a, k) => `<button class="btn small" data-tut="act:${k}">${a[0]}</button>`).join(" ");
    o.innerHTML = `<div class="tut-dim ${el ? "" : "full"}"></div>${el ? '<div class="tut-spot"></div>' : ""}
      <div class="tut-card" role="dialog" aria-label="Tutorial step ${T.i + 1} of ${STEPS.length}">
        <div class="tut-head"><span class="tut-n">${T.i + 1} / ${STEPS.length}</span><button class="tog" data-tut="close" aria-label="Close tutorial">✕</button></div>
        <h3>${s.title}</h3><p>${body}</p>${acts ? `<div style="margin:6px 0">${acts}</div>` : ""}
        ${waiting ? `<p class="tut-wait">${s.waitText || "Waiting…"}</p>` : ""}
        <div class="tut-nav"><button class="btn small" data-tut="prev" ${T.i === 0 ? "disabled" : ""}>Back</button>
          <span class="tut-dots">${STEPS.map((_, k) => `<i class="${k === T.i ? "on" : ""}"></i>`).join("")}</span>
          <button class="btn small primary" data-tut="next" ${waiting ? "disabled" : ""}>${T.i === STEPS.length - 1 ? "Finish" : waiting ? "Do the step" : "Next"}</button></div>
        ${waiting ? `<button class="btn small" data-tut="skip" style="margin-top:4px">Skip this step</button>` : ""}</div>`;
    const card = o.querySelector(".tut-card");
    if (!el) { card.style.left = "50%"; card.style.top = "50%"; card.style.transform = "translate(-50%,-50%)"; return; }
    el.scrollIntoView({ block: "center", behavior: "instant" });
    const r = el.getBoundingClientRect(), pad = 6, spot = o.querySelector(".tut-spot");
    Object.assign(spot.style, { left: r.left - pad + "px", top: r.top - pad + "px", width: r.width + pad * 2 + "px", height: Math.min(r.height + pad * 2, innerHeight - 20) + "px" });
    const cw = Math.min(360, innerWidth - 32); card.style.width = cw + "px";
    const ch = card.offsetHeight || 220;
    let left, top;
    if (s.place === "left" && r.left > cw + 30) { left = r.left - cw - 16; top = Math.max(16, r.top); }
    else if (r.bottom + ch + 16 < innerHeight) { top = r.bottom + 14; left = r.left; }
    else if (r.top - ch - 16 > 0) { top = r.top - ch - 14; left = r.left; }
    else { top = innerHeight - ch - 16; left = r.right + 16 + cw < innerWidth ? r.right + 16 : 16; }
    left = Math.max(16, Math.min(left, innerWidth - cw - 16)); top = Math.max(16, Math.min(top, innerHeight - ch - 16));
    card.style.left = left + "px"; card.style.top = top + "px";
  }
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-tut]"); if (!b) { if (T.i >= 0) setTimeout(update, 80); return; }
    const a = b.dataset.tut, s = step();
    if (a === "close") close(true);
    else if (a === "next") go(1);
    else if (a === "prev") go(-1);
    else if (a === "skip") go(1);
    else if (a.startsWith("act:")) { s.actions[+a.slice(4)][1](); setTimeout(update, 80); }
  });
  document.addEventListener("change", () => { if (T.i >= 0) setTimeout(update, 120); });
  addEventListener("resize", () => { if (T.i >= 0) update(); });
  addEventListener("scroll", () => { if (T.i >= 0) update(); }, { passive: true });
  window.PrologTutorial = { start, update, active: () => T.i >= 0 };
  // hook into the app: re-place the overlay after every render
  const _render = window.render; window.render = function () { _render.apply(this, arguments); if (T.i >= 0) setTimeout(update, 30); };
  const _drawer = window.renderDrawer; window.renderDrawer = function () { _drawer.apply(this, arguments); if (T.i >= 0) setTimeout(update, 30); };
  let seen = false; try { seen = localStorage.getItem(TUT_KEY) === "1"; } catch (e) { seen = false; }
  if (!seen) setTimeout(() => { if (T.i < 0) start(); }, 900);
})();
