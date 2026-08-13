# Datenschmiede Tabellendefinition
schema = "shop"
name = "payments"
description = """
Zahlungen — referenziert **shop.orders**, das wiederum **shop.customers**
referenziert. Zeigt die rekursive Abhängigkeitsauflösung im
Testdatenprojekt-Tabellenbaum über zwei Ebenen: shop.payments ->
shop.orders -> shop.customers werden gemeinsam ausgewählt.
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
description = "Bezahlte Bestellung"

[[columns]]
name = "amount"
type = "decimal"
pk = false
fk = false
description = "Zahlbetrag"

[[columns]]
name = "paid_at"
type = "datetime"
pk = false
fk = false
description = "Zahlungszeitpunkt"
