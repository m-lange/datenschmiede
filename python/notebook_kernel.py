# Datenschmiede — persistenter Python-Kernel fuer das Generator-Notebook.
#
# Ein Prozess je geoeffnetem .tdgen-Notebook (siehe generator/notebook.ts):
# fuehrt Zellen in EINEM gemeinsamen Namespace aus — Variablen, Funktionen
# und Importe bleiben zwischen Ausfuehrungen erhalten (volles Python, wie
# in einem Jupyter-Kernel). Protokoll: JSON-Zeilen auf stdin/stdout.
#
#   -> {"type": "init", "lookups": [...]}
#   -> {"type": "exec", "id": 1, "role": "generate", "code": "..."}
#   <- {"id": 1, "ok": true, "outputs": ["..."], ...}
#   <- {"id": 1, "ok": false, "error": "...", "ename": "...", "traceback": "..."}
#
# Nach dem Ausfuehren einer Methoden-Zelle wird die Methode automatisch mit
# den aktuellen Testwerten aufgerufen (params/n aus dem Namespace, z. B.
# von der Scratch-Zelle gesetzt) und das Ergebnis angezeigt — wie die
# Ausgabe einer Notebook-Zelle. Freie Zellen zeigen den Wert ihres letzten
# Ausdrucks (wie Jupyter).

import ast
import contextlib
import io
import json
import sys
import traceback

LOOKUPS = {}

try:
    import numpy as np
except ImportError:
    np = None
try:
    import pandas as pd
except ImportError:
    pd = None


class Ctx:
    """Gegenstueck zum ctx des Generator-Laufs, soweit ohne Tabellen-Daten moeglich."""

    def __init__(self):
        if np is not None:
            self.rng = np.random.default_rng()
        self.np = np
        self.pd = pd
        self._faker = {}
        self.log_lines = []

    def faker(self, locale="en_US"):
        if locale not in self._faker:
            from faker import Faker

            self._faker[locale] = Faker(locale)
        return self._faker[locale]

    def log(self, *args):
        self.log_lines.append("log: " + " ".join(str(a) for a in args))

    def lookup(self, name, column):
        lookup = LOOKUPS.get(name)
        if lookup is None:
            raise RuntimeError(f'Lookup list "{name}" was not found')
        if column not in lookup["columns"]:
            raise RuntimeError(f'Lookup list "{name}" has no column "{column}"')
        index = lookup["columns"].index(column)
        return [row["values"][index] if index < len(row["values"]) else "" for row in lookup["rows"]]

    def lookup_value(self, name, column):
        """
        Im Zellen-Testlauf: gewichtete Ziehung EINES Werts je Datensatz
        (n aus dem Namespace). Die Zeilen-Konsistenz mit anderen Spalten/
        Tabellen entsteht erst im echten Lauf bzw. der Tabellen-Vorschau.
        """
        if np is None or pd is None:
            raise RuntimeError("Missing Python packages: numpy, pandas")
        lookup = LOOKUPS.get(name)
        if lookup is None:
            raise RuntimeError(f'Lookup list "{name}" was not found')
        values = self.lookup(name, column)
        if not values:
            return pd.Series([], dtype=object)
        weights = []
        for row in lookup["rows"]:
            raw = str(row.get("weight", "")).strip().replace(",", ".")
            try:
                weights.append(max(0.0, float(raw)))
            except ValueError:
                weights.append(0.0)
        total = sum(weights)
        p = [w / total for w in weights] if total > 0 else None
        n = int(NAMESPACE.get("n") or 10)
        indices = self.rng.choice(len(values), size=n, p=p)
        return pd.Series(np.array(values, dtype=object)[indices])

    def column(self, name):
        raise RuntimeError(
            f'ctx.column("{name}") needs generated table data — use the table editor preview to test this'
        )

    def related(self, fk_path, column):
        raise RuntimeError("ctx.related(...) needs generated table data — use the table editor preview to test this")

    def table(self, label, column):
        raise RuntimeError("ctx.table(...) needs generated table data — use the table editor preview to test this")


CTX = Ctx()
# Gemeinsamer Namespace aller Zellen — vorbelegt mit den ueblichen Helfern.
NAMESPACE = {"np": np, "pd": pd, "ctx": CTX, "params": {}, "n": 10}


def dumps(value):
    return json.dumps(value, ensure_ascii=False, indent=2, default=str)


def auto_call(role, outputs):
    """Ruft die gerade definierte Methode mit den aktuellen Testwerten auf."""
    params = dict(NAMESPACE.get("params") or {})
    n = int(NAMESPACE.get("n") or 10)

    if role == "parameters":
        fn = NAMESPACE.get("parameters")
        if callable(fn):
            outputs.append(dumps(fn()))
        return

    if role == "parse_params":
        fn = NAMESPACE.get("parse_params")
        if callable(fn):
            outputs.append(dumps(fn(params)))
        return

    if role == "display_value":
        fn = NAMESPACE.get("display_value")
        if callable(fn):
            outputs.append(str(fn(params)))
        return

    if role == "validate":
        fn = NAMESPACE.get("validate")
        if callable(fn):
            warnings = [str(m) for m in (fn(params) or []) if str(m).strip()]
            outputs.append(dumps(warnings))
        return

    if role == "generate":
        fn = NAMESPACE.get("generate")
        if not callable(fn):
            return
        if pd is None or np is None:
            missing = [name for name, mod in (("numpy", np), ("pandas", pd)) if mod is None]
            raise RuntimeError("Missing Python packages: " + ", ".join(missing))
        parse_fn = NAMESPACE.get("parse_params")
        parsed = parse_fn(params) if callable(parse_fn) else params
        series = pd.Series(fn(parsed, n, CTX))
        outputs.extend(f"[{index}] {value}" for index, value in enumerate(series.head(50)))
        if len(series) > 50:
            outputs.append(f"… ({len(series)} values)")


def run_cell(role, code):
    outputs = []
    CTX.log_lines = []
    stdout = io.StringIO()
    with contextlib.redirect_stdout(stdout):
        tree = ast.parse(code or "pass", mode="exec")
        # Wie Jupyter: ist die letzte Anweisung ein Ausdruck, wird sein Wert
        # angezeigt (nur bei freien Zellen relevant — Methoden-Zellen enden
        # mit einer Funktionsdefinition).
        last_expr = None
        if tree.body and isinstance(tree.body[-1], ast.Expr):
            last_expr = ast.Expression(tree.body.pop().value)
        exec(compile(tree, "<cell>", "exec"), NAMESPACE)
        value = eval(compile(last_expr, "<cell>", "eval"), NAMESPACE) if last_expr is not None else None
        auto_call(role, outputs)
    printed = stdout.getvalue()
    result = []
    if printed.strip():
        result.extend(printed.rstrip("\n").split("\n"))
    result.extend(CTX.log_lines)
    if value is not None:
        result.append(repr(value))
    result.extend(outputs)
    return result


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            continue
        if message.get("type") == "init":
            LOOKUPS.clear()
            LOOKUPS.update({l["name"]: l for l in message.get("lookups", [])})
            continue
        if message.get("type") != "exec":
            continue
        reply = {"id": message.get("id")}
        try:
            reply["ok"] = True
            reply["outputs"] = run_cell(message.get("role") or "extra", message.get("code") or "")
        except Exception as err:  # noqa: BLE001 — jede Ausnahme als Zell-Fehler melden
            reply = {
                "id": message.get("id"),
                "ok": False,
                "ename": type(err).__name__,
                "error": str(err),
                "traceback": traceback.format_exc(),
            }
        print(json.dumps(reply, ensure_ascii=False, default=str), flush=True)


if __name__ == "__main__":
    main()
