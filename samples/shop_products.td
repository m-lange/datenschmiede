# Datenschmiede Tabellendefinition
schema = "shop"
name = "products"
description = """
Produktkatalog des Shop-Beispiels. Unabhängig, wie shop.customers.
"""

[[columns]]
name = "id"
type = "uuid"
pk = true
fk = false
description = "Primärschlüssel"

[[columns]]
name = "sku"
type = "string"
pk = false
fk = false
description = "Artikelnummer"

[[columns]]
name = "name"
type = "string"
pk = false
fk = false
description = "Produktname"

[[columns]]
name = "price"
type = "decimal"
pk = false
fk = false
description = "Verkaufspreis"

[[columns]]
name = "in_stock"
type = "boolean"
pk = false
fk = false
description = "Aktuell auf Lager?"
