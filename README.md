# Datenschmiede

Eine VS-Code-Extension für **synthetische Testdaten**: Tabellen visuell
definieren, Spalten mit Generatoren belegen, Tabellen zu Projekten bündeln
und die Daten vektorisiert über **pandas/numpy** erzeugen — als CSV, mit
konsistenten Fremdschlüssel-Beziehungen über beliebig viele Ebenen.

Alle Dateitypen sind unter der Haube normale Klartext-Dateien (TOML bzw.
CSV) und damit git-freundlich; die Extension stellt dafür grafische Custom
Editoren bereit. Wer lieber den Rohtext bearbeitet, öffnet jede Datei per
Rechtsklick auf den Tab → **„Reopen Editor With…“** als Text.

| Dateityp | Inhalt | Anlegen über Befehl |
| --- | --- | --- |
| `.td` | Eine Tabellendefinition (Spalten, Schlüssel, Generatoren, Ausgabe) | **Datenschmiede: Neue Tabelle erstellen…** |
| `.lkp` | Eine Nachschlageliste (gewichtete Wertezeilen) | **Datenschmiede: Neue Nachschlageliste erstellen…** |
| `.tdgen` | Ein benutzerdefinierter Generator (Python, als Notebook) | **Datenschmiede: Neuen Generator erstellen…** |
| `.tdproject` | Ein Testdatenprojekt (Tabellenauswahl, Anzahlen, Interpreter, Ausgabeordner) | **Datenschmiede: Neues Testdatenprojekt erstellen…** |

Alle Befehle sind über die Command Palette und den Rechtsklick im Explorer
erreichbar. Jeder Dateityp hat ein eigenes Datei-Icon (Explorer, Tabs); die
Oberfläche ist auf **Deutsch und Englisch** lokalisiert — passend zur
Anzeigesprache von VS Code. Die Optik lehnt sich an
[Oracle SQL Developer for VS Code](https://marketplace.visualstudio.com/items?itemName=Oracle.sql-developer)
an (Tabs, dichtes Grid mit Zeilennummern, randlose Toolbar-Buttons), ist
aber komplett über native VS-Code-Theme-Variablen umgesetzt
(Light/Dark/High-Contrast).

**Referenzen über logische Namen**: Tabellen werden als `schema.name`
referenziert, Nachschlagelisten über ihren Namen, Generatoren als
`custom:<name>` — nie über Dateipfade. Dateien dürfen also umbenannt und
verschoben werden, ohne Referenzen zu brechen; wird dagegen ein *Name*
geändert oder eine Datei gelöscht, melden alle betroffenen Stellen das als
Problem (siehe unten).

## Beispielprojekt

Unter [`samples/`](samples/) liegt das durchgängige Beispielprojekt
**„Webshop Demo“** (nach Dateityp in `tables/`, `lookups/` und `generators/`
gegliedert): fünf Tabellen in zwei Namensräumen (`shop.core` und
`shop.sales`) mit FK-Ketten über drei Ebenen, drei Nachschlagelisten,
sieben benutzerdefinierte Generatoren und ein fertig konfiguriertes
Projekt — jede Datei mit ausführlicher Markdown-Beschreibung, welche
Funktion sie demonstriert. Einstieg:
[`samples/webshop-demo.tdproject`](samples/webshop-demo.tdproject).

## Tabellen (`.td`)

Jede `.td`-Datei beschreibt **eine Tabelle** und öffnet als Editor mit zwei
Tabs.

**Übersicht**: **Schema**, **Name** und **Beschreibung** — Beschreibungen
unterstützen überall in der Extension Markdown (fett, kursiv, Code, Links,
Listen), werden standardmäßig gerendert angezeigt und per Klick als Rohtext
bearbeitet. Dazu die Karte **„Ausgabe“**:

- **Dateiname** als Tag-Feld (an Power Automate angelehnt): fester Text
  frei editierbar, dynamische Teile als klickbare Tags — Datum/Uhrzeit,
  Zeitstempel, Schema, Tabellenname, Datensatzanzahl oder der Wert einer
  Spalte aus dem ersten generierten Datensatz (Menü **„Dynamischen Wert
  einfügen“**; Klick auf ein Tag entfernt es). Leer ergibt `schema_tabelle`
- **Dateityp** (vorerst nur CSV) mit Spaltentrenner, „jeden Wert in
  doppelte Anführungszeichen“, Dezimaltrenner, Datums-/Zeitstempelformat,
  Kopfzeile und Encoding

**Spalten**: ein Grid mit einer Zeile je Spalte — Name, Datentyp (`string`,
`integer`, `uuid`, `email`, …), Beschreibung (Markdown, einzeilig mit
Ellipsis), **PK**/**FK**-Checkboxen, **Referenzierte Tabelle** und
**Referenzierte Spalte** (Auswahl aus dem Workspace, angezeigt als
`schema.name`; nur aktiv bei FK; Selbst-Referenzen sind gesperrt) sowie der
**Spaltengenerator** (siehe unten). Zeilen lassen sich hinzufügen,
verschieben und entfernen; Spaltenbreiten passen sich dem Inhalt an und
sind per Ziehgriff einstellbar (geräteweit gemerkt).

Der **Vorschau-Knopf** in der Toolbar erzeugt 20 Datensätze mit der
aktuellen Konfiguration — inklusive aller referenzierten Tabellen — über
denselben Python-Läufer wie der echte Lauf und zeigt sie als Tabelle im
Dialog. Die Vorschau braucht kein Projekt: sie nutzt die in VS Code aktive
Python-Umgebung (3.10+), geschrieben wird nichts.

Die Anzahl zu erzeugender Datensätze gehört bewusst **nicht** zur
Tabellendefinition, sondern wird je Testdatenprojekt festgelegt.

### Validierung (Problems-Ansicht)

Eine Workspace-weite Hintergrund-Prüfung validiert **alle** Datenschmiede-
Dateien — auch die, die in keinem Editor geöffnet sind — und trägt Probleme
mit Sprungziel in VS Codes **Problems-Ansicht** ein; die Editoren markieren
dieselben Probleme zusätzlich direkt am Feld. Gemeldet werden u. a.
fehlende oder nicht (mehr) existierende FK-Ziele, fehlende/ungültige
Generator-Parameter, Referenzen auf umbenannte oder gelöschte
Tabellen/Spalten/Nachschlagelisten/Generatoren, zyklische Referenzen,
fehlende Gewichte, Python-Syntaxfehler in `.tdgen`-Code-Zellen sowie
kaputtes TOML/CSV mit genauer Zeile/Spalte.

## Spaltengeneratoren

Jede Spalte kann einen **Generator** zugewiesen bekommen, der beim Lauf
ihre Werte erzeugt. Eingebaut sind (je einer pro Datei unter
[`src/generator/builtins/`](src/generator/builtins/)):

- **Random Int** / **Random Float**: gleichverteilte Zahlen in [min, max]
- **Faker**: realistische Werte (Namen, Adressen, E-Mails, …) über das
  Python-Paket [faker](https://faker.readthedocs.io/), Provider und Locale
  als vordefinierte Auswahl
- **Nachschlageliste**: gewichtete Werte aus einer `.lkp`-Liste — alle
  Spalten, die aus derselben Liste ziehen, lesen je Datensatz **dieselbe
  Zeile** (z. B. `code` „DE“ und `currency` „EUR“), auch über
  FK-verbundene Tabellen hinweg
- **Kombinieren**: kombiniert die Werte anderer Spalten derselben Tabelle
  über eine Vorlage mit `{spaltenname}`-Platzhaltern
- **Fremdschlüssel** (wird beim Anhaken der FK-Checkbox automatisch und
  fest zugewiesen): zieht Werte aus der referenzierten Spalte; die erste
  FK-Spalte einer Tabelle bestimmt zusammen mit der Kardinalität des
  Projekts die Datensatzanzahl

Ohne Generator greift ein sinnvoller Standard je Datentyp (laufende Nummer,
UUID4, Zufallsdatum, …). Der **Stift** neben der Auswahl öffnet einen
Parameter-Dialog mit je Parametertyp passendem Eingabefeld; die Zelle zeigt
danach den Anzeige-Text der Konfiguration (z. B. `Random Int: 1 … 100`).

## Nachschlagelisten (`.lkp`)

Eine Nachschlageliste ist eine gewichtete Wertetabelle (z. B. Länder mit
Währung und Verteilungs-Gewicht), aus der der Nachschlagelisten-Generator
und benutzerdefinierte Generatoren (`ctx.lookup`/`ctx.lookup_value`)
ziehen. Der Editor hat zwei Tabs:

- **Übersicht**: Name (darüber wird die Liste referenziert), Beschreibung
  (Markdown) und ein **Verteilungs-Diagramm** — ein Balken je Zeile,
  skaliert relativ zum größten Gewicht
- **Werte**: ein Grid mit beliebig vielen Wertespalten und der festen
  **Gewichtsspalte** am Ende. Spalten werden direkt über ihre Kopfzelle
  umbenannt; die Phantom-Kopfzelle **„+ Neue Spalte“** legt beim Tippen
  eine neue an. Die Gewichte sind frei (auch über 100 % in Summe) — die
  Summenzeile zeigt den Gesamtwert rein informativ; nur leere/ungültige
  Gewichte werden als Problem gemeldet

Auf der Festplatte ist eine `.lkp`-Datei einfaches CSV (Semikolon-getrennt,
quotiert, Gewichtsspalte als letzte Spalte); Name und Beschreibung stehen
in `#`-Kommentarzeilen am Dateianfang.

## Benutzerdefinierte Generatoren (`.tdgen`)

Eine `.tdgen`-Datei (TOML) öffnet als **echtes VS-Code-Notebook** mit
Monaco-Editoren je Zelle (Python-Highlighting, IntelliSense) und einem
**persistenten Python-Prozess je Notebook** als Kernel — Variablen, Importe
und Funktionen bleiben zwischen Zell-Ausführungen erhalten, wie in Jupyter.
Aufbau:

- **Markdown-Kopfzelle**: `# Name` plus Beschreibung
- **`parameters()`-Zelle**: gibt die Parameterdefinitionen als
  Literal-Liste von dicts zurück (`{"name": …, "type": …, "description":
  …, "choices": […], "required": True}`; Datentypen = Spaltentypen plus
  `lookup`/`table`/`column`/`own_column`). Beim Speichern leitet der
  Serializer daraus die `[[parameters]]`-Blöcke der Datei ab — der Code
  selbst bleibt verbatim erhalten
- **Scratch-Zelle**: Testwerte (`params = {…}`, `n = 10`) und freie
  Experimente
- die vier **Methoden-Zellen** — das Ausführen definiert die Methode *und*
  ruft sie automatisch mit den aktuellen Testwerten auf, das Ergebnis
  erscheint nativ unter der Zelle:
  - `def generate(params, n, ctx) -> pandas.Series` (Pflicht): erzeugt die
    Werte
  - `def parse_params(params)` (optional): wandelt die String-Parameter in
    typisierte Werte
  - `def display_value(params)` (optional): kompakte Zusammenfassung für
    Lauf-Protokoll/Vorschau
  - `def validate(params)` (optional): eigene Prüfungen — Warnungen
    erscheinen an den konfigurierten Spalten in der Problems-Ansicht

Das `ctx`-Objekt bietet in `generate` u. a.: `rng` (numpy), `pd`/`np`,
`faker(locale)`, `column("name")` (Werte anderer Spalten derselben
Tabelle), `table("label", "spalte")` (Werte einer anderen Tabelle),
`related("fk_spalte", "spalte")` (zeilengenauer Join über eine FK-Spalte,
auch mehrstufig: `related("order_id.customer_id", "country")`),
`lookup("liste", "spalte")` (rohe Listenwerte), `lookup_value("liste",
"spalte")` (ein Wert je Datensatz aus der **konsistent gezogenen**
Listen-Zeile) und `log(...)` (schreibt ins Lauf-Protokoll).

Beispiele unter [`samples/generators/`](samples/generators/):
`sequential_id` (fortlaufende Kennungen wie `ORD-001000`, vektorisiert),
`tracking_code` (Referenz auf eine andere Tabelle via `ctx.table`),
`related_sum` (Aggregation `SUM(...) GROUP BY` über `ctx.related`),
`value_category` (kategorisiert eine Spalte derselben Tabelle via
`own_column`), `parent_value` (übernimmt zeilengenau einen Wert der
führenden Tabelle), `iban` (gültige Prüfziffern nach ISO 7064, inkl.
eigener `validate`-Prüfung) und `lei` (Legal Entity Identifier nach
ISO 17442).

## Testdatenprojekte (`.tdproject`)

Ein Testdatenprojekt bündelt eine Auswahl von Tabellen mit Datensatzanzahl
je Tabelle, verknüpftem Python-Interpreter und Ausgabeordner — die
Grundlage für den Generator-Lauf. Der Editor hat zwei Tabs:

**Übersicht**: Name und Beschreibung, die Zeile für den verknüpften
**Python-Interpreter** (Status samt Version, **„Ändern…“**-Knopf), der
**Start-Knopf** des Laufs sowie:

- **Ausgabeordner** als Tag-Feld — fester Text (auch per
  Ordner-Auswahldialog) plus Variablen wie Datum, Uhrzeit, Zeitstempel und
  Projektname, z. B. `output/{project}_{datetime}`; leer gilt `output`.
  Relative Pfade beziehen sich auf den Ordner der Projektdatei
- die Übersicht **„Generierte Dateien“**: je ausgewählter Tabelle die
  Dateiname-Vorlage und die aus der Konfiguration **berechnete
  Datensatzanzahl** — bei referenzierten Tabellen die Kardinalität entlang
  der FK-Kette multipliziert (z. B. `100 × 1..3 → 100..300`)

**Tabellen**: alle `.td`-Tabellen des Workspace als Baum-Tabelle,
gruppiert nach den **Punkt-getrennten Segmenten ihres `schema`-Felds**
(nicht nach Ordnerstruktur) — `ag.cor.sapbp` ergibt drei verschachtelte
Namensraum-Ebenen. Ein Suchfeld filtert live nach Name, Namensraum oder
Pfad; das Kontextmenü eines Namensraums bietet „Alle auswählen/abwählen“
und „Alle auf-/zuklappen“ für seinen Teilbaum. Jede Tabellenzeile hat:

- eine **Checkbox**: Auswählen nimmt alle über Fremdschlüssel und
  Generator-Referenzen (rekursiv) benötigten Tabellen automatisch mit auf;
  benötigte Tabellen lassen sich nicht abwählen, solange eine andere
  ausgewählte sie noch referenziert — so bleibt jede FK-Spalte im Projekt
  auflösbar
- ein **Datensätze**-Feld, sobald sie ausgewählt ist: **primäre** Tabellen
  (ohne ausgehenden Fremdschlüssel) bekommen eine feste Gesamtanzahl
  (mit Tausendertrennzeichen angezeigt), **referenzierte** Tabellen die
  Anzahl **je Datensatz** der referenzierten Tabelle — als feste Zahl
  (`5`) oder Bereich (`1..3`)
- einen Knopf zum direkten **Öffnen** der `.td`-Datei

### Python-Interpreter

Der Lauf braucht **Python 3.10 oder neuer** mit `pandas`/`numpy` (und
`faker` für den Faker-Generator). Die Extension nutzt die offizielle API
der [Python-Extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python)
(`ms-python.python`, als Abhängigkeit deklariert), statt selbst nach
Interpretern zu suchen:

- Öffnet man ein Projekt ohne verknüpften Interpreter, fragt die Extension
  aktiv danach; die Auswahl wird in der Projektdatei gespeichert
  (`python_path`/`python_id`) und beim Öffnen neu aufgelöst — inklusive
  Warnung, falls der Pfad nicht mehr existiert oder zu alt ist
- Auch direkt über **„Datenschmiede: Python-Interpreter auswählen…“**
  erreichbar
- Beim Aktivieren prüft die Extension einmal pro Sitzung, ob überhaupt
  eine Python-3.10+-Installation vorhanden ist, und verweist andernfalls
  auf [python.org](https://www.python.org/downloads/)

## Generator-Lauf

Der **Run-Knopf** in der Editor-Titelleiste des Projekt-Editors (bzw. der
Start-Knopf im Übersicht-Tab, Befehl **„Datenschmiede: Testdaten
generieren“**) startet die Generierung
([`python/generate.py`](python/generate.py)):

1. **Reihenfolge bestimmen**: Tabellen topologisch nach Fremdschlüssel-
   und Generator-Referenzen, innerhalb einer Tabelle Spalte für Spalte
   (abhängige Spalten nach ihren Quellen, Custom-Code zuletzt)
2. **Daten erzeugen**: vektorisiert über pandas/numpy; referenzierte
   Tabellen entstehen über die Kardinalität je Datensatz der
   referenzierten Tabelle, die treibende FK-Spalte gleich mit
3. **Schreiben**: eine CSV-Datei je Tabelle gemäß ihrer
   Ausgabe-Konfiguration in den aufgelösten Ausgabeordner des Projekts

Der Fortschritt erscheint als abbrechbare Benachrichtigung mit
Fortschrittsbalken; das vollständige Protokoll (Tabellen, Spalten,
`ctx.log`-Ausgaben, Python-Tracebacks) steht im Output-Channel
**„Datenschmiede“**. Fehlende Python-Pakete werden mit
Ein-Klick-Installation in einem sichtbaren Terminal gemeldet.

## Dateiformat (`.td`)

```toml
# Datenschmiede Tabellendefinition
schema = "public"
name = "orders"
description = """
Beispieltabelle für Bestellungen.
"""

[output]
file_name = "{schema}_{table}_{date}"
format = "csv"

[[columns]]
name = "id"
type = "uuid"
pk = true
fk = false
description = "Eindeutiger Primärschlüssel"

[[columns]]
name = "customer_id"
type = "uuid"
pk = false
fk = true
fk_table = "public.customers"
fk_column = "id"
description = "Verweist auf den Kunden"
```

`fk_table`/`fk_column` werden nur bei `fk = true` geschrieben; `fk_table`
referenziert die logische Identität `schema.name`. Generator und
Parameter einer Spalte stehen als `generator = "…"` plus
`[columns.generator_params]` am Ende ihres Blocks. `.tdproject` und
`.tdgen` sind ebenfalls TOML, `.lkp` ist CSV — alle Formate werden von den
Editoren in einem festen, git-diff-freundlichen Layout geschrieben.

## Entwicklung

```bash
npm install
npm run watch          # esbuild im Watch-Modus
npm run check-types    # TypeScript-Typprüfung
npm run package        # Produktions-Build (dist/extension.js)
```

Anschließend in VS Code mit **F5** starten („Extension ausführen“) — öffnet
ein Extension Development Host-Fenster. Da die Extension `ms-python.python`
als `extensionDependencies` deklariert, muss diese im Extension Development
Host-Profil installiert sein (bei einem frischen Profil ggf. einmalig
manuell — die automatische Installation von `extensionDependencies` greift
nur beim regulären Marketplace-Install).

## Roadmap

- Weitere Ausgabeformate (z. B. JSON, SQL-Inserts, Parquet)
- Weitere eingebaute Generatoren (z. B. Sequenzen mit Mustern,
  Normalverteilungen)
