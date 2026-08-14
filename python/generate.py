# Datenschmiede Testdaten-Generator — Python-Laufzeit.
#
# Wird vom Extension-Host mit dem Pfad einer Plan-JSON-Datei aufgerufen
# (siehe src/project/run.ts, dort wird der Plan aus .tdproject/.td/.lkp/
# .tdgen-Dateien gebaut). Erzeugt fuer jede Tabelle des Plans synthetische
# Datensaetze — hochgradig vektorisiert ueber numpy/pandas, damit auch grosse
# Datenmengen schnell entstehen — und schreibt sie als CSV gemaess der
# Ausgabe-Konfiguration der Tabelle.
#
# Ablauf:
#   1. Tabellen topologisch sortieren (Fremdschluessel- und
#      Generator-Referenzen), danach je Tabelle die Spalten — Spalte fuer
#      Spalte, soweit die Abhaengigkeiten (z. B. Kombinations-Vorlagen) es
#      erlauben.
#   2. Zeilenanzahl bestimmen: primaere Tabellen aus der festen Anzahl,
#      referenzierte Tabellen ueber die Kardinalitaet je Datensatz der
#      referenzierten Tabelle (die treibende FK-Spalte entsteht dabei gleich
#      mit, via numpy.repeat).
#   3. Jede Spalte mit ihrem Generator fuellen (eingebaute direkt hier,
#      benutzerdefinierte aus dem im Plan mitgelieferten Python-Code).
#   4. CSV schreiben (Trenner, Quoting, Dezimal-/Datumsformate, Encoding
#      gemaess Konfiguration), Dateiname aus der {…}-Vorlage aufloesen.
#
# Fortschritt und Ergebnis werden als JSON-Zeilen auf stdout gemeldet
# (events: start / table_start / table_done / done / error) — der
# Extension-Host uebersetzt sie in die VS-Code-Fortschrittsanzeige.

import json
import re
import sys
import traceback
from datetime import datetime, timedelta


def emit(event, **payload):
    print(json.dumps({"event": event, **payload}, ensure_ascii=False), flush=True)


def fail(message, **payload):
    emit("error", message=str(message), **payload)
    sys.exit(2)


# Abhaengigkeiten frueh und gesammelt pruefen, damit die Meldung im
# Extension-Host einen konkreten Installationshinweis zeigen kann.
_missing = []
try:
    import numpy as np
except ImportError:
    _missing.append("numpy")
try:
    import pandas as pd
except ImportError:
    _missing.append("pandas")
if _missing:
    emit("error", code="missing-packages", packages=_missing,
         message="Missing Python packages: " + ", ".join(_missing))
    sys.exit(3)

import csv as csv_module

RNG = np.random.default_rng()
RUN_DT = datetime.now()

_faker_instances = {}


def get_faker(locale):
    """Faker-Instanz je Locale (Import erst bei Bedarf, mit klarer Fehlermeldung)."""
    key = locale or "en_US"
    if key not in _faker_instances:
        try:
            from faker import Faker
        except ImportError:
            emit("error", code="missing-packages", packages=["faker"],
                 message="Missing Python package: faker")
            sys.exit(3)
        _faker_instances[key] = Faker(key)
    return _faker_instances[key]


class Context:
    """`ctx`-Objekt fuer benutzerdefinierte Generatoren (siehe .tdgen-Editor)."""

    def __init__(self, runner, table):
        self.rng = RNG
        self.np = np
        self.pd = pd
        self._runner = runner
        self._table = table

    def faker(self, locale="en_US"):
        return get_faker(locale)

    def log(self, *args):
        """
        Schreibt eine Meldung ins Lauf-Protokoll (Output-Channel
        "Datenschmiede" in VS Code). Bewusst statt print(): stdout ist fuer
        das JSON-Ereignis-Protokoll reserviert — rohe print()-Zeilen werden
        dort verworfen (print(..., file=sys.stderr) landet ebenfalls im
        Output-Channel).
        """
        emit("log", table=self._table["label"], message=" ".join(str(a) for a in args))

    def column(self, name):
        """Bereits generierte Werte einer anderen Spalte dieser Tabelle."""
        data = self._runner.data.get(self._table["label"], {})
        if name not in data:
            raise RuntimeError(
                f'ctx.column("{name}"): column is not generated yet (or does not exist) '
                f'in table {self._table["label"]}'
            )
        return data[name]

    def table(self, label, column):
        """Bereits generierte Werte einer Spalte einer anderen Tabelle des Plans."""
        data = self._runner.data.get(label)
        if data is None or column not in data:
            raise RuntimeError(f'ctx.table("{label}", "{column}"): values are not available (yet)')
        return data[column]

    def related(self, fk_path, column):
        """
        Zeilen-genau zugeordnete Werte einer referenzierten (fuehrenden)
        Tabelle: fuer jeden Datensatz dieser Tabelle der Wert von `column`
        aus GENAU dem Datensatz, auf den die FK-Spalte zeigt — ein Join
        ueber fk_table/fk_column statt einer Zufallsstichprobe (ctx.table).

        `fk_path` darf auch ein Punkt-getrennter Pfad ueber MEHRERE
        FK-Spalten sein — jeder weitere Teil ist eine FK-Spalte der zuvor
        erreichten Tabelle. Beispiele (in `shipments`):

            ctx.related("order_id", "status")                # Bestellung
            ctx.related("order_id.customer_id", "country")   # -> Kunde
        """
        parts = [p.strip() for p in str(fk_path).split(".") if p.strip()]
        if not parts:
            raise RuntimeError('ctx.related: empty foreign key path')

        table_def = self._table
        keys = None
        parent_key = None
        for part in parts:
            col_def = next((c for c in table_def["columns"] if c["name"] == part), None)
            if col_def is None or not col_def.get("fk") or not col_def.get("fk_table"):
                raise RuntimeError(
                    f'ctx.related("{fk_path}", ...): "{part}" is not a foreign key column of {table_def["label"]}'
                )
            data = self._runner.data.get(table_def["label"], {})
            if part not in data:
                raise RuntimeError(f'ctx.related("{fk_path}", ...): column {table_def["label"]}.{part} is not generated yet')
            if keys is None:
                # Erster Sprung: die eigenen FK-Werte identifizieren die Datensaetze der naechsten Tabelle.
                keys = pd.Series(data[part])
            else:
                # Weiterer Sprung: die bisherigen Schluessel in die FK-Werte
                # der gerade erreichten Tabelle uebersetzen.
                mapping = pd.Series(data[part].values, index=data[parent_key].values)
                mapping = mapping[~mapping.index.duplicated(keep="first")]
                keys = keys.map(mapping)
            parent_label, parent_key = col_def["fk_table"], col_def["fk_column"]
            next_table = self._runner.tables.get(parent_label)
            if next_table is None:
                raise RuntimeError(f'ctx.related("{fk_path}", ...): table {parent_label} is not part of this run')
            table_def = next_table

        final = self._runner.data.get(table_def["label"])
        if final is None or parent_key not in final or column not in final:
            raise RuntimeError(
                f'ctx.related("{fk_path}", "{column}"): values of {table_def["label"]}.{column} are not available (yet)'
            )
        mapping = pd.Series(final[column].values, index=final[parent_key].values)
        mapping = mapping[~mapping.index.duplicated(keep="first")]
        return pd.Series(keys).map(mapping)

    def lookup(self, name, column):
        """Alle (rohen) Werte einer Spalte einer Nachschlageliste (.lkp) — ohne Ziehung/Gewichtung."""
        values, _weights = self._runner.lookup_column(name, column)
        # Kopie, damit Custom-Code die Liste gefahrlos veraendern kann — die
        # Original-Liste liegt im Cache des Runners (siehe lookup_column).
        return list(values)

    def lookup_value(self, name, column):
        """
        EIN Wert je Datensatz aus der konsistent gezogenen Listen-Zeile —
        exakt derselbe Mechanismus wie der eingebaute Lookup-Generator
        (siehe Runner.lookup_indices): alle Spalten derselben Liste (auch
        Lookup-Generator-Spalten und ueber FK verbundene Tabellen) lesen
        dieselbe Zeile. Beispiel: zieht der Kunde code "CH", liefert
        ctx.lookup_value("countries", "currency") in seiner Bestellung
        "CHF" aus derselben Zeile.
        """
        n = self._runner.row_counts.get(self._table["label"])
        if n is None:
            raise RuntimeError('ctx.lookup_value(...): row count of this table is not known yet')
        values, _weights = self._runner.lookup_column(name, column)
        if not values:
            return pd.Series([""] * n, dtype=object)
        indices = self._runner.lookup_indices(self._table, name, n)
        arr = np.array(values, dtype=object)
        return pd.Series(arr[np.clip(indices, 0, len(arr) - 1)])


def indent_body(body):
    return "\n".join("    " + line for line in (body or "pass").split("\n"))


def build_custom_functions(defn):
    """Baut generate/parse_params aus dem im Plan mitgelieferten Code einer .tdgen-Datei."""
    namespace = {"np": np, "pd": pd}
    source = (
        f'def generate(params, n, ctx):\n{indent_body(defn.get("generate"))}\n\n'
        f'def parse_params(params):\n{indent_body(defn.get("parse_params") or "return params")}\n'
    )
    try:
        exec(compile(source, f'<tdgen:{defn["name"]}>', "exec"), namespace)
    except SyntaxError as err:
        raise RuntimeError(f'Custom generator "{defn["name"]}": syntax error in code ({err})') from err
    return namespace["generate"], namespace["parse_params"]


def sanitize_filename(name):
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip().strip(".")
    return name or "output"


def sanitize_path_segment(part):
    """Wie sanitize_filename, aber fuer einzelne Ordner-Segmente (laesst `.`/`..` durch)."""
    if part in (".", ".."):
        return part
    return re.sub(r'[<>:"|?*\x00-\x1f]', "_", part).strip() or "_"


class Runner:
    def __init__(self, plan):
        self.plan = plan
        self.tables = {t["label"]: t for t in plan["tables"]}
        self.lookups = {l["name"]: l for l in plan.get("lookups", [])}
        self.custom = {}
        for defn in plan.get("custom_generators", []):
            self.custom[defn["name"]] = defn
        # label -> {spaltenname -> pd.Series} der bereits generierten Werte
        self.data = {}
        # label -> Zeilenanzahl
        self.row_counts = {}
        # (tabellen_label, listen_name) -> gezogene Zeilen-Indizes der
        # Nachschlageliste je Datensatz: alle Spalten, die aus derselben
        # Liste ziehen, lesen so dieselbe Zeile — auch ueber FK-verbundene
        # Tabellen hinweg (siehe lookup_indices).
        self.lookup_row_indices = {}
        # listen_name -> {"values": {spalte: [...]}, "weights": [...]} —
        # einmal extrahierte Spaltenwerte/geparste Gewichte je Liste, statt
        # sie fuer jede Spalte, die aus der Liste zieht, neu aufzubauen.
        self._lookup_cache = {}

    # ------------------------------------------------------------------
    # Reihenfolge
    # ------------------------------------------------------------------

    def table_dependencies(self, table):
        """Labels der Tabellen (im Plan), von denen diese Tabelle abhaengt."""
        deps = set()
        for column in table["columns"]:
            if column.get("fk") and column.get("fk_table") in self.tables and column["fk_table"] != table["label"]:
                deps.add(column["fk_table"])
            generator = column.get("generator")
            if generator:
                for ref in generator.get("table_refs", []):
                    if ref in self.tables and ref != table["label"]:
                        deps.add(ref)
        return deps

    def sorted_tables(self):
        """Topologische Sortierung der Tabellen; bricht bei Zyklen mit einer klaren Meldung ab."""
        remaining = dict(self.tables)
        ordered = []
        while remaining:
            ready = [t for t in remaining.values() if not (self.table_dependencies(t) & set(remaining))]
            if not ready:
                fail("Circular dependency between tables: " + ", ".join(sorted(remaining)))
            for table in sorted(ready, key=lambda t: t["label"]):
                ordered.append(table)
                del remaining[table["label"]]
        return ordered

    def sorted_columns(self, table):
        """
        Spalten-Reihenfolge innerhalb einer Tabelle: die treibende FK-Spalte
        entsteht bereits beim Zeilen-Aufbau; danach Spalte fuer Spalte,
        Kombinations-Spalten erst nach ihren referenzierten Spalten,
        benutzerdefinierte Generatoren zuletzt (ihr Code kann per
        ctx.column(...) auf alles Bisherige zugreifen).
        """
        columns = [c for c in table["columns"] if c["name"] != table.get("driving_fk_column")]

        def own_deps(column):
            generator = column.get("generator")
            if not generator:
                return set()
            deps = set(generator.get("own_column_refs", []))
            return deps

        remaining = {c["name"]: c for c in columns}
        # Definierte Spaltenreihenfolge einmal als Index-Map (list.index je
        # Sortierschluessel waere quadratisch).
        order_index = {c["name"]: i for i, c in enumerate(table["columns"])}
        ordered = []
        # Erst alle ohne eigene Abhaengigkeiten und ohne Custom-Code, dann der Rest.
        while remaining:
            ready = [
                c for c in remaining.values()
                if not (own_deps(c) & set(remaining))
            ]
            if not ready:
                fail(
                    f'Table {table["label"]}: circular column dependency between '
                    + ", ".join(sorted(remaining))
                )
            ready.sort(key=lambda c: (1 if (c.get("generator") or {}).get("id", "").startswith("custom:") else 0,
                                      order_index.get(c["name"], 0)))
            column = ready[0]
            ordered.append(column)
            del remaining[column["name"]]
        return ordered

    # ------------------------------------------------------------------
    # Nachschlagelisten
    # ------------------------------------------------------------------

    def lookup_column(self, name, column):
        lookup = self.lookups.get(name)
        if lookup is None:
            raise RuntimeError(f'Lookup list "{name}" was not found')
        if column not in lookup["columns"]:
            raise RuntimeError(f'Lookup list "{name}" has no column "{column}"')
        # Spaltenwerte und Gewichte je Liste nur einmal aufbauen — jede
        # weitere Spalte, die aus derselben Liste zieht, liest den Cache.
        cache = self._lookup_cache.setdefault(name, {"values": {}, "weights": None})
        if column not in cache["values"]:
            index = lookup["columns"].index(column)
            cache["values"][column] = [
                row["values"][index] if index < len(row["values"]) else "" for row in lookup["rows"]
            ]
        if cache["weights"] is None:
            weights = []
            for row in lookup["rows"]:
                raw = str(row.get("weight", "")).strip().replace(",", ".")
                try:
                    weights.append(max(0.0, float(raw)))
                except ValueError:
                    weights.append(0.0)
            cache["weights"] = weights
        return cache["values"][column], cache["weights"]

    def lookup_indices(self, table, name, n):
        """
        Gezogene Zeilen-Indizes einer Nachschlageliste fuer eine Tabelle —
        je Datensatz EINE Zeile, die alle Spalten derselben Liste gemeinsam
        lesen (z. B. code "DE" und currency "EUR" aus derselben Zeile):

        1. Hat diese Tabelle bereits Indizes fuer die Liste (eine andere
           Spalte zog zuerst), werden sie wiederverwendet.
        2. Sonst: Hat eine per FK referenzierte Tabelle Indizes fuer die
           Liste, werden sie zeilengenau uebernommen (Join ueber die
           FK-Spalte) — zusammengehoerige Datensaetze lesen so ueber
           Tabellengrenzen hinweg dieselbe Listen-Zeile.
        3. Sonst wird frisch gewichtet gezogen.
        """
        key = (table["label"], name)
        if key in self.lookup_row_indices:
            return self.lookup_row_indices[key]

        for column in table["columns"]:
            if not column.get("fk") or not column.get("fk_table"):
                continue
            parent_indices = self.lookup_row_indices.get((column["fk_table"], name))
            own_fk = self.data.get(table["label"], {}).get(column["name"])
            parent = self.data.get(column["fk_table"])
            if parent_indices is None or own_fk is None or parent is None:
                continue
            mapping = pd.Series(np.asarray(parent_indices), index=parent[column["fk_column"]].values)
            mapping = mapping[~mapping.index.duplicated(keep="first")]
            mapped = pd.Series(own_fk).map(mapping)
            if mapped.isna().any():
                # FK-Werte ohne Treffer (sollte nicht vorkommen) -> nicht raten,
                # sondern unten frisch ziehen.
                break
            indices = mapped.to_numpy(dtype=np.int64)
            self.lookup_row_indices[key] = indices
            return indices

        lookup = self.lookups.get(name)
        if lookup is None:
            raise RuntimeError(f'Lookup list "{name}" was not found')
        count = len(lookup["rows"])
        if count == 0:
            indices = np.zeros(0, dtype=np.int64) if n == 0 else np.full(n, -1, dtype=np.int64)
            self.lookup_row_indices[key] = indices
            return indices
        _values, weights = self.lookup_column(name, lookup["columns"][0]) if lookup["columns"] else ([], [])
        total = sum(weights)
        p = [w / total for w in weights] if total > 0 else None
        indices = RNG.choice(count, size=n, p=p)
        self.lookup_row_indices[key] = indices
        return indices

    # ------------------------------------------------------------------
    # Generatoren
    # ------------------------------------------------------------------

    def generate_column(self, table, column, n):
        generator = column.get("generator")
        gen_id = (generator or {}).get("id", "")
        params = (generator or {}).get("params", {})

        if gen_id == "default":
            # Explizit gewaehlter Standard je Datentyp — identisch zu einer
            # Spalte ganz ohne Generator.
            return self.default_by_type(table, column, n)

        if gen_id == "foreign-key" or (column.get("fk") and not gen_id):
            ref_table, ref_column = column.get("fk_table"), column.get("fk_column")
            ref_values = self.data.get(ref_table, {}).get(ref_column)
            if ref_values is None:
                raise RuntimeError(
                    f'Column {table["label"]}.{column["name"]}: referenced values '
                    f'{ref_table}.{ref_column} are not available'
                )
            return pd.Series(RNG.choice(ref_values.to_numpy(), size=n))

        if gen_id == "random-int":
            low = int(params.get("min", "0"))
            high = int(params.get("max", "100"))
            return pd.Series(RNG.integers(low, high + 1, size=n))

        if gen_id == "random-float":
            low = float(str(params.get("min", "0")).replace(",", "."))
            high = float(str(params.get("max", "1")).replace(",", "."))
            decimals = int(params.get("decimals", "2") or "2")
            return pd.Series(np.round(RNG.uniform(low, high, size=n), decimals))

        if gen_id == "faker":
            provider = params.get("provider", "word")
            faker = get_faker(params.get("locale", "en_US"))
            method = getattr(faker, provider, None)
            if method is None:
                raise RuntimeError(
                    f'Column {table["label"]}.{column["name"]}: unknown Faker provider "{provider}"'
                )
            return pd.Series([method() for _ in range(n)], dtype=object)

        if gen_id == "lookup":
            # Je Datensatz wird EINE Listen-Zeile gezogen (siehe
            # lookup_indices) — alle Spalten derselben Liste, auch in
            # FK-verbundenen Tabellen, lesen dieselbe Zeile.
            list_name = params.get("list", "")
            values, _weights = self.lookup_column(list_name, params.get("column", ""))
            if not values:
                return pd.Series([""] * n, dtype=object)
            indices = self.lookup_indices(table, list_name, n)
            arr = np.array(values, dtype=object)
            return pd.Series(arr[np.clip(indices, 0, len(arr) - 1)])

        if gen_id == "combine":
            template = params.get("template", "")
            table_data = self.data[table["label"]]
            parts = re.split(r"(\{[^{}]+\})", template)
            pieces = []
            for part in parts:
                if not part:
                    continue
                if part.startswith("{") and part.endswith("}"):
                    ref = part[1:-1].strip()
                    if ref not in table_data:
                        raise RuntimeError(
                            f'Column {table["label"]}.{column["name"]}: combine template references '
                            f'"{ref}", which is not generated yet'
                        )
                    pieces.append(table_data[ref].astype(str).reset_index(drop=True))
                else:
                    pieces.append(pd.Series([part] * n, dtype=object))
            if not pieces:
                return pd.Series([""] * n, dtype=object)
            if len(pieces) == 1:
                return pieces[0]
            # Alle Teile in EINEM Durchlauf verketten, statt paarweise immer
            # neue Zwischen-Serien zu erzeugen.
            return pieces[0].str.cat(pieces[1:])

        if gen_id.startswith("custom:"):
            name = gen_id[len("custom:"):]
            defn = self.custom.get(name)
            if defn is None:
                raise RuntimeError(
                    f'Column {table["label"]}.{column["name"]}: custom generator "{name}" was not found'
                )
            if "functions" not in defn:
                defn["functions"] = build_custom_functions(defn)
            generate, parse_params = defn["functions"]
            ctx = Context(self, table)
            parsed = parse_params(dict(params))
            series = generate(parsed, n, ctx)
            series = pd.Series(series).reset_index(drop=True)
            if len(series) != n:
                raise RuntimeError(
                    f'Custom generator "{name}" returned {len(series)} values, expected {n}'
                )
            return series

        # Kein (bekannter) Generator konfiguriert -> sinnvoller Standard je Datentyp.
        return self.default_by_type(table, column, n)

    def default_by_type(self, table, column, n):
        ctype = column.get("type", "string")
        name = column.get("name", "value")
        if ctype == "integer":
            # Laufende Nummer — als PK direkt eindeutig.
            return pd.Series(np.arange(1, n + 1, dtype=np.int64))
        if ctype in ("float", "decimal"):
            return pd.Series(np.round(RNG.uniform(0, 1000, size=n), 2))
        if ctype == "boolean":
            return pd.Series(RNG.integers(0, 2, size=n).astype(bool))
        if ctype == "uuid":
            # Vektorisiertes UUID4 aus Zufalls-Bytes (deutlich schneller als
            # uuid.uuid4 je Zeile). Der komplette Puffer wird in EINEM
            # C-Aufruf zu Hex (statt einer Python-Callback je Zeile, wie es
            # apply_along_axis taete) und dann in 32-Zeichen-Stuecke zerlegt.
            b = RNG.integers(0, 256, size=(n, 16), dtype=np.uint8)
            b[:, 6] = (b[:, 6] & 0x0F) | 0x40
            b[:, 8] = (b[:, 8] & 0x3F) | 0x80
            full = b.tobytes().hex()
            return pd.Series(
                [
                    f"{full[i:i + 8]}-{full[i + 8:i + 12]}-{full[i + 12:i + 16]}-{full[i + 16:i + 20]}-{full[i + 20:i + 32]}"
                    for i in range(0, 32 * n, 32)
                ],
                dtype=object,
            )
        if ctype == "date":
            start = RUN_DT - timedelta(days=365)
            offsets = RNG.integers(0, 365, size=n)
            base = pd.Timestamp(start.date())
            return pd.Series(base + pd.to_timedelta(offsets, unit="D")).dt.normalize()
        if ctype == "datetime":
            seconds = RNG.integers(0, 365 * 24 * 3600, size=n)
            base = pd.Timestamp(RUN_DT) - pd.Timedelta(days=365)
            return pd.Series(base + pd.to_timedelta(seconds, unit="s"))
        if ctype == "time":
            seconds = RNG.integers(0, 24 * 3600, size=n)
            return pd.Series(pd.to_timedelta(seconds, unit="s"))
        if ctype == "email":
            nums = np.arange(1, n + 1)
            return pd.Series([f"user{i}@example.com" for i in nums], dtype=object)
        if ctype == "json":
            return pd.Series(["{}"] * n, dtype=object)
        # string / text / Unbekanntes
        return pd.Series([f"{name}_{i}" for i in range(1, n + 1)], dtype=object)

    # ------------------------------------------------------------------
    # Tabellen-Lauf
    # ------------------------------------------------------------------

    def run_table(self, table):
        label = table["label"]
        self.data[label] = {}

        driving = table.get("driving_fk")
        if driving:
            parent_label, parent_column = driving["table"], driving["column"]
            parent_values = self.data.get(parent_label, {}).get(parent_column)
            if parent_values is None:
                raise RuntimeError(
                    f'Table {label}: referenced values {parent_label}.{parent_column} are not available'
                )
            lo, hi = int(table["records"]["min"]), int(table["records"]["max"])
            counts = RNG.integers(lo, hi + 1, size=len(parent_values))
            n = int(counts.sum())
            # Die treibende FK-Spalte entsteht direkt beim Zeilen-Aufbau:
            # jeder Datensatz der referenzierten Tabelle bekommt `counts`
            # zugehoerige Datensaetze.
            self.data[label][table["driving_fk_column"]] = pd.Series(
                np.repeat(parent_values.to_numpy(), counts)
            )
        else:
            n = int(table["records"])

        self.row_counts[label] = n

        for column in self.sorted_columns(table):
            self.data[label][column["name"]] = self.generate_column(table, column, n).reset_index(drop=True)
            # Spalte-fuer-Spalte-Fortschritt fuers Lauf-Protokoll (Output-Channel).
            emit("column_done", table=label, column=column["name"], records=n)

        return n

    # ------------------------------------------------------------------
    # Ausgabe
    # ------------------------------------------------------------------

    def resolve_output_dir(self):
        """
        Loest den Ausgabeordner des Plans auf: die `{…}`-Variablen der
        Vorlage (Datum/Zeit/Zeitstempel/Projektname) werden ersetzt, jedes
        Pfad-Segment bereinigt; relative Pfade beziehen sich auf den Ordner
        der Projektdatei. Leer -> `output`.
        """
        import os

        template = (self.plan.get("output_path") or "").strip() or "output"

        def replace(match):
            token = match.group(1).strip()
            if token == "date":
                return RUN_DT.strftime("%Y%m%d")
            if token == "time":
                return RUN_DT.strftime("%H%M%S")
            if token == "datetime":
                return RUN_DT.strftime("%Y%m%d_%H%M%S")
            if token == "timestamp":
                return str(int(RUN_DT.timestamp()))
            if token == "project":
                return self.plan.get("project_name", "")
            return ""

        resolved = re.sub(r"\{([^{}]+)\}", replace, template)
        # Trenner (und ein fuehrendes Laufwerk wie `C:`) erhalten, jedes
        # Segment einzeln bereinigen.
        parts = re.split(r"([\\/]+)", resolved)
        cleaned = "".join(
            part if re.fullmatch(r"[\\/]+", part) or re.fullmatch(r"[A-Za-z]:", part) else sanitize_path_segment(part)
            for part in parts
            if part
        )
        return os.path.normpath(os.path.join(self.plan.get("project_dir", "."), cleaned or "output"))

    def resolve_filename(self, table, n, df):
        template = (table["output"].get("file_name") or "").strip()
        if not template:
            schema = (table.get("schema") or "").strip()
            template = f"{schema}_{table['name']}" if schema else table["name"]

        def replace(match):
            token = match.group(1).strip()
            if token == "date":
                return RUN_DT.strftime("%Y%m%d")
            if token == "time":
                return RUN_DT.strftime("%H%M%S")
            if token == "datetime":
                return RUN_DT.strftime("%Y%m%d_%H%M%S")
            if token == "timestamp":
                return str(int(RUN_DT.timestamp()))
            if token == "schema":
                return (table.get("schema") or "").strip()
            if token == "table":
                return table["name"]
            if token == "records":
                return str(n)
            if token.startswith("column:"):
                cname = token[len("column:"):].strip()
                if cname in df.columns and len(df) > 0:
                    return str(df[cname].iloc[0])
                return ""
            return ""

        return sanitize_filename(re.sub(r"\{([^{}]+)\}", replace, template))

    def format_dataframe(self, table, df):
        """Datums-/Zeit-Spalten gemaess der konfigurierten Formate als Text (gemeinsam fuer CSV und Vorschau)."""
        csv_cfg = table["output"].get("csv", {})
        date_fmt = csv_cfg.get("date_format") or "%Y-%m-%d"
        datetime_fmt = csv_cfg.get("datetime_format") or "%Y-%m-%d %H:%M:%S"
        # Flache Kopie genuegt: unten werden nur ganze Spalten NEU zugewiesen
        # (das laesst das Original unberuehrt) — eine tiefe Kopie wuerde bei
        # grossen Laeufen den Speicherbedarf unnoetig verdoppeln.
        out = df.copy(deep=False)
        for column in table["columns"]:
            cname, ctype = column["name"], column.get("type")
            if cname not in out.columns:
                continue
            try:
                if ctype == "date":
                    out[cname] = pd.to_datetime(out[cname]).dt.strftime(date_fmt)
                elif ctype == "datetime":
                    out[cname] = pd.to_datetime(out[cname]).dt.strftime(datetime_fmt)
                elif ctype == "time":
                    series = out[cname]
                    if pd.api.types.is_timedelta64_dtype(series):
                        base = pd.Timestamp("1970-01-01") + series
                        out[cname] = base.dt.strftime("%H:%M:%S")
            except (ValueError, TypeError):
                # Werte, die sich nicht als Datum/Zeit lesen lassen (z. B. aus
                # einem Custom-Generator), unveraendert lassen.
                pass
        return out

    def write_csv(self, table, df, n):
        import os

        csv_cfg = table["output"].get("csv", {})
        os.makedirs(self.out_dir, exist_ok=True)

        out = self.format_dataframe(table, df)
        file_name = self.resolve_filename(table, n, out) + ".csv"
        path = os.path.join(self.out_dir, file_name)
        out.to_csv(
            path,
            index=False,
            sep=csv_cfg.get("delimiter") or ";",
            decimal=csv_cfg.get("decimal") or ".",
            header=csv_cfg.get("include_header", True),
            quoting=csv_module.QUOTE_ALL if csv_cfg.get("quote_all", True) else csv_module.QUOTE_MINIMAL,
            encoding=csv_cfg.get("encoding") or "utf-8",
        )
        return path

    def run(self):
        ordered = self.sorted_tables()
        preview = self.plan.get("preview")
        self.out_dir = self.resolve_output_dir()
        emit("start", tables=len(ordered))
        files = []
        for index, table in enumerate(ordered):
            emit("table_start", table=table["label"], index=index, total=len(ordered))
            n = self.run_table(table)
            # Spaltenreihenfolge der Tabellendefinition beibehalten.
            df = pd.DataFrame({c["name"]: self.data[table["label"]][c["name"]] for c in table["columns"]})
            if preview:
                # Vorschau-Modus: nichts schreiben; nur die Ziel-Tabelle wird
                # am Ende zurueckgemeldet.
                if table["label"] == preview.get("table"):
                    out = self.format_dataframe(table, df).head(int(preview.get("limit", 20)))
                    emit(
                        "preview",
                        table=table["label"],
                        columns=[c["name"] for c in table["columns"]],
                        rows=[["" if v is None else str(v) for v in row] for row in out.itertuples(index=False)],
                    )
                continue
            path = self.write_csv(table, df, n)
            files.append({"table": table["label"], "file": path, "records": n})
            emit("table_done", table=table["label"], file=path, records=n, index=index, total=len(ordered))
        if not preview:
            emit("done", files=files, output_dir=self.out_dir)


def main():
    if len(sys.argv) < 2:
        fail("Usage: generate.py <plan.json>")
    try:
        with open(sys.argv[1], encoding="utf-8") as handle:
            plan = json.load(handle)
    except (OSError, json.JSONDecodeError) as err:
        fail(f"Unable to read plan file: {err}")
    try:
        Runner(plan).run()
    except RuntimeError as err:
        # Auch fuer "erwartete" Fehler den Traceback mitgeben — bei Fehlern
        # aus Custom-Generator-Code zeigt er die betroffene Zeile
        # (<tdgen:name>-Frames), siehe Output-Channel im Extension-Host.
        fail(err, traceback=traceback.format_exc())
    except Exception as err:  # noqa: BLE001 — jede unerwartete Ausnahme sauber als Event melden
        fail(f"{type(err).__name__}: {err}", traceback=traceback.format_exc())


if __name__ == "__main__":
    main()
