# Datenschmiede Tabellendefinition
schema = "hr.core"
name = "departments"
description = """
Abteilungen — Namensraum **hr.core** (zwei Ebenen: "hr" -> "core").
Unabhängig, braucht eine manuell gesetzte Datensatzanzahl.
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
description = "Abteilungsname"

[[columns]]
name = "cost_center"
type = "string"
pk = false
fk = false
description = "Kostenstelle"
