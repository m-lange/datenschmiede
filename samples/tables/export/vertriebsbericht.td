# Datenschmiede Tabellendefinition
schema = "shop.export"
name = "vertriebsbericht"
description = """
**Excel-Beispiel** — zeigt alle Einstellungen des Dateityps *Excel* im Tab
**„Excel“**:

- **Blattname** `Bericht {date}`: eine Vorlage mit denselben
  `{…}`-Variablen wie der Dateiname, nicht bloß ein fester Text
- **Startzelle** `B3`: die Tabelle beginnt eingerückt, links und oben bleibt
  Platz für eine Überschrift
- **Kopfzeile schreiben**, **Kopfzeile fixieren** (bleibt beim Scrollen
  stehen) und **Autofilter** auf der Kopfzeile
- **Spaltenbreiten anpassen**: jede Spalte wird ungefähr auf ihren Inhalt
  geweitet
- eigene **Datums- und Zeitstempelformate** (`TT.MM.JJJJ`) — jeder Dateityp
  bringt seine eigenen mit; die CSV-Einstellungen gelten hier nicht

Der Dateiname `vertriebsbericht_{date}_{records}` nutzt die Variable
`{records}`, die zur Laufzeit durch die tatsächliche Datensatzanzahl ersetzt
wird.

Excel wird über das Python-Paket `openpyxl` geschrieben (siehe
[`requirements.txt`](../../requirements.txt)). Eine **Datei-Vorschau** über
den Play-Knopf gibt es für Excel nicht — das Ergebnis ist eine Binärdatei;
die Werte-Vorschau im Spalten-Tab funktioniert weiterhin.
"""

[output]
file_name = "vertriebsbericht_{date}_{records}"
format = "xlsx"

[output.csv]
delimiter = ";"
quote_all = true
decimal = ","
date_format = "%d.%m.%Y"
datetime_format = "%d.%m.%Y %H:%M:%S"
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
name = "bericht_id"
type = "integer"
pk = true
fk = false
description = "Fortlaufende Zeilennummer — Standard des Datentyps `integer`"
generator = "default"

[[columns]]
name = "jahr"
type = "integer"
pk = false
fk = false
description = "Berichtsjahr — Ganzzahl `2024 … 2026`"
generator = "random-int"
[columns.generator_params]
min = "2024"
max = "2026"

[[columns]]
name = "monat"
type = "integer"
pk = false
fk = false
description = "Berichtsmonat — Ganzzahl `1 … 12`"
generator = "random-int"
[columns.generator_params]
min = "1"
max = "12"

[[columns]]
name = "periode"
type = "string"
pk = false
fk = false
description = "Periodenschlüssel — **Kombination** aus `jahr` und `monat`"
generator = "combine"
[columns.generator_params]
template = "{jahr}-{monat}"

[[columns]]
name = "region"
type = "string"
pk = false
fk = false
description = "Vertriebsregion — Ländername aus der Liste `laender`"
generator = "lookup"
[columns.generator_params]
list = "laender"
column = "name"

[[columns]]
name = "waehrung"
type = "string"
pk = false
fk = false
description = "Berichtswährung aus **derselben Zeile** wie `region`"
generator = "lookup"
[columns.generator_params]
list = "laender"
column = "waehrung"

[[columns]]
name = "haendler"
type = "string"
pk = false
fk = false
description = "Vertriebspartner — Faker-Provider `company`"
generator = "faker"
[columns.generator_params]
provider = "company"
locale = "de_DE"

[[columns]]
name = "umsatz"
type = "decimal"
pk = false
fk = false
description = "Monatsumsatz — `1.000,00 … 950.000,00`"
generator = "random-float"
[columns.generator_params]
min = "1000"
max = "950000"
decimals = "2"

[[columns]]
name = "deckungsbeitrag"
type = "decimal"
pk = false
fk = false
description = "Deckungsbeitrag — `100,00 … 250.000,00`"
generator = "random-float"
[columns.generator_params]
min = "100"
max = "250000"
decimals = "2"

[[columns]]
name = "auftraege"
type = "integer"
pk = false
fk = false
description = "Anzahl Aufträge — Ganzzahl `5 … 1.200`"
generator = "random-int"
[columns.generator_params]
min = "5"
max = "1200"

[[columns]]
name = "stand"
type = "datetime"
pk = false
fk = false
description = "Auswertungszeitpunkt — im Blatt als `TT.MM.JJJJ HH:MM` formatiert"
generator = "default"
