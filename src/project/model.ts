/**
 * Datenmodell eines .tdproject-Testdatenprojekts.
 *
 * Wie bei table/model.ts ist dies die "Wahrheit", mit der die Projekt-Webview
 * arbeitet; sie wird vom Extension-Host aus dem TOML-Text der Dokument-Datei
 * erzeugt (siehe project/toml.ts) und nach jeder Änderung wieder zu TOML
 * serialisiert.
 */

/** Eine der Tabellen, die zu diesem Projekt gehören (Auswahl über den Tabellenbaum, siehe project/tree.ts). */
export interface ProjectTable {
	/** Workspace-relativer Pfad (POSIX-Trenner) der zugehörigen `.td`-Datei. */
	path: string;
	/**
	 * Anzahl zu erzeugender Datensätze, als kompakter String. Für Tabellen
	 * ohne gültigen ausgehenden Fremdschlüssel (primäre Tabellen) eine feste
	 * Zahl ("100"); für Tabellen mit ausgehendem Fremdschlüssel (referenzierte
	 * bzw. sekundäre Tabellen) die Anzahl je Datensatz der referenzierten
	 * Tabelle — feste Zahl ("5") oder Bereich ("1..3"), siehe
	 * table/cardinality.ts. Pflicht für jede ausgewählte Tabelle; fehlt der
	 * Wert, meldet der Projekt-Editor das in der Problems-Ansicht (siehe
	 * buildRecordsDiagnostics in project/editorProvider.ts).
	 */
	records?: string;
}

/** Der mit diesem Projekt verknüpfte Python-Interpreter (für den künftigen Generator-Lauf). */
export interface PythonLink {
	/** Pfad zum Python-Interpreter bzw. zum Umgebungsordner. */
	path: string;
	/** ID der Umgebung aus der Python-Extension, falls bekannt — best effort zur Wiederauflösung (siehe project/python.ts). */
	id?: string;
}

export interface Project {
	name: string;
	description: string;
	/** `null`, solange (noch) kein Python-Interpreter verknüpft wurde. */
	python: PythonLink | null;
	tables: ProjectTable[];
}

export function createEmptyProject(name = ''): Project {
	return { name, description: '', python: null, tables: [] };
}
