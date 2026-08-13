# Changelog

## 0.6.0

- **Testdaten-Generierung — der eigentliche Generator-Lauf ist da**: Der
  Befehl **„Datenschmiede: Testdaten generieren“** (Run-Knopf in der
  Editor-Titelleiste des Projekt-Editors, Start-Knopf im Übersicht-Tab oder
  Command Palette) erzeugt für alle ausgewählten Tabellen eines
  Testdatenprojekts synthetische Datensätze — mit dem verknüpften
  Python-Interpreter, hochgradig vektorisiert über **pandas/numpy**
  (`python/generate.py`), auch für große Datenmengen. Der Lauf bestimmt
  zuerst die Generier-Reihenfolge (Tabellen topologisch nach
  Fremdschlüssel-/Generator-Referenzen, darin Spalte für Spalte), meldet
  seinen Fortschritt VS-Code-typisch als Benachrichtigung mit
  Fortschrittsbalken (abbrechbar) und schreibt je Tabelle eine CSV-Datei in
  den Ordner `output/` neben der Projektdatei. Fehlende Python-Pakete
  werden mit Ein-Klick-Installation (Terminal, `pip install`) gemeldet.
- **Spaltengeneratoren im Table Editor**: neue Grid-Spalte
  **„Spaltengenerator“** mit Auswahl aller verfügbaren Generatoren —
  eingebaut (`src/generator/builtins/`, je einer pro Datei) sind
  **Random Int**, **Random Float**, **Faker** (realistische Namen,
  Adressen, … via Python-Paket `faker`), **Nachschlageliste** (gewichtete
  Werte aus `.lkp`), **Kombinieren** (`{spalten}`-Vorlage über die Werte
  anderer Spalten) sowie der Standard-Generator **Fremdschlüssel**, der
  beim Anhaken der FK-Checkbox automatisch zugewiesen wird und die
  FK-Beziehung beim Lauf auflöst. Ohne Generator greift ein sinnvoller
  Standard je Datentyp. Der Stift neben der Auswahl öffnet einen
  Parameter-Dialog mit je Parametertyp passendem Eingabefeld (Zahl, Datum,
  Auswahl aus vordefinierter Liste, Tabelle/Spalte/Nachschlageliste des
  Workspace, …); die Zelle zeigt danach den Anzeige-Text der Konfiguration
  (z. B. `Random Int: 1 … 100`, `FK → shop.customers.id`) statt nur des
  Namens. Warnungen zur Konfiguration (fehlender Pflichtparameter,
  Referenz auf inzwischen umbenannte/gelöschte Tabellen, Spalten,
  Nachschlagelisten oder Generatoren) markieren die Zelle orange und
  erscheinen als Warning-Diagnostics in der Problems-Ansicht.
- **Neuer Dateityp `.tdgen` („Generator“)**: benutzerdefinierte Generatoren
  im Workspace, mit eigenem Custom Editor (`GeneratorEditorProvider`,
  `src/generator/editorProvider.ts`) im Stil eines **Jupyter-Notebooks**:
  Name/Beschreibung als Markdown-Zelle oben, darunter die dynamische
  **Parameter-Tabelle** (Name, Datentyp — Spaltentypen erweitert um
  Nachschlageliste/Tabelle/Spalte —, Beschreibung, optionale vordefinierte
  Werteliste, Pflicht-Flag) und drei Python-**Code-Zellen** mit fest
  vorgegebener, nicht änderbarer Signatur und editierbarem Rumpf:
  `generate` (Pflicht), `parse_params` und `display_value` (optional, je
  mit erklärender Beschreibung davor). Datei-Icon: `GenerateMethod`-Symbol
  in Magenta (`#D743EB`; für helle Themes eine dunklere Variante
  `#A21FB8`, `icons/tdgen-*.svg`). Befehl **„Datenschmiede: Neuen
  Generator erstellen…“**; Beispiel unter `samples/order_number.tdgen`.
- **Ausgabe-Einstellungen je Tabelle (Übersicht-Tab des Table Editors)**:
  der **Dateiname** der generierten Datei als Tag-Feld im Stil von Power
  Automate — konstanter Text frei editierbar, dynamische Teile (aktuelles
  Datum/Uhrzeit, Zeitstempel, Schema, Tabellenname, Datensatzanzahl oder
  der Wert einer Spalte aus dem ersten Datensatz) als klickbare Tags über
  das Menü **„Dynamischen Wert einfügen“**. Dazu die
  **Dateityp-Konfiguration** (vorerst CSV) mit Spaltentrenner,
  Anführungszeichen-Verhalten, Dezimaltrenner, Datums-/Zeitstempelformat,
  Kopfzeile und Encoding (`[output]`-Block der `.td`-Datei).
- **Projekt-Editor**: der Übersicht-Tab zeigt neu die **generierten
  Dateien** (Tabelle, `.td`-Datei, Dateiname-Vorlage mit Tags,
  Datensatzanzahl — rein lesend) samt Start-Knopf. Die automatische
  Tabellen-Mitnahme im Tabellen-Tab berücksichtigt neben Fremdschlüsseln
  jetzt auch die von Spaltengeneratoren **benötigten Tabellen**.

## 0.5.0

- **Neuer Dateityp `.lkp` ("Nachschlageliste")**: gewichtete Wertelisten für
  die Testdaten-Generierung. Technisch eine Semikolon-getrennte CSV-Datei
  (jeder Wert in doppelten Anführungszeichen, Kopfzeile oben; Name und
  Beschreibung als `#`-Kommentarzeilen am Dateianfang), mit eigenem Custom
  Editor (`LookupEditorProvider`, `src/lookup/editorProvider.ts`) im selben
  visuellen Stil wie Table- und Projekt-Editor. Datei-Icon: Lookup-Symbol in
  Grün (`#23CC99`, je Theme-Helligkeit eine Variante, `icons/lookup-*.svg`):
  - **Übersicht**-Tab: Name, Beschreibung (Markdown) sowie ein
    Verteilungs-Diagramm — ein horizontaler Balken je Wertezeile
    (beschriftet mit dem Wert der ersten Spalte, Gewicht am Balkenende)
    plus Summen-Hinweis
  - **Werte**-Tab: Grid mit frei hinzufüg-/entfernbaren Spalten und Zeilen.
    Jede Wertespalte ist direkt über ihre Kopfzelle umbenennbar; die
    Phantom-Kopfzelle **„+ Neue Spalte“** legt beim Tippen sofort eine neue
    Spalte an. Die Gewichtsspalte (**Gewicht in %**) ist fest immer die
    letzte Spalte; die eingegebenen Gewichte gelten unverändert und dürfen
    in Summe beliebig von 100 % abweichen — die Summenzeile unter dem Grid
    zeigt den Gesamtwert rein informativ, ohne Prüfung. Nur einzelne
    fehlende oder ungültige Gewichte werden rot markiert und als
    Diagnostics in VS Codes Problems-Ansicht gemeldet
  - Befehl **„Datenschmiede: Neue Nachschlageliste erstellen…“** (Command
    Palette oder Rechtsklick im Explorer), analog zu „Neue Tabelle
    erstellen…“
- **Table Editor — neue Zeilen-Aktionen je Spalte**: nach oben/unten
  verschieben (Chevron-Knöpfe; am Anfang/Ende deaktiviert, ändert die
  Spaltenreihenfolge in der `.td`-Datei) sowie ein Auge-Umschalter zum Aus-/
  Einblenden — aktuell ein rein visueller Merkzustand ohne weitere Funktion
  (Zeile wird gedimmt, Icon wechselt zu durchgestrichenem Auge; nichts wird
  gespeichert). Die rote Hover-Farbe der Icon-Knöpfe gilt jetzt nur noch für
  destruktive Aktionen (Entfernen), nicht mehr z. B. fürs Öffnen einer
  Tabelle im Projekt-Editor

## 0.4.0

- **Neuer Dateityp `.tdproject` ("Testdatenprojekt")**: bündelt eine Auswahl
  von `.td`-Tabellen zu einem benannten, beschriebenen Projekt mit
  verknüpftem Python-Interpreter und je Tabelle einer Datensatzanzahl. Wie
  `.td` technisch TOML, mit eigenem Custom Editor (`ProjectEditorProvider`,
  `src/project/editorProvider.ts`) im selben visuellen Stil wie der Table
  Editor:
  - **Übersicht**-Tab: Name, Beschreibung (Markdown, wie beim Table Editor)
    sowie eine Zeile für den verknüpften Python-Interpreter
  - **Tabellen**-Tab: die komplette Tabellenauswahl als Baum-Tabelle direkt
    im Editor — alle `.td`-Tabellen des Workspace, gruppiert nach den
    Punkt-getrennten Segmenten ihres `schema`-Felds (z. B. `ag.cor.sapbp`
    als drei verschachtelte Zeilen) statt nach Ordnerstruktur, mit einem
    Live-Suchfeld darüber (filtert nach Tabellenname, Namensraum oder
    Dateipfad, Escape leert es). Jede Zeile hat eine Checkbox (Auswahl —
    wählt automatisch alle über Fremdschlüssel (rekursiv) referenzierten
    Tabellen mit aus und lässt sie sich nicht abwählen, solange sie noch
    benötigt werden; solche Tabellen zeigen ein Verlinkt-Icon samt
    „— erforderlich“ im Namen, Tabellen mit kaputtem TOML eine deaktivierte
    Checkbox mit demselben `.td`-Icon in Rot statt Blau), eine
    **Datensätze**-Spalte sobald ausgewählt (Eingabefeld ohne ausgehenden
    Fremdschlüssel, sonst „Abgeleitet über …“ — fehlt sie bei einer Tabelle,
    die sie braucht, erscheint das direkt am Feld **und** als Diagnostic in
    VS Codes **Problems-Ansicht**) sowie einen Knopf zum direkten Öffnen der
    `.td`-Datei
  - Befehl **„Datenschmiede: Neues Testdatenprojekt erstellen…“** (Command
    Palette oder Rechtsklick im Explorer), analog zu „Neue Tabelle
    erstellen…“
- **Python-Interpreter-Verknüpfung**: nutzt die offizielle, typisierte
  `@vscode/python-extension`-API der Python-Extension (`ms-python.python`,
  jetzt `extensionDependencies` — wird automatisch mit installiert). Beim
  ersten Öffnen eines Projekts ohne verknüpften Interpreter fragt die
  Extension aktiv nach; die Auswahl wird in der `.tdproject`-Datei
  gespeichert (`python_path`/`python_id`) und beim Öffnen erneut aufgelöst
  (inkl. Warnung, falls der Pfad nicht mehr existiert oder älter als Python
  3.10 ist). Beim Aktivieren der Extension prüft sie zusätzlich einmal, ob
  überhaupt eine Python-3.10+-Installation gefunden werden kann, und
  verweist andernfalls auf python.org — mehr ist ohne eigene
  VS-Code-API für Interpreter-Installation nicht möglich
- **Tabellen können sich im Table Editor nicht mehr selbst als
  Fremdschlüssel-Ziel referenzieren**: die eigene Tabelle ist im
  „Referenzierte Tabelle“-Auswahlfeld deaktiviert; ein von Hand im TOML
  eingetragener Selbst-Bezug wird als neue Diagnostic `fk-self-reference`
  sowohl am Feld als auch in der Problems-Ansicht gemeldet
- Eigenes Datei-Icon für `.tdproject` (Explorer, Tabs): `DataGenerator.svg`
  in einer Farbe, `#FFC000` (Dark-Theme) bzw. abgedunkelt auf `#8F6B00`
  (Light-Theme, ~4,9:1 Kontrast auf Weiß — `#FFC000` direkt hätte dort nur
  ~1,6:1, dieselbe Begründung wie beim `.td`-Icon in 0.3.0)
- 21 Beispieltabellen unter [`samples/`](samples/) (dazu das bestehende
  `example.td`, dessen bis dahin ungenutzte Selbst-Referenz durch die neue
  Prüfung ebenfalls aufgefallen und behoben wurde): mehrere
  Fremdschlüssel-Ketten über bis zu vier Ebenen sowie Namensräume mit einer,
  zwei und drei Schema-Ebenen (u. a. `ag.cor.sapbp`), um Tabellenbaum-
  Gruppierung und rekursive Auswahl auszuprobieren
- Umbenannt: `EditorProvider` → `TableEditorProvider`
  (`src/editorProvider.ts` → `src/table/editorProvider.ts`), zur
  Unterscheidung vom neuen `ProjectEditorProvider`
- Größere interne Aufräumarbeiten für die beiden Editoren nebeneinander:
  `src/model.ts`/`toml.ts`/`validation.ts`/`webviewStrings.ts`/
  `cardinality.ts` liegen jetzt unter `src/table/`, ihre neuen
  Projekt-Gegenstücke unter `src/project/`; generische, von beiden
  Dateiformaten geteilte TOML-Bausteine (`ParseError`, `tomlString`) wurden
  nach `src/tomlUtil.ts` ausgelagert; das Workspace-weite Einlesen/Parsen
  aller `.td`-Dateien lebt jetzt einmalig in `src/table/repository.ts`
  (vom Table Editor **und** vom Tabellen-Tab des Projekt-Editors genutzt,
  inkl. `computeRequiredClosure` für die rekursive FK-Auflösung); die
  webview-seitigen DOM-/Markdown-/Select-Helfer wurden aus `media/main.js`
  (jetzt `media/table.js`) nach `media/common.js` extrahiert und werden von
  `table.js` und dem neuen `project.js` gemeinsam genutzt
- Der Befehl „Datenschmiede: Python-Interpreter auswählen…“ wirkt auf den
  gerade fokussierten `.tdproject`-Editor-Tab, ermittelt über VS Codes
  native Tab-API (`vscode.window.tabGroups`) statt einer eigenen
  „aktives Projekt“-Verfolgung — die brauchte es nur für die inzwischen
  wieder entfernte Seitenleisten-Ansicht

## 0.3.0

- Fremdschlüssel, deren referenzierte Tabelle oder Spalte (nicht mehr)
  gefunden wird — z. B. weil die `.td`-Datei der referenzierten Tabelle
  gelöscht/umbenannt oder die Spalte dort entfernt wurde — werden jetzt
  erkannt: farbliche Markierung am Feld (wie bei fehlender Auswahl) **und**
  Eintrag in VS Codes Problems-Ansicht. Das erkennt auch Änderungen an
  anderen `.td`-Dateien im Workspace, nicht nur an der gerade geöffneten
  Datei selbst
- Validierungsfehler im Grid (fehlende FK-Referenz/-Spalte, ungültige
  Kardinalität) markieren jetzt nur noch das Feld farblich (roter Rahmen +
  Tooltip) statt zusätzlichen Fehlertext einzublenden — die ausführliche
  Meldung steht weiterhin in VS Codes Problems-Ansicht
- Spalten-Beschreibung im Grid nutzt jetzt wieder dasselbe
  Vorschau-/Editor-Feld mit Markdown-Unterstützung wie die
  Tabellenbeschreibung im Übersicht-Tab (gerendert anzeigen, Klick zum
  Bearbeiten). Im Grid bleibt die Vorschau abweichend einzeilig mit
  Ellipsis bei Überlänge statt automatisch zu wachsen
- Bugfix: die Ellipsis bei Überlänge der Spalten-Beschreibung fehlte
  zwischenzeitlich ganz, obwohl der Text sichtbar abgeschnitten wurde.
  Grund: `text-overflow: ellipsis` wird von `<textarea>`-Elementen nicht
  unterstützt (nur von Block-Elementen wie `<div>` oder von `<input>`) —
  ein zwischenzeitlicher Versuch, Vorschau und Bearbeitung in einem
  einzigen `<textarea>` zu vereinen, konnte die Ellipsis deshalb
  grundsätzlich nicht darstellen. Die Lösung ist ein `<div>` für die
  Vorschau (unterstützt Ellipsis zuverlässig) mit einer separaten,
  standardmäßig per `hidden`-Attribut ausgeblendeten Textarea zum
  Bearbeiten — sorgfältig ohne die schon zuvor gefundene Falle einer
  Autoren-`display`-Regel, die `[hidden]` aushebelt
- Bugfix: der native Dropdown-Pfeil von Select-Feldern (Datentyp,
  Referenzierte Tabelle/Spalte) konnte bei sehr schmalen Spalten aus dem
  Sichtbereich geraten — ersetzt durch ein eigenes, garantiert sichtbares
  Chevron-Icon
- Bugfix: das Datentyp-Select (und das Kardinalitäts-Feld) konnten breiter
  werden als ihre Spalte und sichtbar über die Beschreibung-Nachbarspalte
  laufen — verursacht durch eine globale `min-width: 140px` auf allen
  Text-/Auswahlfeldern, die größer war als die Mindestbreite der Datentyp-
  (120px) bzw. Kardinalitäts-Spalte (110px). Grid-Zellen setzen diese
  Mindestbreite jetzt zurück (die eigentlichen Untergrenzen kommen von den
  Spalten selbst); zusätzlich schneidet jede Grid-Zelle ihren Inhalt jetzt
  als Sicherheitsnetz an der Zellgrenze ab, statt ihn in die Nachbarspalte
  überlaufen zu lassen
- Fremdschlüssel können jetzt zusätzlich zur referenzierten Tabelle auch
  eine **referenzierte Spalte** angeben (`fk_column`) — als eigene
  Grid-Spalte, deren Auswahlliste sich nach der gewählten referenzierten
  Tabelle richtet. Fehlt sie, erscheint das wie bei der Tabelle als Problem
  in der Problems-Ansicht
- Grid-Spalten (Name, Datentyp, Beschreibung, Referenzierte Tabelle/Spalte,
  Zugehörige Datensätze) sind jetzt an ihrem Inhalt statt proportional
  gestreckt bemessen; eine unsichtbare Füll-Spalte am Ende nimmt übrigen
  Platz auf, damit das Grid trotzdem die volle Breite ausfüllt. Diese
  Spalten lassen sich außerdem per Ziehgriff am rechten Rand der Kopfzelle
  von Hand verbreitern/verschmälern — die Breiten werden geräteweit für
  alle `.td`-Dateien gemerkt (`globalState`)
- Bugfix: Von Hand gezogene Spaltenbreiten hatten keine Wirkung, weil
  `table-layout: auto` eine gesetzte `<col>`-Breite nur als Hinweis
  behandelt, den z. B. die Formularfelder in den Zellen überstimmen
  konnten. Die Tabelle misst ihre Spalten jetzt einmal automatisch, sobald
  sie im DOM hängt, und schaltet danach auf `table-layout: fixed` um —
  erst damit ist eine gesetzte Breite zuverlässig maßgeblich
- UI-Chrome sanfter/geräumiger gestaltet, angelehnt an den Assistant-Panel-
  Look dieser Extension: größere, weichere Rundungen, Übersicht-Felder und
  Spalten-Grid in Karten gruppiert, Tabs als Segmented Control statt
  Unterstreichung — Grid-Dichte (Zeilennummern, PK-/FK-Spalten) bleibt am
  SQL-Developer-Vorbild orientiert; weiterhin ausschließlich native
  VS-Code-Theme-Variablen, kein hartkodiertes Light/Dark
- **Dateiendung von `.dgen` zu `.td` geändert** (Custom Editor, Sprache,
  Datei-Icon, Beispiel, Workspace-Suche für FK-Tabellen)
- Datei-Icon durch `CaseTableColumn` aus der Visual Studio 2026 Image Library
  ersetzt; Icon-Farbe auf `#009EFF` (Dark-Theme, ~5,8:1 Kontrast) bzw.
  abgedunkelt auf `#0078C2` (Light-Theme, ~4,7:1 Kontrast auf Weiß —
  `#009EFF` direkt hätte dort nur ~2,9:1 und wäre zu schwer erkennbar)
- Modell-Typen generisch benannt: `DgenTable`/`DgenColumn` → `Table`/`Column`
  (ebenso `DgenParseError` → `ParseError`, `DgenIssue(Kind)` → `Issue(Kind)`)
- PK/FK sind jetzt einfache Checkboxen in eigenen Spalten nach der
  Beschreibung (statt gemeinsamer Badge-Spalte davor)
- Fremdschlüssel können eine **referenzierte Tabelle** sowie eine
  **Kardinalität** zugehöriger Datensätze für die Generierung hinterlegen —
  als eigene Grid-Spalten (nur aktiv, wenn FK angehakt ist), nicht mehr in
  einer aufklappbaren Detailzeile. Die Kardinalität ist ein Textfeld, z. B.
  `5` oder `1..3` (`fk_records`). Die referenzierte Tabelle wird als
  `schema.name` angezeigt und referenziert (`fk_table`, z. B.
  `"public.customers"`), nicht per Dateiname — bleibt also auch beim
  Umbenennen/Verschieben der Datei gültig; die Auswahl aktualisiert sich
  automatisch bei Anlegen/Löschen/inhaltlichen Änderungen im Workspace
- Validierung: fehlende FK-Referenz oder ungültige Kardinalität wird direkt
  am Feld markiert **und** als Diagnostic in VS Codes Problems-Ansicht
  eingetragen (ebenso TOML-Syntaxfehler, mit Zeile/Spalte)
- Tabellen- und Spalten-Beschreibung unterstützen jetzt **Markdown**
  (fett, kursiv, Code, Links, Listen), standardmäßig gerendert angezeigt,
  Klick zum Bearbeiten; die Tabellenbeschreibung wächst automatisch auf die
  zur Anzeige nötige Höhe
- Bugfix: Beschreibungsfelder zeigten Inhalt doppelt (gerendert + roh) an,
  weil eine CSS-Regel das `hidden`-Attribut der Bearbeiten-Textarea aushebelte
- Bugfix: ein leerer oder fehlender `fk_records`-Wert wurde beim Lesen bzw.
  Speichern still auf `"1"` zurückgesetzt, statt als Problem zu erscheinen —
  ungültige/leere Kardinalität bleibt jetzt unverändert erhalten und wird
  korrekt als Diagnostic in der Problems-Ansicht gemeldet
- „Dgen“/„DGen“ konsequent aus allen Bezeichnern entfernt: Datei
  `dgenEditorProvider.ts` → `editorProvider.ts` und Klasse
  `DgenEditorProvider` → `EditorProvider`; Funktionen `parseDgenText` →
  `parseTableText`, `serializeDgenTable` → `serializeTable`,
  `validateDgenTable` → `validateTable`, `newDgenTableCommand` →
  `newTableCommand`; Befehls-ID `dgen.newTable` → `datenschmiede.newTable`,
  Sprach-ID `dgen` → `td`, Command-Category „DGen“ → „Datenschmiede“,
  npm-Paketname `datenschmiede-dgen` → `datenschmiede-td`, TOML-Kopfzeile
  „# Datenschmiede DGen-Tabellendefinition“ → „# Datenschmiede
  Tabellendefinition“
- UI-Elemente strecken sich über die volle Panel-Breite (mit Mindestgrößen
  je Element statt fester, zentrierter Spalte)
- Eigener Breadcrumb-Kopf über den Tabs entfernt

## 0.2.0

- UI an Oracle SQL Developer for VS Code angelehnt: Breadcrumb-Kopf, Tabs
  ("Übersicht" / "Spalten"), dichtes Grid mit Zeilennummern und einer
  schmalen Flags-Spalte mit klickbaren P-/F-Badges statt Checkbox-Spalten
- Custom Datei-Icon für `.dgen`-Dateien (Explorer, Tabs, Breadcrumb)
- Lokalisierung: Oberfläche und Meldungen auf Deutsch und Englisch,
  automatisch passend zur VS-Code-Anzeigesprache (`vscode.l10n`)

## 0.1.0

- Custom Editor für `.dgen`-Dateien (TOML-basiert) im VS-Code-Look
- Globale Tabellenangaben: Schema, Name, mehrzeilige Beschreibung
- Spalten mit Name, Datentyp, PK, FK und Beschreibung hinzufügen/entfernen
- Befehl „Neue DGen-Tabelle erstellen…“
