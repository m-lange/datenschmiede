# Datenschmiede Tabellendefinition
schema = "shop.export"
name = "bestellnachricht"
description = """
**XML-Beispiel** — dieselbe Zielstruktur-Mechanik wie bei JSON, aber mit den
XML-eigenen Knotenarten. Gepflegt wird sie im Tab **„XML-Struktur“**, die
**Dokument-Vorschau** zeigt das fertige XML ohne Lauf.

Geschrieben wird `<Auftraege>` mit je einem `<Auftrag>` pro Datensatz:

- `Nr` und `Waehrung` sind **Attribute** (Knotenart *Attribut*, im Baum am
  `@` erkennbar) — sie stehen im öffnenden Tag statt als eigene Elemente
- `Kunde` ist ein **Objekt** mit einem eigenen Attribut `art` als **festem
  Text** und drei Kindelementen
- `Merkmal` ist ein **Array**: Ein Array schreibt in XML ein **wiederholtes
  Element mit dem Namen des Arrays** — aus zwei Kindern werden also
  `<Merkmal>…</Merkmal><Merkmal>…</Merkmal>`
- `Referenz` steht **zweimal als Geschwisterknoten** mit demselben Namen.
  Das ist erlaubt und bleibt erhalten: Die Verschachtelung wird in der
  Datei über `depth` abgebildet, nicht über einen Namenspfad, der zwei
  gleichnamige Knoten zu einem zusammenfallen ließe

Der Dateiname nutzt `{timestamp}` — die Unix-Zeit des Laufs, praktisch,
wenn mehrere Läufe pro Sekunde unterscheidbar bleiben sollen.
"""

[output]
file_name = "auftraege_{timestamp}"
format = "xml"

[output.csv]
delimiter = ";"
quote_all = true
decimal = "."
date_format = "%Y-%m-%d"
datetime_format = "%Y-%m-%d %H:%M:%S"
include_header = true
encoding = "utf-8"

[output.xml]
root_element = "Auftraege"
record_element = "Auftrag"
indent = 2
declaration = true
date_format = "%Y-%m-%d"
datetime_format = "%Y-%m-%dT%H:%M:%S"
encoding = "utf-8"

[[output.xml.nodes]]
name = "Nr"
kind = "attribute"
value_type = "auto"
source_kind = "column"
source = "auftrags_nr"

[[output.xml.nodes]]
name = "Waehrung"
kind = "attribute"
value_type = "auto"
source_kind = "column"
source = "waehrung"

[[output.xml.nodes]]
name = "Datum"
kind = "value"
value_type = "auto"
source_kind = "column"
source = "auftragsdatum"

[[output.xml.nodes]]
name = "Status"
kind = "value"
value_type = "auto"
source_kind = "column"
source = "status"

[[output.xml.nodes]]
name = "Kunde"
kind = "object"

[[output.xml.nodes]]
name = "art"
kind = "attribute"
depth = 1
value_type = "auto"
source_kind = "constant"
source = "B2C"

[[output.xml.nodes]]
name = "Name"
kind = "value"
depth = 1
value_type = "auto"
source_kind = "column"
source = "kunde_name"

[[output.xml.nodes]]
name = "Land"
kind = "value"
depth = 1
value_type = "auto"
source_kind = "column"
source = "land"

[[output.xml.nodes]]
name = "Iban"
kind = "value"
depth = 1
value_type = "auto"
source_kind = "column"
source = "iban"

[[output.xml.nodes]]
name = "Betraege"
kind = "object"

[[output.xml.nodes]]
name = "Netto"
kind = "value"
depth = 1
value_type = "auto"
source_kind = "column"
source = "netto"

[[output.xml.nodes]]
name = "Steuer"
kind = "value"
depth = 1
value_type = "auto"
source_kind = "column"
source = "steuer"

[[output.xml.nodes]]
name = "Brutto"
kind = "value"
depth = 1
value_type = "auto"
source_kind = "column"
source = "brutto"

[[output.xml.nodes]]
name = "Merkmal"
kind = "array"

[[output.xml.nodes]]
name = "segment"
kind = "value"
depth = 1
value_type = "auto"
source_kind = "column"
source = "segment"

[[output.xml.nodes]]
name = "kanal"
kind = "value"
depth = 1
value_type = "auto"
source_kind = "constant"
source = "webshop"

[[output.xml.nodes]]
name = "Referenz"
kind = "value"
value_type = "auto"
source_kind = "column"
source = "referenz_intern"

[[output.xml.nodes]]
name = "Referenz"
kind = "value"
value_type = "auto"
source_kind = "column"
source = "referenz_extern"

[[columns]]
name = "auftrags_nr"
type = "string"
pk = true
fk = false
description = "Auftragsnummer `AU-00001` aufwärts — eigener Generator `laufende_nummer`"
generator = "custom:laufende_nummer"
[columns.generator_params]
prefix = "AU-"
start = "1"
stellen = "6"

[[columns]]
name = "auftragsdatum"
type = "date"
pk = false
fk = false
description = "Auftragsdatum — Standard des Datentyps `date`"
generator = "default"

[[columns]]
name = "status"
type = "string"
pk = false
fk = false
description = "Bearbeitungsstand aus der Liste `bestellstatus`"
generator = "lookup"
[columns.generator_params]
list = "bestellstatus"
column = "code"

[[columns]]
name = "kunde_name"
type = "string"
pk = false
fk = false
description = "Name des Bestellers — Faker-Provider `name`"
generator = "faker"
[columns.generator_params]
provider = "name"
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

[[columns]]
name = "waehrung"
type = "string"
pk = false
fk = false
description = "Währung aus **derselben Zeile** wie `land` — steht als Attribut im Tag"
generator = "lookup"
[columns.generator_params]
list = "laender"
column = "waehrung"

[[columns]]
name = "iban"
type = "string"
pk = false
fk = false
description = "IBAN mit gültiger Prüfziffer — eigener Generator `iban_de`"
generator = "custom:iban_de"
[columns.generator_params]
bankliste = "banken"
blz_spalte = "blz"

[[columns]]
name = "netto"
type = "decimal"
pk = false
fk = false
description = "Nettobetrag — `19,00 … 4.800,00`"
generator = "random-float"
[columns.generator_params]
min = "19"
max = "4800"
decimals = "2"

[[columns]]
name = "steuer"
type = "decimal"
pk = false
fk = false
description = "Steuerbetrag — `0,00 … 912,00`"
generator = "random-float"
[columns.generator_params]
min = "0"
max = "912"
decimals = "2"

[[columns]]
name = "brutto"
type = "decimal"
pk = false
fk = false
description = "Bruttobetrag — `19,00 … 5.712,00`"
generator = "random-float"
[columns.generator_params]
min = "19"
max = "5712"
decimals = "2"

[[columns]]
name = "segment"
type = "string"
pk = false
fk = false
description = "Kundensegment aus `netto` — erster Eintrag des Arrays `Merkmal`"
generator = "custom:wertklasse"
[columns.generator_params]
eigene_spalte = "netto"
grenze_1 = "500"
grenze_2 = "2000"
bezeichner = "klein/mittel/gross"

[[columns]]
name = "referenz_intern"
type = "string"
pk = false
fk = false
description = "Interne Referenz — erstes der beiden gleichnamigen `Referenz`-Elemente"
generator = "custom:laufende_nummer"
[columns.generator_params]
prefix = "INT-"
start = "5000"
stellen = "6"

[[columns]]
name = "referenz_extern"
type = "uuid"
pk = false
fk = false
description = "Externe Referenz — zweites `Referenz`-Element, gleicher Name, eigener Wert"
generator = "default"
