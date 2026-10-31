"""Measure Claude's drawing extraction against an engineer-verified reference (needs a Claude API key).

Usage: python tools/eval_drawing_extraction.py reference/DWG_PTC2211120_Titanium_Tank_Recycle_Drum_As_built.pdf \
           reference/drawing_truth_PTC2211120.json
Scores: part recall (by name/category + thickness), thickness accuracy, material-spec accuracy, nozzle mark recall,
and how many reference 'unclear_items' were also flagged by the model."""
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
from app.ai.claude import analyze_drawing  # noqa: E402


def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def main(pdf, truth_path):
    truth = json.load(open(truth_path))
    ext, meta = analyze_drawing(pdf, "application/pdf", "")
    out_path = os.path.splitext(pdf)[0] + ".extraction.json"
    json.dump({"extraction": ext, "meta": meta}, open(out_path, "w"), indent=1, ensure_ascii=False)
    tparts = [p for p in truth.get("parts", []) if p.get("thk_mm") is not None]
    hits, thk_ok, mat_ok = 0, 0, 0
    for tp in tparts:
        cands = [p for p in ext["parts"] if norm(tp.get("name"))[:6] in norm(p.get("name")) or norm(p.get("name"))[:6] in norm(tp.get("name"))]
        if not cands:
            continue
        hits += 1
        best = min(cands, key=lambda p: abs((p.get("thk_mm") or 1e9) - tp["thk_mm"]))
        thk_ok += best.get("thk_mm") is not None and abs(best["thk_mm"] - tp["thk_mm"]) < 0.01
        mat_ok += norm(tp.get("material"))[:6] in norm(best.get("material_spec"))
    tn = {norm(n.get("mark")) for n in truth.get("nozzles", [])}
    en = {norm(n.get("mark")) for n in ext.get("nozzles", [])}
    rep = {"model": meta.get("model"), "tokens": [meta.get("input_tokens"), meta.get("output_tokens")],
           "parts_reference": len(tparts), "parts_found": hits, "part_recall": round(hits / max(len(tparts), 1), 3),
           "thickness_accuracy": round(thk_ok / max(hits, 1), 3), "material_accuracy": round(mat_ok / max(hits, 1), 3),
           "nozzle_recall": round(len(tn & en) / max(len(tn), 1), 3), "unclear_flagged": len(ext.get("unclear_items", [])),
           "saved": out_path}
    print(json.dumps(rep, indent=1))


if __name__ == "__main__":
    main(*sys.argv[1:])
