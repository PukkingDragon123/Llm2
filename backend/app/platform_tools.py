"""Office tooling discovery: LibreOffice on any OS, Microsoft Excel (COM) on Windows.

Excel is preferred on Windows because Prolog's original quotation PDF was printed by Excel: rendering with
Excel (with the installed Cambria / Angsana New fonts) reproduces the original exactly, and Excel evaluates
XLOOKUP when importing workbooks."""
from __future__ import annotations

import glob
import os
import shutil
import sys


def soffice_path() -> str | None:
    p = os.environ.get("PROLOG_SOFFICE") or shutil.which("soffice") or shutil.which("libreoffice")
    if p:
        return p
    cands = []
    if sys.platform == "win32":
        for base in (os.environ.get("ProgramFiles", r"C:\Program Files"), os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")):
            cands += glob.glob(os.path.join(base, "LibreOffice*", "program", "soffice.exe"))
    elif sys.platform == "darwin":
        cands += ["/Applications/LibreOffice.app/Contents/MacOS/soffice"]
    else:
        cands += ["/usr/bin/soffice", "/usr/lib/libreoffice/program/soffice", "/opt/libreoffice/program/soffice"]
    for c in cands:
        if os.path.exists(c):
            return c
    return None


def require_soffice() -> str:
    p = soffice_path()
    if not p:
        raise RuntimeError("LibreOffice is required for Excel/PDF conversion but was not found. Install LibreOffice "
                           "(https://www.libreoffice.org) or, on Windows, Microsoft Excel.")
    return p


def excel_available() -> bool:
    if sys.platform != "win32" or os.environ.get("PROLOG_DISABLE_EXCEL") == "1":
        return False
    try:
        import win32com.client  # noqa: F401
        import winreg
        winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, "Excel.Application")
        return True
    except Exception:
        return False


def _excel():
    import pythoncom
    import win32com.client
    pythoncom.CoInitialize()
    xl = win32com.client.DispatchEx("Excel.Application")
    xl.Visible = False
    xl.DisplayAlerts = False
    return xl


def excel_export_pdf(xlsx_path: str, pdf_path: str):
    """Print the workbook to PDF with Excel itself (same renderer as Prolog's original)."""
    xl = _excel()
    try:
        wb = xl.Workbooks.Open(os.path.abspath(xlsx_path), ReadOnly=True)
        try:
            wb.ExportAsFixedFormat(0, os.path.abspath(pdf_path), 0, True, False)   # xlTypePDF, standard quality
        finally:
            wb.Close(False)
    finally:
        xl.Quit()


def excel_convert(src: str, dst_xlsx: str):
    """Open .xls in Excel (recalculates XLOOKUP etc.) and save as .xlsx."""
    xl = _excel()
    try:
        wb = xl.Workbooks.Open(os.path.abspath(src), ReadOnly=True, UpdateLinks=0)
        try:
            xl.CalculateFull()
            wb.SaveAs(os.path.abspath(dst_xlsx), FileFormat=51)
        finally:
            wb.Close(False)
    finally:
        xl.Quit()


def status() -> dict:
    return {"soffice": soffice_path(), "excel": excel_available(), "platform": sys.platform}
