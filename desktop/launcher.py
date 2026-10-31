"""Prolog Titanium Estimator - desktop launcher.

Runs the full application locally (FastAPI backend + built frontend) and shows it in a native window
(pywebview: WebView2 on Windows, WebKit on macOS, GTK/Qt on Linux). Falls back to the default browser if no
native webview is available. All data stays on this computer, in the per-user data folder."""
import os
import socket
import sys
import threading
import time
import urllib.request

APP_NAME = "Prolog Titanium Estimator"


def base_dir() -> str:
    if getattr(sys, "frozen", False):
        return getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    return os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def data_dir() -> str:
    if os.environ.get("PROLOG_DATA_DIR"):
        return os.environ["PROLOG_DATA_DIR"]
    if sys.platform == "win32":
        root = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~\\AppData\\Local")
    elif sys.platform == "darwin":
        root = os.path.expanduser("~/Library/Application Support")
    else:
        root = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
    return os.path.join(root, "PrologTitaniumEstimator")


def configure_streams():
    """Windowed builds have no console (sys.stdout/stderr are None): send output to a log file instead."""
    if sys.stdout is None or sys.stderr is None:
        d = data_dir()
        os.makedirs(d, exist_ok=True)
        f = open(os.path.join(d, "app.log"), "a", buffering=1, encoding="utf-8")
        sys.stdout = sys.stdout or f
        sys.stderr = sys.stderr or f


def configure_env():
    b = base_dir()
    frozen = getattr(sys, "frozen", False)
    os.environ.setdefault("PROLOG_DATA_DIR", data_dir())
    os.makedirs(os.environ["PROLOG_DATA_DIR"], exist_ok=True)
    os.environ.setdefault("PROLOG_FRONTEND_DIST", os.path.join(b, "frontend", "dist"))
    user_fonts = os.path.join(os.environ["PROLOG_DATA_DIR"], "fonts")
    os.makedirs(user_fonts, exist_ok=True)
    os.environ.setdefault("PROLOG_FONTS_DIR", user_fonts)
    if not frozen:
        sys.path.insert(0, os.path.join(b, "backend"))


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def start_server(port: int):
    import uvicorn
    from app.main import app
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", log_config=None)
    server = uvicorn.Server(config)
    t = threading.Thread(target=server.run, daemon=True)
    t.start()
    url = f"http://127.0.0.1:{port}"
    for _ in range(150):
        try:
            with urllib.request.urlopen(url + "/api/health", timeout=1) as r:
                if r.status == 200:
                    return server, url
        except Exception:
            time.sleep(0.2)
    raise RuntimeError("The application server did not start")


def main():
    configure_streams()
    configure_env()
    smoke = "--smoke-test" in sys.argv
    port = free_port()
    server, url = start_server(port)
    if smoke:   # CI / installer check: server + UI + engine reachable, then exit
        import json
        h = json.loads(urllib.request.urlopen(url + "/api/health").read())
        html = urllib.request.urlopen(url + "/").read()
        ps = json.loads(urllib.request.urlopen(url + "/api/projects").read())
        p = json.loads(urllib.request.urlopen(url + f"/api/projects/{ps[0]['id']}").read())
        net = p["result"]["totals"]["net"]
        pdf_ok = None
        if h.get("soffice") or h.get("excel"):
            pdf = urllib.request.urlopen(url + f"/api/projects/{ps[0]['id']}/export/quotation.pdf", timeout=300).read()
            pdf_ok = pdf[:4] == b"%PDF"
        result = json.dumps({"health": h, "ui": b"<div id=\"root\"" in html, "projects": len(ps), "net": net, "pdf": pdf_ok})
        print(result)
        out = os.environ.get("PROLOG_SMOKE_OUT")
        if out:
            open(out, "w").write(result)
        ok = h["ok"] and b"root" in html and abs(net - 131958) < 0.005 and pdf_ok is not False
        server.should_exit = True
        sys.exit(0 if ok else 1)
    if "--browser" not in sys.argv:
        try:
            import webview
            webview.create_window(APP_NAME, url, width=1440, height=900, min_size=(1100, 700))
            webview.start()
            server.should_exit = True
            return
        except Exception as e:  # no native webview available -> browser
            print("Native window unavailable, opening browser:", e)
    import webbrowser
    webbrowser.open(url)
    print(f"{APP_NAME} running at {url} - close this window to quit.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        server.should_exit = True


if __name__ == "__main__":
    main()
