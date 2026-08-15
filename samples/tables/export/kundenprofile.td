# Datenschmiede Tabellendefinition
schema = "shop.export"
name = "kundenprofile"
description = """
**JSON-Beispiel** — zeigt, wie flach erzeugte Spalten über eine
**Zielstruktur** in ein verschachteltes Dokument wandern. Die Struktur wird
im Tab **„JSON-Struktur“** gepflegt: je Zeile links Name, Art und Werttyp,
rechts die Herkunft des Werts. Der Knopf **„Dokument-Vorschau“** zeigt das
fertige JSON, ohne dass ein Lauf nötig wäre.

Geschrieben wird `{"kunden": [ … ]}` mit je einem Objekt pro Datensatz:

- `id`, `name`, `email` direkt aus den gleichnamigen Spalten, mit
  ausdrücklichem **Werttyp**: `id` als `integer`, der Rest als `string`
- `adresse` als **Objekt** mit vier Untereinträgen
- `umsatz.betrag` als **Zahl** (`number`) und `umsatz.waehrung` aus der
  Spalte — dazu `umsatz.brutto` als **fester Text**, also ein Wert, der gar
  nicht aus einer Spalte kommt
- `tags` als **Array** mit zwei Einträgen: einer aus einer Spalte, einer
  fest
- `meta.quelle` fest, `meta.exportiert_am` aus der Spalte

`kunden_uuid` ist **ausgeblendet**: Bei CSV hieße das „nicht schreiben“ —
hier entscheidet allein die Zielstruktur, was im Dokument landet, und die
Spalte ist dort bewusst zugeordnet.

Der `ascii_only`-Schalter steht auf *aus*: Umlaute werden direkt
geschrieben, nicht als `\\uXXXX` maskiert. Wie es andersherum aussieht,
zeigt [`ereignisstrom`](ereignisstrom.td).
"""

[output]
file_name = "kundenprofile_{datetime}"
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
root_name = "kunden"
indent = 2
json_lines = false
ascii_only = false
date_format = "%Y-%m-%d"
datetime_format = "%Y-%m-%dT%H:%M:%S"
encoding = "utf-8"

[[output.json.nodes]]
name = "id"
kind = "value"
value_type = "integer"
source_kind = "column"
source = "kunden_id"

[[output.json.nodes]]
name = "uuid"
kind = "value"
value_type = "string"
source_kind = "column"
source = "kunden_uuid"

[[output.json.nodes]]
name = "name"
kind = "value"
value_type = "string"
source_kind = "column"
source = "voller_name"

[[output.json.nodes]]
name = "email"
kind = "value"
value_type = "string"
source_kind = "column"
source = "email"

[[output.json.nodes]]
name = "aktiv"
kind = "value"
value_type = "boolean"
source_kind = "column"
source = "aktiv"

[[output.json.nodes]]
name = "adresse"
kind = "object"

[[output.json.nodes]]
name = "strasse"
kind = "value"
depth = 1
value_type = "string"
source_kind = "column"
source = "strasse"

[[output.json.nodes]]
name = "plz"
kind = "value"
depth = 1
value_type = "string"
source_kind = "column"
source = "plz"

[[output.json.nodes]]
name = "ort"
kind = "value"
depth = 1
value_type = "string"
source_kind = "column"
source = "stadt"

[[output.json.nodes]]
name = "land"
kind = "value"
depth = 1
value_type = "string"
source_kind = "column"
source = "land"

[[output.json.nodes]]
name = "umsatz"
kind = "object"

[[output.json.nodes]]
name = "betrag"
kind = "value"
depth = 1
value_type = "number"
source_kind = "column"
source = "umsatz_gesamt"

[[output.json.nodes]]
name = "waehrung"
kind = "value"
depth = 1
value_type = "string"
source_kind = "column"
source = "waehrung"

[[output.json.nodes]]
name = "brutto"
kind = "value"
depth = 1
value_type = "boolean"
source_kind = "constant"
source = "true"

[[output.json.nodes]]
name = "tags"
kind = "array"

[[output.json.nodes]]
name = "segment"
kind = "value"
depth = 1
value_type = "string"
source_kind = "column"
source = "segment"

[[output.json.nodes]]
name = "kanal"
kind = "value"
depth = 1
value_type = "string"
source_kind = "constant"
source = "webshop"

[[output.json.nodes]]
name = "meta"
kind = "object"

[[output.json.nodes]]
name = "quelle"
kind = "value"
depth = 1
value_type = "string"
source_kind = "constant"
source = "datenschmiede"

[[output.json.nodes]]
name = "exportiert_am"
kind = "value"
depth = 1
value_type = "string"
source_kind = "column"
source = "exportiert_am"

[[columns]]
name = "kunden_id"
type = "integer"
pk = true
fk = false
description = "Fortlaufende Kundennummer — im Dokument als `integer` geschrieben"
generator = "default"

[[columns]]
name = "kunden_uuid"
type = "uuid"
pk = false
fk = false
hidden = true
description = "Technische Kennung — als **ausgeblendet** markiert, in der Zielstruktur aber bewusst zugeordnet"
generator = "default"

[[columns]]
name = "voller_name"
type = "string"
pk = false
fk = false
description = "Name — Faker-Provider `name`"
generator = "faker"
[columns.generator_params]
provider = "name"
locale = "de_DE"

[[columns]]
name = "email"
type = "email"
pk = false
fk = false
description = "E-Mail-Adresse — Faker-Provider `email`"
generator = "faker"
[columns.generator_params]
provider = "email"
locale = "de_DE"

[[columns]]
name = "aktiv"
type = "boolean"
pk = false
fk = false
description = "Konto aktiv — im Dokument als echtes `true`/`false`, nicht als Text"
generator = "default"

[[columns]]
name = "strasse"
type = "string"
pk = false
fk = false
description = "Straße — Faker-Provider `street_address`"
generator = "faker"
[columns.generator_params]
provider = "street_address"
locale = "de_DE"

[[columns]]
name = "plz"
type = "string"
pk = false
fk = false
description = "Postleitzahl — Faker-Provider `postcode`"
generator = "faker"
[columns.generator_params]
provider = "postcode"
locale = "de_DE"

[[columns]]
name = "stadt"
type = "string"
pk = false
fk = false
description = "Ort — Faker-Provider `city`"
generator = "faker"
[columns.generator_params]
provider = "city"
locale = "de_DE"

[[columns]]
name = "land"
type = "string"
pk = false
fk = false
description = "Länderkürzel aus der Liste `laender`"
generator = "lookup"
[columns.generator_params]
list = "laender"
column = "code"

[[columns]]
name = "waehrung"
type = "string"
pk = false
fk = false
description = "Währung aus **derselben Zeile** wie `land`"
generator = "lookup"
[columns.generator_params]
list = "laender"
column = "waehrung"

[[columns]]
name = "umsatz_gesamt"
type = "decimal"
pk = false
fk = false
description = "Jahresumsatz — im Dokument als `number`, also ohne Anführungszeichen"
generator = "random-float"
[columns.generator_params]
min = "0"
max = "48000"
decimals = "2"

[[columns]]
name = "segment"
type = "string"
pk = false
fk = false
description = "Kundensegment aus `umsatz_gesamt` — `basis`/`plus`/`premium`"
generator = "custom:wertklasse"
[columns.generator_params]
eigene_spalte = "umsatz_gesamt"
grenze_1 = "5000"
grenze_2 = "20000"
bezeichner = "basis/plus/premium"

[[columns]]
name = "exportiert_am"
type = "datetime"
pk = false
fk = false
description = "Exportzeitpunkt — als ISO-Zeitstempel geschrieben"
generator = "default"
