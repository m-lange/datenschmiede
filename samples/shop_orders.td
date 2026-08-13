# Datenschmiede Tabellendefinition
schema = "shop"
name = "orders"
description = """
Bestellungen — referenziert **shop.customers**. Wird ein Testdatenprojekt-
Tabellenbaum-Eintrag für shop.orders ausgewählt, wird shop.customers
automatisch mit ausgewählt (und lässt sich nicht mehr abwählen). Die
Datensatzanzahl von shop.orders selbst wird über die Kardinalität hier
abgeleitet, statt manuell gesetzt zu werden. Beispiel für den
Nachschagelisten-Generator (Status) und einen benutzerdefinierten
Generator aus einer .tdgen-Datei (Bestellnummer).
"""

[output]
file_name = "orders_{timestamp}"
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
name = "order_number"
type = "string"
pk = false
fk = false
description = "Fortlaufende Bestellnummer (benutzerdefinierter Generator order_number.tdgen)"
generator = "custom:order_number"
[columns.generator_params]
prefix = "ORD-"
start = "1000"
digits = "6"

[[columns]]
name = "customer_id"
type = "uuid"
pk = false
fk = true
fk_table = "shop.customers"
fk_column = "id"
description = "Bestellender Kunde — je Kunde 1 bis 5 Bestellungen"
generator = "foreign-key"

[[columns]]
name = "order_date"
type = "date"
pk = false
fk = false
description = "Bestelldatum"

[[columns]]
name = "status"
type = "string"
pk = false
fk = false
description = "Status, gewichtet aus der Nachschlageliste order_status"
generator = "lookup"
[columns.generator_params]
list = "order_status"
column = "status"

[[columns]]
name = "amount"
type = "decimal"
pk = false
fk = false
description = "Bestellwert in Euro"
generator = "random-float"
[columns.generator_params]
min = "9.90"
max = "499.90"
decimals = "2"
