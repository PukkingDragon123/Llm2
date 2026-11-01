import json, pathlib
here = pathlib.Path(__file__).parent
def j(p): return (here / p).read_text(encoding="utf-8").replace("</", "<\\/")
html = f'''<title>Prolog Titanium Estimator</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&family=Caladea:ital,wght@0,400;0,700;1,400&display=swap">
<style>{(here/"app.css").read_text(encoding="utf-8")}</style>
<div class="app">
  <nav class="rail" aria-label="Workspace"><div class="brand"><img id="brandlogo" alt="Prolog Titanium"><b>Prolog Titanium<br><span style="font-weight:400;opacity:.8">Estimator</span></b></div>
    <div id="tabs" style="display:contents"></div><div class="foot">Engine reproduces quotation QT-2608533 to the cent. Click any ƒ value for its calculation.</div></nav>
  <main class="main"><header class="top" id="top"></header><div class="content" id="content"><p class="muted">Loading…</p></div></main>
</div>
<script type="application/json" id="seed">{j("build/seed.json")}</script>
<script type="application/json" id="imgs">{j("build/imgs.json")}</script>
<script src="https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script>{(here/"engine.js").read_text(encoding="utf-8")}</script>
<script>document.getElementById("brandlogo").src = JSON.parse(document.getElementById("imgs").textContent).logo;</script>
<script>{(here/"app.js").read_text(encoding="utf-8")}</script>
'''
(here / "build" / "prolog_estimator.html").write_text(html, encoding="utf-8")
print(len(html))
