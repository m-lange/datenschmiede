# Datenschmiede Tabellendefinition
schema = "public"
name = "customers"
description = """
Beispieltabelle für Kundenstammdaten.
Dient als Vorlage für den **synthet** Testdaten-Generator.
"""

[[columns]]
name = "id"
type = "uuid"
pk = true
fk = false
description = "Eindeutiger **Primärschlüssel**"

[[columns]]
name = "email"
type = "email"
pk = true
fk = false
description = "E-Mail-Adresse des Kundenkdsjflksdf"

[[columns]]
name = "created_at"
type = "datetime"
pk = false
fk = false
description = "Zeitpunkt der Askdjflksdfkjsdfklsjdflksjdflksjadfnlage"

[[columns]]
name = "test_column"
type = "boolean"
pk = false
fk = false
description = "sdfjsdaklfdlskksdfksjfksdjflksdflksadfksjdfklsdjflkksjdflksdjfksdjfklsdjflksdjfklsdjlk"
