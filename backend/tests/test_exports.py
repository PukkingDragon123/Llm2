import copy
import json
import os
import sys

import openpyxl

from app.calc.engine import compute
from app.exports.costing import build_costing_workbook, verify_with_libreoffice
from app.exports.quotation import build_quotation_workbook, xlsx_to_pdf

HERE = os.path.dirname(__file__)
ROOT = os.path.join(HERE, "..", "..")
FIX = json.load(open(os.path.join(HERE, "..", "app", "seed", "reference_import.json")))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from compare_pdf import compare  # noqa: E402

REF_PDF = os.path.join(ROOT, "reference", "QT-2608533_Rev.4_JI-263937_Titanium_Recycle_Drum.pdf")
# Text present in the original PDF only as invisible (white) characters: the product line repeated under
# the page-2 table header. Not visible on paper.
INVISIBLE_ON_PAGE2 = {"Titanium", "Recycle", "Drum", "(", "SIZE", ":", "ID", "2,800", "x", "TL", "6,700", "mm.", ")",
                      "135,510.00", "1.00"}


def test_quotation_pdf_matches_original(tmp_path):
    r = compute(FIX["estimate"])
    doc = copy.deepcopy(FIX["quote_doc"])
    doc["quotation_date"] = "2026-10-19"    # date printed on the original
    x = tmp_path / "QT.xlsx"
    info = build_quotation_workbook(doc, r, str(x))
    assert info["breaks"] == [32]
    pdf = xlsx_to_pdf(str(x), str(tmp_path))
    rep = compare(REF_PDF, pdf)
    assert rep["pages"] == [3, 3]
    for p in rep["page_reports"]:
        missing = [w for w in p["missing_words"] if not (p["page"] == 2 and w in INVISIBLE_ON_PAGE2)]
        assert missing == [], (p["page"], missing)
        assert p["extra_words"] == [], (p["page"], p["extra_words"])
        assert abs(p["median_dx_pt_unique"]) <= 2.0 and abs(p["median_dy_pt_unique"]) <= 3.0, p
        assert p["p90_abs_dy_pt_unique"] <= 4.5, p
    # spreadsheet keeps live formulas and original print setup
    wb = openpyxl.load_workbook(x)
    ws = wb["5. Quotation"]
    assert ws["V73"].value == "=SUM(V19:Y72)" and ws["V75"].value == "=V73-V74"
    assert ws.page_setup.scale == 95 and ws.print_title_rows.replace("$", "") == "1:17"
    assert ws.oddFooter.right.text == "FM-SAL-001 REV.NO.03 EFF.DATE 05/03/25"


def test_quotation_grows_with_more_lines(tmp_path):
    r = compute(FIX["estimate"])
    doc = copy.deepcopy(FIX["quote_doc"])
    doc["page_breaks"] = "auto"
    extra = [{"kind": "line", "runs": [{"text": f" - Extra line {i} : ASTM B265 Gr.2 ; Q'ty = 1 Lot."}]} for i in range(40)]
    doc["rows"] = doc["rows"][:8] + extra + doc["rows"][8:]
    x = tmp_path / "QT_long.xlsx"
    info = build_quotation_workbook(doc, r, str(x))
    assert len(info["breaks"]) >= 2
    pdf = xlsx_to_pdf(str(x), str(tmp_path))
    import subprocess
    txt = subprocess.run(["pdftotext", "-layout", pdf, "-"], capture_output=True, text=True).stdout
    assert "Extra line 39" in txt and "131,958.00" in txt


def test_costing_workbook_formulas_recalculate_to_engine_values(tmp_path):
    r = compute(FIX["estimate"])
    x = tmp_path / "costing.xlsx"
    cells = build_costing_workbook(FIX["estimate"], r, FIX["project"], str(x))
    rep = verify_with_libreoffice(str(x), cells, r)
    assert rep["checked"] > 90 and rep["mismatches"] == []


def test_costing_workbook_with_adjustments(tmp_path):
    est = copy.deepcopy(FIX["estimate"])
    est["buckets"][2]["adjustments"] = [{"label": "Historical labor calibration", "pct": 0.08,
                                         "reason": "3 jobs actual/estimate", "source": "history"}]
    r = compute(est)
    assert r["items"][2]["unit_price"] > 68820
    x = tmp_path / "c.xlsx"
    cells = build_costing_workbook(est, r, FIX["project"], str(x))
    rep = verify_with_libreoffice(str(x), cells, r)
    assert rep["mismatches"] == []
