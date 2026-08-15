# Datenschmiede Tabellendefinition
schema = "shop.sales"
name = "lieferungen"
description = """
**Die anspruchsvollste Tabelle des Beispiels** — genau eine Lieferung je
Bestellung (Kardinalität `1`), aber mit zwei Rechenoperationen über den
ganzen Datenbestand.

**Was hier zu sehen ist**

- `empfaenger` und `empfaenger_land` gehen über **zwei Fremdschlüssel
  hinweg**: Der Pfad `bestell_nr.kunden_nr` führt von der Lieferung über
  die Bestellung bis zum Kunden. Der Generator
  [`elternwert`](../../generators/elternwert.tdgen) liefert den Wert genau
  des Datensatzes am Ende der Kette
- `menge_gesamt` ist eine **Aggregation**: der Generator
  [`positionssumme`](../../generators/positionssumme.tdgen) summiert
  `menge` aller Positionen dieser Bestellung — `SUM(...) GROUP BY
  bestell_nr`, vektorisiert über pandas
- `sendungsklasse` klassifiziert diese Summe mit
  [`wertklasse`](../../generators/wertklasse.tdgen) in `S`/`M`/`L`; der
  Parametertyp `own_column` sorgt dafür, dass `menge_gesamt` **vorher**
  erzeugt wird
- `versandzeit` ist der Datentyp `time` — die einzige Spalte des Beispiels
  mit reiner Uhrzeit

**Warum die Aggregation hier steht und nicht in `bestellungen`**: Die
Positionen referenzieren die Bestellungen. Eine Summe über die Positionen
*in* den Bestellungen wäre ein Zyklus — beide Tabellen müssten zuerst
erzeugt werden. Die Problems-Ansicht meldet so etwas als zirkuläre
Referenz. Die Lieferungen werden dagegen ohnehin **nach** den Positionen
erzeugt.
"""

[output]
file_name = "lieferungen_{datetime}"
format = "csv"

[output.csv]
delimiter = ";"
quote_all = true
decimal = ","
date_format = "%d.%m.%Y"
datetime_format = "%d.%m.%Y %H:%M:%S"
include_header = true
encoding = "utf-8"

[[columns]]
name = "liefer_nr"
type = "string"
pk = true
fk = false
description = "Lieferscheinnummer `L-00000001` aufwärts — eigener Generator `laufende_nummer`"
generator = "custom:laufende_nummer"
[columns.generator_params]
prefix = "L-"
start = "1"
stellen = "8"

[[columns]]
name = "bestell_nr"
type = "string"
pk = false
fk = true
fk_table = "shop.sales.bestellungen"
fk_column = "bestell_nr"
description = "Zugehörige Bestellung — Kardinalität `1`, also genau eine Lieferung je Bestellung"

[[columns]]
name = "empfaenger"
type = "string"
pk = false
fk = false
description = "Nachname des Kunden — über **zwei** Fremdschlüssel: `bestell_nr` → `kunden_nr`"
generator = "custom:elternwert"
[columns.generator_params]
fk_pfad = "bestell_nr.kunden_nr"
spalte = "nachname"

[[columns]]
name = "empfaenger_land"
type = "string"
pk = false
fk = false
description = "Land des Kunden — derselbe zweistufige Pfad, andere Zielspalte"
generator = "custom:elternwert"
[columns.generator_params]
fk_pfad = "bestell_nr.kunden_nr"
spalte = "land"

[[columns]]
name = "versanddatum"
type = "date"
pk = false
fk = false
description = "Versanddatum — Standard des Datentyps `date`"
generator = "default"

[[columns]]
name = "versandzeit"
type = "time"
pk = false
fk = false
description = "Übergabe an den Dienstleister — Datentyp `time`, reine Uhrzeit"
generator = "default"

[[columns]]
name = "menge_gesamt"
type = "integer"
pk = false
fk = false
description = "**Summe** der Positionsmengen dieser Bestellung — Generator `positionssumme`"
generator = "custom:positionssumme"
[columns.generator_params]
quelltabelle = "shop.sales.positionen"
wertspalte = "menge"
gruppenspalte = "bestell_nr"
eigene_spalte = "bestell_nr"

[[columns]]
name = "sendungsklasse"
type = "string"
pk = false
fk = false
description = "Größenklasse aus `menge_gesamt` — `S` unter 5, `M` bis 20, `L` darüber"
generator = "custom:wertklasse"
[columns.generator_params]
eigene_spalte = "menge_gesamt"
grenze_1 = "5"
grenze_2 = "20"
bezeichner = "S/M/L"

[[columns]]
name = "zustellversuche"
type = "integer"
pk = false
fk = false
description = "Anzahl Zustellversuche — Ganzzahl `1 … 3`"
generator = "random-int"
[columns.generator_params]
min = "1"
max = "3"

[[columns]]
name = "zugestellt"
type = "boolean"
pk = false
fk = false
description = "Erfolgreich zugestellt — Standard des Datentyps `boolean`"
generator = "default"
