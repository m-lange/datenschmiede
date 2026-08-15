# Datenschmiede Tabellendefinition
schema = "shop.sales"
name = "bestellungen"
description = """
**Herzstück der Beziehungen**: eine Bestellung gehört zu genau einem Kunden,
und im Projekt steht die Kardinalität `1..5` — also ein bis fünf Bestellungen
**je Kunde**. Aus 2.000 Kunden werden dadurch `2.000..10.000` Bestellungen;
das ER-Diagramm schreibt die Kardinalität an den Pfeil, die Übersicht
„Generierte Dateien“ zeigt die berechnete Spanne.

**Was hier zu sehen ist**

- `waehrung` zieht aus der Liste [`laender`](../../lookups/laender.lkp) —
  und zwar aus **derselben Zeile, die der Kunde gezogen hat**. Die
  Zeilenkonsistenz wirkt über den Fremdschlüssel hinweg: Zu einem Kunden mit
  `land` = `CH` steht hier `CHF`, ohne dass das irgendwo verdrahtet wäre
- `status`/`abgeschlossen` und `zahlart`/`zahlungsgebuehr` sind je zwei
  Spalten aus **einer** Listenzeile — Code und abgeleiteter Wert können
  dadurch nicht auseinanderlaufen
- `kunde_name` holt der Generator
  [`elternwert`](../../generators/elternwert.tdgen) über den Fremdschlüssel
  aus **genau dem** referenzierten Kundendatensatz — ein Join, kein Zufall
- `liefer_stadt` zieht der Generator
  [`fremdwert`](../../generators/fremdwert.tdgen) dagegen **zufällig** aus
  der temporären Tabelle [`shop.core.adressen`](../core/adressen.td): ein
  Wertevorrat ohne Beziehung
- der Dateiname `bestellungen_{date}_{time}` zeigt zwei der eingebauten
  Variablen; im Übersicht-Tab stehen sie als Bausteine, nicht als roher Text
"""

[output]
file_name = "bestellungen_{date}_{time}"
format = "csv"

[output.csv]
delimiter = ";"
quote_all = true
decimal = ","
date_format = "%d.%m.%Y"
datetime_format = "%d.%m.%Y %H:%M:%S"
include_header = true
encoding = "utf-8"

[[columns]]
name = "bestell_nr"
type = "string"
pk = true
fk = false
description = "Bestellnummer `B-2026-00000001` aufwärts — eigener Generator `laufende_nummer`"
generator = "custom:laufende_nummer"
[columns.generator_params]
prefix = "B-2026-"
start = "1"
stellen = "8"

[[columns]]
name = "kunden_nr"
type = "string"
pk = false
fk = true
fk_table = "shop.core.kunden"
fk_column = "kunden_nr"
description = "Besteller — **treibende** FK-Spalte: die Kardinalität `1..5` gilt je Kunde"

[[columns]]
name = "bestelldatum"
type = "date"
pk = false
fk = false
description = "Bestelldatum — Standard des Datentyps `date`"
generator = "default"

[[columns]]
name = "status"
type = "string"
pk = false
fk = false
description = "Bearbeitungsstand aus der Liste `bestellstatus`"
generator = "lookup"
[columns.generator_params]
list = "bestellstatus"
column = "code"

[[columns]]
name = "abgeschlossen"
type = "boolean"
pk = false
fk = false
description = "Kennzeichen aus **derselben Zeile** wie `status` — kann nicht widersprüchlich werden"
generator = "lookup"
[columns.generator_params]
list = "bestellstatus"
column = "abgeschlossen"

[[columns]]
name = "zahlart"
type = "string"
pk = false
fk = false
description = "Zahlungsart aus der Liste `zahlarten`"
generator = "lookup"
[columns.generator_params]
list = "zahlarten"
column = "code"

[[columns]]
name = "zahlungsgebuehr"
type = "decimal"
pk = false
fk = false
description = "Gebühr aus **derselben Zeile** wie `zahlart` — gehört fest zur Zahlungsart"
generator = "lookup"
[columns.generator_params]
list = "zahlarten"
column = "gebuehr"

[[columns]]
name = "waehrung"
type = "string"
pk = false
fk = false
description = "Währung aus der Liste `laender` — **dieselbe Zeile, die der Kunde gezogen hat**"
generator = "lookup"
[columns.generator_params]
list = "laender"
column = "waehrung"

[[columns]]
name = "kunde_name"
type = "string"
pk = false
fk = false
description = "Nachname **genau des** referenzierten Kunden — Generator `elternwert` über `kunden_nr`"
generator = "custom:elternwert"
[columns.generator_params]
fk_pfad = "kunden_nr"
spalte = "nachname"

[[columns]]
name = "liefer_stadt"
type = "string"
pk = false
fk = false
description = "Lieferort — **zufällig** aus der temporären Tabelle `shop.core.adressen`"
generator = "custom:fremdwert"
[columns.generator_params]
quelltabelle = "shop.core.adressen"
quellspalte = "stadt"

[[columns]]
name = "warenwert"
type = "decimal"
pk = false
fk = false
description = "Warenwert — `9,90 … 2.400,00`"
generator = "random-float"
[columns.generator_params]
min = "9.9"
max = "2400"
decimals = "2"

[[columns]]
name = "versandkosten"
type = "decimal"
pk = false
fk = false
description = "Versandkosten — `0,00 … 12,90`"
generator = "random-float"
[columns.generator_params]
min = "0"
max = "12.9"
decimals = "2"

[[columns]]
name = "rabatt_prozent"
type = "integer"
pk = false
fk = false
description = "Gewährter Rabatt — Ganzzahl `0 … 25`"
generator = "random-int"
[columns.generator_params]
min = "0"
max = "25"

[[columns]]
name = "kommentar"
type = "text"
pk = false
fk = false
description = "Freitext des Kunden — Faker-Provider `sentence`"
generator = "faker"
[columns.generator_params]
provider = "sentence"
locale = "de_DE"
