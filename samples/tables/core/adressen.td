# Datenschmiede Tabellendefinition
schema = "shop.core"
name = "adressen"
description = """
**Beispiel für den Dateityp „Temporäre Tabelle“.** Die Datensätze werden ganz
normal erzeugt — andere Tabellen können sie per Fremdschlüssel
referenzieren, Generatoren können sie lesen —, aber es wird **keine Datei
geschrieben**. Im Übersicht-Tab steht deshalb an der Stelle des Dateinamens
ein Hinweis statt einer Endung, und in der Übersicht „Generierte Dateien“
taucht diese Tabelle ohne Zieldatei auf.

Hier dient sie als reiner **Wertevorrat**: Der eigene Generator
[`fremdwert`](../../generators/fremdwert.tdgen) zieht in
[`shop.sales.bestellungen`](../sales/bestellungen.td) zufällige Lieferstädte
daraus. Weil er die Tabelle über einen Parameter vom Typ `table`
referenziert, wird sie im Projekt-Editor **automatisch mitgewählt** (und
dort gesperrt) und **vor** den Bestellungen erzeugt.

Genau dafür ist der Dateityp gedacht: Zwischenergebnisse, Hilfstabellen und
Wertevorräte, die zum Erzeugen gebraucht werden, aber nicht ausgeliefert
werden sollen.
"""

[output]
file_name = "adressen"
format = "temp"

[output.csv]
delimiter = ";"
quote_all = true
decimal = "."
date_format = "%Y-%m-%d"
datetime_format = "%Y-%m-%d %H:%M:%S"
include_header = true
encoding = "utf-8"

[[columns]]
name = "adress_id"
type = "integer"
pk = true
fk = false
description = "Fortlaufende Kennung — Standard des Datentyps `integer`"
generator = "default"

[[columns]]
name = "strasse"
type = "string"
pk = false
fk = false
description = "Straße und Hausnummer — Faker-Provider `street_address`"
generator = "faker"
[columns.generator_params]
provider = "street_address"
locale = "de_DE"

[[columns]]
name = "plz"
type = "string"
pk = false
fk = false
description = "Postleitzahl — Faker-Provider `postcode`"
generator = "faker"
[columns.generator_params]
provider = "postcode"
locale = "de_DE"

[[columns]]
name = "stadt"
type = "string"
pk = false
fk = false
description = "Ort — Faker-Provider `city`; dieser Vorrat wird von `fremdwert` gezogen"
generator = "faker"
[columns.generator_params]
provider = "city"
locale = "de_DE"

[[columns]]
name = "land"
type = "string"
pk = false
fk = false
description = "Länderkürzel aus der Liste `laender`"
generator = "lookup"
[columns.generator_params]
list = "laender"
column = "code"
