# Datenschmiede Tabellendefinition
schema = "shop.export"
name = "partnerexport"
description = """
**Beispiel für einen eigenen Dateigenerator.** Als Dateityp ist nicht einer
der eingebauten gewählt, sondern
[`csv_mit_kopfblock`](../../filegen/csv_mit_kopfblock.filegen) — eine
`.filegen`-Datei aus dem Workspace, die die Ausgabedatei **komplett selbst
schreibt**.

Das Ergebnis ist ein CSV mit einem fünfzeiligen Informationsblock davor, 14
Reserve-Leerzeilen und der Kopfzeile auf **Zeile 20** — ein Aufbau, den
kein eingebauter Schreiber abdeckt, der aber in Austauschformaten
regelmäßig verlangt wird.

Wichtig: Die **CSV-Einstellungen dieser Tabelle gelten weiter**. Der
Generator ruft `ctx.as_csv(df)` auf und bekommt die Datensätze mit
Semikolon, Anführungszeichen und Dezimalkomma genau so gerendert, wie sie
hier konfiguriert sind — er kümmert sich nur um das Drumherum. Die
Dateiendung (`csv`) kommt ebenfalls aus dem Generator und steht im
Übersicht-Tab neben dem Dateinamen.

Weil der Generator `structure = "none"` deklariert, hat diese Tabelle
**keinen Struktur-Tab** — anders als [`api_lieferung`](api_lieferung.td).
"""

[output]
file_name = "partner_{column:mandant}_{date}"
format = "custom:csv_mit_kopfblock"

[output.csv]
delimiter = ";"
quote_all = true
decimal = ","
date_format = "%d.%m.%Y"
datetime_format = "%d.%m.%Y %H:%M:%S"
include_header = true
encoding = "utf-8"

[[columns]]
name = "mandant"
type = "string"
pk = false
fk = false
description = "Mandantenkennung — konstant, taucht über `{column:mandant}` im Dateinamen auf"
generator = "combine"
[columns.generator_params]
template = "M100"

[[columns]]
name = "partner_nr"
type = "string"
pk = true
fk = false
description = "Partnernummer `P-000001` aufwärts — eigener Generator `laufende_nummer`"
generator = "custom:laufende_nummer"
[columns.generator_params]
prefix = "P-"
start = "1"
stellen = "6"

[[columns]]
name = "name"
type = "string"
pk = false
fk = false
description = "Firmenname — Faker-Provider `company`"
generator = "faker"
[columns.generator_params]
provider = "company"
locale = "de_DE"

[[columns]]
name = "land"
type = "string"
pk = false
fk = false
description = "Länderkürzel aus der Liste `laender`"
generator = "lookup"
[columns.generator_params]
list = "laender"
column = "code"

[[columns]]
name = "ust_satz"
type = "float"
pk = false
fk = false
description = "Umsatzsteuersatz aus **derselben Zeile** wie `land`"
generator = "lookup"
[columns.generator_params]
list = "laender"
column = "ust_satz"

[[columns]]
name = "umsatz"
type = "decimal"
pk = false
fk = false
description = "Jahresumsatz — `0,00 … 1.500.000,00`, im CSV mit Dezimalkomma"
generator = "random-float"
[columns.generator_params]
min = "0"
max = "1500000"
decimals = "2"

[[columns]]
name = "vertrag_seit"
type = "date"
pk = false
fk = false
description = "Vertragsbeginn — im CSV als `TT.MM.JJJJ`"
generator = "default"
