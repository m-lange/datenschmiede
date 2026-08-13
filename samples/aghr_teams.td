# Datenschmiede Tabellendefinition
schema = "ag.hr"
name = "teams"
description = """
Teams — Namensraum **ag.hr** (zwei Ebenen), ein weiterer Zweig unter dem
"ag"-Namensraum-Knoten neben ag.cor.*. Unabhängig.
"""

[[columns]]
name = "id"
type = "uuid"
pk = true
fk = false
description = "Primärschlüssel"

[[columns]]
name = "name"
type = "string"
pk = false
fk = false
description = "Teamname"
