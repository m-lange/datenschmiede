# Datenschmiede Tabellendefinition
schema = "ag.cor.sapbp"
name = "bank_accounts"
description = """
Bankverbindungen — referenziert **ag.cor.sapbp.business_partners**.
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
description = "Zugehöriger Geschäftspartner"

[[columns]]
name = "iban"
type = "string"
pk = false
fk = false
description = "IBAN"

[[columns]]
name = "bank_name"
type = "string"
pk = false
fk = false
description = "Name der Bank"
