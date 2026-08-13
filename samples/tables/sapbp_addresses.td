# Datenschmiede Tabellendefinition
schema = "ag.cor.sapbp"
name = "addresses"
description = """
Adressen — referenziert **ag.cor.sapbp.business_partners**.
"""

[[columns]]
name = "id"
type = "uuid"
pk = true
fk = false
description = "Primärschlüssel"

[[columns]]
name = "business_partner_id"
type = "uuid"
pk = false
fk = true
fk_table = "ag.cor.sapbp.business_partners"
fk_column = "id"
description = "Zugehöriger Geschäftspartner — 1 bis 2 Adressen je Partner"

[[columns]]
name = "street"
type = "string"
pk = false
fk = false
description = "Straße und Hausnummer"

[[columns]]
name = "city"
type = "string"
pk = false
fk = false
description = "Stadt"

[[columns]]
name = "country_code"
type = "string"
pk = false
fk = false
description = "ISO-3166-1-Alpha-2-Ländercode"
