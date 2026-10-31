"""Cell-by-cell comparison of the generated quotation sheet with the original workbook's sheet.
Usage: python compare_xlsx.py original_converted.xlsx generated.xlsx [sheet]"""
import sys
import openpyxl
from openpyxl.utils import get_column_letter as L


def sig(c):
    f, b, a = c.font, c.border, c.alignment
    col = f.color.rgb if f.color is not None and isinstance(f.color.rgb, str) else None
    fill = c.fill.fgColor.rgb if c.fill is not None and c.fill.fill_type == "solid" else None
    return {"font": (f.name, f.sz, bool(f.b), bool(f.i), f.u, col if col not in ("FF000000",) else None),
            "fill": fill, "border": tuple(getattr(b, k).style for k in ("left", "right", "top", "bottom")),
            "align": (a.horizontal, a.vertical, bool(a.wrap_text)), "numfmt": c.number_format}


def main(a, b, sheet="5. Quotation", rows=79, cols=25):
    wa = openpyxl.load_workbook(a, data_only=True, rich_text=False)[sheet]
    wb = openpyxl.load_workbook(b, rich_text=False)[sheet]
    diffs = {"value": [], "font": [], "fill": [], "border": [], "align": [], "numfmt": [], "height": [], "merge": []}
    for r in range(1, rows + 1):
        ha, hb = wa.row_dimensions[r].height, wb.row_dimensions[r].height
        if (ha or 15) != (hb or 15):
            diffs["height"].append((r, ha, hb))
        for c in range(1, cols + 1):
            ca, cb = wa.cell(r, c), wb.cell(r, c)
            if ca.__class__.__name__ == "MergedCell" and cb.__class__.__name__ == "MergedCell":
                continue
            va, vb = ca.value, cb.value
            if isinstance(vb, str) and vb.startswith("="):
                vb = "<formula>"
            if va != vb and not (vb == "<formula>" and isinstance(va, (int, float))) and not (va in (None, "") and vb in (None, "")):
                diffs["value"].append((f"{L(c)}{r}", str(va)[:40], str(vb)[:40]))
            sa, sb = sig(ca), sig(cb)
            for k in ("font", "fill", "border", "align", "numfmt"):
                if sa[k] != sb[k] and not (k == "numfmt" and va in (None, "")):
                    diffs[k].append((f"{L(c)}{r}", sa[k], sb[k]))
    ma = {str(m) for m in wa.merged_cells.ranges if m.max_row <= rows and m.max_col <= cols}
    mb = {str(m) for m in wb.merged_cells.ranges if m.max_row <= rows and m.max_col <= cols}
    diffs["merge"] = sorted(ma ^ mb)
    for k, v in diffs.items():
        print(f"{k}: {len(v)}")
        for x in v[:8]:
            print("   ", x)


if __name__ == "__main__":
    main(*sys.argv[1:])
