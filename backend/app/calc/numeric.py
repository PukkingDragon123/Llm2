"""Excel-compatible numeric helpers and a safe arithmetic-expression evaluator for inputs."""
from __future__ import annotations

import ast
import math
import operator
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR, ROUND_HALF_UP


def _excel_decimal(x: float) -> Decimal:
    # Excel works with 15 significant digits; normalise float noise before rounding.
    return Decimal(f"{x:.15g}")


def roundup(x: float, digits: float = 0) -> float:
    """Excel ROUNDUP: rounds away from zero. Non-integer digits are truncated toward zero (Excel)."""
    d = int(digits)
    q = Decimal(1).scaleb(-d)
    v = _excel_decimal(x)
    r = (v / q).to_integral_value(rounding=ROUND_CEILING if v >= 0 else ROUND_FLOOR) * q
    return float(r)


def round_excel(x: float, digits: int = 0) -> float:
    q = Decimal(1).scaleb(-int(digits))
    return float((_excel_decimal(x) / q).to_integral_value(rounding=ROUND_HALF_UP) * q)


_OPS = {
    ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
    ast.Div: operator.truediv, ast.Pow: operator.pow, ast.USub: operator.neg, ast.UAdd: operator.pos,
}
_FUNCS = {"pi": math.pi}


class ExprError(ValueError):
    pass


def eval_expr(value) -> float | None:
    """Evaluate a numeric input. Accepts numbers or arithmetic strings like '45000+42000' or '104000/105'.

    Returns None for blank input (missing), raises ExprError for invalid text."""
    if value is None:
        return None
    if isinstance(value, bool):
        raise ExprError("boolean is not a number")
    if isinstance(value, (int, float)):
        if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
            raise ExprError("not a finite number")
        return float(value)
    s = str(value).strip().replace(",", "")
    if s == "":
        return None
    if s.startswith("="):
        s = s[1:]
    try:
        tree = ast.parse(s, mode="eval")
    except SyntaxError as e:
        raise ExprError(f"invalid expression '{value}'") from e

    def ev(n):
        if isinstance(n, ast.Expression):
            return ev(n.body)
        if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)) and not isinstance(n.value, bool):
            return float(n.value)
        if isinstance(n, ast.BinOp) and type(n.op) in _OPS:
            return _OPS[type(n.op)](ev(n.left), ev(n.right))
        if isinstance(n, ast.UnaryOp) and type(n.op) in _OPS:
            return _OPS[type(n.op)](ev(n.operand))
        if isinstance(n, ast.Name) and n.id.lower() in _FUNCS:
            return _FUNCS[n.id.lower()]
        raise ExprError(f"unsupported expression '{value}'")

    try:
        out = ev(tree)
    except ZeroDivisionError as e:
        raise ExprError(f"division by zero in '{value}'") from e
    return float(out)


def fmt(x: float | None, nd: int = 4) -> str:
    if x is None:
        return "—"
    if abs(x - round(x)) < 1e-9:
        return f"{round(x):,}"
    return f"{x:,.{nd}f}".rstrip("0").rstrip(".")
