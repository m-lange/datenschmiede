# Datenschmiede Tabellendefinition
# Generiert aus den Spezifikations-Excels (read_input.py)
schema = "flake_stdfkcorp_radar"
name = "co_produkte"
description = """
Controlling-Produktkatalog
"""

[output]
file_name = "Produktkatalog"
format = "csv"

[output.csv]
delimiter = ";"
include_header = true
encoding = "utf-8"

[[columns]]
name = "id_m_produkt"
type = "integer"
pk = false
fk = false
generator = "default"

[[columns]]
name = "produkt_code"
type = "string"
pk = false
fk = false
description = "[Fachlich identisch mit: flake_ctdfkcorp_radar.co_produkte.produkt_code, flake_ctdfkcorp_radar.iag.co_produkt, flake_stdfkcorp_radar.iag.co_produkt]"
generator = "lookup"
[columns.generator_params]
list = "co_produkt_code"
column = "value"

[[columns]]
name = "produkt_bezeichnung"
type = "string"
pk = false
fk = false
generator = "lookup"
[columns.generator_params]
list = "co_produkt_bezeichnung"
column = "value"

[[columns]]
name = "ebene1"
type = "string"
pk = false
fk = false
generator = "lookup"
[columns.generator_params]
list = "co_ebene1_code"
column = "value"

[[columns]]
name = "ebene1_bez"
type = "string"
pk = false
fk = false
generator = "lookup"
[columns.generator_params]
list = "co_ebene1_bez"
column = "value"

[[columns]]
name = "ebene2"
type = "string"
pk = false
fk = false
generator = "lookup"
[columns.generator_params]
list = "co_ebene2_code"
column = "value"

[[columns]]
name = "ebene2_bez"
type = "string"
pk = false
fk = false
generator = "lookup"
[columns.generator_params]
list = "co_ebene2_bez"
column = "value"

[[columns]]
name = "bva_produktgruppe"
type = "string"
pk = false
fk = false
generator = "lookup"
[columns.generator_params]
list = "bva_produktgruppe"
column = "value"
