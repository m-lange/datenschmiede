# Datenschmiede Tabellendefinition
schema = "shop.core"
name = "products"
description = """
**Produktkatalog** des Webshop-Beispiels — wie `shop.core.customers` eine
*primäre* Tabelle mit fester Gesamtanzahl (im Projekt: 80 Artikel).

Bemerkenswertes an dieser Tabelle:

- `sku` ist der **Primärschlüssel als fachliche Artikelnummer**
  (`SKU-0001`, …) über den benutzerdefinierten Generator `sequential_id`
  mit *vier* Stellen — derselbe Generator, andere Parameter als bei den
  Kunden
- `price`: **Random Float** im Bereich `0.99 … 999.99` mit zwei
  Nachkommastellen
- `weight_kg`: noch ein Random Float — im CSV mit **Dezimal-Punkt**, da
  diese Datei (anders als die Bestellungen) im internationalen Format
  geschrieben wird: Komma als Trenner, nichts in Anführungszeichen

Die Ausgabe-Einstellungen weichen bewusst von den anderen Tabellen ab, um
die **Dateityp-Konfiguration je Tabelle** zu zeigen.
"""

[output]
file_name = "products"
format = "csv"

[output.csv]
delimiter = ","
quote_all = false
decimal = "."
date_format = "%Y-%m-%d"
datetime_format = "%Y-%m-%d %H:%M:%S"
include_header = true
encoding = "utf-8"

[[columns]]
name = "sku"
type = "string"
pk = true
fk = false
description = "Artikelnummer als Primärschlüssel (`SKU-0001`, …) — `sequential_id` mit 4 Stellen"
generator = "custom:sequential_id"
[columns.generator_params]
prefix = "SKU-"
start = "1"
digits = "4"

[[columns]]
name = "name"
type = "string"
pk = false
fk = false
description = "Produktname — Faker-Provider `word` (englisch als neutraler Platzhalter)"
generator = "faker"
[columns.generator_params]
provider = "word"
locale = "en_US"

[[columns]]
name = "price"
type = "decimal"
pk = false
fk = false
description = "Verkaufspreis in Euro — **Random Float** `0.99 … 999.99`, 2 Nachkommastellen"
generator = "random-float"
[columns.generator_params]
min = "0.99"
max = "999.99"
decimals = "2"

[[columns]]
name = "weight_kg"
type = "float"
pk = false
fk = false
description = "Versandgewicht in Kilogramm — Random Float `0.05 … 25`, 3 Nachkommastellen"
generator = "random-float"
[columns.generator_params]
min = "0.05"
max = "25"
decimals = "3"

[[columns]]
name = "in_stock"
type = "boolean"
pk = false
fk = false
description = "Aktuell lieferbar? — Faker-Provider `boolean`"
generator = "faker"
[columns.generator_params]
provider = "boolean"
