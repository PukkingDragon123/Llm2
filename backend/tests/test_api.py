"""End-to-end API workflow tests (fresh temporary database; Claude replaced by a recording fake client)."""
import os
import tempfile
import time

TMP = tempfile.mkdtemp(prefix="prolog_test_")
os.environ["PROLOG_DATA_DIR"] = TMP
os.environ.pop("ANTHROPIC_API_KEY", None)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.ai import claude  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
ASBUILT = os.path.join(ROOT, "reference", "DWG_PTC2211120_Titanium_Tank_Recycle_Drum_As_built.pdf")


class _Usage:
    input_tokens, output_tokens = 1000, 500


class _Resp:
    def __init__(self, parsed):
        self.parsed_output, self.stop_reason, self.usage, self.model = parsed, "end_turn", _Usage(), "claude-opus-5-5"


class FakeClient:
    """Mimics client.beta.messages.parse; records requests so we can assert on how Claude is called."""
    def __init__(self):
        self.calls = []
        outer = self

        class _Msgs:
            def parse(self, **kw):
                outer.calls.append(kw)
                schema = kw["output_format"]
                if schema is claude.DrawingExtraction:
                    loc = {"page": 1, "bbox": [0.1, 0.1, 0.3, 0.2]}
                    return _Resp(claude.DrawingExtraction(
                        drawing_type="as_built",
                        title_block=[{"key": "drawing_no", "value": "PTC.2211120", "confidence": 0.95, "location": loc}],
                        design_data=[{"key": "design_pressure", "value": "0.19", "unit": "MPaG", "confidence": 0.9, "location": loc}],
                        main_dimensions=[{"key": "ID", "value": "2800", "unit": "mm", "confidence": 0.95}],
                        parts=[
                            {"mark": "1", "name": "Shell", "category": "shell", "material_spec": "SB-265 Gr.2", "form": "plate",
                             "thk_mm": 6, "width_mm": 2000, "length_mm": 6000, "qty": 7, "confidence": 0.9, "location": loc},
                            {"mark": "2", "name": "Top Head", "category": "head", "material_spec": "SB-265 Gr.2", "form": "plate",
                             "thk_mm": 5, "qty": 1, "confidence": 0.7, "unclear_fields": ["width_mm"], "location": loc},
                            {"mark": "9", "name": "Base Plate", "category": "base_plate", "material_spec": "SA-36", "form": "plate",
                             "thk_mm": 35, "qty": 1, "confidence": 0.85, "location": loc}],
                        nozzles=[{"mark": "A", "service": "Liquid inlet", "size": "16B", "flange_rating": "JIS10K",
                                  "confidence": 0.9, "location": loc}],
                        welding_and_nde=[], surface_finish_and_painting=[], general_notes=["Full RT"],
                        unclear_items=[{"field": "nozzle P", "description": "3in nozzle P missing from nozzle list",
                                        "question": "Is nozzle P (3B) in scope?", "location": loc}],
                        summary="Titanium drum ID2800 x TL6650."))
                if schema is claude.EstimateSuggestion:
                    return _Resp(claude.EstimateSuggestion(
                        crew_days=60, crew_days_rationale="JI-263937 similar size used 60 days",
                        crew=[{"role": "Welder Normal time", "rate_id": "L21", "persons": 4, "rationale": "history"}],
                        processes=[], services=[], material_needs=[], questions=["Confirm RT extent"],
                        confidence_note="based on 1 similar job"))
                raise AssertionError(schema)

        class _Beta:
            messages = _Msgs()

        self.beta = _Beta()


@pytest.fixture(scope="module")
def c():
    with TestClient(app) as cl:
        yield cl


def wait(c, jid, timeout=120):
    t = time.time()
    while time.time() - t < timeout:
        j = c.get(f"/api/jobs/{jid}").json()
        if j["status"] != "running":
            return j
        time.sleep(0.3)
    raise TimeoutError(jid)


def test_seeded_reference_project(c):
    ps = c.get("/api/projects").json()
    assert len(ps) == 1 and ps[0]["job_no"] == "JI-263937"
    d = c.get(f"/api/projects/{ps[0]['id']}").json()
    assert [i["unit_price"] for i in d["result"]["items"]] == [55240, 21560, 68820, 1000]
    assert d["result"]["totals"]["net"] == 131958
    t = c.post("/api/trace", json={"estimate": d["estimate"], "key": "item.3.price"}).json()
    assert t["formula"].startswith("calculated") or t["children"]


def test_blank_project_asks_for_missing_info_and_blocks_issue(c):
    p = c.post("/api/projects", json={"job_no": "JI-TEST1", "quotation_no": "QT-TEST1", "customer_name": "ACME",
                                      "product_subject": "Titanium Tank"}).json()
    d = c.get(f"/api/projects/{p['id']}").json()
    miss = [i for i in d["result"]["issues"] if i["severity"] == "missing"]
    assert miss and all(i["question"] for i in miss)
    r = c.post(f"/api/projects/{p['id']}/revisions", json={"note": "x"})
    assert r.status_code == 409


def test_copy_issue_revision_and_download(c):
    ref = c.get("/api/projects").json()[-1]
    p = c.post("/api/projects", json={"job_no": "JI-TEST2", "quotation_no": "QT-2700001-PJ-REV.0", "customer_name": "Moritani",
                                      "product_subject": "Titanium Recycle Drum", "copy_from": ref["id"]}).json()
    r = c.post(f"/api/projects/{p['id']}/revisions", json={"note": "first issue"})
    assert r.status_code == 200, r.text
    rv = r.json()
    assert rv["quotation_no"] == "QT-2700001-PJ-REV.1" and rv["totals"]["net"] == 131958
    pdf = c.get(f"/api/revisions/{rv['id']}/files/{rv['files']['quotation_pdf']}")
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"
    x = c.get(f"/api/revisions/{rv['id']}/files/{rv['files']['costing_xlsx']}")
    assert x.status_code == 200 and x.content[:2] == b"PK"
    # change an input -> new revision -> compare
    d = c.get(f"/api/projects/{p['id']}").json()
    est = d["estimate"]
    est["settings"]["quote_discount_pct"] = 0.05
    c.put(f"/api/projects/{p['id']}", json={"estimate": est})
    rv2 = c.post(f"/api/projects/{p['id']}/revisions", json={"note": "5% discount"}).json()
    assert rv2["quotation_no"].endswith("REV.2") and rv2["totals"]["net"] == 146620 * 0.95
    diff = c.get(f"/api/projects/{p['id']}/revisions/compare", params={"a": rv["id"], "b": rv2["id"]}).json()
    assert any(x["item"] == "net" and abs(x["delta"] - (146620 * 0.95 - 131958)) < 1e-6 for x in diff)


def test_ai_unavailable_without_key(c):
    claude.set_test_client(None)
    p = c.get("/api/projects").json()[0]
    with open(ASBUILT, "rb") as f:
        dw = c.post(f"/api/projects/{p['id']}/drawings", files={"file": ("asbuilt.pdf", f, "application/pdf")}).json()
    r = c.post(f"/api/drawings/{dw['id']}/analyze", json={})
    assert r.status_code == 503 and r.json()["code"] == "ai_unavailable"


def test_drawing_analysis_review_and_bom(c):
    fake = FakeClient()
    claude.set_test_client(fake)
    try:
        p = c.post("/api/projects", json={"job_no": "JI-TEST3", "product_subject": "Titanium Recycle Drum"}).json()
        with open(ASBUILT, "rb") as f:
            dw = c.post(f"/api/projects/{p['id']}/drawings", files={"file": ("asbuilt.pdf", f, "application/pdf")}).json()
        assert dw["pages"] == 5
        png = c.get(f"/api/drawings/{dw['id']}/page/1.png?w=800")
        assert png.status_code == 200 and png.content[:4] == b"\x89PNG"
        job = c.post(f"/api/drawings/{dw['id']}/analyze", json={"context": "ID2800 drum"}).json()
        j = wait(c, job["job_id"])
        assert j["status"] == "done", j
        call = fake.calls[-1]
        assert call["model"] == "claude-opus-5-5" and call["thinking"] == {"type": "adaptive"}
        assert call["fallbacks"] == "default" and "server-side-fallback-2026-07-01" in call["betas"]
        imgs = [b for b in call["messages"][0]["content"] if b["type"] == "image"]
        assert len(imgs) == 5 * 5      # overview + 4 tiles per page
        d = c.get(f"/api/drawings/{dw['id']}").json()
        assert d["status"] == "extracted" and len(d["extraction"]["parts"]) == 3
        # engineer: accept shell, correct the head width, reject base plate
        review = {"parts": {"0": {"status": "accepted"}, "1": {"status": "edited", "values": {"width_mm": 3200, "length_mm": 3200}},
                            "2": {"status": "rejected"}}, "complete": True}
        c.put(f"/api/drawings/{dw['id']}/review", json=review)
        res = c.post(f"/api/drawings/{dw['id']}/to-bom").json()
        assert len(res["added"]) == 2 and res["not_accepted"] == [2]
        est = c.get(f"/api/projects/{p['id']}").json()["estimate"]
        shell = [x for x in est["parts"] if x["name"].startswith("Shell")][0]
        assert (shell["s1"], shell["s2"], shell["s3"], shell["grade_code"]) == (6, 2000, 6000, "02")
        head = [x for x in est["parts"] if x["name"].startswith("Top Head")][0]
        assert head["s2"] == 3200
        # estimate suggestion job
        job = c.post(f"/api/projects/{p['id']}/ai/suggest").json()
        j = wait(c, job["job_id"])
        assert j["status"] == "done" and j["result"]["suggestion"]["crew"][0]["rate_id"] == "L21"
        sys_prompt = fake.calls[-1]["system"][0]
        assert sys_prompt["cache_control"] == {"type": "ephemeral"} and "NEVER propose supplier material prices" in sys_prompt["text"]
    finally:
        claude.set_test_client(None)


def test_suppliers_prices(c):
    prices = c.get("/api/prices", params={"q": "6t"}).json()
    assert any(p["unit_price"] == 3395 for p in prices)
    sup = c.get("/api/suppliers").json()
    assert sup and sup[0]["price_count"] > 0
    new = c.post("/api/prices", json={"supplier_name": "Test Mill", "material": "Ti.Gr.2", "description": "2000x6000x6t mm.",
                                      "unit_price": 3500, "currency": "USD", "quote_date": "2026-10-01"}).json()
    assert new["id"] and new["age_days"] is not None


def test_actuals_calibration_and_learning(c):
    ref = c.get("/api/projects").json()[-1]
    c.put(f"/api/projects/{ref['id']}/actuals", json={"categories": {"crews": {"actual": 764303.4 * 1.1}}, "mark_completed": True})
    cal = c.get("/api/learning/calibration").json()
    assert cal["crews"]["n"] >= 1 and abs(cal["crews"]["factor"] - 1.1) < 1e-9
    other = [p for p in c.get("/api/projects").json() if p["job_no"] == "JI-TEST2"][0]
    lr = c.get(f"/api/projects/{other['id']}/learning").json()
    s = [x for x in lr["suggestions"] if x["category"] == "crews"][0]
    assert abs(s["suggested_pct"] - 0.1) < 1e-9 and s["item"] == 3
    sim = c.get(f"/api/projects/{other['id']}/similar").json()
    assert sim[0]["score"] > 0.5
