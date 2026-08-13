# Datenschmiede Tabellendefinition
schema = "ag.cor.fin"
name = "invoices"
description = """
Rechnungen — referenziert sowohl **ag.cor.sapbp.business_partners** (über
den Namensraum-Zweig hinweg) als auch **ag.cor.fin.cost_centers**. Zeigt,
dass die automatische Auswahl auch über Namensraum-Grenzen hinweg
funktioniert.
"""

[output]
file_name = "customers_column:id_timestamp"
format = "csv"

[output.csv]
delimiter = ";"
quote_all = true
decimal = "."
date_format = "%Y-%m-%d"
datetime_format = "%Y-%m-%d %H:%M:%S"
include_header = true
encoding = "utf-8"

[[columns]]
name = "id"
type = "uuid"
pk = true
fk = false
description = "Primärschlüssel"
generator = "faker"
[columns.generator_params]
provider = "first_name"
locale = "de_CH"

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
generator = "faker"
[columns.generator_params]
provider = "last_name"
locale = "de_DE"

[[columns]]
name = "issued_at"
type = "date"
pk = false
fk = false
description = "Rechnungsdatum"
generator = "lookup"
[columns.generator_params]
list = "countries"
column = "iso_code"
