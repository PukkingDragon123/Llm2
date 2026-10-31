"""Build backend/app/templates/quotation_template.xlsx from the original Prolog quotation workbook.

Keeps only '5. Quotation' and 'Disclaimers' with original styles/merges/print setup; formulas are
replaced by their cached values (the app writes its own values at export time)."""
import sys, openpyxl
from openpyxl.utils import column_index_from_string
src, dst = sys.argv[1], sys.argv[2]
wf = openpyxl.load_workbook(src)
wv = openpyxl.load_workbook(src, data_only=True)
keep = ['5. Quotation', 'Disclaimers']
for name in list(wf.sheetnames):
    if name not in keep:
        del wf[name]
for name in keep:
    ws, vs = wf[name], wv[name]
    ws.data_validations.dataValidation = []
    ws.conditional_formatting = type(ws.conditional_formatting)()
    for row in ws.iter_rows():
        for c in row:
            if c.__class__.__name__ == 'MergedCell':
                continue
            if c.column >= column_index_from_string('Z'):
                c.value = None; continue
            if isinstance(c.value, str) and c.value.startswith('='):
                c.value = vs[c.coordinate].value
    # drop merges entirely right of Y
    for m in list(ws.merged_cells.ranges):
        if m.min_col >= column_index_from_string('Z'):
            ws.unmerge_cells(str(m))
    ws._images = []
# rows beyond the printed area of the quotation hold a non-printed duplicate; drop them
q = wf['5. Quotation']
if q.max_row > 79:
    for m in list(q.merged_cells.ranges):
        if m.min_row > 79:
            q.unmerge_cells(str(m))
    q.delete_rows(80, q.max_row - 79)
# record Disclaimers cells that are linked to customer name / product subject on the quotation
import json, os
var = {}
for row in wf['Disclaimers'].iter_rows():
    for c in row:
        pass
wd = openpyxl.load_workbook(src)['Disclaimers']
for row in wd.iter_rows():
    for c in row:
        if isinstance(c.value, str) and c.value.startswith('='):
            f = c.value.replace('$', '')
            if "Quotation'!E9" in f: var[c.coordinate] = 'customer_name'
            elif "Quotation'!E14" in f: var[c.coordinate] = 'product_subject'
import re as _re
changed = True
while changed:
    changed = False
    for row in wd.iter_rows():
        for c in row:
            if c.coordinate in var or not (isinstance(c.value, str) and c.value.startswith('=')):
                continue
            refs = _re.findall(r"(?<![!A-Z])\$?([A-Z]{1,2})\$?(\d+)", c.value)
            for col, r in refs:
                k = f"{col}{r}"
                if k in var and "!" not in c.value:
                    var[c.coordinate] = var[k]; changed = True; break
metap = os.path.join(os.path.dirname(dst), 'template_meta.json')
meta = json.load(open(metap)) if os.path.exists(metap) else {}
meta['disclaimer_variables'] = var
json.dump(meta, open(metap, 'w'), indent=1)
print('disclaimer variable cells:', var)
wf.save(dst)
print('saved', dst)
