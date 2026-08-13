# Datenschmiede: Table Editor

Eine VS-Code-Extension mit eigenen Custom Editoren für **`.td`-Tabellen­definitionen**
und **`.tdproject`-Testdatenprojekte** – dem Startpunkt für einen
synthetischen Testdaten-Generator ("Datenschmiede").

Beide Dateitypen sind unter der Haube ganz normale **TOML-Dateien**. Die Extension
stellt dafür grafische Formulare bereit, die sich optisch an
[Oracle SQL Developer for VS Code](https://marketplace.visualstudio.com/items?itemName=Oracle.sql-developer)
anlehnen (Tabs, dichtes Grid mit Zeilennummern und PK-/FK-Checkbox-Spalten,
randlose Toolbar-Buttons), technisch aber komplett über native
VS-Code-Theme-Variablen umgesetzt sind (Light/Dark/High-Contrast).
Wer lieber den Rohtext bearbeiten möchte, kann jede Datei jederzeit per
Rechtsklick auf den Tab → **„Reopen Editor With…“** als Text öffnen.

Beide Dateitypen haben außerdem ein eigenes Datei-Icon (Explorer, Tabs), und
die Oberfläche ist auf **Deutsch und Englisch** lokalisiert – passend zur
Anzeigesprache von VS Code.

## Aktueller Funktionsumfang

Jede `.td`-Datei beschreibt **eine Tabelle** und wird als zwei Tabs dargestellt:

- **Übersicht**: **Schema**, **Name**, **Beschreibung** — unterstützt Markdown
  (fett, kursiv, Code, Links, Listen), standardmäßig gerendert angezeigt, ein
  Klick blendet die Rohtext-Bearbeitung ein; die Höhe passt sich automatisch
  dem Inhalt an
- **Spalten**: beliebig viele Spalten, jeweils mit eigener Grid-Spalte für:
  - Name
  - Datentyp (Auswahl aus gängigen Typen, z. B. `string`, `integer`, `uuid`, `email`, …)
  - Beschreibung — unterstützt Markdown wie im Übersicht-Tab: im
    Ruhezustand gerendert und auf eine Zeile mit Ellipsis bei Überlänge
    begrenzt, ein Klick blendet die Rohtext-Bearbeitung ein (dort wächst
    das Feld automatisch auf die volle Höhe)
  - **PK**/**FK**-Checkboxen
  - **Referenzierte Tabelle**: Auswahl aus den Tabellen im Workspace,
    angezeigt als `schema.name` (nicht als Dateiname) — aktualisiert sich
    automatisch bei Anlegen/Löschen/Umbenennen; nur aktiv, wenn FK angehakt
    ist. Eine Tabelle kann sich nicht selbst referenzieren — die eigene
    Tabelle ist im Auswahlfeld deaktiviert, ein von Hand im TOML
    eingetragener Selbst-Bezug erscheint als Problem
  - **Referenzierte Spalte**: Auswahl aus den Spalten der gewählten
    referenzierten Tabelle — ebenfalls nur aktiv bei FK

  Die Anzahl zu erzeugender Datensätze wird nicht hier, sondern je Projekt
  im Projekt-Editor festgelegt (siehe unten, „Tabellen auswählen“).

  Name, Datentyp, Beschreibung und Referenzierte Tabelle/Spalte passen ihre
  Breite automatisch an den Inhalt an (überschüssiger
  Platz bleibt als Freiraum am Ende) und lassen sich per Ziehgriff am
  rechten Rand der Kopfzelle auch von Hand anpassen — von Hand gesetzte
  Breiten werden geräteweit für alle `.td`-Dateien gemerkt.

  Fehlt bei einer FK-Spalte die referenzierte Tabelle/Spalte oder verweist
  sie auf eine referenzierte Tabelle/Spalte, die nicht (mehr) existiert
  (z. B. weil die Datei gelöscht, umbenannt oder die Spalte dort entfernt
  wurde), wird das direkt am Feld markiert
  **und** als Problem in VS Codes **Problems-Ansicht** eingetragen (inkl.
  Sprung zur passenden Zeile in der Datei). Das gilt auch, wenn die
  referenzierte Datei nicht in der gerade geöffneten `.td`-Datei selbst,
  sondern anderswo im Workspace geändert/gelöscht wird. Auch kaputtes TOML
  (z. B. nach manueller Bearbeitung) erscheint dort mit genauer Zeile/Spalte.

Spalten können über den Button **„Spalte hinzufügen“** ergänzt und über das
Papierkorb-Symbol pro Zeile wieder entfernt werden.

Über den Befehl **„Datenschmiede: Neue Tabelle erstellen…“** (Command Palette oder
Rechtsklick im Explorer) lässt sich eine neue `.td`-Datei mit leerem
Grundgerüst anlegen.

Unter [`samples/`](samples/) liegt das durchgängige Beispielprojekt
**„Webshop Demo“** (nach Dateityp in `tables/`, `lookups/` und `generators/`
gegliedert): fünf Tabellen in zwei Namensräumen (`shop.core` und
`shop.sales`) mit FK-Ketten über drei Ebenen, zwei Nachschlagelisten, zwei
benutzerdefinierte Generatoren und ein fertig konfiguriertes
`.tdproject` — jede Datei mit ausführlicher Markdown-Beschreibung, welche
Funktion sie demonstriert. Einstieg:
[`samples/webshop-demo.tdproject`](samples/webshop-demo.tdproject).

## Dateiformat

```toml
# Datenschmiede Tabellendefinition
schema = "public"
name = "orders"
description = """
Beispieltabelle für Bestellungen.
"""

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

`fk_table` und `fk_column` werden nur geschrieben, wenn
`fk = true` ist. `fk_table` referenziert die Tabelle über ihre logische
Identität (`schema.name`, wie in SQL üblich), nicht über den Dateinamen —
die Referenz bleibt also gültig, auch wenn die Datei umbenannt oder
verschoben wird. Wie viele Datensätze erzeugt werden, gehört nicht zur
Tabellendefinition, sondern wird je Testdatenprojekt festgelegt (siehe
unten).

## Testdatenprojekte (`.tdproject`)

Ein Testdatenprojekt bündelt eine Auswahl von `.td`-Tabellen zu einem
benannten, beschriebenen Projekt mit verknüpftem Python-Interpreter und
einer Datensatzanzahl je Tabelle — die Grundlage für den späteren
Generator-Lauf. Wie `.td` technisch TOML, mit eigenem Custom Editor im
selben visuellen Stil:

- **Übersicht**: **Name**, **Beschreibung** (Markdown, wie beim Table
  Editor) sowie eine Zeile für den verknüpften **Python-Interpreter** samt
  **„Ändern…“**-Knopf
- **Tabellen**: die komplette Tabellenauswahl als Baum-Tabelle direkt im
  Editor (siehe unten) — kein separates Fenster oder Seitenleisten-Ansicht
  nötig

Über den Befehl **„Datenschmiede: Neues Testdatenprojekt erstellen…“**
(Command Palette oder Rechtsklick im Explorer) lässt sich ein neues
`.tdproject` mit leerem Grundgerüst anlegen.

### Tabellen auswählen

Der **Tabellen**-Tab zeigt alle `.td`-Tabellen des Workspace als Baum-Tabelle,
gruppiert nach den **Punkt-getrennten Segmenten ihres `schema`-Felds** statt
nach Ordnerstruktur — `ag.cor.sapbp` ergibt z. B. drei verschachtelte
Namensraum-Zeilen `ag` → `cor` → `sapbp`. Ein Suchfeld darüber filtert live
nach Tabellenname, Namensraum oder Dateipfad (Escape leert es).

Jede Tabellenzeile hat:

- eine **Checkbox**, um sie ins Projekt auf- oder daraus abzunehmen. Wird
  eine Tabelle ausgewählt, werden alle über Fremdschlüssel (rekursiv)
  referenzierten Tabellen automatisch mit ausgewählt und lassen sich nicht
  abwählen, solange sie noch benötigt werden — so bleibt jede im Projekt
  enthaltene Fremdschlüssel-Spalte immer auflösbar. Solche automatisch
  gesperrten Tabellen zeigen zusätzlich ein Verlinkt-Icon samt
  „— erforderlich“ direkt im Namen; Tabellen mit kaputtem TOML haben eine
  deaktivierte Checkbox und lassen sich nicht auswählen
- eine **Datensätze**-Spalte, sobald sie ausgewählt ist — ein Eingabefeld
  für jede ausgewählte Tabelle, mit einem Icon davor, das die Art der
  Tabelle kennzeichnet: **primäre** Tabellen (ohne ausgehenden
  Fremdschlüssel, Schlüssel-Icon) bekommen eine feste Gesamtanzahl
  (z. B. `100`); **referenzierte** Tabellen (mit ausgehendem
  Fremdschlüssel, Referenz-Icon) die Anzahl je Datensatz der
  referenzierten Tabelle — als feste Zahl (`5`) oder Bereich (`1..3`).
  Fehlt die Angabe oder ist sie ungültig, erscheint das direkt am Feld
  **und** als Diagnostic in der Problems-Ansicht
- einen Knopf zum direkten **Öffnen** der zugehörigen `.td`-Datei

### Python-Interpreter

Für den späteren Generator-Lauf braucht jedes Projekt einen verknüpften
Python-Interpreter (**Python 3.10 oder neuer**). Die Extension nutzt dafür
die offizielle, typisierte API der
[Python-Extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python)
(`ms-python.python`, als `extensionDependencies` deklariert — wird beim
Installieren automatisch mit installiert) statt selbst nach
Interpreter-Pfaden zu suchen:

- Öffnet man ein Projekt ohne verknüpften Interpreter, fragt die Extension
  aktiv danach; die Auswahl wird in der `.tdproject`-Datei gespeichert
  (`python_path`/`python_id`) und bei jedem Öffnen neu aufgelöst — inklusive
  Warnung, falls der Pfad nicht mehr existiert oder der Interpreter älter
  als Python 3.10 ist
- Auch direkt über **„Datenschmiede: Python-Interpreter auswählen…“**
  erreichbar (wirkt auf das gerade fokussierte Projekt)
- Beim Aktivieren der Extension prüft sie einmal pro Sitzung, ob überhaupt
  eine Python-3.10+-Installation gefunden werden kann, und verweist
  andernfalls auf [python.org](https://www.python.org/downloads/) — mehr ist
  ohne eigene VS-Code-API zur Interpreter-*Installation* nicht möglich

## Entwicklung

```bash
npm install
npm run watch     # esbuild im Watch-Modus
```

Anschließend in VS Code mit **F5** starten ("Extension ausführen") – öffnet
ein Extension Development Host-Fenster, in dem `.td`- und
`.tdproject`-Dateien mit ihren Custom Editoren geöffnet werden. Da die
Extension `ms-python.python` als `extensionDependencies` deklariert, muss
diese im Extension Development Host-Profil installiert sein, damit die
Python-Interpreter-Verknüpfung funktioniert (bei einem frischen Profil ggf.
einmalig manuell installieren — die automatische Installation von
`extensionDependencies` greift nur beim regulären Marketplace-Install).

```bash
npm run check-types   # TypeScript-Typprüfung
npm run package        # Produktions-Build (dist/extension.js)
```

## Spaltengeneratoren

Jede Spalte einer Tabelle kann einen **Generator** zugewiesen bekommen, der
beim Generator-Lauf ihre Werte erzeugt (Grid-Spalte **„Spaltengenerator“**
im Table Editor). Eingebaut sind (je einer pro Datei unter
[`src/generator/builtins/`](src/generator/builtins/)):

- **Random Int** / **Random Float**: gleichverteilte Zahlen in [min, max]
- **Faker**: realistische Werte (Namen, Adressen, E-Mails, …) über das
  Python-Paket [faker](https://faker.readthedocs.io/), Provider und Locale
  als vordefinierte Auswahl
- **Nachschlageliste**: gewichtete Werte aus einer `.lkp`-Liste des
  Workspace
- **Kombinieren**: kombiniert die Werte anderer Spalten derselben Tabelle
  über eine Vorlage mit `{spaltenname}`-Platzhaltern
- **Fremdschlüssel** (Standard-Generator für FK-Spalten, wird beim Anhaken
  der FK-Checkbox automatisch zugewiesen): zieht Werte aus der
  referenzierten Spalte; die erste FK-Spalte einer Tabelle bestimmt
  zusammen mit der Kardinalität des Projekts die Datensatzanzahl

Ohne Generator greift ein sinnvoller Standard je Datentyp (laufende Nummer,
UUID4, Zufallsdatum, …). Der **Stift** neben der Auswahl öffnet einen
Parameter-Dialog mit je Parametertyp passendem Eingabefeld; die Zelle zeigt
danach den Anzeige-Text der Konfiguration (z. B. `Random Int: 1 … 100`,
`FK → shop.customers.id`). Probleme der Konfiguration — fehlende
Pflichtparameter, Referenzen auf inzwischen umbenannte oder gelöschte
Tabellen/Spalten/Nachschlagelisten/Generatoren — markieren die Zelle und
erscheinen als **Warnungen** in der Problems-Ansicht.

## Benutzerdefinierte Generatoren (`.tdgen`)

Über **„Datenschmiede: Neuen Generator erstellen…“** entsteht eine
`.tdgen`-Datei (TOML) mit eigenem Custom Editor im Stil eines
**Jupyter-Notebooks**: Name und Beschreibung als Markdown oben, darunter
eine dynamische **Parameter-Tabelle** (Name, Datentyp — die Spaltentypen
erweitert um Nachschlageliste, referenzierte Tabelle und Spalte —,
Beschreibung, optionale vordefinierte Werteliste, Pflicht-Flag) sowie drei
Python-**Code-Zellen** mit fest vorgegebener, nicht änderbarer Signatur und
editierbarem Rumpf:

- `def generate(params, n, ctx) -> pandas.Series` (Pflicht): erzeugt die
  Werte; `ctx` bietet `rng` (numpy), `pd`/`np`, `faker(locale)`,
  `column("name")` (Werte anderer Spalten) und `lookup("liste", "spalte")`
- `def parse_params(params)` (optional): wandelt die String-Parameter in
  typisierte Werte
- `def display_value(params)` (optional): kompakte Zusammenfassung für
  Lauf-Protokoll/Vorschau

Referenziert wird ein Generator über seinen **Namen** (`custom:<name>`),
nicht den Dateinamen; wird die Datei gelöscht oder der Name geändert,
melden betroffene Tabellen das als Warnung. Beispiele:
[`samples/generators/sequential_id.tdgen`](samples/generators/sequential_id.tdgen)
(fortlaufende Kennungen wie `ORD-001000`, vektorisiert),
[`samples/generators/tracking_code.tdgen`](samples/generators/tracking_code.tdgen)
(Sendungsnummern mit Tabellen-/Spalten-Referenz auf eine andere Tabelle
via `ctx.table`) und
[`samples/generators/related_sum.tdgen`](samples/generators/related_sum.tdgen)
(Aggregation: Summe einer Spalte einer anderen Tabelle, gruppiert nach
einem Schlüssel — `SUM(order_items.quantity) GROUP BY order_id`),
[`samples/generators/value_category.tdgen`](samples/generators/value_category.tdgen)
(kategorisiert eine Spalte derselben Tabelle über den Parametertyp
`own_column` — die Quellspalte wird garantiert vorher generiert) und
[`samples/generators/parent_value.tdgen`](samples/generators/parent_value.tdgen)
(übernimmt zeilengenau einen Wert der führenden Tabelle via
`ctx.related`, z. B. das Land des bestellenden Kunden).

## Ausgabe je Tabelle (Dateiname + CSV)

Im **Übersicht**-Tab des Table Editors legt die Karte **„Ausgabe“** fest,
wie die generierte Datei heißt und aussieht:

- **Dateiname** als Tag-Feld (an Power Automate angelehnt): fester Text
  frei editierbar, dynamische Teile als klickbare Tags — aktuelles
  Datum/Uhrzeit, Zeitstempel, Schema, Tabellenname, Datensatzanzahl oder
  der Wert einer Spalte aus dem ersten generierten Datensatz (Menü
  **„Dynamischen Wert einfügen“**; Klick auf ein Tag entfernt es). Leer
  ergibt `schema_tabelle`
- **Dateityp** (vorerst nur CSV) mit Spaltentrenner, „jeden Wert in
  doppelte Anführungszeichen“, Dezimaltrenner, Datums-/Zeitstempelformat,
  Kopfzeile und Encoding

## Generator-Lauf

Der **Run-Knopf** in der Editor-Titelleiste des Projekt-Editors (bzw. der
Start-Knopf im Übersicht-Tab, Befehl **„Datenschmiede: Testdaten
generieren“**) startet die Generierung:

1. Reihenfolge bestimmen: Tabellen topologisch nach Fremdschlüssel- und
   Generator-Referenzen, innerhalb einer Tabelle Spalte für Spalte
   (Kombinations-Spalten nach ihren referenzierten Spalten)
2. Daten erzeugen: hochgradig vektorisiert über **pandas/numpy**
   ([`python/generate.py`](python/generate.py)), mit dem verknüpften
   Python-Interpreter des Projekts; referenzierte Tabellen entstehen über
   die Kardinalität (`5` oder `1..3` je Datensatz der referenzierten
   Tabelle)
3. Schreiben: eine CSV-Datei je Tabelle gemäß ihrer Ausgabe-Konfiguration
   in den Ordner `output/` neben der Projektdatei

Der Fortschritt erscheint VS-Code-typisch als Benachrichtigung mit
Fortschrittsbalken (abbrechbar); fehlende Python-Pakete (`pandas`, `numpy`,
`faker`) werden mit Ein-Klick-Installation gemeldet. Der Übersicht-Tab des
Projekt-Editors zeigt vorab je ausgewählter Tabelle die **generierte
Datei** (td-Datei, Name, Dateiname-Vorlage, Datensatzanzahl — rein lesend).

## Roadmap

Die Extension wird schrittweise zu einem vollständigen Generator für
synthetische Testdaten ausgebaut, u. a.:

- Vorschau generierter Testdaten direkt in VS Code
- Weitere Ausgabeformate (z. B. JSON, SQL-Inserts, Parquet)
- Weitere eingebaute Generatoren (z. B. Sequenzen mit Mustern,
  Normalverteilungen)
