# Datenschmiede Tabellendefinition
schema = "shop.export"
name = "zahlungsavis"
description = """
**Beispiel für den Dateityp „Feste Satzlänge“** — eine Textdatei, in der die
Felder ohne Trennzeichen nebeneinander stehen und allein Position und Breite
bestimmen, wo ein Wert anfängt und aufhört. Solche Dateien verlangen viele
Bank- und Hostsysteme.

Gepflegt wird der Aufbau im Tab **„Satzaufbau“**: je Feld Spalte, abgeleitete
**Startposition**, Breite, Ausrichtung und Füllzeichen; darunter steht die
**Satzlänge** — hier **132 Zeichen**. Die Startpositionen werden aus den
Breiten davor berechnet, man pflegt also nur die Breite.

**Was hier zu sehen ist**

- **rechtsbündige, mit Nullen gefüllte** Zahlenfelder (`satzart`, `lfd_nr`,
  `betrag_cent`) neben **linksbündigen, mit Leerzeichen gefüllten**
  Textfeldern
- **Zu lange Werte abschneiden** ist eingeschaltet — sonst schöbe ein zu
  langer Name alles dahinter aus seiner Position. Bei rechtsbündigen Feldern
  wird von vorn abgeschnitten
- **Zeilenende CRLF** statt LF, wie es Hostsysteme meist erwarten
- eine **eigene Kodierung** (`iso-8859-1`) statt UTF-8 — die Datei geht an
  ein System, das kein Unicode kann
- ein eigenes **Datumsformat** `%Y%m%d`: In einer Satzdatei steht ein Datum
  als acht Ziffern ohne Trennzeichen
- **Kopfzeile schreiben** ist an: Die Spaltennamen stehen in denselben
  Feldern wie die Werte — praktisch beim Prüfen, in echten Satzdateien meist
  aus
- `satzart` zeigt den Generator **Kombination** als Konstante: eine Vorlage
  ganz ohne Platzhalter liefert für jeden Datensatz denselben Text

Der Dateiname `avis_{schema}_{table}` nutzt die Variablen für Namensraum und
Tabellenname.
"""

[output]
file_name = "avis_{schema}_{table}"
format = "fixed"

[output.csv]
delimiter = ";"
quote_all = true
decimal = "."
date_format = "%Y-%m-%d"
datetime_format = "%Y-%m-%d %H:%M:%S"
include_header = true
encoding = "utf-8"

[output.fixed]
include_header = true
truncate = true
line_ending = "crlf"
date_format = "%Y%m%d"
datetime_format = "%Y%m%d%H%M%S"
decimal = "."
encoding = "iso-8859-1"

[[output.fixed.fields]]
column = "satzart"
width = 2
align = "right"
pad = "0"

[[output.fixed.fields]]
column = "lfd_nr"
width = 8
align = "right"
pad = "0"

[[output.fixed.fields]]
column = "valuta"
width = 8
align = "left"
pad = " "

[[output.fixed.fields]]
column = "iban"
width = 34
align = "left"
pad = " "

[[output.fixed.fields]]
column = "bic"
width = 11
align = "left"
pad = " "

[[output.fixed.fields]]
column = "empfaenger"
width = 27
align = "left"
pad = " "

[[output.fixed.fields]]
column = "betrag_cent"
width = 12
align = "right"
pad = "0"

[[output.fixed.fields]]
column = "waehrung"
width = 3
align = "left"
pad = " "

[[output.fixed.fields]]
column = "verwendungszweck"
width = 27
align = "left"
pad = " "

[[columns]]
name = "satzart"
type = "string"
pk = false
fk = false
description = "Satzart `01` — **Kombination** mit einer Vorlage ohne Platzhalter, also eine Konstante"
generator = "combine"
[columns.generator_params]
template = "01"

[[columns]]
name = "lfd_nr"
type = "integer"
pk = true
fk = false
description = "Laufende Satznummer — Standard des Datentyps `integer`, rechtsbündig mit Nullen"
generator = "default"

[[columns]]
name = "valuta"
type = "date"
pk = false
fk = false
description = "Wertstellungsdatum — als `JJJJMMTT` ohne Trennzeichen geschrieben"
generator = "default"

[[columns]]
name = "iban"
type = "string"
pk = false
fk = false
description = "IBAN des Empfängers — eigener Generator `iban_de`"
generator = "custom:iban_de"
[columns.generator_params]
bankliste = "banken"
blz_spalte = "blz"

[[columns]]
name = "bic"
type = "string"
pk = false
fk = false
description = "BIC aus **derselben Zeile** der Liste `banken` wie die BLZ innerhalb der IBAN"
generator = "lookup"
[columns.generator_params]
list = "banken"
column = "bic"

[[columns]]
name = "empfaenger"
type = "string"
pk = false
fk = false
description = "Zahlungsempfänger — Faker-Provider `last_name`; zu lange Namen werden abgeschnitten"
generator = "faker"
[columns.generator_params]
provider = "last_name"
locale = "de_DE"

[[columns]]
name = "betrag_cent"
type = "integer"
pk = false
fk = false
description = "Betrag in Cent — Satzdateien kennen keine Kommas"
generator = "random-int"
[columns.generator_params]
min = "100"
max = "99999999"

[[columns]]
name = "waehrung"
type = "string"
pk = false
fk = false
description = "Währung aus der Liste `laender`"
generator = "lookup"
[columns.generator_params]
list = "laender"
column = "waehrung"

[[columns]]
name = "verwendungszweck"
type = "string"
pk = false
fk = false
description = "Verwendungszweck — eigener Generator `laufende_nummer`"
generator = "custom:laufende_nummer"
[columns.generator_params]
prefix = "RECHNUNG "
start = "1"
stellen = "8"
