# Datenschmiede Tabellendefinition
schema = "ag.cor.fin"
name = "cost_centers"
description = """
Kostenstellen — Namensraum **ag.cor.fin**, ein Geschwister-Zweig von
ag.cor.sapbp unter demselben "ag.cor"-Namensraum-Knoten. Unabhängig.
"""

[output]
file_name = ""
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
generator = "custom:table_sample"
[columns.generator_params]
source_table = "ag.cor.fin.cost_centers"
prefix = "ABC"
source_column = "id"

[[columns]]
name = "code"
type = "string"
pk = false
fk = false
description = "Kostenstellen-Code"
generator = "random-int"
[columns.generator_params]
min = "1"
max = "100"

[[columns]]
name = "name"
type = "string"
pk = false
fk = false
description = "Bezeichnung"
generator = "random-float"
[columns.generator_params]
min = "0"
max = "1000"
decimals = "2"
