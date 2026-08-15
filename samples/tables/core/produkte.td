# Datenschmiede Tabellendefinition
schema = "shop.core"
name = "produkte"
description = """
**Sortiment** — die erste Tabelle mit einem ausgehenden Fremdschlüssel und
damit mit einer **Kardinalität**: Im Projekt steht `40..80`, also 40 bis 80
Produkte **je Warengruppe**. Bei acht Gruppen erwartet die Übersicht
„Generierte Dateien“ deshalb `320..640` Datensätze — eine feste Zahl stünde
dort nur bei einer primären Tabelle.

**Was hier zu sehen ist**

- `gruppe_id` ist die **treibende** FK-Spalte: die erste ausgehende
  FK-Spalte einer Tabelle bestimmt, worauf sich die Kardinalität bezieht.
  Sie bekommt automatisch den Generator **Fremdschlüssel**, der die Werte
  aus der referenzierten Spalte zieht
- `ean` entsteht aus der Artikelnummer über den eigenen Generator
  [`ean13`](../../generators/ean13.tdgen) — Parametertyp `own_column`:
  `artikel_nr` wird garantiert **vorher** erzeugt
- `gewicht_kg` ist `float` mit drei Nachkommastellen, `listenpreis`
  `decimal` mit zweien — die Nachkommastellen sind ein Parameter des
  Generators, nicht des Datentyps
"""

[output]
file_name = "produkte_{date}"
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
name = "artikel_nr"
type = "string"
pk = true
fk = false
description = "Artikelnummer `A-001000` aufwärts — eigener Generator `laufende_nummer`"
generator = "custom:laufende_nummer"
[columns.generator_params]
prefix = "A-"
start = "1000"
stellen = "6"

[[columns]]
name = "gruppe_id"
type = "string"
pk = false
fk = true
fk_table = "shop.core.warengruppen"
fk_column = "gruppe_id"
description = "Warengruppe — **treibende** FK-Spalte: die Kardinalität `40..80` gilt je Warengruppe"

[[columns]]
name = "ean"
type = "string"
pk = false
fk = false
description = "EAN-13 mit gültiger Prüfziffer, abgeleitet aus `artikel_nr` — eigener Generator `ean13`"
generator = "custom:ean13"
[columns.generator_params]
quell_spalte = "artikel_nr"
laendercode = "400"

[[columns]]
name = "bezeichnung"
type = "string"
pk = false
fk = false
description = "Produktname — Faker-Provider `word`"
generator = "faker"
[columns.generator_params]
provider = "word"
locale = "de_DE"

[[columns]]
name = "listenpreis"
type = "decimal"
pk = false
fk = false
description = "Listenpreis — `4,90 … 1.899,00` mit zwei Nachkommastellen"
generator = "random-float"
[columns.generator_params]
min = "4.9"
max = "1899"
decimals = "2"

[[columns]]
name = "gewicht_kg"
type = "float"
pk = false
fk = false
description = "Versandgewicht — `0,05 … 25` kg mit drei Nachkommastellen"
generator = "random-float"
[columns.generator_params]
min = "0.05"
max = "25"
decimals = "3"

[[columns]]
name = "lagerbestand"
type = "integer"
pk = false
fk = false
description = "Verfügbare Stückzahl — Ganzzahl `0 … 900`"
generator = "random-int"
[columns.generator_params]
min = "0"
max = "900"

[[columns]]
name = "aufgenommen_am"
type = "date"
pk = false
fk = false
description = "Aufnahme ins Sortiment — Standard des Datentyps `date`"
generator = "default"

[[columns]]
name = "aktiv"
type = "boolean"
pk = false
fk = false
description = "Aktiv im Verkauf — Standard des Datentyps `boolean`"
generator = "default"
