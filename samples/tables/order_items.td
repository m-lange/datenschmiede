# Datenschmiede Tabellendefinition
schema = "shop.sales"
name = "order_items"
description = """
**Bestellpositionen** — die Tabelle mit den *meisten* Beziehungen im
Beispiel: sie hat **zwei Fremdschlüssel** und zeigt, wie der Generator-Lauf
damit umgeht.

- `order_id` → `shop.sales.orders.id`: die **erste** FK-Spalte ist die
  *treibende* — die Projekt-Kardinalität `1..4` gilt je Bestellung, die
  Zeilen entstehen per `np.repeat` entlang der Bestellungen
- `product_sku` → `shop.core.products.sku`: jede weitere FK-Spalte zieht
  **zufällige** Werte aus der referenzierten Spalte — dadurch werden auch
  die Produkte automatisch mit ins Projekt aufgenommen
- `line_note` **kombiniert** eigene Spalten (`{quantity} x {product_sku}`)
  — die referenzierten Spalten werden dadurch garantiert *vor* der Notiz
  generiert (Spalte-für-Spalte-Reihenfolge)

Die Ausgabe demonstriert zwei weitere Dateinamen-Variablen:
`{schema}_{table}_{records}` ergibt z. B. `shop.sales_order_items_812` —
und als Spaltentrenner dient ein **Tabulator**.
"""

[output]
file_name = "{schema}_{table}_{records}"
format = "csv"

[output.csv]
delimiter = "\t"
quote_all = false
decimal = "."
date_format = "%Y-%m-%d"
datetime_format = "%Y-%m-%d %H:%M:%S"
include_header = true
encoding = "utf-8"

[[columns]]
name = "id"
type = "string"
pk = true
fk = false
description = "Primärschlüssel — fortlaufende Positionsnummer (`ITM-00000001`, …), 8 Stellen"
generator = "custom:sequential_id"
[columns.generator_params]
prefix = "ITM-"
start = "1"
digits = "4"

[[columns]]
name = "order_id"
type = "string"
pk = false
fk = true
fk_table = "shop.sales.orders"
fk_column = "id"
description = "Zugehörige Bestellung — *treibende* FK-Spalte: `1..4` Positionen je Bestellung"
generator = "foreign-key"

[[columns]]
name = "product_sku"
type = "string"
pk = false
fk = true
fk_table = "shop.core.products"
fk_column = "sku"
description = "Bestellter Artikel — zweite FK-Spalte, zieht **zufällige** Artikelnummern aus `shop.core.products`"
generator = "foreign-key"

[[columns]]
name = "quantity"
type = "integer"
pk = false
fk = false
description = "Bestellmenge — **Random Int** `1 … 5`"
generator = "random-int"
[columns.generator_params]
min = "1"
max = "200"

[[columns]]
name = "line_note"
type = "string"
pk = false
fk = false
description = "Positions-Notiz — **kombiniert** aus Menge und Artikelnummer (`{quantity} x {product_sku}`)"
generator = "combine"
[columns.generator_params]
template = "{quantity} x {product_sku}"
