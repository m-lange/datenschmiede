# Datenschmiede Tabellendefinition
schema = "ag.cor.sapbp"
name = "contacts"
description = """
Ansprechpartner — referenziert **ag.cor.sapbp.business_partners**.
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
description = "Zugehöriger Geschäftspartner — 1 bis 3 Ansprechpartner je Partner"

[[columns]]
name = "full_name"
type = "string"
pk = false
fk = false
description = "Name des Ansprechpartners"

[[columns]]
name = "email"
type = "email"
pk = false
fk = false
description = "E-Mail-Adresse"
