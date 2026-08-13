# Datenschmiede Tabellendefinition
schema = "hr.core"
name = "positions"
description = """
Stellenprofile — ebenfalls Namensraum **hr.core**, unabhängig.
"""

[[columns]]
name = "id"
type = "uuid"
pk = true
fk = false
description = "Primärschlüssel"

[[columns]]
name = "title"
type = "string"
pk = false
fk = false
description = "Stellenbezeichnung"

[[columns]]
name = "level"
type = "integer"
pk = false
fk = false
description = "Karrierestufe"
