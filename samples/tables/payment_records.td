# Datenschmiede Tabellendefinition
schema = "shop.batch"
name = "payment_records"
description = """
**Beispiel für feste Satzlänge** — eine Zahlungsdatei im Stil klassischer
Bankformate (DTAUS/ACH). Die Felder stehen **ohne Trennzeichen**
nebeneinander; allein Reihenfolge und Breite bestimmen, wo ein Wert beginnt
und endet. Der Tab **„Satzaufbau“** zeigt je Feld die Startposition, die
Breite, die Ausrichtung und das Füllzeichen sowie unten die resultierende
**Satzlänge**.

Bemerkenswertes an diesem Aufbau:

- `record_type` ist ein **fester Kennsatz** (`50`) — zwei Zeichen, mit
  Nullen aufgefüllt
- `amount_cents` und `sequence_no` sind **rechtsbündig mit Nullen**
  aufgefüllt, wie es Betrags- und Zählerfelder verlangen
- `beneficiary` und `purpose` sind **linksbündig mit Leerzeichen** — zu
  lange Werte werden abgeschnitten, damit die Folgefelder an ihrer Position
  bleiben
- `value_date` nutzt das Datumsformat `%Y%m%d` (acht Zeichen, ohne
  Trennzeichen) aus den Ausgabe-Einstellungen
- `internal_ref` ist **ausgeblendet** und taucht im Satzaufbau nicht auf

Der Knopf **„Dokument-Vorschau“** im Satzaufbau zeigt 20 Sätze so, wie der
Lauf sie schreiben würde — die beste Kontrolle dafür, ob die Spalten
tatsächlich untereinander stehen.
"""

[output]
file_name = "zahlungen_{date}"
format = "fixed"

[output.csv]
delimiter = ";"
quote_all = true
decimal = "."
date_format = "%Y-%m-%d"
datetime_format = "%Y-%m-%d %H:%M:%S"
include_header = true
encoding = "utf-8"

[output.fixed]
include_header = false
truncate = true
line_ending = "crlf"
date_format = "%Y%m%d"
datetime_format = "%Y%m%d%H%M%S"
decimal = "."
encoding = "utf-8"

[[output.fixed.fields]]
column = "record_type"
width = 2
align = "right"
pad = "0"

[[output.fixed.fields]]
column = "sequence_no"
width = 8
align = "right"
pad = "0"

[[output.fixed.fields]]
column = "value_date"
width = 8
align = "left"
pad = " "

[[output.fixed.fields]]
column = "iban"
width = 34
align = "left"
pad = " "

[[output.fixed.fields]]
column = "beneficiary"
width = 27
align = "left"
pad = " "

[[output.fixed.fields]]
column = "amount_cents"
width = 12
align = "right"
pad = "0"

[[output.fixed.fields]]
column = "currency"
width = 3
align = "left"
pad = " "

[[output.fixed.fields]]
column = "purpose"
width = 27
align = "left"
pad = " "

[[columns]]
name = "record_type"
type = "string"
pk = false
fk = false
description = "Fester Kennsatz `50` — zwei Zeichen, mit Nullen aufgefüllt"
generator = "combine"
[columns.generator_params]
template = "50"

[[columns]]
name = "sequence_no"
type = "integer"
pk = true
fk = false
description = "Laufende Satznummer — Standard des Datentyps `integer`, rechtsbündig mit Nullen"
generator = "default"

[[columns]]
name = "value_date"
type = "date"
pk = false
fk = false
description = "Wertstellungsdatum — im Satz als `%Y%m%d` (acht Zeichen ohne Trennzeichen)"
generator = "default"

[[columns]]
name = "iban"
type = "string"
pk = false
fk = false
description = "IBAN des Empfängers — benutzerdefinierter Generator `iban`"
generator = "custom:iban"
[columns.generator_params]
country = "DE"
formatted = "false"

[[columns]]
name = "beneficiary"
type = "string"
pk = false
fk = false
description = "Name des Empfängers — Faker-Provider `name`; zu lange Namen werden auf 27 Zeichen gekürzt"
generator = "faker"
[columns.generator_params]
provider = "name"
locale = "de_DE"

[[columns]]
name = "amount_cents"
type = "integer"
pk = false
fk = false
description = "Betrag in Cent — **Random Int** `100 … 999999`, rechtsbündig mit Nullen"
generator = "random-int"
[columns.generator_params]
min = "100"
max = "999999"

[[columns]]
name = "currency"
type = "string"
pk = false
fk = false
description = "Währung aus der Nachschlageliste `countries`"
generator = "lookup"
[columns.generator_params]
list = "countries"
column = "currency"

[[columns]]
name = "purpose"
type = "string"
pk = false
fk = false
description = "Verwendungszweck — Faker-Provider `sentence`, auf 27 Zeichen gekürzt"
generator = "faker"
[columns.generator_params]
provider = "sentence"
locale = "de_DE"

[[columns]]
name = "internal_ref"
type = "uuid"
pk = false
fk = false
hidden = true
description = "Interne Referenz — ausgeblendet, taucht im Satzaufbau nicht auf"
generator = "default"
