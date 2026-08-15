# Datenschmiede Tabellendefinition
schema = "shop.export"
name = "ereignisstrom"
description = """
**JSON Lines (NDJSON)** — die zweite Betriebsart des JSON-Dateityps: **ein
Datensatz je Zeile**, ohne umschließendes Array. Genau das erwarten
Log-Systeme und Streaming-Schnittstellen, die zeilenweise lesen, ohne die
ganze Datei im Speicher zu halten.

**Was hier zu sehen ist**

- **JSON Lines** ist eingeschaltet und die **Einrückung steht auf 0** —
  beides gehört zusammen: Eingerückte Objekte über mehrere Zeilen wären
  kein NDJSON mehr
- **Nur ASCII** ist eingeschaltet: Umlaute werden als `\\uXXXX` maskiert
  statt direkt geschrieben — der Gegenpol zu
  [`kundenprofile`](kundenprofile.td)
- die **Zielstruktur ist leer**. Dann schreibt der Lauf schlicht **eine
  Eigenschaft je sichtbarer Spalte** — man braucht den Struktur-Tab also
  nur, wenn es verschachtelt werden soll
- `nutzlast` hat den Datentyp `json`; sein Standardwert ist das leere Objekt
  `{}`, das ein eigener Generator mit Inhalt füllen kann
- der Dateiname nutzt `{column:quelle}` — den Wert dieser Spalte aus dem
  **ersten** erzeugten Datensatz. Sinnvoll, wenn eine Spalte für die ganze
  Datei konstant ist, wie hier durch die Kombinations-Vorlage ohne
  Platzhalter
"""

[output]
file_name = "ereignisse_{date}_{column:quelle}"
format = "json"

[output.csv]
delimiter = ";"
quote_all = true
decimal = "."
date_format = "%Y-%m-%d"
datetime_format = "%Y-%m-%d %H:%M:%S"
include_header = true
encoding = "utf-8"

[output.json]
root_name = ""
indent = 0
json_lines = true
ascii_only = true
date_format = "%Y-%m-%d"
datetime_format = "%Y-%m-%dT%H:%M:%S"
encoding = "utf-8"

[[columns]]
name = "ereignis_id"
type = "uuid"
pk = true
fk = false
description = "Eindeutige Ereigniskennung — Standard des Datentyps `uuid`"
generator = "default"

[[columns]]
name = "quelle"
type = "string"
pk = false
fk = false
description = "Erzeugendes System — Konstante über eine **Kombination** ohne Platzhalter; steht auch im Dateinamen"
generator = "combine"
[columns.generator_params]
template = "webshop"

[[columns]]
name = "typ"
type = "string"
pk = false
fk = false
description = "Ereignisart aus der Liste `bestellstatus`"
generator = "lookup"
[columns.generator_params]
list = "bestellstatus"
column = "code"

[[columns]]
name = "referenz"
type = "string"
pk = false
fk = false
description = "Bezugsobjekt — eigener Generator `laufende_nummer`"
generator = "custom:laufende_nummer"
[columns.generator_params]
prefix = "B-2026-"
start = "1"
stellen = "8"

[[columns]]
name = "nutzlast"
type = "json"
pk = false
fk = false
description = "Ereignisrumpf — Datentyp `json`, standardmäßig das leere Objekt"
generator = "default"

[[columns]]
name = "beschreibung"
type = "text"
pk = false
fk = false
description = "Klartext mit Umlauten — zeigt die `\\uXXXX`-Maskierung"
generator = "faker"
[columns.generator_params]
provider = "sentence"
locale = "de_DE"

[[columns]]
name = "erfasst_am"
type = "datetime"
pk = false
fk = false
description = "Zeitpunkt des Ereignisses — ISO-Zeitstempel"
generator = "default"
