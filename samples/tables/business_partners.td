# Datenschmiede Tabellendefinition
schema = "shop.master"
name = "business_partners"
description = """
**Beispiel für eine führende Nachschlageliste** — im Übersicht-Tab ist unter
**„Führende Nachschlageliste“** die Liste
[`business_partners`](../lookups/business_partners.lkp) ausgewählt.

Damit gilt für diese Tabelle:

- sie bekommt **genau einen Datensatz je Zeile** der Liste (hier zwölf),
  jede Zeile **genau einmal** und in Listenreihenfolge — nicht gezogen,
  nicht wiederholt
- die **Datensatzanzahl kommt aus der Liste**, nicht aus dem Projekt; im
  Projekt-Editor braucht diese Tabelle deshalb kein Anzahl-Feld
- alle Nachschlage-Spalten dieser Tabelle lesen **dieselbe Zeile**:
  `partner_id`, `partner_name` und `segment` eines Datensatzes stammen immer
  aus derselben Listenzeile und passen dadurch zusammen

Genau das braucht man, wenn eine **vorgegebene Liste von Schlüsseln**
(Geschäftspartner-IDs, Mandanten, Filialen) die Grundlage bilden soll: die
Liste einmal pflegen, und alle davon abhängigen Tabellen hängen sich per
Fremdschlüssel daran — jede ID kommt dabei genau einmal vor, sodass
`partner_id` ein echter Primärschlüssel bleibt.

Die übrigen Spalten (`credit_limit`, `created_at`) werden wie gewohnt
zufällig erzeugt — die Liste bestimmt nur, *wie viele* Datensätze es gibt
und welche Werte in den zugeordneten Spalten stehen.
"""
driving_lookup = "business_partners"

[output]
file_name = "business_partners"
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
name = "partner_id"
type = "string"
pk = true
fk = false
description = "Partnernummer **aus der führenden Liste** — jede Zeile genau einmal, also ein echter Primärschlüssel"
generator = "lookup"
[columns.generator_params]
list = "business_partners"
column = "partner_id"

[[columns]]
name = "partner_name"
type = "string"
pk = false
fk = false
description = "Name aus **derselben** Listenzeile wie `partner_id`"
generator = "lookup"
[columns.generator_params]
list = "business_partners"
column = "partner_name"

[[columns]]
name = "segment"
type = "string"
pk = false
fk = false
description = "Segment aus **derselben** Listenzeile — passt damit immer zum Partner"
generator = "lookup"
[columns.generator_params]
list = "business_partners"
column = "segment"

[[columns]]
name = "credit_limit"
type = "decimal"
pk = false
fk = false
description = "Kreditlimit — **Random Float** `5.000 … 750.000`; frei erzeugt, nicht aus der Liste"
generator = "random-float"
[columns.generator_params]
min = "5000"
max = "750000"
decimals = "2"

[[columns]]
name = "created_at"
type = "datetime"
pk = false
fk = false
description = "Anlagezeitpunkt — Standard des Datentyps `datetime`"
generator = "default"
