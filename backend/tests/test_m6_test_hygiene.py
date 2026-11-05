# Guard test (M6, AC-M6-26): unordered list reads, live clock calls, unmarked clock tests.
"""Three rules that keep the test suite from becoming flaky.

(a) A `select(Model)` read as a list (`.all()`, `.first()`, `list(...)`, `[0]`, a loop) needs an
    `.order_by(...)`. Without it Postgres may return rows in any order, so a test passes today and
    fails another day.
(b) `date.today()`, `datetime.now()` and `datetime.today()` are not allowed in tests: they read the
    real clock. Use `clock_helpers` (PINNED_DAY, frozen_at) or the app's `utc_now` / `today_ist`.
(c) A test file that uses the clock helpers must carry `pytestmark = pytest.mark.time_sensitive`,
    so CI runs it again with the clock started just before and just after midnight IST.
"""

import ast
from pathlib import Path

TESTS_FOLDER = Path(__file__).parent

# Models whose rows are always read as a list in order. Any `select(<CapitalisedName>)` is checked,
# the names below only document the tables that caused flaky tests in the past.
LIST_READ_METHODS = {"all", "first", "fetchall"}
SINGLE_ROW_METHODS = {"one", "one_or_none", "scalar_one", "scalar_one_or_none", "scalar"}

# Justified exceptions: (file name, rule letter) -> reason.
ALLOWED: dict[tuple[str, str], str] = {
    ("test_m6_test_hygiene.py", "b"): "this file only names the forbidden calls in text",
    ("test_m6_test_hygiene.py", "c"): "this file only names the helpers in text",
}

CLOCK_HELPER_NAMES = {
    "frozen_at",
    "time_machine",
    "PINNED_DAY",
    "PINNED_MONDAY",
    "PINNED_SUNDAY",
    "utc_now",
    "today_ist",
    "ist_today",
}
LIVE_CLOCK_CALLS = {("date", "today"), ("datetime", "now"), ("datetime", "today")}


def _test_files() -> list[Path]:
    return sorted(TESTS_FOLDER.glob("test_*.py"))


def _parse(path: Path) -> ast.Module:
    return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


def _add_parents(tree: ast.AST) -> None:
    for parent in ast.walk(tree):
        for child in ast.iter_child_nodes(parent):
            child.parent = parent  # type: ignore[attr-defined]


def _parent(node: ast.AST) -> ast.AST | None:
    return getattr(node, "parent", None)


def _is_select_of_model(node: ast.AST) -> bool:
    """True for `select(AuditLog)` or `select(AuditLog, ...)`: a read of whole model rows."""
    return (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "select"
        and bool(node.args)
        and isinstance(node.args[0], ast.Name)
        and node.args[0].id[:1].isupper()
    )


def _climb_chain(node: ast.AST) -> tuple[ast.AST, list[str]]:
    """Follow `.method(...)` calls and `session.scalars(<this>)` wrappers upwards.

    Returns the last node of the chain and the method names seen on the way."""
    methods: list[str] = []
    current = node
    while True:
        parent = _parent(current)
        if isinstance(parent, ast.Attribute) and parent.value is current:
            methods.append(parent.attr)
            call = _parent(parent)
            if isinstance(call, ast.Call) and call.func is parent:
                current = call
                continue
            current = parent
            continue
        if isinstance(parent, ast.Call) and current in parent.args:
            # The statement is handed to a function: session.scalars(stmt), list(...), len(...).
            if isinstance(parent.func, ast.Name):
                methods.append(f"call:{parent.func.id}")
            current = parent
            continue
        return current, methods


# Reading the rows in a way that does not depend on their order is fine.
ORDER_BLIND_CALLS = {
    "call:len",
    "call:set",
    "call:frozenset",
    "call:sorted",
    "call:any",
    "call:all",
}
ORDER_BLIND_CALLS |= {"call:sum", "call:bool", "call:Counter"}


def _is_empty_list(node: ast.AST) -> bool:
    return isinstance(node, ast.List) and not node.elts


def _enclosing_function(node: ast.AST) -> ast.AST:
    current = node
    while _parent(current) is not None and not isinstance(
        current, ast.FunctionDef | ast.AsyncFunctionDef | ast.Module
    ):
        current = _parent(current)  # type: ignore[assignment]
    return current


def _order_blind_wrapper(node: ast.AST) -> bool:
    """True when `node` sits directly inside set(...), sorted(...), len(...) and the like."""
    parent = _parent(node)
    return (
        isinstance(parent, ast.Call)
        and isinstance(parent.func, ast.Name)
        and f"call:{parent.func.id}" in ORDER_BLIND_CALLS
    )


def _variable_is_read_in_order(variable: str, scope: ast.AST) -> bool:
    """True when the list held in `variable` is indexed, looped over or listed."""
    for node in ast.walk(scope):
        if (
            isinstance(node, ast.Subscript)
            and isinstance(node.value, ast.Name)
            and node.value.id == variable
            and isinstance(node.slice, ast.Constant | ast.UnaryOp)
        ):
            return True
        if (
            isinstance(node, ast.For)
            and isinstance(node.iter, ast.Name)
            and node.iter.id == variable
        ):
            return True
        if isinstance(node, ast.ListComp) and not _order_blind_wrapper(node):
            first = node.generators[0].iter
            if isinstance(first, ast.Name) and first.id == variable:
                return True
    return False


def _is_list_read(end: ast.AST, methods: list[str]) -> bool:
    if any(name in SINGLE_ROW_METHODS for name in methods):
        return False
    if any(name in ORDER_BLIND_CALLS for name in methods):
        return False
    parent = _parent(end)
    if isinstance(parent, ast.Compare) and any(_is_empty_list(c) for c in parent.comparators):
        return False
    if isinstance(parent, ast.Assign):
        target = parent.targets[0]
        if isinstance(target, ast.Tuple | ast.List):
            return False  # `(row,) = ...all()` unpacks exactly one row
        if isinstance(target, ast.Name) and (
            any(name in LIST_READ_METHODS for name in methods) or "call:list" in methods
        ):
            return _variable_is_read_in_order(target.id, _enclosing_function(end))
        return False
    read_as_list = any(name in LIST_READ_METHODS for name in methods) or "call:list" in methods
    return read_as_list or (isinstance(parent, ast.For) and parent.iter is end)


def _unordered_reads(tree: ast.Module) -> list[int]:
    _add_parents(tree)
    lines = []
    for node in ast.walk(tree):
        if not _is_select_of_model(node):
            continue
        end, methods = _climb_chain(node)
        if "order_by" in methods:
            continue
        if _is_list_read(end, methods):
            lines.append(node.lineno)
    return lines


def test_no_unordered_list_reads_of_model_rows() -> None:
    offenders = []
    for path in _test_files():
        if (path.name, "a") in ALLOWED:
            continue
        for line in _unordered_reads(_parse(path)):
            offenders.append(f"{path.name}:{line}")
    assert offenders == [], "select(Model) read as a list without .order_by(): " + ", ".join(
        offenders
    )


def test_no_live_clock_calls_in_tests() -> None:
    offenders = []
    for path in _test_files():
        if (path.name, "b") in ALLOWED:
            continue
        for node in ast.walk(_parse(path)):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and isinstance(node.func.value, ast.Name)
                and (node.func.value.id, node.func.attr) in LIVE_CLOCK_CALLS
            ):
                offenders.append(f"{path.name}:{node.lineno}")
    assert offenders == [], "live clock call in a test: " + ", ".join(offenders)


def _uses_clock_helpers(tree: ast.Module) -> bool:
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and node.id in CLOCK_HELPER_NAMES:
            return True
        if isinstance(node, ast.alias) and node.name in CLOCK_HELPER_NAMES:
            return True
    return False


def _has_time_sensitive_marker(tree: ast.Module) -> bool:
    for statement in tree.body:
        is_marker_line = isinstance(statement, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == "pytestmark"
            for target in statement.targets
        )
        if is_marker_line and "time_sensitive" in ast.unparse(statement):
            return True
    return False


def test_clock_using_files_are_marked_time_sensitive() -> None:
    offenders = []
    for path in _test_files():
        if (path.name, "c") in ALLOWED:
            continue
        tree = _parse(path)
        if _uses_clock_helpers(tree) and not _has_time_sensitive_marker(tree):
            offenders.append(path.name)
    assert offenders == [], "needs pytestmark = pytest.mark.time_sensitive: " + ", ".join(offenders)
