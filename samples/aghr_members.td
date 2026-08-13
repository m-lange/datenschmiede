# Datenschmiede Tabellendefinition
schema = "ag.hr.test"
name = "members"
description = """
Teammitglieder — referenziert **ag.hr.teams** und zusätzlich
**ag.cor.sapbp.business_partners** (jedes Mitglied ist auch als
Geschäftspartner geführt). Zweite Tabelle, die über einen
Namensraum-Zweig hinweg auf ag.cor.sapbp verweist.
"""

[[columns]]
name = "id"
type = "uuid"
pk = true
fk = false
description = "Primärschlüssel"

[[columns]]
name = "team_id"
type = "uuid"
pk = false
fk = true
fk_table = "ag.hr.teams"
fk_column = "id"
description = "Zugehöriges Team — 2 bis 10 Mitglieder je Team"

[[columns]]
name = "business_partner_id"
type = "uuid"
pk = false
fk = true
fk_table = "ag.cor.sapbp.business_partners"
fk_column = "id"
description = "Zugehöriger Geschäftspartner-Datensatz"

[[columns]]
name = "role"
type = "string"
pk = false
fk = false
description = "Rolle im Team"
