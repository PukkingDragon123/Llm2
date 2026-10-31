# Verification report — reference project QT-2608533 / JI-263937 (Titanium Recycle Drum)

All results below are reproduced by `cd backend && python -m pytest -q` (plus `SLOW=1` for the raw `.xls` import).

## 1. Calculations

Import of the original workbook `reference/QT-2608533_Rev.4_…xls` → engine recomputation → comparison with the
values Excel cached in that file (and printed on the original PDF):

| Value | Excel / PDF | Recomputed | |
|--|--|--|--|
| Item 1 Main Part : Titanium | 55,240.00 | 55,240.00 | ✔ |
| Item 2 Other Accessories | 21,560.00 | 21,560.00 | ✔ |
| Item 3 Labor cost | 68,820.00 | 68,820.00 | ✔ |
| Item 4 JTEPA | 1,000.00 | 1,000.00 | ✔ |
| Total / Discount 10 % / Net | 146,620.00 / 14,662.00 / 131,958.00 | same | ✔ |
| Product line price (CES path, 7 % CES discount) | 135,510.00 | 135,510.00 | ✔ |
| Import Price / Import (WFN) / Domestic totals | 35,710 USD / 2,633 USD / 340,460 THB | same | ✔ |
| In-house crew (11 persons × 60 days) | 764,303.40 THB | same | ✔ |
| Machine-hour rates (22 machines) | workbook column BW | same | ✔ 22/22 |

The editable costing workbook is recalculated by LibreOffice and every mapped cell (≈100) is compared with the
engine: 0 mismatches (also with historical-calibration adjustments applied).

## 2. Customer quotation output

Generated from the imported data with the original sheets as template, compared with the original PDF
(`tools/compare_pdf.py`) and the original sheet (`tools/compare_xlsx.py`):

| Check | Result |
|--|--|
| Pages | 3 / 3 (page break after the same row: items 1–3 on page 1, item 4 + terms + totals + certificates on page 2, Disclaimers page 3) |
| Words (text content) page 1 / 2 / 3 | 499/499 · 299/315* · 358/358 |
| Median word position offset (unique words) | page 1: +0.4 / −0.6 pt · page 2: −0.1 / −0.9 pt · page 3: −1.5 / −2.8 pt |
| 90th percentile vertical offset | 2.9 / 2.7 / 3.8 pt |
| Sheet cells A1:Y79 | borders 0 diffs, row heights 0, merges 0, alignment 0; values differ only where the original holds `NOW()` or LibreOffice-unevaluable `#VALUE!` caches; fill of the four section headings deliberately set to the printed colour D8E4BC (the xls palette entry converts to 00FF00) |

\* The 16 page-2 words "missing" are white (invisible) text in the original — the product line repeated under the
page-2 table header. They do not appear on paper.

### Remaining differences (not fixed, with reason)

1. **Fonts.** The original uses Cambria (body) and Angsana New (footer). They are proprietary and not installed in
   this Linux build environment, so PDFs here use Caladea (metric-compatible with Cambria) and Liberation Serif 9 pt
   (matched to the printed footer width). Glyph shapes differ slightly and two long description lines wrap at a
   different word. Fix: copy the licensed font files into `backend/fonts/` — the renderer then uses them and the footer
   substitution is switched off automatically. The `.xlsx` always specifies the original fonts.
2. **Renderer geometry.** The original PDF was printed by Excel; the app renders with LibreOffice. LibreOffice prints
   the Disclaimers sheet ≈2.4 % smaller and places footers lower; both are calibrated for the PDF copy only
   (`PDF_SCALE_CALIBRATION`, `PDF_FOOTER_MARGIN_IN`). Residual offsets are listed above.
3. Pixel-level difference ratio at 50 dpi is ≈8–10 % per page, dominated by font anti-aliasing / glyph differences.
4. Quotation date: the original sheet uses `=NOW()`; the app writes the quotation date stored on the project.

## 3. Findings in the source workbook (reported, not "corrected")

- The PDF reads `QT-2608533-PJ-REV.3-NTWS` while the file name says Rev.4.
- Item prices (bucket formula, rounded to 10) and the product-line price (CES path: rounded to 100, 7 % CES discount)
  are two independent calculations; the quotation shows 135,510 on the product line but totals 146,620 / net 131,958.
  The app reproduces both and lets you choose the product-line mode (`ces` / `sum_items` / `manual`).
- The hidden *Pricing Policy* sheet (OVH 35 %, Risk 5 % compounded for custom-made) is not wired to any formula;
  the live calculation uses OVH 10 % and Risk 6 % on the same base and a 0.75 divisor. The app uses the live values
  (editable in Settings).
- Hard-coded overrides inside formulas (kept and shown in traces): Import Price row 9 = BOQ price − 442; sea freight
  THB 55,500; WFN freight USD 300 + THB 20,000; drawing THB 20,000; head forming THB 45,000 + 42,000; packing THB 24,800;
  crew 60 days; RT 7 jobs × 15,000; PT weld length 104,000 mm / 105.
- Machine consumables ratio is 0.3 on some rows and 0.5 on others (relative-reference slip in the workbook); imported
  per machine as found. Machine hours are per CES row (not multiplied by part quantity), as in the workbook.
- Domestic price sheet lists lap-joint flanges with quantities but no price (they are bought through the WFN sheet);
  not imported as lines, noted in the import notes.
- Drawing vs quotation: the as-built drawing lists loose flanges SS400 (HDG) and a JIS 5K manhole, while the quotation
  text says A105; empty weight on the drawing is 4,037 kg vs "~6,200 kg" transport weight in the quotation.

## 4. Not verifiable here (missing source data / credentials)

- **Live Claude calls.** No Anthropic API key exists in this environment. The integration is implemented with the
  official SDK and tested with a recording fake client (request shape: model, adaptive thinking, structured output
  schema, refusal fallback, prompt caching, 25 images for a 5-page drawing). Extraction accuracy on real drawings must
  be measured with `tools/eval_drawing_extraction.py` once a key is configured.
- **Learning from actual production costs.** The workbook's actual-cost sheets (MRA, CCC, APRP, TCRP, KPI) are empty or
  `#REF!`; there is no completed project with actuals. The calibration code is tested with synthetic actuals only.
- Only one historical workbook was available; the importer is written for the FM-SAL-001 layout and reports anything it
  cannot recognise in import notes rather than guessing.
- Per-part dimensions in the CES sheet are blank in the reference workbook (material is priced per piece from supplier
  sheets), so per-part weight costing could not be compared with a Prolog reference.
