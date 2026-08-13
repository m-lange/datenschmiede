# Datenschmiede Tabellendefinition
schema = "shop"
name = "orders"
description = """
Bestellungen — referenziert **shop.customers**. Wird ein Testdatenprojekt-
Tabellenbaum-Eintrag für shop.orders ausgewählt, wird shop.customers
automatisch mit ausgewählt (und lässt sich nicht mehr abwählen). Die
Datensatzanzahl von shop.orders selbst wird über die Kardinalität hier
abgeleitet, statt manuell gesetzt zu werden.
"""

[[columns]]
name = "id"
type = "uuid"
pk = true
fk = false
description = "Primärschlüssel"

[[columns]]
name = "customer_id"
type = "uuid"
pk = false
fk = true
fk_table = "shop.customers"
fk_column = "id"
description = "Bestellender Kunde — je Kunde 1 bis 5 Bestellungen"

[[columns]]
name = "order_date"
type = "date"
pk = false
fk = false
description = "Bestelldatum"

[[columns]]
name = "status"
type = "string"
pk = false
fk = false
description = "Status, z. B. \"open\", \"shipped\", \"cancelled\""
