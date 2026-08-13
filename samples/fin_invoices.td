# Datenschmiede Tabellendefinition
schema = "ag.cor.fin"
name = "invoices"
description = """
Rechnungen — referenziert sowohl **ag.cor.sapbp.business_partners** (über
den Namensraum-Zweig hinweg) als auch **ag.cor.fin.cost_centers**. Zeigt,
dass die automatische Auswahl auch über Namensraum-Grenzen hinweg
funktioniert.
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
description = "Rechnungsempfänger — 1 bis 6 Rechnungen je Geschäftspartner"

[[columns]]
name = "cost_center_id"
type = "uuid"
pk = false
fk = true
fk_table = "ag.cor.fin.cost_centers"
fk_column = "id"
description = "Belastete Kostenstelle"

[[columns]]
name = "amount"
type = "decimal"
pk = false
fk = false
description = "Rechnungsbetrag"

[[columns]]
name = "issued_at"
type = "date"
pk = false
fk = false
description = "Rechnungsdatum"
