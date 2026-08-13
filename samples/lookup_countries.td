# Datenschmiede Tabellendefinition
schema = ""
name = "countries"
description = """
Ländercode-Nachschlagetabelle ohne Schema — landet im Testdatenprojekt-
Tabellenbaum auf der Wurzelebene statt in einem Namensraum.
"""

[[columns]]
name = "id"
type = "uuid"
pk = true
fk = false
description = "Primärschlüssel"

[[columns]]
name = "iso_code"
type = "string"
pk = false
fk = false
description = "ISO-3166-1-Alpha-2-Code, z. B. \"DE\""

[[columns]]
name = "name"
type = "string"
pk = false
fk = false
description = "Ländername"
