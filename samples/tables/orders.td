# Datenschmiede Tabellendefinition
schema = "shop.sales"
name = "orders"
description = """
**Bestellungen** — die erste *referenzierte* Tabelle des Beispiels: sie
hängt per Fremdschlüssel an `shop.core.customers`. Daraus folgt im
Testdatenprojekt zweierlei:

1. Wird `shop.sales.orders` ausgewählt, wird `shop.core.customers`
   **automatisch mit ausgewählt** (und lässt sich nicht abwählen, solange
   die Bestellungen sie brauchen)
2. Die Datensatzanzahl ist keine feste Zahl, sondern eine **Kardinalität
   je Kunde** — im Projekt `1..5`: jeder Kunde bekommt ein bis fünf
   Bestellungen, die Übersicht rechnet daraus `250..1250`

Weitere Besonderheiten:

- `customer_id` ist die *treibende* FK-Spalte (Generator **Fremdschlüssel**,
  automatisch zugewiesen und nicht änderbar)
- `status`: gewichtete **Nachschlageliste** `order_status`
- `customer_country`: übernimmt das Land **zeilengenau** vom jeweils
  bestellenden Kunden (Generator `parent_value` — `ctx.related` joint über
  die FK-Spalte, statt zufällig zu ziehen)
- `currency`: zieht aus der Nachschlageliste `countries` die Spalte
  `currency` — und liest dabei **dieselbe Listen-Zeile** wie das Land des
  Kunden: ein Schweizer Kunde bekommt `CHF`, ein polnischer `PLN`
  (Zeilen-Konsistenz des Lookup-Generators über FK-verbundene Tabellen)
- Die CSV-Ausgabe ist bewusst **deutsch formatiert**: Dezimal-*Komma* und
  Datumsformat `TT.MM.JJJJ`; der Dateiname trägt einen `{timestamp}`, sodass
  jeder Lauf eine neue Datei erzeugt
"""

[output]
file_name = "orders_{timestamp}"
format = "csv"

[output.csv]
delimiter = ";"
quote_all = true
decimal = ","
date_format = "%d.%m.%Y"
datetime_format = "%d.%m.%Y %H:%M:%S"
include_header = true
encoding = "utf-8"

[[columns]]
name = "id"
type = "string"
pk = true
fk = false
description = "Primärschlüssel — fortlaufende Bestellnummer (`ORD-001000`, …), Startwert 1000"
generator = "custom:sequential_id"
[columns.generator_params]
prefix = "ORD-"
start = "1000"
digits = "6"

[[columns]]
name = "customer_id"
type = "string"
pk = false
fk = true
fk_table = "shop.core.customers"
fk_column = "id"
description = "Bestellender Kunde — *treibende* FK-Spalte: die Projekt-Kardinalität `1..5` gilt je Kunde"
generator = "foreign-key"

[[columns]]
name = "order_date"
type = "date"
pk = false
fk = false
description = "Bestelldatum — Faker-Provider `date_this_year`, im CSV als `TT.MM.JJJJ`"
generator = "faker"
[columns.generator_params]
provider = "date_this_year"

[[columns]]
name = "status"
type = "string"
pk = false
fk = false
description = "Bestellstatus — gewichtet aus der **Nachschlageliste** `order_status`"
generator = "lookup"
[columns.generator_params]
list = "order_status"
column = "status"

[[columns]]
name = "total"
type = "decimal"
pk = false
fk = false
description = "Bestellwert — Random Float, im CSV mit Dezimal-**Komma**"
generator = "random-float"
[columns.generator_params]
min = "9.90"
max = "1999.90"
decimals = "2"

[[columns]]
name = "customer_country"
type = "string"
pk = false
fk = false
description = "Land des bestellenden Kunden — **zeilengenau** aus `shop.core.customers.country` übernommen (Generator `parent_value` via `ctx.related`)"
generator = "custom:parent_value"
[columns.generator_params]
fk_column = "customer_id"
source_column = "country"

[[columns]]
name = "currency"
type = "string"
pk = false
fk = false
description = "Währung der Bestellung — **Nachschlageliste** `countries`, Spalte `currency`: liest dieselbe Listen-Zeile wie das Land des Kunden (CH-Kunde → CHF)"
generator = "lookup"
[columns.generator_params]
list = "countries"
column = "currency"
