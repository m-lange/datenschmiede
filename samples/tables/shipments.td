# Datenschmiede Tabellendefinition
schema = "shop.sales"
name = "shipments"
description = """
**Sendungen** — genau *eine* je Bestellung: die Projekt-Kardinalität ist
die feste Zahl `1` (eine 1:1-Beziehung über die treibende FK-Spalte
`order_id`).

Die Spalte `tracking_code` nutzt den **benutzerdefinierten Generator**
`tracking_code` (siehe `generators/tracking_code.tdgen`) und zeigt dessen
*Tabellen-/Spalten-Referenz*: das Länderkürzel in `DHL-DE-48291736` wird
per `ctx.table(...)` zufällig aus `shop.core.customers.country` gezogen —

- die Kunden-Tabelle wird dadurch im Projekt **automatisch mit
  ausgewählt** und beim Lauf **vor** den Sendungen generiert
- wird die referenzierte Tabelle/Spalte später umbenannt oder gelöscht,
  meldet die Problems-Ansicht das als **Warnung** an dieser Spalte

`total_quantity` demonstriert den Generator `related_sum`: eine
**Aggregation** über eine andere Tabelle — die Summe von
`order_items.quantity`, gruppiert nach `order_id` und über die eigene
`order_id`-Spalte zugeordnet (`SUM(...) GROUP BY ...` als vektorisiertes
pandas-`groupby`). Die Sendungen entstehen *nach* den Positionen, deshalb
ist die Summe hier möglich (in `orders` selbst wäre sie eine zirkuläre
Referenz).

Der Dateiname demonstriert die Variable `{datetime}` (Datum + Uhrzeit des
Laufs); geschrieben wird mit `UTF-8 (BOM)` — praktisch für Excel.
"""

[output]
file_name = "shipments_{datetime}"
format = "csv"

[output.csv]
delimiter = ";"
quote_all = true
decimal = "."
date_format = "%Y-%m-%d"
datetime_format = "%Y-%m-%d %H:%M"
include_header = true
encoding = "utf-8-sig"

[[columns]]
name = "id"
type = "string"
pk = true
fk = false
description = "Primärschlüssel — fortlaufende Sendungsnummer (`SHP-000001`, …)"
generator = "custom:sequential_id"
[columns.generator_params]
prefix = "SHP-"
start = "1"
digits = "6"

[[columns]]
name = "order_id"
type = "string"
pk = false
fk = true
fk_table = "shop.sales.orders"
fk_column = "id"
description = "Zugehörige Bestellung — treibende FK-Spalte mit Kardinalität `1` (genau eine Sendung je Bestellung)"
generator = "foreign-key"

[[columns]]
name = "tracking_code"
type = "string"
pk = false
fk = false
description = "Sendungsnummer `DHL-DE-XXXXXXXX` — benutzerdefinierter Generator mit **Tabellen-Referenz** auf `shop.core.customers.country`"
generator = "custom:tracking_code"
[columns.generator_params]
carrier = "DHL"
origin_table = "shop.core.customers"
origin_column = "country"

[[columns]]
name = "total_quantity"
type = "integer"
pk = false
fk = false
description = "Gesamtstückzahl der Sendung — **Summe** von `order_items.quantity` je `order_id` (benutzerdefinierter Generator `related_sum`)"
generator = "custom:related_sum"
[columns.generator_params]
source_table = "shop.sales.order_items"
value_column = "quantity"
match_column = "order_id"
key_column = "order_id"

[[columns]]
name = "size_category"
type = "string"
pk = false
fk = false
description = "Sendungsgröße `small`/`medium`/`large` — kategorisiert `total_quantity` über den Generator `value_category` (Parametertyp `own_column`)"
generator = "custom:value_category"
[columns.generator_params]
source_column = "total_quantity"
limits = "5,12"
labels = "small,medium,large"

[[columns]]
name = "shipped_at"
type = "datetime"
pk = false
fk = false
description = "Versandzeitpunkt — Faker-Provider `date_time_this_year`, im CSV ohne Sekunden (`%Y-%m-%d %H:%M`)"
generator = "faker"
[columns.generator_params]
provider = "date_time_this_year"
