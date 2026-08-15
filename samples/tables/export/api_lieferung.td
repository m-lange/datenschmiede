# Datenschmiede Tabellendefinition
schema = "shop.export"
name = "api_lieferung"
description = """
**Eigener Dateigenerator mit Zielstruktur.** Als Dateityp ist
[`json_umschlag`](../../filegen/json_umschlag.filegen) gewählt. Weil dieser
Generator `structure = "json"` deklariert, bekommt diese Tabelle den Tab
**„JSON-Struktur“** — die Nutzlast wird also ganz normal im Table Editor
beschrieben, und der Generator legt nur den Umschlag darum:

```json
{
  "meta": { "quelle": "shop.export.api_lieferung", "anzahl": 120, … },
  "daten": [ { "artikel": { … }, "bestand": { … } }, … ]
}
```

Das ist die Arbeitsteilung, für die es die beiden Bausteine gibt: Die
**Struktur eines Datensatzes** gehört in den Table Editor, das **Format der
Datei drumherum** in den Dateigenerator. Der bekommt die fertige Nutzlast
über `ctx.as_json(df)` und muss sie nicht selbst bauen.

Die Dateiendung `json` und der Aufbau des Umschlags stammen aus der
`.filegen`-Datei; die `{…}`-Variablen des Dateinamens werden wie immer vom
Lauf aufgelöst und stehen dem Generator als `ctx.file_name` zur Verfügung —
hier landen sie mit im `meta`-Block.
"""

[output]
file_name = "api_lieferung_{datetime}"
format = "custom:json_umschlag"

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
indent = 2
json_lines = false
ascii_only = false
date_format = "%Y-%m-%d"
datetime_format = "%Y-%m-%dT%H:%M:%S"
encoding = "utf-8"

[[output.json.nodes]]
name = "artikel"
kind = "object"

[[output.json.nodes]]
name = "nummer"
kind = "value"
depth = 1
value_type = "string"
source_kind = "column"
source = "artikel_nr"

[[output.json.nodes]]
name = "ean"
kind = "value"
depth = 1
value_type = "string"
source_kind = "column"
source = "ean"

[[output.json.nodes]]
name = "bezeichnung"
kind = "value"
depth = 1
value_type = "string"
source_kind = "column"
source = "bezeichnung"

[[output.json.nodes]]
name = "bestand"
kind = "object"

[[output.json.nodes]]
name = "menge"
kind = "value"
depth = 1
value_type = "integer"
source_kind = "column"
source = "lagerbestand"

[[output.json.nodes]]
name = "lieferbar"
kind = "value"
depth = 1
value_type = "boolean"
source_kind = "column"
source = "lieferbar"

[[output.json.nodes]]
name = "preis"
kind = "value"
depth = 1
value_type = "number"
source_kind = "column"
source = "listenpreis"

[[output.json.nodes]]
name = "waehrung"
kind = "value"
depth = 1
value_type = "string"
source_kind = "constant"
source = "EUR"

[[output.json.nodes]]
name = "stand"
kind = "value"
value_type = "string"
source_kind = "column"
source = "stand"

[[columns]]
name = "artikel_nr"
type = "string"
pk = true
fk = false
description = "Artikelnummer — eigener Generator `laufende_nummer`"
generator = "custom:laufende_nummer"
[columns.generator_params]
prefix = "A-"
start = "1000"
stellen = "6"

[[columns]]
name = "ean"
type = "string"
pk = false
fk = false
description = "EAN-13 aus `artikel_nr` — eigener Generator `ean13`"
generator = "custom:ean13"
[columns.generator_params]
quell_spalte = "artikel_nr"
laendercode = "400"

[[columns]]
name = "bezeichnung"
type = "string"
pk = false
fk = false
description = "Produktname — Faker-Provider `word`"
generator = "faker"
[columns.generator_params]
provider = "word"
locale = "de_DE"

[[columns]]
name = "lagerbestand"
type = "integer"
pk = false
fk = false
description = "Verfügbare Stückzahl — im Dokument als `integer`"
generator = "random-int"
[columns.generator_params]
min = "0"
max = "900"

[[columns]]
name = "lieferbar"
type = "boolean"
pk = false
fk = false
description = "Sofort lieferbar — im Dokument als echtes `true`/`false`"
generator = "default"

[[columns]]
name = "listenpreis"
type = "decimal"
pk = false
fk = false
description = "Listenpreis — im Dokument als `number`, also ohne Anführungszeichen"
generator = "random-float"
[columns.generator_params]
min = "4.9"
max = "1899"
decimals = "2"

[[columns]]
name = "stand"
type = "datetime"
pk = false
fk = false
description = "Stand der Bestandsangabe — ISO-Zeitstempel"
generator = "default"
