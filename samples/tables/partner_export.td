# Datenschmiede Tabellendefinition
schema = "shop.export"
name = "partner_export"
description = """
**Beispiel für einen eigenen Dateigenerator** — als Dateityp ist nicht CSV
ausgewählt, sondern der Dateigenerator
[`csv_with_header_block`](../filegen/csv_with_header_block.filegen).

Er schreibt die Daten als gewöhnliches CSV, stellt ihnen aber einen
Kopfblock voran: **Zeilen 1–5** enthalten Datei-Informationen, **6–19**
bleiben leer, und in **Zeile 20** steht die Kopfzeile des CSV. Die
CSV-Einstellungen dieser Tabelle (Trennzeichen, Anführungszeichen,
Dezimaltrenner) gelten dabei unverändert weiter — der Generator holt sich
das fertige CSV über `ctx.as_csv(df)` und kümmert sich nur um das Drumherum.

Der Knopf **„Dokument-Vorschau“** in der Ausgabe-Karte ruft den Generator
mit 20 Vorschau-Datensätzen auf und zeigt die entstehende Datei — ohne dass
etwas geschrieben wird.
"""

[output]
file_name = "partner_export_{date}"
format = "custom:csv_with_header_block"

[output.csv]
delimiter = ";"
quote_all = false
decimal = ","
date_format = "%d.%m.%Y"
datetime_format = "%d.%m.%Y %H:%M:%S"
include_header = true
encoding = "utf-8"

[[columns]]
name = "partner_id"
type = "string"
pk = true
fk = false
description = "Partnernummer (`BP-000001`, …) — benutzerdefinierter Generator `sequential_id`"
generator = "custom:sequential_id"
[columns.generator_params]
prefix = "BP-"
start = "1"
digits = "6"

[[columns]]
name = "partner_name"
type = "string"
pk = false
fk = false
description = "Name des Geschäftspartners — Faker-Provider `company`"
generator = "faker"
[columns.generator_params]
provider = "company"
locale = "de_DE"

[[columns]]
name = "country_code"
type = "string"
pk = false
fk = false
description = "Länderkürzel aus der Nachschlageliste `countries`"
generator = "lookup"
[columns.generator_params]
list = "countries"
column = "code"

[[columns]]
name = "credit_limit"
type = "decimal"
pk = false
fk = false
description = "Kreditlimit — **Random Float** `1.000 … 500.000`, im CSV mit Dezimal-Komma"
generator = "random-float"
[columns.generator_params]
min = "1000"
max = "500000"
decimals = "2"

[[columns]]
name = "valid_from"
type = "date"
pk = false
fk = false
description = "Gültig ab — im CSV deutsch formatiert (`%d.%m.%Y`)"
generator = "default"
