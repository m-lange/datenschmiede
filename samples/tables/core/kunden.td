# Datenschmiede Tabellendefinition
schema = "shop.core"
name = "kunden"
description = """
**Stammtabelle des Beispiels** und Einstieg in fast alle Funktionen: eine
primäre Tabelle ohne ausgehenden Fremdschlüssel, deren Anzahl direkt im
Projekt steht. Alle anderen Verkaufstabellen hängen sich per Fremdschlüssel
daran.

**Was hier zu sehen ist**

- `kunden_nr` als Primärschlüssel aus dem eigenen Generator
  [`laufende_nummer`](../../generators/laufende_nummer.tdgen) — lesbar und
  sortierbar statt zufällig
- `kunden_uuid` ist **ausgeblendet**: Die Spalte wird erzeugt und steht
  überall zur Verfügung (Vorschau, FK-Ziel, Generatoren), landet aber
  **nicht in der Datei** — genau dafür ist das Auge in der Spaltenliste da
- `email` nutzt den eingebauten Generator **Kombination**: Die Vorlage
  `{vorname}.{nachname}@example.de` setzt die Werte anderer Spalten
  desselben Datensatzes zusammen; deren Erzeugungsreihenfolge ergibt sich
  automatisch
- `land` und `waehrung` ziehen aus **derselben Zeile** der Liste
  [`laender`](../../lookups/laender.lkp) — ein Schweizer Kunde bekommt
  garantiert CHF. Dasselbe gilt für `bank_name`, `bic` und die BLZ innerhalb
  der `iban`, die der Generator
  [`iban_de`](../../generators/iban_de.tdgen) aus der Liste
  [`banken`](../../lookups/banken.lkp) zieht
- die CSV-Einstellungen zeigen die deutsche Schreibweise: Semikolon,
  Dezimalkomma, `TT.MM.JJJJ`
"""

[output]
file_name = "kunden_{date}"
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
name = "kunden_nr"
type = "string"
pk = true
fk = false
description = "Kundennummer `K-100000` aufwärts — eigener Generator `laufende_nummer`"
generator = "custom:laufende_nummer"
[columns.generator_params]
prefix = "K-"
start = "100000"
stellen = "6"

[[columns]]
name = "kunden_uuid"
type = "uuid"
pk = false
fk = false
hidden = true
description = "Technische Kennung — **ausgeblendet**: wird erzeugt, aber nicht in die Datei geschrieben"
generator = "default"

[[columns]]
name = "vorname"
type = "string"
pk = false
fk = false
description = "Vorname — Faker-Provider `first_name`, deutsch"
generator = "faker"
[columns.generator_params]
provider = "first_name"
locale = "de_DE"

[[columns]]
name = "nachname"
type = "string"
pk = false
fk = false
description = "Nachname — Faker-Provider `last_name`, deutsch"
generator = "faker"
[columns.generator_params]
provider = "last_name"
locale = "de_DE"

[[columns]]
name = "email"
type = "email"
pk = false
fk = false
description = "E-Mail — **Kombination** aus `vorname` und `nachname` desselben Datensatzes"
generator = "combine"
[columns.generator_params]
template = "{vorname}.{nachname}@example.de"

[[columns]]
name = "telefon"
type = "string"
pk = false
fk = false
description = "Telefonnummer — Faker-Provider `phone_number`"
generator = "faker"
[columns.generator_params]
provider = "phone_number"
locale = "de_DE"

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
name = "land"
type = "string"
pk = false
fk = false
description = "Länderkürzel aus der Liste `laender` — gewichtet gezogen"
generator = "lookup"
[columns.generator_params]
list = "laender"
column = "code"

[[columns]]
name = "waehrung"
type = "string"
pk = false
fk = false
description = "Währung aus **derselben Zeile** wie `land` — passt dadurch immer zum Land"
generator = "lookup"
[columns.generator_params]
list = "laender"
column = "waehrung"

[[columns]]
name = "bank_name"
type = "string"
pk = false
fk = false
description = "Kreditinstitut aus der Liste `banken`"
generator = "lookup"
[columns.generator_params]
list = "banken"
column = "name"

[[columns]]
name = "bic"
type = "string"
pk = false
fk = false
description = "BIC aus **derselben Zeile** wie `bank_name`"
generator = "lookup"
[columns.generator_params]
list = "banken"
column = "bic"

[[columns]]
name = "iban"
type = "string"
pk = false
fk = false
description = "IBAN mit gültiger Prüfziffer — die BLZ stammt aus **derselben Zeile** wie `bank_name`"
generator = "custom:iban_de"
[columns.generator_params]
bankliste = "banken"
blz_spalte = "blz"

[[columns]]
name = "geburtsdatum"
type = "date"
pk = false
fk = false
description = "Geburtsdatum — Faker-Provider `date_of_birth`"
generator = "faker"
[columns.generator_params]
provider = "date_of_birth"
locale = "de_DE"

[[columns]]
name = "newsletter"
type = "boolean"
pk = false
fk = false
description = "Newsletter abonniert — Standard des Datentyps `boolean`"
generator = "default"

[[columns]]
name = "umsatz_gesamt"
type = "decimal"
pk = false
fk = false
description = "Bisheriger Gesamtumsatz — **Zufallszahl** `0 … 25.000` mit zwei Nachkommastellen"
generator = "random-float"
[columns.generator_params]
min = "0"
max = "25000"
decimals = "2"

[[columns]]
name = "bonuspunkte"
type = "integer"
pk = false
fk = false
description = "Punktestand — **Ganzzahl** `0 … 5.000`"
generator = "random-int"
[columns.generator_params]
min = "0"
max = "5000"

[[columns]]
name = "registriert_am"
type = "datetime"
pk = false
fk = false
description = "Anlagezeitpunkt — Standard des Datentyps `datetime`"
generator = "default"

[[columns]]
name = "notiz"
type = "text"
pk = false
fk = false
description = "Freitext — Faker-Provider `sentence`"
generator = "faker"
[columns.generator_params]
provider = "sentence"
locale = "de_DE"
