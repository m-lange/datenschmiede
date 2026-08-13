# Datenschmiede Tabellendefinition
schema = "shop"
name = "customers"
description = """
Kundenstamm des Shop-Beispiels (Namensraum **shop**, eine Ebene). Unabhängig
(keine ausgehende Fremdschlüssel-Beziehung) — braucht im Testdatenprojekt
eine manuell gesetzte Datensatzanzahl. Beispiel für Spaltengeneratoren:
Faker-Namen plus eine kombinierte E-Mail-Adresse.
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
type = "uuid"
pk = true
fk = false
description = "Primärschlüssel"

[[columns]]
name = "first_name"
type = "string"
pk = false
fk = false
description = "Vorname"
generator = "faker"
[columns.generator_params]
provider = "first_name"
locale = "de_DE"

[[columns]]
name = "last_name"
type = "string"
pk = false
fk = false
description = "Nachname"
generator = "faker"
[columns.generator_params]
provider = "last_name"
locale = "de_DE"

[[columns]]
name = "email"
type = "email"
pk = false
fk = false
description = "E-Mail-Adresse — kombiniert aus Vor- und Nachname"
generator = "combine"
[columns.generator_params]
template = "{first_name}.{last_name}@example.com"

[[columns]]
name = "created_at"
type = "datetime"
pk = false
fk = false
description = "Zeitpunkt der Registrierung"
