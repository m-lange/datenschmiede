# Changelog

## 0.11.1

Eine Reihe von Korrekturen aus einem Durchlauf durch die gesamte Oberfläche:
Die Übersicht „Generierte Dateien“ zeigt jetzt die Endung, die der Lauf
wirklich schreibt (`.txt` statt `.fixed`, die des Dateigenerators statt
`custom:…`, und bei einer temporären Tabelle den Hinweis, dass keine Datei
entsteht); eine Tabelle mit führender Nachschlageliste nennt im Tab
**Tabellen** die Liste, statt ihr leeres Anzahl-Feld rot als Fehler zu
markieren; Beschreibungen rendern Markdown-Tabellen und relative Links auf
Nachbardateien, die sich anklicken lassen; der Parameter-Dialog zeigt die
Dokumentation eines Generators gerendert statt als Rohtext; ein Lauf ohne
verknüpften Interpreter bietet die Auswahl direkt an, statt nur zu melden;
die Zeilenaktionen (samt Stift für die Generator-Parameter) bleiben beim
seitlichen Scrollen am rechten Rand stehen; die Datei-Vorschau öffnet
schreibgeschützt und fragt beim Schließen nicht mehr nach dem Speichern; die
Zellen eines Generator-Notebooks zählen wieder von 1 aufwärts; neue Dateien
lehnen unzulässige Namen mit einer Meldung ab, statt am Dateisystem zu
scheitern; die Schema-Ansicht zeigt nach einer Änderung von außen wieder den
aktuellen Stand; und die Editoren behalten ihre Scrollposition, wenn eine
Änderung von außen eintrifft.

## 0.11.0

Generator-Parameter dürfen jetzt statt eines festen Werts andere Spalten
derselben Tabelle als `{spalte}` referenzieren und unterscheiden sich damit von
Datensatz zu Datensatz — etwa eine Faker-Locale `de_{land}` oder eine Obergrenze
`{kreditrahmen}`; bei Auswahl- und Datumsfeldern schaltet ein Knopf im
Parameter-Dialog auf freie Texteingabe um.

## 0.10.0

Eigene Seitenleiste mit fünf Ansichten, gerenderte Markdown-Tooltips in allen
Auswahllisten, ein Fremdschlüssel-Dialog mit Schema-Baum statt zweier
Grid-Spalten, zusätzliche Python-Pakete je Projekt über eine `requirements.txt`
und deutlich weniger Speicherbedarf bei großen Läufen. Dazu korrigierte
Datensatzzahlen bei führender Nachschlageliste, ein einheitliches Datumsformat,
<kbd>Strg</kbd>+<kbd>F5</kbd> für die Play-Aktion, eine Meldung bei doppelt
definierten Tabellen und eine komplett erneuerte Beispielsammlung.

## 0.9.0

Eigene Dateigeneratoren (`.filegen`) schreiben die Ausgabedatei komplett selbst,
der neue Dateityp „Temporäre Tabelle“ erzeugt Datensätze ohne Datei, und eine
führende Nachschlageliste gibt einer Tabelle genau einen Datensatz je Listenzeile.
Die Datei-Vorschau ist jetzt ein Play-Knopf in der Editor-Titelleiste, der die
fertige Datei als ungespeicherten Editor öffnet.

## 0.8.0

Neuer Dateityp „Feste Satzlänge“ mit dem Tab „Satzaufbau“ für Spalte,
Startposition, Breite, Ausrichtung und Füllzeichen, dazu Zeilenende,
Dezimaltrenner, optionale Kopfzeile und Encoding.

## 0.7.1

Arrays schreiben in XML jetzt ein wiederholtes Element mit dem Namen des Arrays,
und gleichnamige Geschwister-Knoten bleiben erhalten, weil die Verschachtelung in
`depth` statt in einem Namenspfad steckt. Aufbau und Wertzuordnung der
Zielstruktur stehen zusammen in einem Grid, mit eigenen Symbolen je Knotenart.

## 0.7.0

Drei neue Ausgabeformate neben CSV — Excel, JSON und XML —, wobei JSON und XML
ihre Zielstruktur über eigene Tabs samt Dokument-Vorschau beschreiben. Dazu der
Befehl „Testdaten generieren (Projekt auswählen)…“ und je eine Beispieltabelle
pro Format.

## 0.6.0

Die eigentliche Testdaten-Generierung: Spaltengeneratoren im Table Editor, der
neue Dateityp `.tdgen` für eigene Generatoren — inzwischen ein echtes
VS-Code-Notebook mit persistentem Python-Prozess —, Ausgabe-Einstellungen je
Tabelle und der Lauf über pandas/numpy mit Fortschritt im Ausgabekanal
„Datenschmiede“. Dazu ein gemeinsamer Workspace-Index für alle
Hintergrund-Prüfungen, zeilenkonsistente Nachschlagelisten, der Parametertyp
`own_column` und die Beispielsammlung „Webshop Demo“.

## 0.5.0

Neuer Dateityp `.lkp` („Nachschlageliste“) mit gewichteten Werten, dazu neue
Zeilen-Aktionen je Spalte im Table Editor.

## 0.4.0

Neuer Dateityp `.tdproject` („Testdatenprojekt“) mit Tabellenauswahl und
verknüpftem Python-Interpreter, dazu 21 Beispieltabellen und ein eigenes
Datei-Icon.

## 0.3.0

Fremdschlüssel bekommen referenzierte Tabelle, referenzierte Spalte und
Kardinalität, jeweils geprüft und in der Problems-Ansicht gemeldet;
Beschreibungen unterstützen Markdown, und die Grid-Spalten lassen sich in der
Breite ziehen. Die Dateiendung heißt jetzt `.td` statt `.dgen`.

## 0.2.0

Oberfläche an Oracle SQL Developer for VS Code angelehnt (Tabs „Übersicht“ und
„Spalten“), eigenes Datei-Icon und Lokalisierung auf Deutsch und Englisch.

## 0.1.0

Erste Fassung: Custom Editor für TOML-basierte Tabellendefinitionen mit Schema,
Name, mehrzeiliger Beschreibung und Spalten samt Datentyp, PK und FK, dazu der
Befehl zum Anlegen einer neuen Tabelle.
