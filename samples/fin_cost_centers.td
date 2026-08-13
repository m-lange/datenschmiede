# Datenschmiede Tabellendefinition
schema = "ag.cor.fin"
name = "cost_centers"
description = """
Kostenstellen — Namensraum **ag.cor.fin**, ein Geschwister-Zweig von
ag.cor.sapbp unter demselben "ag.cor"-Namensraum-Knoten. Unabhängig.
"""

[[columns]]
name = "id"
type = "uuid"
pk = true
fk = false
description = "Primärschlüssel"

[[columns]]
name = "code"
type = "string"
pk = false
fk = false
description = "Kostenstellen-Code"

[[columns]]
name = "name"
type = "string"
pk = false
fk = false
description = "Bezeichnung"
