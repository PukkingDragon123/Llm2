import copy
import json
import os
import subprocess

import pytest

from app.calc.engine import compute, trace
from app.calc.numeric import roundup, eval_expr

HERE = os.path.dirname(__file__)
REF = os.path.join(HERE, "..", "..", "reference")
FIX = json.load(open(os.path.join(HERE, "fixtures", "reference_import.json")))


def pdf_numbers():
    """Values printed on Prolog's original quotation PDF (ground truth)."""
    txt = subprocess.run(["pdftotext", "-layout", os.path.join(REF, "QT-2608533_Rev.4_JI-263937_Titanium_Recycle_Drum.pdf"), "-"],
                         capture_output=True, text=True).stdout
    return txt


def test_roundup_excel_semantics():
    assert roundup(55231.4667, -1) == 55240
    assert roundup(55230.0, -1) == 55230
    assert roundup(145600.3984, -2) == 145700
    assert roundup(965.47, -0.5) == 966          # Excel truncates digits -0.5 -> 0
    assert roundup(-12.1, 0) == -13              # away from zero
    assert roundup(0.1 + 0.2, 1) == 0.3          # float noise does not round up


def test_eval_expr():
    assert eval_expr("45000+42000") == 87000
    assert abs(eval_expr("104000/105") - 990.476190476) < 1e-6
    assert eval_expr("") is None
    with pytest.raises(Exception):
        eval_expr("__import__('os')")


def test_reference_project_reproduces_original_quotation():
    r = compute(FIX["estimate"])
    prices = {i["no"]: i["unit_price"] for i in r["items"]}
    assert prices == {1: 55240, 2: 21560, 3: 68820, 4: 1000}
    t = r["totals"]
    assert (t["total"], t["discount"], t["net"], t["header_price"]) == (146620, 14662, 131958, 135510)
    txt = pdf_numbers()
    for s in ("55,240.00", "21,560.00", "68,820.00", "1,000.00", "146,620.00", "14,662.00", "131,958.00", "135,510.00"):
        assert s in txt
    assert r["ces"]["price"] == 145700 and r["ces"]["net"] == 135501
    assert not [i for i in r["issues"] if i["severity"] in ("missing", "error")]


def test_machine_rates_match_workbook():
    r = compute(FIX["estimate"])
    for m in r["machines"]:
        if m.get("workbook_rate") is not None:
            assert m["rate"] == m["workbook_rate"], m["name"]


def test_price_sheets_match_workbook():
    r = compute(FIX["estimate"])
    for s in r["price_sheets"]:
        assert s["total"] == s["workbook_total"], s["id"]


def test_trace_is_complete_and_consistent():
    r = compute(FIX["estimate"])
    t = trace(r, "totals.net", depth=40)

    def walk(n, seen):
        assert n["label"] != "(unknown)", n["key"]
        seen.add(n["key"])
        for ch in n["children"]:
            walk(ch, seen)
        return seen

    seen = walk(t, set())
    assert "ps.import.l2.up" in seen and "rate.L19" in seen and "set.fx" in seen
    # every calc node's value equals what its inputs imply for sums
    n = r["nodes"]
    assert n["item.1.base"]["value"] == n["ps.import.total"]["value"]


def test_recalculates_when_inputs_change():
    est = copy.deepcopy(FIX["estimate"])
    est["price_sheets"][0]["lines"][2]["unit_price"] = 3500       # 6t plate price up
    r = compute(est)
    assert r["items"][0]["unit_price"] > 55240
    est["settings"]["ovh_pct"] = 0.0
    est["settings"]["risk_pct"] = 0.0
    r2 = compute(est)
    assert r2["items"][1]["unit_price"] == roundup(r2["items"][1]["base"] / 0.75, -1)


def test_missing_inputs_are_reported_not_invented():
    est = copy.deepcopy(FIX["estimate"])
    est["price_sheets"][0]["lines"][0]["unit_price"] = None
    est["crews"][0]["days"] = None
    r = compute(est)
    miss = [i for i in r["issues"] if i["severity"] == "missing"]
    paths = {i["path"] for i in miss}
    assert "price_sheets.0.lines.0.unit_price" in paths and "crews.0.days" in paths
    assert all(i["question"] for i in miss)


def test_part_weight_formulas():
    est = {"materials": [{"code": "02", "name": "Ti Gr-2 Plate", "density": 4.51, "thb_per_kg": 451.409, "shape": "TWL"},
                         {"code": "20", "name": "Ti Gr-2 Pipe", "density": 4.51, "shape": "ODTL"}],
           "parts": [{"id": "a", "name": "Shell", "grade_code": "02", "s1": 6, "s2": 2000, "s3": 6000, "qty": 1, "pricing": "by_weight"},
                     {"id": "b", "name": "Pipe", "grade_code": "20", "s1": 88.9, "s2": 5.49, "s3": 1000, "qty": 2}],
           "buckets": [{"no": 1, "heading": "Mat", "sources": [{"type": "parts_material"}]}]}
    r = compute(est)
    assert abs(r["parts"][0]["weight"] - 324.72) < 1e-9
    assert abs(r["parts"][0]["material_cost_thb"] - 324.72 * 451.409) < 1e-6
    import math
    w = (math.pi / 4 * 0.0889 ** 2 - math.pi / 4 * ((88.9 - 2 * 5.49) / 1000) ** 2) * 1000 * 4.51
    assert abs(r["parts"][1]["weight"] - w) < 1e-9


@pytest.mark.skipif(os.environ.get("SLOW") != "1", reason="set SLOW=1 (LibreOffice import ~70 s)")
def test_import_original_xls_end_to_end():
    from app.importer import import_workbook
    d = import_workbook(os.path.join(REF, "QT-2608533_Rev.4_JI-263937_Titanium_Recycle_Drum.xls"))
    r = compute(d["estimate"])
    assert [i["unit_price"] for i in r["items"]] == [55240, 21560, 68820, 1000]
    assert r["totals"]["header_price"] == 135510
