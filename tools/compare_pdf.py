"""Compare a generated PDF with the original reference PDF: page count, text content and word positions,
plus a per-page pixel difference ratio. Usage: python compare_pdf.py original.pdf generated.pdf [outdir]"""
import json
import os
import re
import subprocess
import sys
import tempfile
from difflib import SequenceMatcher
from html import unescape


def words(pdf):
    out = subprocess.run(["pdftotext", "-bbox", pdf, "-"], capture_output=True, text=True).stdout
    pages, cur = [], None
    for line in out.splitlines():
        if line.strip().startswith("<page"):
            cur = []
            pages.append(cur)
        m = re.search(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*)</word>', line)
        if m and cur is not None:
            cur.append((unescape(m.group(5)), *map(float, m.group(1, 2, 3, 4))))
    return pages


def pixel_diff(a, b, page, tmp):
    from PIL import Image, ImageChops
    pa, pb = os.path.join(tmp, "a"), os.path.join(tmp, "b")
    subprocess.run(["pdftoppm", "-r", "50", "-gray", "-png", "-f", str(page), "-l", str(page), a, pa], check=True)
    subprocess.run(["pdftoppm", "-r", "50", "-gray", "-png", "-f", str(page), "-l", str(page), b, pb], check=True)
    fa = [f for f in os.listdir(tmp) if f.startswith("a")][0]
    fb = [f for f in os.listdir(tmp) if f.startswith("b")][0]
    ia = Image.open(os.path.join(tmp, fa)).convert("L")
    ib = Image.open(os.path.join(tmp, fb)).convert("L").resize(ia.size)
    d = ImageChops.difference(ia, ib).point(lambda x: 255 if x > 64 else 0)
    ratio = sum(d.histogram()[255:]) / (ia.size[0] * ia.size[1])
    for f in (fa, fb):
        os.remove(os.path.join(tmp, f))
    return ratio


def compare(orig, gen):
    A, B = words(orig), words(gen)
    rep = {"pages": [len(A), len(B)], "page_reports": []}
    with tempfile.TemporaryDirectory() as tmp:
        for p in range(min(len(A), len(B))):
            wa, wb = A[p], B[p]
            # nearest same-text word matching (robust to reading-order differences)
            pool = {}
            from collections import Counter
            cnt = Counter(w[0] for w in wa)
            for j, w in enumerate(wb):
                pool.setdefault(w[0], []).append(j)
            pairs = []
            for i, w in enumerate(wa):
                cands = pool.get(w[0]) or []
                if cands:
                    j = min(cands, key=lambda j: abs(wb[j][1] - w[1]) + abs(wb[j][2] - w[2]))
                    cands.remove(j)
                    pairs.append((i, j))
            class _SM:
                def get_opcodes(self_):
                    ops = [("equal", i, i + 1, j, j + 1) for i, j in pairs]
                    mi = set(range(len(wa))) - {i for i, _ in pairs}
                    mj = set(range(len(wb))) - {j for _, j in pairs}
                    ops += [("delete", i, i + 1, 0, 0) for i in sorted(mi)]
                    ops += [("insert", 0, 0, j, j + 1) for j in sorted(mj)]
                    return ops
            sm = _SM()
            dx, dy, matched = [], [], 0
            missing, extra = [], []
            for tag, i1, i2, j1, j2 in sm.get_opcodes():
                if tag == "equal":
                    for i, j in zip(range(i1, i2), range(j1, j2)):
                        dx.append(wb[j][1] - wa[i][1])
                        dy.append(wb[j][2] - wa[i][2])
                        matched += 1
                else:
                    missing += [w[0] for w in wa[i1:i2]]
                    extra += [w[0] for w in wb[j1:j2]]
            mx = max((abs(x) for x in dx), default=0)
            my = max((abs(y) for y in dy), default=0)
            worst = sorted(((abs(dy[k]) + abs(dx[k]), k) for k in range(len(dx))), reverse=True)[:5]
            eq = [(i, j) for tag, i1, i2, j1, j2 in sm.get_opcodes() if tag == "equal" for i, j in zip(range(i1, i2), range(j1, j2))]
            rep["page_reports"].append({
                "page": p + 1, "words_orig": len(wa), "words_gen": len(wb), "matched": matched,
                "text_match_ratio": round(matched / max(len(wa), 1), 4),
                "median_dx_pt_unique": round(sorted([dx[k] for k, (i, j) in enumerate(pairs) if cnt[wa[i][0]] == 1] or [0])[len([1 for i, j in pairs if cnt[wa[i][0]] == 1]) // 2], 2),
                "median_dy_pt_unique": round(sorted([dy[k] for k, (i, j) in enumerate(pairs) if cnt[wa[i][0]] == 1] or [0])[len([1 for i, j in pairs if cnt[wa[i][0]] == 1]) // 2], 2),
                "p90_abs_dy_pt_unique": round(sorted([abs(dy[k]) for k, (i, j) in enumerate(pairs) if cnt[wa[i][0]] == 1] or [0])[int(0.9 * len([1 for i, j in pairs if cnt[wa[i][0]] == 1]))] if pairs else 0, 2),
                "mean_abs_dx_pt": round(sum(abs(x) for x in dx) / max(len(dx), 1), 2),
                "mean_abs_dy_pt": round(sum(abs(y) for y in dy) / max(len(dy), 1), 2),
                "max_dx_pt": round(mx, 2), "max_dy_pt": round(my, 2),
                "worst": [(wa[eq[k][0]][0], round(dx[k], 1), round(dy[k], 1)) for _, k in worst],
                "missing_words": missing[:40], "extra_words": extra[:40],
                "pixel_diff_ratio": round(pixel_diff(orig, gen, p + 1, tmp), 4),
            })
    return rep


if __name__ == "__main__":
    r = compare(sys.argv[1], sys.argv[2])
    print(json.dumps(r, indent=1, ensure_ascii=False))
