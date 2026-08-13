# Datenschmiede Tabellendefinition
schema = ""
name = "currencies"
description = """
Währungs-Nachschlagetabelle ohne Schema — wie countries.td auf der
Wurzelebene des Tabellenbaums, unabhängig (keine Fremdschlüssel).
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
description = "ISO-4217-Code, z. B. \"EUR\""

[[columns]]
name = "name"
type = "string"
pk = false
fk = false
description = "Name der Währung"

[[columns]]
name = "decimal_places"
type = "integer"
pk = false
fk = false
description = "Anzahl Nachkommastellen"
