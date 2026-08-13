# Datenschmiede Tabellendefinition
schema = "shop"
name = "customers"
description = """
Kundenstamm des Shop-Beispiels (Namensraum **shop**, eine Ebene). Unabhängig
(keine ausgehende Fremdschlüssel-Beziehung) — braucht im Testdatenprojekt
eine manuell gesetzte Datensatzanzahl.
"""

[[columns]]
name = "id"
type = "uuid"
pk = true
fk = false
description = "Primärschlüssel"

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
name = "email"
type = "email"
pk = false
fk = false
description = "E-Mail-Adresse"

[[columns]]
name = "created_at"
type = "datetime"
pk = false
fk = false
description = "Zeitpunkt der Registrierung"
