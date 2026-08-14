# Datenschmiede Tabellendefinition
# Generiert aus den Spezifikations-Excels (read_input.py)
schema = "flake_stdfkcorp_radar"
name = "feedback_auswertung"
description = """
Auswertungen von Umfragen
"""

[output]
file_name = "Feedback Auswertung_{timestamp}"
format = "csv"

[output.csv]
delimiter = ";"
include_header = true
encoding = "utf-8"

[[columns]]
name = "respondent_name"
type = "string"
pk = false
fk = false
description = "Respondent name"
generator = "faker"
[columns.generator_params]
provider = "name"
locale = "de_DE"

[[columns]]
name = "respondent_unique_id"
type = "string"
pk = false
fk = false
description = "Respondent unique ID"
generator = "faker"
[columns.generator_params]
provider = "uuid4"

[[columns]]
name = "answer_created"
type = "string"
pk = false
fk = false
description = "Answer created"
generator = "faker"
[columns.generator_params]
provider = "date_time_this_year"

[[columns]]
name = "datum_abschluss"
type = "string"
pk = true
fk = false
description = "Answer completed (nur abgeschlossene Befragungen werden hier reportet!)"
generator = "faker"
[columns.generator_params]
provider = "date_this_year"

[[columns]]
name = "abteilung"
type = "string"
pk = false
fk = false
description = "Abteilung"
generator = "lookup"
[columns.generator_params]
list = "bank_abteilungen"
column = "value"

[[columns]]
name = "gesamt_note"
type = "string"
pk = false
fk = false
description = "Gesamtzufriedenheit : Wie zufrieden waren Sie mit dem bisherigen Gesamtprozess in vorliegendem Metafall im Hause der DZ BANK?"
generator = "lookup"
[columns.generator_params]
list = "zufriedenheit_skala"
column = "value"

[[columns]]
name = "note_informationsanforderungen"
type = "integer"
pk = false
fk = false
description = "Zufriedenheit mit der Zusammenarbeit mit der DZ BANK : Wie zufrieden waren Sie mit den Informationsanforderungen der DZ BANK?"
generator = "random-int"
[columns.generator_params]
min = "1"
max = "6"

[[columns]]
name = "note_aussagen"
type = "integer"
pk = false
fk = false
description = "Zufriedenheit mit der Zusammenarbeit mit der DZ BANK : Wie zufrieden waren Sie mit den zeitnahen Aussagen der DZ BANK über die Machbarkeit des Kreditantrages?"
generator = "random-int"
[columns.generator_params]
min = "1"
max = "6"

[[columns]]
name = "note_geschwindigkeit"
type = "integer"
pk = false
fk = false
description = "Zufriedenheit mit der Zusammenarbeit mit der DZ BANK : Wie zufrieden waren Sie mit der Geschwindigkeit der Entscheidung?"
generator = "random-int"
[columns.generator_params]
min = "1"
max = "6"

[[columns]]
name = "note_nachvollziehbarkeit"
type = "integer"
pk = false
fk = false
description = "Zufriedenheit mit der Zusammenarbeit mit der DZ BANK : Wie zufrieden waren Sie mit der Nachvollziehbarkeit der Entscheidung?"
generator = "random-int"
[columns.generator_params]
min = "1"
max = "6"

[[columns]]
name = "note_laufende_informationen"
type = "integer"
pk = false
fk = false
description = "Zufriedenheit mit der Zusammenarbeit mit der DZ BANK : Wie zufrieden waren Sie mit den laufenden Informationen über den Bearbeitungsstatus?"
generator = "random-int"
[columns.generator_params]
min = "1"
max = "6"

[[columns]]
name = "note_auflagen"
type = "integer"
pk = false
fk = false
description = "Zufriedenheit mit der Zusammenarbeit mit der DZ BANK : Wie zufrieden waren Sie mit den im Rahmen der Kreditentscheidung besprochenen Auflagen und/oder Besonderheiten im Hinblick auf die vorbesprochenen Vertragsausgestaltungen?"
generator = "random-int"
[columns.generator_params]
min = "1"
max = "6"

[[columns]]
name = "optimierungsbedarf"
type = "string"
pk = false
fk = false
description = "Zufriedenheit mit der Zusammenarbeit mit der DZ BANK : Gibt es aus Ihrer Sicht Optimierungsbedarf in der Zusammenarbeit?"
generator = "lookup"
[columns.generator_params]
list = "optimierungsbedarf_status"
column = "value"

[[columns]]
name = "datum_antragsstellung"
type = "date"
pk = false
fk = false
description = "Allgemeine Informationen : Datum der Antragsstellung"
generator = "faker"
[columns.generator_params]
provider = "date_this_year"

[[columns]]
name = "antrag_art"
type = "string"
pk = false
fk = false
description = "Allgemeine Informationen : Art des Antrags"
generator = "lookup"
[columns.generator_params]
list = "kredit_antragsarten"
column = "value"

[[columns]]
name = "produkt"
type = "string"
pk = false
fk = false
description = "Allgemeine Informationen : Angefragtes Produkt"
generator = "lookup"
[columns.generator_params]
list = "kredit_produkte"
column = "value"

[[columns]]
name = "blz"
type = "integer"
pk = false
fk = false
description = "Allgemeine Informationen : Bankleitzahl Ihres Hauses"
generator = "lookup"
[columns.generator_params]
list = "blz_genobanken"
column = "value"

[[columns]]
name = "name_ansprechpartner"
type = "string"
pk = false
fk = false
description = "Allgemeine Informationen : Name des Ansprechpartners in Ihrem Hause"
generator = "faker"
[columns.generator_params]
provider = "name"
locale = "de_DE"

[[columns]]
name = "telefonnummer"
type = "string"
pk = false
fk = false
description = "Allgemeine Informationen : Telefonnummer des Ansprechpartners in Ihrem Hause"
generator = "faker"
[columns.generator_params]
provider = "phone_number"
locale = "de_DE"

[[columns]]
name = "name_antragskunde"
type = "string"
pk = false
fk = false
description = "Allgemeine Informationen : Name des Antragskunden"
generator = "faker"
[columns.generator_params]
provider = "company"
locale = "de_DE"

[[columns]]
name = "gp_nr"
type = "string"
pk = true
fk = false
description = "Allgemeine Informationen : GP-Nr. des Antragskunden"
generator = "default"

[[columns]]
name = "weitere_anmerkungen"
type = "string"
pk = false
fk = false
description = "Weitere Anmerkungen : Haben Sie weitere Anmerkungen zum vorliegenden Fall?"
generator = "lookup"
[columns.generator_params]
list = "feedback_anmerkungen"
column = "value"
