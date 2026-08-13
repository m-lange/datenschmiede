# Datenschmiede Tabellendefinition
schema = "hr.core"
name = "employee_positions"
description = """
Verknüpfungstabelle Mitarbeitende <-> Stellenprofile — referenziert sowohl
**hr.core.employees** als auch **hr.core.positions** (Kette über drei
Ebenen bis hinunter zu hr.core.departments).
"""

[[columns]]
name = "id"
type = "uuid"
pk = true
fk = false
description = "Primärschlüssel"

[[columns]]
name = "employee_id"
type = "uuid"
pk = false
fk = true
fk_table = "hr.core.employees"
fk_column = "id"
description = "Mitarbeitende Person"

[[columns]]
name = "position_id"
type = "uuid"
pk = false
fk = true
fk_table = "hr.core.positions"
fk_column = "id"
description = "Zugewiesenes Stellenprofil"

[[columns]]
name = "valid_from"
type = "date"
pk = false
fk = false
description = "Gültig ab"
