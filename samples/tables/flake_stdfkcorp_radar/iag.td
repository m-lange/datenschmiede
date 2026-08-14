# Datenschmiede Tabellendefinition
# Generiert aus den Spezifikations-Excels (read_input.py)
schema = "flake_stdfkcorp_radar"
name = "iag"
description = """
Inlandsgetriebenes Auslandsgeschäft
"""

[output]
file_name = "ProduktionGesamtSicht_{timestamp}"
format = "csv"

[output.csv]
delimiter = ";"
include_header = true
encoding = "utf-8"

[[columns]]
name = "richtung"
type = "string"
pk = true
fk = false
description = "Struktur"
generator = "lookup"
[columns.generator_params]
list = "iag_richtung"
column = "value"

[[columns]]
name = "geschaeftsnummer"
type = "string"
pk = true
fk = false
description = "Geschäftsnummer"
generator = "default"

[[columns]]
name = "oe_kdbetreu_bank"
type = "string"
pk = false
fk = false
description = "Abw. OE Kundenbetreuung (des GP)"
generator = "lookup"
[columns.generator_params]
list = "oe_kdbetreuung"
column = "value"

[[columns]]
name = "oe_kdbetreu_be"
type = "string"
pk = false
fk = false
description = "OE Betreuung konsolidiert"
generator = "lookup"
[columns.generator_params]
list = "oe_kdbetreuung"
column = "value"

[[columns]]
name = "be_nr"
type = "string"
pk = false
fk = false
description = "BE konsolidiert"
generator = "default"

[[columns]]
name = "be_name"
type = "string"
pk = false
fk = false
description = "BE Name konsolidiert"
generator = "faker"
[columns.generator_params]
provider = "company"
locale = "de_DE"

[[columns]]
name = "be_nr_org"
type = "string"
pk = false
fk = false
description = "BE des Importeurs"
generator = "default"

[[columns]]
name = "be_name_org"
type = "string"
pk = false
fk = false
description = "BE-Importeur Name"
generator = "faker"
[columns.generator_params]
provider = "company"
locale = "de_DE"

[[columns]]
name = "oe_kdbetreu_be_org"
type = "string"
pk = false
fk = false
description = "Abw. OE Kundenbetreuung (BE Imp.)"
generator = "lookup"
[columns.generator_params]
list = "oe_kdbetreuung"
column = "value"

[[columns]]
name = "gp_nr"
type = "string"
pk = true
fk = false
description = "GP konsolidiert [Fachlich identisch mit: flake_ctdfkcorp_radar.gp_stammdaten.gp_nr, flake_ctdfkcorp_radar.iag.gp_nr]"
generator = "lookup"
[columns.generator_params]
list = "gp_nummern"
column = "value"

[[columns]]
name = "gp_name"
type = "string"
pk = false
fk = false
description = "GP Name konsolidiert"
generator = "faker"
[columns.generator_params]
provider = "company"
locale = "de_DE"

[[columns]]
name = "gp_nr_org"
type = "string"
pk = false
fk = false
description = "Importeur"
generator = "lookup"
[columns.generator_params]
list = "gp_nummern"
column = "value"

[[columns]]
name = "gp_name_org"
type = "string"
pk = false
fk = false
description = "Importeur Name"
generator = "faker"
[columns.generator_params]
provider = "company"
locale = "de_DE"

[[columns]]
name = "vermittler_nr_gp_org"
type = "string"
pk = false
fk = false
description = "Vermittler Importeur (aus SAP BP)"
generator = "default"

[[columns]]
name = "vermittler_name_gp_org"
type = "string"
pk = false
fk = false
description = "Vermittler Importeur Name"
generator = "faker"
[columns.generator_params]
provider = "name"
locale = "de_DE"

[[columns]]
name = "be_nr_bestandsliste"
type = "string"
pk = false
fk = false
description = "BE Nummer aus Bestandsliste"
generator = "default"

[[columns]]
name = "be_name_bestandsliste"
type = "string"
pk = false
fk = false
description = "BE Name aus Bestandsliste"
generator = "faker"
[columns.generator_params]
provider = "company"
locale = "de_DE"

[[columns]]
name = "gp_nr_bestandsliste"
type = "string"
pk = false
fk = false
description = "GP Nummer aus Bestandsliste"
generator = "lookup"
[columns.generator_params]
list = "gp_nummern"
column = "value"

[[columns]]
name = "gp_name_bestandsliste"
type = "string"
pk = false
fk = false
description = "GP Bezeichnung aus Bestandsliste"
generator = "faker"
[columns.generator_params]
provider = "company"
locale = "de_DE"

[[columns]]
name = "gp_bank_nr"
type = "string"
pk = false
fk = false
description = "Geschäftspartner"
generator = "default"

[[columns]]
name = "gp_bank_name"
type = "string"
pk = false
fk = false
description = "Kurzbezeichnung GP"
generator = "faker"
[columns.generator_params]
provider = "company"
locale = "de_DE"

[[columns]]
name = "land_kuerzel"
type = "string"
pk = false
fk = false
description = "Land (Kürzel)"
generator = "lookup"
[columns.generator_params]
list = "iso_laendercodes"
column = "value"

[[columns]]
name = "land"
type = "string"
pk = false
fk = false
description = "Land (Bezeichnung)"
generator = "faker"
[columns.generator_params]
provider = "country"
locale = "de_DE"

[[columns]]
name = "co_produkt"
type = "string"
pk = false
fk = false
description = "Controlling-Produkt [Fachlich identisch mit: flake_ctdfkcorp_radar.co_produkte.produkt_code, flake_ctdfkcorp_radar.iag.co_produkt, flake_stdfkcorp_radar.co_produkte.produkt_code]"
generator = "lookup"
[columns.generator_params]
list = "co_produkt_code"
column = "value"

[[columns]]
name = "co_produkt_lang"
type = "string"
pk = false
fk = false
description = "Controlling-Produkt Lang"
generator = "lookup"
[columns.generator_params]
list = "co_produkt_lang_liste"
column = "value"

[[columns]]
name = "nominalvolumen"
type = "decimal"
pk = false
fk = false
description = "Nominalvolumen"
generator = "random-float"
[columns.generator_params]
min = "10000.00"
max = "5000000.00"
decimals = "2"

[[columns]]
name = "marge"
type = "decimal"
pk = false
fk = false
description = "Marge in %"
generator = "random-float"
[columns.generator_params]
min = "0.10"
max = "5.00"
decimals = "2"

[[columns]]
name = "effektivkapital"
type = "decimal"
pk = false
fk = false
description = "Effektivkapital"
generator = "random-float"
[columns.generator_params]
min = "5000.00"
max = "4500000.00"
decimals = "2"

[[columns]]
name = "kb"
type = "decimal"
pk = false
fk = false
description = "KB"
generator = "random-float"
[columns.generator_params]
min = "-5000.00"
max = "50000.00"
decimals = "2"

[[columns]]
name = "kb_ohne_vol"
type = "decimal"
pk = false
fk = false
description = "KB ohne Volumen"
generator = "random-float"
[columns.generator_params]
min = "0.00"
max = "10000.00"
decimals = "2"

[[columns]]
name = "dlb"
type = "decimal"
pk = false
fk = false
description = "DLB"
generator = "random-float"
[columns.generator_params]
min = "0.00"
max = "25000.00"
decimals = "2"

[[columns]]
name = "khb"
type = "decimal"
pk = false
fk = false
description = "KHB"
generator = "random-float"
[columns.generator_params]
min = "0.00"
max = "5000.00"
decimals = "2"

[[columns]]
name = "wstb"
type = "decimal"
pk = false
fk = false
description = "WSTB"
generator = "random-float"
[columns.generator_params]
min = "0.00"
max = "15000.00"
decimals = "2"

[[columns]]
name = "dbi"
type = "decimal"
pk = false
fk = false
description = "DB I"
generator = "random-float"
[columns.generator_params]
min = "-10000.00"
max = "100000.00"
decimals = "2"

[[columns]]
name = "srk"
type = "decimal"
pk = false
fk = false
description = "SRK"
generator = "random-float"
[columns.generator_params]
min = "0.00"
max = "20000.00"
decimals = "2"

[[columns]]
name = "dbii"
type = "decimal"
pk = false
fk = false
description = "DB II"
generator = "random-float"
[columns.generator_params]
min = "-15000.00"
max = "80000.00"
decimals = "2"

[[columns]]
name = "ssk"
type = "decimal"
pk = false
fk = false
description = "SSK"
generator = "random-float"
[columns.generator_params]
min = "0.00"
max = "10000.00"
decimals = "2"

[[columns]]
name = "kbk"
type = "decimal"
pk = false
fk = false
description = "kbK"
generator = "random-float"
[columns.generator_params]
min = "0.00"
max = "15000.00"
decimals = "2"

[[columns]]
name = "dbiii"
type = "decimal"
pk = false
fk = false
description = "DB III"
generator = "random-float"
[columns.generator_params]
min = "-20000.00"
max = "60000.00"
decimals = "2"

[[columns]]
name = "oekk"
type = "decimal"
pk = false
fk = false
description = "ÖKK"
generator = "random-float"
[columns.generator_params]
min = "0.00"
max = "10000.00"
decimals = "2"

[[columns]]
name = "dbiv_m_kbk"
type = "decimal"
pk = false
fk = false
description = "DB IV m. kbK"
generator = "random-float"
[columns.generator_params]
min = "-25000.00"
max = "50000.00"
decimals = "2"

[[columns]]
name = "dbiv_o_kbk"
type = "decimal"
pk = false
fk = false
description = "DB IV o. kbK"
generator = "random-float"
[columns.generator_params]
min = "-25000.00"
max = "50000.00"
decimals = "2"

[[columns]]
name = "rorac"
type = "decimal"
pk = false
fk = false
description = "RORAC"
generator = "random-float"
[columns.generator_params]
min = "-5.00"
max = "35.00"
decimals = "2"
