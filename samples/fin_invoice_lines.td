# Datenschmiede Tabellendefinition
schema = "ag.cor.fin"
name = "invoice_lines"
description = """
Rechnungspositionen — referenziert **ag.cor.fin.invoices**. Tiefste Stufe
einer vierstufigen Kette: invoice_lines -> invoices -> business_partners
(bzw. cost_centers) — gut geeignet, um die rekursive Auswahlauflösung im
Testdatenprojekt-Tabellenbaum durchzuspielen.
"""

[[columns]]
name = "id"
type = "uuid"
pk = true
fk = false
description = "Primärschlüssel"

[[columns]]
name = "invoice_id"
type = "uuid"
pk = false
fk = true
fk_table = "ag.cor.fin.invoices"
fk_column = "id"
description = "Zugehörige Rechnung — 1 bis 5 Positionen je Rechnung"

[[columns]]
name = "description"
type = "string"
pk = false
fk = false
description = "Positionsbeschreibung"

[[columns]]
name = "amount"
type = "decimal"
pk = false
fk = false
description = "Positionsbetrag"
