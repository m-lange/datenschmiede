# Datenschmiede Tabellendefinition
schema = "shop.report"
name = "sales_report"
description = """
**Excel-Beispiel** — dieselben Spalten wie eine gewöhnliche Tabelle, aber
als `.xlsx` geschrieben statt als CSV. Eine *primäre* Tabelle ohne
Fremdschlüssel: sie lässt sich einzeln über die **Vorschau** ausprobieren
oder in ein Testdatenprojekt aufnehmen.

Bemerkenswertes an den Ausgabe-Einstellungen:

- **Blattname** `Bericht {date}` — der Blattname kennt dieselben
  `{…}`-Variablen wie der Dateiname
- **Tabelle platzieren ab** `B3`: die ersten beiden Zeilen und die Spalte
  `A` bleiben frei, z. B. für einen von Hand ergänzten Berichtskopf
- **Kopfzeile fixiert** und mit **Autofilter** versehen, Spaltenbreiten
  passen sich dem Inhalt an
- `internal_note` ist **ausgeblendet** (Auge-Umschalter): der Wert wird
  erzeugt, landet aber nicht in der Mappe

Benötigt zusätzlich das Python-Paket `openpyxl` — fehlt es, bietet der Lauf
die Installation per Klick an.
"""

[output]
file_name = "vertriebsbericht_{date}"
format = "xlsx"

[output.csv]
delimiter = ";"
quote_all = true
decimal = "."
date_format = "%Y-%m-%d"
datetime_format = "%Y-%m-%d %H:%M:%S"
include_header = true
encoding = "utf-8"

[output.xlsx]
sheet_name = "Bericht {date}"
start_cell = "B3"
include_header = true
freeze_header = true
auto_filter = true
auto_fit_columns = true
date_format = "%d.%m.%Y"
datetime_format = "%d.%m.%Y %H:%M"

[[columns]]
name = "report_id"
type = "string"
pk = true
fk = false
description = "Fachliche Berichtsnummer (`REP-0001`, …) — benutzerdefinierter Generator `sequential_id`"
generator = "custom:sequential_id"
[columns.generator_params]
prefix = "REP-"
start = "1"
digits = "4"

[[columns]]
name = "bundesland"
type = "string"
pk = false
fk = false
description = "Vertriebsregion — gewichtet aus der Nachschlageliste `bundeslaender`"
generator = "lookup"
[columns.generator_params]
list = "bundeslaender"
column = "bundesland"

[[columns]]
name = "stadt"
type = "string"
pk = false
fk = false
description = "Stadt aus **derselben** Zeile der Liste wie `bundesland` — passt dadurch immer zusammen"
generator = "lookup"
[columns.generator_params]
list = "bundeslaender"
column = "stadt"

[[columns]]
name = "umsatz_eur"
type = "decimal"
pk = false
fk = false
description = "Monatsumsatz in Euro — **Random Float** `1.000 … 250.000`, 2 Nachkommastellen"
generator = "random-float"
[columns.generator_params]
min = "1000"
max = "250000"
decimals = "2"

[[columns]]
name = "auftraege"
type = "integer"
pk = false
fk = false
description = "Anzahl Aufträge im Berichtszeitraum — **Random Int** `5 … 400`"
generator = "random-int"
[columns.generator_params]
min = "5"
max = "400"

[[columns]]
name = "stichtag"
type = "date"
pk = false
fk = false
description = "Berichtsstichtag — im Blatt deutsch formatiert (`%d.%m.%Y`)"
generator = "default"

[[columns]]
name = "erstellt_am"
type = "datetime"
pk = false
fk = false
description = "Zeitpunkt der Erstellung — Zeitstempelformat `%d.%m.%Y %H:%M`"
generator = "default"

[[columns]]
name = "internal_note"
type = "string"
pk = false
fk = false
hidden = true
description = "Interne Notiz — wird erzeugt, aber **nicht** in die Excel-Mappe geschrieben"
generator = "faker"
[columns.generator_params]
provider = "sentence"
locale = "de_DE"
