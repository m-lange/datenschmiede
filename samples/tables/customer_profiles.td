# Datenschmiede Tabellendefinition
schema = "shop.api"
name = "customer_profiles"
description = """
**JSON-Beispiel** — zeigt, wie flach erzeugte Spalten über eine
**Zielstruktur** in ein verschachteltes Dokument wandern. Die Struktur wird
im Tab **„Schema“** beschrieben und im Tab **„Zuordnung“** mit Spalten
gefüllt; der Knopf **„Dokument-Vorschau“** dort zeigt das fertige JSON,
ohne dass ein Lauf nötig wäre.

Geschrieben wird `{"customers": [ … ]}` mit je einem Objekt pro Datensatz:

- `id`, `name`, `email` direkt aus den gleichnamigen Spalten
- `address` als **Objekt** mit `street`, `city`, `postal_code` und
  `country` — Stadt und PLZ stammen aus derselben Zeile der
  Nachschlageliste `bundeslaender` und passen dadurch zusammen
- `revenue.total` als **Zahl** (Werttyp `number`) und `revenue.currency`
  als **fester Text** — ein Beispiel für einen Wert, der gar nicht aus einer
  Spalte kommt
- `tags` als **Array** aus zwei Werten
- `meta.source` ist wieder ein fester Text, `meta.exported_at` der
  Exportzeitpunkt

`customer_uuid` ist **ausgeblendet**: für CSV hieße das „nicht schreiben“ —
hier steuert allein die Zielstruktur, was im Dokument landet, und die Spalte
ist dort bewusst zugeordnet.
"""

[output]
file_name = "customer_profiles_{date}"
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
root_name = "customers"
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
source = "customer_id"

[[output.json.nodes]]
name = "uuid"
kind = "value"
value_type = "string"
source_kind = "column"
source = "customer_uuid"

[[output.json.nodes]]
name = "name"
kind = "value"
value_type = "string"
source_kind = "column"
source = "full_name"

[[output.json.nodes]]
name = "email"
kind = "value"
value_type = "string"
source_kind = "column"
source = "email"

[[output.json.nodes]]
name = "address"
kind = "object"

[[output.json.nodes]]
name = "street"
kind = "value"
depth = 1
value_type = "string"
source_kind = "column"
source = "street"

[[output.json.nodes]]
name = "city"
kind = "value"
depth = 1
value_type = "string"
source_kind = "column"
source = "city"

[[output.json.nodes]]
name = "postal_code"
kind = "value"
depth = 1
value_type = "string"
source_kind = "column"
source = "postal_code"

[[output.json.nodes]]
name = "country"
kind = "value"
depth = 1
value_type = "string"
source_kind = "column"
source = "country_code"

[[output.json.nodes]]
name = "revenue"
kind = "object"

[[output.json.nodes]]
name = "total"
kind = "value"
depth = 1
value_type = "number"
source_kind = "column"
source = "revenue_total"

[[output.json.nodes]]
name = "currency"
kind = "value"
depth = 1
value_type = "string"
source_kind = "constant"
source = "EUR"

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
name = "channel"
kind = "value"
depth = 1
value_type = "string"
source_kind = "constant"
source = "webshop"

[[output.json.nodes]]
name = "meta"
kind = "object"

[[output.json.nodes]]
name = "source"
kind = "value"
depth = 1
value_type = "string"
source_kind = "constant"
source = "datenschmiede"

[[output.json.nodes]]
name = "exported_at"
kind = "value"
depth = 1
value_type = "string"
source_kind = "column"
source = "exported_at"

[[columns]]
name = "customer_id"
type = "integer"
pk = true
fk = false
description = "Fortlaufende Kundennummer — Standard des Datentyps `integer`"
generator = "default"

[[columns]]
name = "customer_uuid"
type = "uuid"
pk = false
fk = false
hidden = true
description = "Technische Kennung — als `hidden` markiert, in der Zielstruktur aber bewusst zugeordnet"
generator = "default"

[[columns]]
name = "full_name"
type = "string"
pk = false
fk = false
description = "Vollständiger Name — Faker-Provider `name` (deutsch)"
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
name = "street"
type = "string"
pk = false
fk = false
description = "Straße und Hausnummer — Faker-Provider `street_address`"
generator = "faker"
[columns.generator_params]
provider = "street_address"
locale = "de_DE"

[[columns]]
name = "city"
type = "string"
pk = false
fk = false
description = "Stadt aus der Nachschlageliste `bundeslaender`"
generator = "lookup"
[columns.generator_params]
list = "bundeslaender"
column = "stadt"

[[columns]]
name = "postal_code"
type = "string"
pk = false
fk = false
description = "PLZ aus **derselben** Listenzeile wie `city` — bleibt ein String (führende Null)"
generator = "lookup"
[columns.generator_params]
list = "bundeslaender"
column = "plz"

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
name = "revenue_total"
type = "decimal"
pk = false
fk = false
description = "Bisheriger Gesamtumsatz — **Random Float** `0 … 12.500`, im JSON als **Zahl**"
generator = "random-float"
[columns.generator_params]
min = "0"
max = "12500"
decimals = "2"

[[columns]]
name = "segment"
type = "string"
pk = false
fk = false
description = "Kundensegment aus dem Umsatz — benutzerdefinierter Generator `value_category`"
generator = "custom:value_category"
[columns.generator_params]
source_column = "revenue_total"
limits = "500,2500"
labels = "klein,mittel,gross"

[[columns]]
name = "exported_at"
type = "datetime"
pk = false
fk = false
description = "Exportzeitpunkt — im JSON als ISO-Zeitstempel (`%Y-%m-%dT%H:%M:%S`)"
generator = "default"
