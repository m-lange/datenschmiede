# Datenschmiede Tabellendefinition
# Generiert aus den Spezifikations-Excels (read_input.py)
schema = "flake_stdfkcorp_radar"
name = "verbundkunden"
description = """
Liste von Verbundkunden der Genossenschaftlichen FinanzGruppe
"""

[output]
file_name = "Verbundkunden"
format = "csv"

[output.csv]
delimiter = ";"
include_header = true
encoding = "utf-8"

[[columns]]
name = "gp_nr"
type = "string"
pk = false
fk = false
description = "Geschäftspartner-Nr."
generator = "default"
