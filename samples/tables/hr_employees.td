# Datenschmiede Tabellendefinition
schema = "hr.core"
name = "employees"
description = """
Mitarbeitende — referenziert **hr.core.departments**.
"""

[[columns]]
name = "id"
type = "uuid"
pk = true
fk = false
description = "Primärschlüssel"

[[columns]]
name = "department_id"
type = "uuid"
pk = false
fk = true
fk_table = "hr.core.departments"
fk_column = "id"
description = "Zugehörige Abteilung — 3 bis 8 Mitarbeitende je Abteilung"

[[columns]]
name = "first_name"
type = "string"
pk = false
fk = false
description = "Vorname"

[[columns]]
name = "last_name"
type = "string"
pk = false
fk = false
description = "Nachname"

[[columns]]
name = "hired_at"
type = "date"
pk = false
fk = false
description = "Einstellungsdatum"
