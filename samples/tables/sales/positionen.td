# Datenschmiede Tabellendefinition
schema = "shop.sales"
name = "positionen"
description = """
**Zwei ausgehende Fremdschlüssel** — die Position gehört zu einer Bestellung
*und* zu einem Produkt. Das zeigt, wie die beiden sich unterscheiden:

- `bestell_nr` steht **zuerst** und ist damit die **treibende** FK-Spalte:
  Die Kardinalität `1..4` aus dem Projekt bedeutet ein bis vier Positionen
  **je Bestellung**
- `artikel_nr` ist ein gewöhnlicher Fremdschlüssel: Er zieht Werte aus der
  referenzierten Spalte, bestimmt aber die Anzahl nicht mit

Damit hängt am Ende eine dreistufige Kette: 2.000 Kunden → `1..5`
Bestellungen → `1..4` Positionen, also `2.000..40.000` Positionen. Die
Übersicht „Generierte Dateien“ rechnet das über die ganze Kette aus.

**Denormalisierte Felder**: `bezeichnung` und `einzelpreis` holt der
Generator [`elternwert`](../../generators/elternwert.tdgen) aus **genau
dem** Produkt, auf das `artikel_nr` zeigt. Der Preis in der Position passt
dadurch zum Listenpreis des Artikels, statt ein zweites Mal gewürfelt zu
werden — der übliche Fall, wenn eine Datei ohne Nachschlagen lesbar sein
soll.
"""

[output]
file_name = "positionen_{date}"
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
name = "position_id"
type = "integer"
pk = true
fk = false
description = "Fortlaufende Positionsnummer — Standard des Datentyps `integer`"
generator = "default"

[[columns]]
name = "bestell_nr"
type = "string"
pk = false
fk = true
fk_table = "shop.sales.bestellungen"
fk_column = "bestell_nr"
description = "Zugehörige Bestellung — **treibende** FK-Spalte: die Kardinalität `1..4` gilt je Bestellung"

[[columns]]
name = "artikel_nr"
type = "string"
pk = false
fk = true
fk_table = "shop.core.produkte"
fk_column = "artikel_nr"
description = "Bestellter Artikel — gewöhnlicher Fremdschlüssel, ohne Einfluss auf die Anzahl"

[[columns]]
name = "bezeichnung"
type = "string"
pk = false
fk = false
description = "Produktname **genau des** referenzierten Artikels — Generator `elternwert` über `artikel_nr`"
generator = "custom:elternwert"
[columns.generator_params]
fk_pfad = "artikel_nr"
spalte = "bezeichnung"

[[columns]]
name = "einzelpreis"
type = "decimal"
pk = false
fk = false
description = "Listenpreis **genau des** referenzierten Artikels — passt dadurch immer zum Produkt"
generator = "custom:elternwert"
[columns.generator_params]
fk_pfad = "artikel_nr"
spalte = "listenpreis"

[[columns]]
name = "menge"
type = "integer"
pk = false
fk = false
description = "Bestellte Stückzahl — Ganzzahl `1 … 8`; wird in `shop.sales.lieferungen` aufsummiert"
generator = "random-int"
[columns.generator_params]
min = "1"
max = "8"

[[columns]]
name = "rabatt_prozent"
type = "integer"
pk = false
fk = false
description = "Positionsrabatt — Ganzzahl `0 … 20`"
generator = "random-int"
[columns.generator_params]
min = "0"
max = "20"
