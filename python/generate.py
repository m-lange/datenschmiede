# Datenschmiede test data generator — Python runtime.
#
# Invoked by the extension host with the path of a plan JSON file (see
# src/project/run.ts, where the plan is built from the .tdproject/.td/.lkp/
# .tdgen files). Produces synthetic records for every table of the plan —
# heavily vectorized via numpy/pandas so that even large data volumes are
# generated quickly — and writes them as CSV according to the table's output
# configuration.
#
# Flow:
#   1. Sort the tables topologically (foreign key and generator references),
#      then the columns of each table — column by column, as far as the
#      dependencies (e.g. combine templates) allow.
#   2. Determine the row count: primary tables from their fixed count,
#      referenced tables from the cardinality per record of the referenced
#      table (the driving FK column is produced along the way, via
#      numpy.repeat).
#   3. Fill every column with its generator (built-in ones directly here,
#      custom ones from the Python code shipped in the plan).
#   4. Write the CSV (separator, quoting, decimal/date formats, encoding as
#      configured) and resolve the file name from its {…} template.
#
# Progress and result are reported as JSON lines on stdout (events: start /
# table_start / table_done / done / error) — the extension host translates them
# into the VS Code progress indicator.

import json
import re
import sys
import traceback
from datetime import datetime, timedelta

# The event protocol and the log output are UTF-8, independently of the
# platform: with a piped stdout Python otherwise falls back to the locale
# encoding (cp1252 on a German Windows), which turns every umlaut in a preview,
# a log line or a traceback into garbage on the extension host — which decodes
# UTF-8. Only the standard streams are affected here; the CSV keeps the
# encoding configured for the table (see write_csv).
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass


def emit(event, **payload):
    """Writes one event of the stdout protocol read by the extension host."""
    print(json.dumps({"event": event, **payload}, ensure_ascii=False), flush=True)


def fail(message, **payload):
    """Reports an error event and terminates the run."""
    emit("error", message=str(message), **payload)
    sys.exit(2)


# Check dependencies early and all at once, so the message in the extension
# host can offer a concrete installation hint.
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
    """Faker instance per locale (imported lazily, with a clear error message)."""
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
    """The `ctx` object handed to custom generators (see the .tdgen editor)."""

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
        Writes a message to the run log (the "Datenschmiede" output channel in
        VS Code). Deliberately provided instead of print(): stdout is reserved
        for the JSON event protocol — raw print() lines are discarded there
        (print(..., file=sys.stderr) also ends up in the output channel).
        """
        emit("log", table=self._table["label"], message=" ".join(str(a) for a in args))

    def column(self, name):
        """Already generated values of another column of this table."""
        data = self._runner.data.get(self._table["label"], {})
        if name not in data:
            raise RuntimeError(
                f'ctx.column("{name}"): column is not generated yet (or does not exist) '
                f'in table {self._table["label"]}'
            )
        return data[name]

    def table(self, label, column):
        """Already generated values of a column of another table in the plan."""
        data = self._runner.data.get(label)
        if data is None or column not in data:
            raise RuntimeError(f'ctx.table("{label}", "{column}"): values are not available (yet)')
        return data[column]

    def related(self, fk_path, column):
        """
        Row-accurate values of a referenced (parent) table: for every record of
        this table the value of `column` from EXACTLY the record its FK column
        points at — a join over fk_table/fk_column rather than a random sample
        (ctx.table).

        `fk_path` may also be a dot-separated path across SEVERAL FK columns —
        each further part is an FK column of the table reached before it.
        Examples (in `shipments`):

            ctx.related("order_id", "status")                # the order
            ctx.related("order_id.customer_id", "country")   # -> the customer
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
                # First hop: our own FK values identify the records of the next table.
                keys = pd.Series(data[part])
            else:
                # Further hop: translate the keys collected so far into the FK
                # values of the table just reached.
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
        """All (raw) values of a column of a lookup list (.lkp) — no drawing, no weighting."""
        values, _weights = self._runner.lookup_column(name, column)
        # A copy, so custom code can modify the list safely — the original list
        # lives in the runner's cache (see lookup_column).
        return list(values)

    def lookup_value(self, name, column):
        """
        ONE value per record from the consistently drawn list row — exactly the
        same mechanism as the built-in lookup generator (see
        Runner.lookup_indices): every column of the same list (including lookup
        generator columns and tables related via FK) reads the same row.
        Example: if the customer draws code "CH", then
        ctx.lookup_value("countries", "currency") on their order returns "CHF"
        from that same row.
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
    """Indents a method body so it can be compiled under a generated signature."""
    return "\n".join("    " + line for line in (body or "pass").split("\n"))


def build_custom_functions(defn):
    """Builds generate/parse_params from the .tdgen code shipped in the plan."""
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
    """Replaces characters that are invalid in file names; never returns an empty name."""
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip().strip(".")
    return name or "output"


def sanitize_path_segment(part):
    """Like sanitize_filename, but for individual folder segments (lets `.`/`..` through)."""
    if part in (".", ".."):
        return part
    return re.sub(r'[<>:"|?*\x00-\x1f]', "_", part).strip() or "_"


class Runner:
    """Executes one plan: ordering, generation and writing of all tables."""

    def __init__(self, plan):
        self.plan = plan
        self.tables = {t["label"]: t for t in plan["tables"]}
        self.lookups = {l["name"]: l for l in plan.get("lookups", [])}
        self.custom = {}
        for defn in plan.get("custom_generators", []):
            self.custom[defn["name"]] = defn
        # label -> {column name -> pd.Series} of the values generated so far
        self.data = {}
        # label -> row count
        self.row_counts = {}
        # (table_label, list_name) -> the lookup list row indices drawn per
        # record: this way every column drawing from the same list reads the
        # same row — across FK-related tables as well (see lookup_indices).
        self.lookup_row_indices = {}
        # list_name -> {"values": {column: [...]}, "weights": [...]} — the
        # column values/parsed weights extracted once per list, instead of
        # rebuilding them for every column that draws from the list.
        self._lookup_cache = {}

    # ------------------------------------------------------------------
    # Ordering
    # ------------------------------------------------------------------

    def table_dependencies(self, table):
        """Labels of the tables (in the plan) this table depends on."""
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
        """Topological sort of the tables; aborts with a clear message on cycles."""
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
        Column order within a table: the driving FK column is produced during
        row construction already; then column by column, combine columns only
        after the columns they reference, and custom generators last (their code
        can reach everything generated so far via ctx.column(...)).
        """
        columns = [c for c in table["columns"] if c["name"] != table.get("driving_fk_column")]

        def own_deps(column):
            generator = column.get("generator")
            if not generator:
                return set()
            deps = set(generator.get("own_column_refs", []))
            return deps

        remaining = {c["name"]: c for c in columns}
        # The declared column order as an index map, built once (calling
        # list.index per sort key would be quadratic).
        order_index = {c["name"]: i for i, c in enumerate(table["columns"])}
        ordered = []
        # First everything without own dependencies and without custom code,
        # then the rest.
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
    # Lookup lists
    # ------------------------------------------------------------------

    def lookup_column(self, name, column):
        """Values and weights of one lookup list column (cached per list)."""
        lookup = self.lookups.get(name)
        if lookup is None:
            raise RuntimeError(f'Lookup list "{name}" was not found')
        if column not in lookup["columns"]:
            raise RuntimeError(f'Lookup list "{name}" has no column "{column}"')
        # Build column values and weights only once per list — every further
        # column drawing from the same list reads the cache.
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
        The lookup list row indices drawn for a table — ONE row per record,
        read jointly by every column of the same list (e.g. code "DE" and
        currency "EUR" from the same row):

        1. If this table already has indices for the list (another column drew
           first), they are reused.
        2. Otherwise: if a table referenced via FK has indices for the list,
           they are taken over row-accurately (a join over the FK column) — so
           related records read the same list row across table boundaries.
        3. Otherwise a fresh weighted draw is made.
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
                # FK values without a match (should not happen) -> do not guess,
                # draw fresh below instead.
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
    # Generators
    # ------------------------------------------------------------------

    def generate_column(self, table, column, n):
        """Produces the `n` values of one column using its configured generator."""
        generator = column.get("generator")
        gen_id = (generator or {}).get("id", "")
        params = (generator or {}).get("params", {})

        if gen_id == "default":
            # The explicitly chosen per-data-type default — identical to a
            # column without any generator at all.
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
            # ONE list row is drawn per record (see lookup_indices) — every
            # column of the same list, including in FK-related tables, reads
            # that same row.
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
            # Concatenate all parts in ONE pass, instead of repeatedly creating
            # intermediate series pairwise.
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

        # No (known) generator configured -> a sensible default per data type.
        return self.default_by_type(table, column, n)

    def default_by_type(self, table, column, n):
        """Default values per data type — also used for columns without a generator."""
        ctype = column.get("type", "string")
        name = column.get("name", "value")
        if ctype == "integer":
            # A running number — unique out of the box when used as a PK.
            return pd.Series(np.arange(1, n + 1, dtype=np.int64))
        if ctype in ("float", "decimal"):
            return pd.Series(np.round(RNG.uniform(0, 1000, size=n), 2))
        if ctype == "boolean":
            return pd.Series(RNG.integers(0, 2, size=n).astype(bool))
        if ctype == "uuid":
            # Vectorized UUID4 from random bytes (much faster than uuid.uuid4
            # per row). The complete buffer is hex-encoded in ONE C call
            # (instead of a Python callback per row, as apply_along_axis would
            # do) and then split into 32-character chunks.
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
        # string / text / anything unknown
        return pd.Series([f"{name}_{i}" for i in range(1, n + 1)], dtype=object)

    # ------------------------------------------------------------------
    # Table run
    # ------------------------------------------------------------------

    def run_table(self, table):
        """Generates all rows of one table and returns their count."""
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
            # The driving FK column is produced right during row construction:
            # every record of the referenced table gets `counts` related
            # records.
            self.data[label][table["driving_fk_column"]] = pd.Series(
                np.repeat(parent_values.to_numpy(), counts)
            )
        else:
            n = int(table["records"])

        self.row_counts[label] = n

        for column in self.sorted_columns(table):
            self.data[label][column["name"]] = self.generate_column(table, column, n).reset_index(drop=True)
            # Column-by-column progress for the run log (output channel).
            emit("column_done", table=label, column=column["name"], records=n)

        return n

    # ------------------------------------------------------------------
    # Output
    # ------------------------------------------------------------------

    def resolve_output_dir(self):
        """
        Resolves the plan's output folder: the template's `{…}` variables
        (date/time/timestamp/project name) are substituted and every path
        segment is sanitized; relative paths are resolved against the folder of
        the project file. Empty -> `output`.
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
        # Preserve separators (and a leading drive such as `C:`), sanitizing
        # each segment individually.
        parts = re.split(r"([\\/]+)", resolved)
        cleaned = "".join(
            part if re.fullmatch(r"[\\/]+", part) or re.fullmatch(r"[A-Za-z]:", part) else sanitize_path_segment(part)
            for part in parts
            if part
        )
        return os.path.normpath(os.path.join(self.plan.get("project_dir", "."), cleaned or "output"))

    def resolve_filename(self, table, n, df):
        """Resolves a table's file name template (without extension) for this run."""
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
        """Renders date/time columns as text per the configured formats (shared by CSV and preview)."""
        csv_cfg = table["output"].get("csv", {})
        date_fmt = csv_cfg.get("date_format") or "%Y-%m-%d"
        datetime_fmt = csv_cfg.get("datetime_format") or "%Y-%m-%d %H:%M:%S"
        # A shallow copy suffices: below, only whole columns are REASSIGNED
        # (which leaves the original untouched) — a deep copy would needlessly
        # double the memory footprint on large runs.
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
                # Leave values that cannot be read as a date/time (e.g. coming
                # from a custom generator) unchanged.
                pass
        return out

    def write_csv(self, table, df, n):
        """Writes one table as CSV and returns the path of the file created."""
        import os

        csv_cfg = table["output"].get("csv", {})
        os.makedirs(self.out_dir, exist_ok=True)

        out = self.format_dataframe(table, df)
        file_name = self.resolve_filename(table, n, out) + ".csv"
        path = os.path.join(self.out_dir, file_name)
        # Hidden columns (hidden = true) are dropped only now: they are
        # generated and available up to this point (as an FK source for other
        # tables, for {column:...} file names) — they are merely not written to
        # the file.
        visible = [c["name"] for c in table["columns"] if not c.get("hidden") and c["name"] in out.columns]
        out = out[visible]
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
        """Runs the whole plan: every table in dependency order, then the output."""
        ordered = self.sorted_tables()
        preview = self.plan.get("preview")
        self.out_dir = self.resolve_output_dir()
        emit("start", tables=len(ordered))
        files = []
        for index, table in enumerate(ordered):
            emit("table_start", table=table["label"], index=index, total=len(ordered))
            n = self.run_table(table)
            # Keep the column order of the table definition.
            df = pd.DataFrame({c["name"]: self.data[table["label"]][c["name"]] for c in table["columns"]})
            if preview:
                # Preview mode: write nothing; only the target table is
                # reported back at the end.
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
    """Entry point: reads the plan file passed as an argument and runs it."""
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
        # Include the traceback even for "expected" errors — for failures in
        # custom generator code it points at the offending line
        # (<tdgen:name> frames), see the output channel in the extension host.
        fail(err, traceback=traceback.format_exc())
    except Exception as err:  # noqa: BLE001 — report every unexpected exception cleanly as an event
        fail(f"{type(err).__name__}: {err}", traceback=traceback.format_exc())


if __name__ == "__main__":
    main()
