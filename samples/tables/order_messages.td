# Datenschmiede Tabellendefinition
schema = "shop.edi"
name = "order_messages"
description = """
**XML-Beispiel** — eine Bestellnachricht im EDI-Stil. Die **Zielstruktur**
(Tab „Schema“) unterscheidet hier drei Knotenarten:

- **Attribut** — `OrderId` und `Currency` hängen als Attribute am
  `<Order>`-Element, `type` am `<Customer>`
- **Objekt** — `Customer` und `Amounts` werden zu verschachtelten Elementen
- **Wert** — die Blätter, die im Tab **„Zuordnung“** eine Spalte (oder
  einen festen Text) bekommen

Geschrieben wird `<Orders><Order …>…</Order>…</Orders>` mit
`<?xml …?>`-Deklaration und zwei Leerzeichen Einrückung. Anders als bei JSON
gibt es hier **keinen Werttyp**: XML kennt nur Text, deshalb fehlt die
Spalte im Schema-Tab.

Der Knopf **„Dokument-Vorschau“** im Zuordnungs-Tab zeigt das fertige XML
für 20 Datensätze — praktisch, um Struktur und Zuordnung zu prüfen, bevor
ein ganzer Lauf startet.
"""

[output]
file_name = "orders_{datetime}"
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
root_element = "Orders"
record_element = "Order"
indent = 2
declaration = true
date_format = "%Y-%m-%d"
datetime_format = "%Y-%m-%dT%H:%M:%S"
encoding = "utf-8"

[[output.xml.nodes]]
path = ["OrderId"]
kind = "attribute"
value_type = "auto"
source_kind = "column"
source = "order_no"

[[output.xml.nodes]]
path = ["Currency"]
kind = "attribute"
value_type = "auto"
source_kind = "column"
source = "currency"

[[output.xml.nodes]]
path = ["OrderDate"]
kind = "value"
value_type = "auto"
source_kind = "column"
source = "order_date"

[[output.xml.nodes]]
path = ["Status"]
kind = "value"
value_type = "auto"
source_kind = "column"
source = "status"

[[output.xml.nodes]]
path = ["Customer"]
kind = "object"

[[output.xml.nodes]]
path = ["Customer", "type"]
kind = "attribute"
value_type = "auto"
source_kind = "constant"
source = "B2C"

[[output.xml.nodes]]
path = ["Customer", "Name"]
kind = "value"
value_type = "auto"
source_kind = "column"
source = "customer_name"

[[output.xml.nodes]]
path = ["Customer", "Country"]
kind = "value"
value_type = "auto"
source_kind = "column"
source = "country_code"

[[output.xml.nodes]]
path = ["Customer", "Iban"]
kind = "value"
value_type = "auto"
source_kind = "column"
source = "iban"

[[output.xml.nodes]]
path = ["Amounts"]
kind = "object"

[[output.xml.nodes]]
path = ["Amounts", "Net"]
kind = "value"
value_type = "auto"
source_kind = "column"
source = "net_amount"

[[output.xml.nodes]]
path = ["Amounts", "Tax"]
kind = "value"
value_type = "auto"
source_kind = "column"
source = "tax_amount"

[[output.xml.nodes]]
path = ["Amounts", "Gross"]
kind = "value"
value_type = "auto"
source_kind = "column"
source = "gross_amount"

[[output.xml.nodes]]
path = ["Reference"]
kind = "value"
value_type = "auto"
source_kind = "column"
source = "reference"

[[output.xml.nodes]]
path = ["MessageType"]
kind = "value"
value_type = "auto"
source_kind = "constant"
source = "ORDERS"

[[columns]]
name = "order_no"
type = "string"
pk = true
fk = false
description = "Fachliche Bestellnummer (`ORD-000001`, …) — benutzerdefinierter Generator `sequential_id`"
generator = "custom:sequential_id"
[columns.generator_params]
prefix = "ORD-"
start = "1"
digits = "6"

[[columns]]
name = "order_date"
type = "date"
pk = false
fk = false
description = "Bestelldatum — Standard des Datentyps `date`, im XML als `%Y-%m-%d`"
generator = "default"

[[columns]]
name = "status"
type = "string"
pk = false
fk = false
description = "Bestellstatus — gewichtet aus der Nachschlageliste `order_status`"
generator = "lookup"
[columns.generator_params]
list = "order_status"
column = "status"

[[columns]]
name = "customer_name"
type = "string"
pk = false
fk = false
description = "Name des Bestellers — Faker-Provider `name` (deutsch)"
generator = "faker"
[columns.generator_params]
provider = "name"
locale = "de_DE"

[[columns]]
name = "country_code"
type = "string"
pk = false
fk = false
description = "Länderkürzel aus der Nachschlageliste `countries`"
generator = "lookup"
[columns.generator_params]
list = "countries"
column = "code"

[[columns]]
name = "currency"
type = "string"
pk = false
fk = false
description = "Währung aus **derselben** Listenzeile wie `country_code` — „CH“ ergibt dadurch immer „CHF“"
generator = "lookup"
[columns.generator_params]
list = "countries"
column = "currency"

[[columns]]
name = "iban"
type = "string"
pk = false
fk = false
description = "IBAN mit gültiger Prüfziffer — benutzerdefinierter Generator `iban`"
generator = "custom:iban"
[columns.generator_params]
country = "DE"
formatted = "false"

[[columns]]
name = "net_amount"
type = "decimal"
pk = false
fk = false
description = "Nettobetrag — **Random Float** `10 … 2.500`, 2 Nachkommastellen"
generator = "random-float"
[columns.generator_params]
min = "10"
max = "2500"
decimals = "2"

[[columns]]
name = "tax_amount"
type = "decimal"
pk = false
fk = false
description = "Steuerbetrag — **Random Float**, bewusst unabhängig vom Nettobetrag gezogen"
generator = "random-float"
[columns.generator_params]
min = "0.7"
max = "475"
decimals = "2"

[[columns]]
name = "gross_amount"
type = "decimal"
pk = false
fk = false
description = "Bruttobetrag — eigener **Random Float**; die drei Beträge werden bewusst unabhängig gezogen"
generator = "random-float"
[columns.generator_params]
min = "10.7"
max = "2975"
decimals = "2"

[[columns]]
name = "reference"
type = "string"
pk = false
fk = false
description = "Belegreferenz — **Combine** aus Bestellnummer und Länderkürzel"
generator = "combine"
[columns.generator_params]
template = "{order_no}/{country_code}"
