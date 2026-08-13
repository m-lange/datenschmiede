# Datenschmiede Tabellendefinition
schema = "shop"
name = "order_items"
description = """
Bestellpositionen — referenziert sowohl **shop.orders** als auch
**shop.products**. Zeigt eine Tabelle mit zwei ausgehenden
Fremdschlüsseln: beide referenzierten Tabellen werden bei Auswahl
automatisch mit ausgewählt.
"""

[[columns]]
name = "id"
type = "uuid"
pk = true
fk = false
description = "Primärschlüssel"

[[columns]]
name = "order_id"
type = "uuid"
pk = false
fk = true
fk_table = "shop.orders"
fk_column = "id"
description = "Zugehörige Bestellung — 1 bis 4 Positionen je Bestellung"

[[columns]]
name = "product_id"
type = "uuid"
pk = false
fk = true
fk_table = "shop.products"
fk_column = "id"
description = "Bestelltes Produkt"

[[columns]]
name = "quantity"
type = "integer"
pk = false
fk = false
description = "Menge"
