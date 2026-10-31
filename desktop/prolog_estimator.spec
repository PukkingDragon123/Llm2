# PyInstaller spec - build from repo root:  pyinstaller desktop/prolog_estimator.spec
import os
from PyInstaller.utils.hooks import collect_submodules, collect_data_files
root = os.path.abspath(".")
datas = [
    (os.path.join(root, "backend", "app", "templates"), os.path.join("app", "templates")),
    (os.path.join(root, "backend", "app", "seed"), os.path.join("app", "seed")),
    (os.path.join(root, "backend", "fonts"), "fonts"),
    (os.path.join(root, "frontend", "dist"), os.path.join("frontend", "dist")),
]
datas += collect_data_files("anthropic") + collect_data_files("pymupdf")
hidden = collect_submodules("app") + collect_submodules("uvicorn") + ["webview", "multipart", "python_multipart"]
a = Analysis([os.path.join(root, "desktop", "launcher.py")], pathex=[os.path.join(root, "backend")],
             datas=datas, hiddenimports=hidden, excludes=["tkinter", "matplotlib", "pytest"])
pyz = PYZ(a.pure)
icon = os.path.join(root, "desktop", "icon.ico") if os.name == "nt" else None
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="PrologEstimator", console=False, icon=icon)
coll = COLLECT(exe, a.binaries, a.datas, name="PrologEstimator")
