# Datenschmiede Tabellendefinition
schema = "shop.core"
name = "customers"
description = """
**Kundenstamm** des Webshop-Beispiels — eine *primäre* Tabelle ohne
ausgehende Fremdschlüssel: ihre Gesamtanzahl wird im Testdatenprojekt fest
vorgegeben (hier 25.000), alle Bestell-Tabellen hängen über FK-Ketten an ihr.

Die Spalten zeigen die wichtigsten **eingebauten Generatoren** im
Zusammenspiel:

- `id`: benutzerdefinierter Generator `sequential_id` — lesbare, eindeutige
  Kennungen wie `CUST-000001`
- `first_name` / `last_name`: **Faker** mit Locale `de_DE`
- `email`: **Kombinieren** — Vorlage `{first_name}.{last_name}@example.com`
  über die Werte der beiden Namens-Spalten (die dadurch automatisch *vor*
  der E-Mail generiert werden)
- `country`: **Nachschlageliste** `countries`, gewichtete Länderkürzel
- `bundesland` / `stadt` / `plz`: **Nachschlageliste** `bundeslaender` —
  drei Spalten aus *derselben* Liste lesen je Datensatz **dieselbe Zeile**:
  Bundesland, Stadt und Postleitzahl passen immer zusammen (die Adresse
  ist bewusst immer deutsch, unabhängig vom `country`-Kürzel)
- `iban`: benutzerdefinierter Generator `iban` — zufällige deutsche IBANs
  mit **gültigen Prüfziffern** (mod 97-10)
- `newsletter` / `created_at`: Faker-Provider `boolean` bzw.
  `date_time_this_year`

Der Dateiname der Ausgabe kombiniert festen Text mit der Variable
`{date}`; die CSV-Einstellungen entsprechen dem deutschen Standard
(Semikolon, alles in Anführungszeichen).
"""

[output]
file_name = "customers_{date}"
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
type = "string"
pk = true
fk = false
description = "Primärschlüssel — fortlaufende Kundennummer (`CUST-000001`, `CUST-000002`, …)"
generator = "custom:sequential_id"
[columns.generator_params]
prefix = "CUST-"
start = "1"
digits = "6"

[[columns]]
name = "first_name"
type = "string"
pk = false
fk = false
description = "Vorname — realistische deutsche Vornamen via **Faker** (`de_DE`)"
generator = "faker"
[columns.generator_params]
provider = "first_name"
locale = "de_DE"

[[columns]]
name = "last_name"
type = "string"
pk = false
fk = false
description = "Nachname — realistische deutsche Nachnamen via **Faker** (`de_DE`)"
generator = "faker"
[columns.generator_params]
provider = "last_name"
locale = "de_DE"

[[columns]]
name = "email"
type = "email"
pk = false
fk = false
description = "E-Mail-Adresse — **kombiniert** aus Vor- und Nachname (`{first_name}.{last_name}@example.com`)"
generator = "combine"
[columns.generator_params]
template = "{first_name}.{last_name}@example.com"

[[columns]]
name = "country"
type = "string"
pk = false
fk = false
description = "Länderkürzel — gewichtet aus der **Nachschlageliste** `countries` (Spalte `code`)"
generator = "lookup"
[columns.generator_params]
list = "countries"
column = "code"

[[columns]]
name = "bundesland"
type = "string"
pk = false
fk = false
description = "Bundesland — **Nachschlageliste** `bundeslaender`, bevölkerungsgewichtet; liest je Datensatz dieselbe Listen-Zeile wie `stadt` und `plz`"
generator = "lookup"
[columns.generator_params]
list = "bundeslaender"
column = "bundesland"

[[columns]]
name = "stadt"
type = "string"
pk = false
fk = false
description = "Stadt — aus **derselben Listen-Zeile** wie `bundesland` (Zeilen-Konsistenz des Lookup-Generators)"
generator = "lookup"
[columns.generator_params]
list = "bundeslaender"
column = "stadt"

[[columns]]
name = "plz"
type = "string"
pk = false
fk = false
description = "Postleitzahl der Stadt — als **String**, damit führende Nullen (`04109` Leipzig) erhalten bleiben; ebenfalls aus derselben Listen-Zeile"
generator = "lookup"
[columns.generator_params]
list = "bundeslaender"
column = "plz"

[[columns]]
name = "iban"
type = "string"
pk = false
fk = false
description = "Bankverbindung — benutzerdefinierter Generator `iban`: zufällige deutsche IBANs mit **gültigen Prüfziffern** (ISO 7064, mod 97-10)"
generator = "custom:iban"
[columns.generator_params]
country = "DE"

[[columns]]
name = "newsletter"
type = "boolean"
pk = false
fk = false
description = "Newsletter abonniert? — Faker-Provider `boolean`"
generator = "faker"
[columns.generator_params]
provider = "boolean"

[[columns]]
name = "created_at"
type = "datetime"
pk = false
fk = false
description = "Zeitpunkt der Registrierung — Faker-Provider `date_time_this_year`"
generator = "faker"
[columns.generator_params]
provider = "date_time_this_year"
