# Datenschmiede Tabellendefinition
schema = "shop.master"
name = "partner_contracts"
description = """
**Die Gegenseite der führenden Nachschlageliste** — diese Tabelle hängt per
Fremdschlüssel an [`shop.master.business_partners`](business_partners.td),
die ihrerseits von der Liste
[`business_partners.lkp`](../lookups/business_partners.lkp) geführt wird.

Damit ergibt sich das Muster, für das eine führende Liste gedacht ist:

1. die **Liste** gibt die Geschäftspartner-IDs fest vor (zwölf Stück)
2. `business_partners` bekommt **genau einen Datensatz je Listenzeile** —
   jede ID kommt exakt einmal vor, ist also ein echter Primärschlüssel
3. `partner_contracts` bekommt im Projekt eine **Kardinalität je Partner**
   (z. B. `1..3`) und erzeugt entsprechend viele Verträge **pro ID**

Die IDs kommen also nicht aus dem Zufall, sondern aus einer gepflegten
Liste — und alles, was daran hängt, richtet sich danach.
"""

[output]
file_name = "partner_contracts"
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
name = "contract_no"
type = "string"
pk = true
fk = false
description = "Vertragsnummer (`CTR-00001`, …) — benutzerdefinierter Generator `sequential_id`"
generator = "custom:sequential_id"
[columns.generator_params]
prefix = "CTR-"
start = "1"
digits = "5"

[[columns]]
name = "partner_id"
type = "string"
pk = false
fk = true
fk_table = "shop.master.business_partners"
fk_column = "partner_id"
description = "Verweist auf den Geschäftspartner — die **treibende** Spalte: je Partner entstehen so viele Verträge, wie das Projekt vorgibt"
generator = "foreign-key"

[[columns]]
name = "partner_name"
type = "string"
pk = false
fk = false
description = "Name des Partners — **zeilentreu** über den Fremdschlüssel geholt (`ctx.related`), passt also immer zur `partner_id`"
generator = "custom:parent_value"
[columns.generator_params]
fk_column = "partner_id"
source_column = "partner_name"

[[columns]]
name = "start_date"
type = "date"
pk = false
fk = false
description = "Vertragsbeginn — Standard des Datentyps `date`"
generator = "default"

[[columns]]
name = "annual_value"
type = "decimal"
pk = false
fk = false
description = "Jahresvolumen — **Random Float** `2.500 … 180.000`"
generator = "random-float"
[columns.generator_params]
min = "2500"
max = "180000"
decimals = "2"
