# Datenschmiede — Einzel-Zellen-Laeufer fuer den Generator-Editor (.tdgen).
#
# Fuehrt EINE Code-Zelle eines benutzerdefinierten Generators mit vom
# Benutzer eingegebenen Parameterwerten aus (Run-Knopf im Editor, siehe
# generator/editorProvider.ts) und liefert das Ergebnis als JSON auf stdout:
#   {"ok": true, "lines": ["..."]}
#   {"ok": false, "error": "...", "traceback": "..."}
#
# Eingabe (stdin, JSON):
#   {"cell": "generate"|"parse_params"|"display_value"|"validate",
#    "params": {...}, "n": 10,
#    "code": {"generate": "...", "parse_params": "...", ...},
#    "lookups": [{"name", "columns", "rows"}]}
#
# Der ctx entspricht dem des echten Laufs, soweit ohne Tabellen-Daten
# moeglich: rng/np/pd/faker/lookup/log funktionieren; column/related/table
# brauchen generierte Tabellen und melden einen verstaendlichen Hinweis.

import json
import sys
import traceback


def out(payload):
    print(json.dumps(payload, ensure_ascii=False, default=str))


def fail(message, tb=""):
    out({"ok": False, "error": str(message), "traceback": tb})
    sys.exit(0)


def indent_body(body):
    return "\n".join("    " + line for line in (body or "pass").split("\n"))


def build(cell, body, args):
    if not (body or "").strip():
        return None
    namespace = {}
    source = f"def _cell({args}):\n{indent_body(body)}\n"
    try:
        exec(compile(source, f"<{cell}>", "exec"), namespace)
    except SyntaxError as err:
        fail(f"Syntax error in {cell}: {err}", traceback.format_exc())
    return namespace["_cell"]


def main():
    payload = json.load(sys.stdin)
    cell = payload.get("cell")
    params = dict(payload.get("params") or {})
    n = int(payload.get("n") or 10)
    code = payload.get("code") or {}
    lookups = {l["name"]: l for l in payload.get("lookups", [])}

    if cell == "parse_params":
        fn = build("parse_params", code.get("parse_params"), "params")
        if fn is None:
            fail("parse_params has no code")
        value = fn(params)
        if isinstance(value, dict):
            out({"ok": True, "lines": [f"{key}: {value[key]!r}" for key in value]})
        else:
            out({"ok": True, "lines": [repr(value)]})
        return

    if cell == "display_value":
        fn = build("display_value", code.get("display_value"), "params")
        if fn is None:
            fail("display_value has no code")
        out({"ok": True, "lines": [str(fn(params))]})
        return

    if cell == "validate":
        fn = build("validate", code.get("validate"), "params")
        if fn is None:
            fail("validate has no code")
        raw = fn(params)
        out({"ok": True, "lines": [str(m) for m in (raw or []) if str(m).strip()]})
        return

    if cell != "generate":
        fail(f"unknown cell {cell!r}")

    # generate: braucht numpy/pandas (und je nach Code faker).
    missing = []
    try:
        import numpy as np
    except ImportError:
        missing.append("numpy")
    try:
        import pandas as pd
    except ImportError:
        missing.append("pandas")
    if missing:
        fail("Missing Python packages: " + ", ".join(missing))

    class Ctx:
        def __init__(self):
            self.rng = np.random.default_rng()
            self.np = np
            self.pd = pd
            self._faker = {}

        def faker(self, locale="en_US"):
            if locale not in self._faker:
                from faker import Faker

                self._faker[locale] = Faker(locale)
            return self._faker[locale]

        def log(self, *args):
            # Beim Zellen-Test landet ctx.log direkt in der Ergebnis-Ausgabe.
            log_lines.append("log: " + " ".join(str(a) for a in args))

        def lookup(self, name, column):
            lookup = lookups.get(name)
            if lookup is None:
                raise RuntimeError(f'Lookup list "{name}" was not found')
            if column not in lookup["columns"]:
                raise RuntimeError(f'Lookup list "{name}" has no column "{column}"')
            index = lookup["columns"].index(column)
            return [row["values"][index] if index < len(row["values"]) else "" for row in lookup["rows"]]

        def column(self, name):
            raise RuntimeError(
                f'ctx.column("{name}") needs generated table data and is not available in a cell test run — use the table editor preview instead'
            )

        def related(self, fk_path, column):
            raise RuntimeError(
                'ctx.related(...) needs generated table data and is not available in a cell test run — use the table editor preview instead'
            )

        def table(self, label, column):
            raise RuntimeError(
                'ctx.table(...) needs generated table data and is not available in a cell test run — use the table editor preview instead'
            )

    log_lines = []
    parse_fn = build("parse_params", code.get("parse_params"), "params")
    generate_fn = build("generate", code.get("generate"), "params, n, ctx")
    if generate_fn is None:
        fail("generate has no code")

    parsed = parse_fn(params) if parse_fn is not None else params
    result = generate_fn(parsed, n, Ctx())
    series = pd.Series(result)
    lines = list(log_lines)
    lines.extend(f"[{index}] {value}" for index, value in enumerate(series.head(50)))
    if len(series) > 50:
        lines.append(f"… ({len(series)} values)")
    out({"ok": True, "lines": lines})


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as err:  # noqa: BLE001 — jede Ausnahme als lesbares Ergebnis melden
        fail(f"{type(err).__name__}: {err}", traceback.format_exc())
