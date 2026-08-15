# Datenschmiede Tabellendefinition
schema = "shop.core"
name = "warengruppen"
description = """
**Beispiel für eine führende Nachschlageliste.** Im Übersicht-Tab ist unter
**„Führende Nachschlageliste“** die Liste
[`warengruppen`](../../lookups/warengruppen.lkp) ausgewählt. Damit gilt für
diese Tabelle:

- sie bekommt **genau einen Datensatz je Zeile** der Liste — hier acht —,
  jede Zeile **genau einmal** und in Listenreihenfolge; nicht gezogen, nicht
  wiederholt
- die **Datensatzanzahl kommt aus der Liste**, nicht aus dem Projekt; im
  Projekt-Editor bleibt das Anzahl-Feld dieser Tabelle deshalb leer
- alle Nachschlage-Spalten lesen **dieselbe Zeile**: `gruppe_id`,
  `bezeichnung` und `marge_prozent` eines Datensatzes gehören immer
  zusammen

Genau das braucht man, wenn eine **vorgegebene Schlüsselliste** die
Grundlage bilden soll: die Liste einmal pflegen, und abhängige Tabellen
hängen sich per Fremdschlüssel daran — hier
[`shop.core.produkte`](produkte.td). Weil jede Zeile genau einmal vorkommt,
bleibt `gruppe_id` ein echter Primärschlüssel.

Die Spalte `aktiv` zeigt, dass die übrigen Spalten wie gewohnt zufällig
erzeugt werden: Die Liste bestimmt nur, *wie viele* Datensätze es gibt und
was in den zugeordneten Spalten steht.
"""
driving_lookup = "warengruppen"

[output]
file_name = "warengruppen"
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
name = "gruppe_id"
type = "string"
pk = true
fk = false
description = "Warengruppenschlüssel **aus der führenden Liste** — jede Zeile genau einmal, also ein echter Primärschlüssel"
generator = "lookup"
[columns.generator_params]
list = "warengruppen"
column = "gruppe_id"

[[columns]]
name = "bezeichnung"
type = "string"
pk = false
fk = false
description = "Bezeichnung aus **derselben** Listenzeile wie `gruppe_id`"
generator = "lookup"
[columns.generator_params]
list = "warengruppen"
column = "bezeichnung"

[[columns]]
name = "marge_prozent"
type = "float"
pk = false
fk = false
description = "Kalkulationsmarge aus **derselben** Listenzeile — Datentyp `float`"
generator = "lookup"
[columns.generator_params]
list = "warengruppen"
column = "marge_prozent"

[[columns]]
name = "aktiv"
type = "boolean"
pk = false
fk = false
description = "Gruppe im Sortiment — frei erzeugt, nicht aus der Liste"
generator = "default"
