# Datenschmiede Tabellendefinition
schema = "ag.cor.sapbp"
name = "business_partners"
description = """
Geschäftspartner — Namensraum **ag.cor.sapbp** (drei Ebenen: "ag" -> "cor"
-> "sapbp", das Beispiel aus der Anforderung). Unabhängig, Wurzel mehrerer
Ketten in diesem Beispiel-Set.
"""

[[columns]]
name = "id"
type = "uuid"
pk = true
fk = false
description = "Primärschlüssel"

[[columns]]
name = "bp_number"
type = "string"
pk = false
fk = false
description = "Geschäftspartner-Nummer"

[[columns]]
name = "bp_type"
type = "string"
pk = false
fk = false
description = "Typ, z. B. \"customer\", \"vendor\", \"employee\""

[[columns]]
name = "name"
type = "string"
pk = false
fk = false
description = "Name des Geschäftspartners"
