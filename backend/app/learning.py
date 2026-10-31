"""Historical learning: estimate-vs-actual calibration and similar-project retrieval."""
from __future__ import annotations

import math
import re
import statistics

# cost categories shared by estimates and actual production records (all in THB)
CATEGORIES = {
    "material": "Material (all supplier price sheets)",
    "crews": "In-house crew labor",
    "services": "Outsource / NDT / finishing services",
    "machines": "Machine process cost",
    "man_days": "Crew man-days (persons x days)",
    "machine_hours": "Machine hours",
}
# which quote-bucket source types each cost category calibrates
CATEGORY_SOURCES = {"material": {"price_sheet", "parts_material"}, "crews": {"crews"}, "services": {"services"},
                    "machines": {"machines"}}


def estimate_categories(result: dict) -> dict:
    """Cost categories (THB) of a computed estimate, used as the 'estimate' side of actuals."""
    TU = result["TU"]
    mat = 0.0
    for s in result["price_sheets"]:
        mat += s["total"] if s["currency"] == "THB" else s["total"] * TU
    mat += result["summary_thb"]["parts_material"]
    man_days = sum((c.get("persons") or 0) * ((c.get("days") if isinstance(c.get("days"), (int, float)) else 0) or 0)
                   for c in result["crews"])
    mh = sum((pr.get("hours") or 0) if isinstance(pr.get("hours"), (int, float)) else 0
             for p in result["parts"] for pr in p.get("processes") or [])
    return {"material": mat, "crews": result["summary_thb"]["crews"], "services": result["summary_thb"]["services"],
            "machines": result["summary_thb"]["machines"], "man_days": man_days, "machine_hours": mh}


def calibration(projects: list[dict], job_class: str | None = None) -> dict:
    """projects: [{id, job_no, job_class, actuals: {cat: {estimate, actual}}}] -> factor per category."""
    out = {}
    for cat, label in CATEGORIES.items():
        est_sum, act_sum, ratios, used = 0.0, 0.0, [], []
        for p in projects:
            if job_class and p.get("job_class") and p["job_class"] != job_class:
                continue
            a = ((p.get("actuals") or {}).get("categories") or {}).get(cat) or {}
            e, v = a.get("estimate"), a.get("actual")
            if isinstance(e, (int, float)) and isinstance(v, (int, float)) and e > 0 and v >= 0:
                est_sum += e
                act_sum += v
                ratios.append(v / e)
                used.append({"project_id": p["id"], "job_no": p.get("job_no"), "estimate": e, "actual": v, "ratio": v / e})
        if used:
            factor = act_sum / est_sum
            out[cat] = {"label": label, "n": len(used), "factor": factor, "suggested_pct": factor - 1,
                        "min_ratio": min(ratios), "max_ratio": max(ratios),
                        "stdev": statistics.pstdev(ratios) if len(ratios) > 1 else 0.0,
                        "reliable": len(used) >= 3 and (statistics.pstdev(ratios) if len(ratios) > 1 else 1) < 0.25,
                        "projects": used}
        else:
            out[cat] = {"label": label, "n": 0, "factor": None, "suggested_pct": None, "reliable": False, "projects": []}
    return out


_DIM = re.compile(r"(ID|OD|DIA\.?|Ø)\s*([\d,\.]+)\s*[xX×]\s*(TL|H|L|HT)\s*([\d,\.]+)", re.I)


def features(p: dict) -> dict:
    title = " ".join(str(x) for x in (p.get("product_subject"), (p.get("quote_doc") or {}).get("title_text"),
                                       (p.get("meta") or {}).get("size_text")) if x)
    for run in (((p.get("quote_doc") or {}).get("title") or {}).get("runs") or []):
        title += " " + run.get("text", "")
    m = _DIM.search(title)
    dia = float(m.group(2).replace(",", "")) if m else (p.get("meta") or {}).get("diameter_mm")
    length = float(m.group(4).replace(",", "")) if m else (p.get("meta") or {}).get("length_mm")
    words = {w.lower() for w in re.findall(r"[A-Za-z]{3,}", title)} - {"size", "titanium", "the", "and", "for"}
    mats = set()
    for s in (p.get("estimate") or {}).get("price_sheets") or []:
        for l in s.get("lines") or []:
            if l.get("material"):
                mats.add(str(l["material"]).replace(" ", "").lower())
    summ = p.get("summary") or {}
    return {"words": words, "dia": dia, "length": length, "materials": mats,
            "total": (summ.get("totals") or {}).get("total"), "weight": (summ.get("weights") or {}).get("price_sheet_kg")}


def similarity(a: dict, b: dict) -> tuple[float, list[str]]:
    fa, fb = features(a), features(b)
    score, why = 0.0, []
    if fa["words"] and fb["words"]:
        j = len(fa["words"] & fb["words"]) / len(fa["words"] | fb["words"])
        score += 0.35 * j
        if j:
            why.append(f"product words {sorted(fa['words'] & fb['words'])}")
    if fa["dia"] and fb["dia"]:
        r = min(fa["dia"], fb["dia"]) / max(fa["dia"], fb["dia"])
        score += 0.2 * r
        why.append(f"diameter {fb['dia']:.0f} vs {fa['dia']:.0f} mm")
    if fa["length"] and fb["length"]:
        r = min(fa["length"], fb["length"]) / max(fa["length"], fb["length"])
        score += 0.15 * r
    if fa["materials"] and fb["materials"]:
        j = len(fa["materials"] & fb["materials"]) / len(fa["materials"] | fb["materials"])
        score += 0.2 * j
        if j:
            why.append("shared materials")
    if fa["weight"] and fb["weight"]:
        r = min(fa["weight"], fb["weight"]) / max(fa["weight"], fb["weight"])
        score += 0.1 * r
    return round(score, 4), why
