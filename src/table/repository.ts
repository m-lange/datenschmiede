import * as vscode from 'vscode';
import { Table, logicalTableName } from './model';
import { parseTableText } from './toml';
import { ParseError } from '../tomlUtil';
import { GeneratorBase } from '../generator/base';

/**
 * Eine `.td`-Datei im Workspace, roh eingelesen und geparst — gemeinsame
 * Grundlage für alles, was den Workspace nach Tabellen durchsucht:
 * die FK-„Referenzierte Tabelle“-/„Referenzierte Spalte“-Auswahl im Table
 * Editor (siehe TableOption/toTableOptions unten), den Projekt-Tabellenbaum
 * (project/tree.ts, gruppiert nach Schema) und die FK-Abhängigkeitsauflösung
 * dort (braucht die vollen Spalten inkl. `fk`/`fk_table`, nicht nur Namen).
 */
export interface TableEntry {
	/** Absoluter URI der Datei — zum Öffnen (z. B. aus dem Projekt-Tabellenbaum) oder erneuten Einlesen. */
	uri: vscode.Uri;
	/** Workspace-relativer Pfad (POSIX-Trenner), via `vscode.workspace.asRelativePath`. */
	relativePath: string;
	/** Rohtext zum Zeitpunkt des Einlesens — für Diagnostics (Zeilenpositionen) ohne erneutes Lesen/Parsen. */
	text: string;
	/** Geparste Tabelle, oder `null`, wenn die Datei kein gültiges TOML enthält (oder nicht lesbar war). */
	table: Table | null;
	/** Der Parse-Fehler samt Position, falls das TOML kaputt ist (nicht gesetzt bei Lese-Fehlern). */
	error: ParseError | null;
	/** Logische Identität (`schema.name`), oder `relativePath` als Fallback ohne gesetzten Namen bzw. bei Parse-Fehler. */
	label: string;
}

/** Eine Tabelle im Workspace, für die FK-„Referenzierte Tabelle“-/„Referenzierte Spalte“-Auswahl. */
export interface TableOption {
	/** Logische Identität (`schema.name`, oder Dateipfad als Fallback ohne gesetzten Namen). */
	label: string;
	/** Namen ihrer Spalten, für die „Referenzierte Spalte“-Auswahl. */
	columns: string[];
}

/** Liest den Inhalt einer Datei — bevorzugt aus einem bereits offenen, noch ungesicherten Editor-Buffer statt von der Festplatte. */
export async function readFileText(uri: vscode.Uri): Promise<string> {
	const openDocument = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === uri.toString());
	if (openDocument) {
		return openDocument.getText();
	}
	const bytes = await vscode.workspace.fs.readFile(uri);
	return Buffer.from(bytes).toString('utf8');
}

/**
 * Baut den Eintrag einer `.td`-Datei aus ihrem Rohtext — `text: null` steht
 * für eine nicht lesbare Datei (sie bleibt in der Liste sichtbar, statt
 * kommentarlos zu verschwinden). Gemeinsame Grundlage für listTables und den
 * Workspace-Index (src/workspaceIndex.ts).
 */
export function buildTableEntry(uri: vscode.Uri, relativePath: string, text: string | null): TableEntry {
	if (text === null) {
		return { uri, relativePath, text: '', table: null, error: null, label: relativePath };
	}
	try {
		const table = parseTableText(text);
		return { uri, relativePath, text, table, error: null, label: tableLabel(table, relativePath) };
	} catch (err) {
		const error = err instanceof ParseError ? err : new ParseError(err instanceof Error ? err.message : String(err));
		return { uri, relativePath, text, table: null, error, label: relativePath };
	}
}

/**
 * Liest und parst alle `.td`-Dateien im Workspace ein. Für offene, noch
 * ungesicherte Dateien wird der aktuelle Editor-Inhalt statt der
 * Festplattenversion gelesen (siehe readFileText). Dateien mit kaputtem TOML
 * landen trotzdem in der Liste (mit `table: null`), damit sie z. B. im
 * Projekt-Tabellenbaum sichtbar bleiben statt kommentarlos zu verschwinden.
 *
 * Für die laufend benötigten Listen (Diagnostics, Editor-Webviews) hält der
 * Workspace-Index (src/workspaceIndex.ts) einen gemeinsamen Cache — diese
 * Funktion bleibt für einmalige Befehle (Generator-Lauf, Vorschau).
 */
export async function listTables(): Promise<TableEntry[]> {
	const uris = await vscode.workspace.findFiles('**/*.td', '**/node_modules/**');
	return Promise.all(
		uris.map(async (uri): Promise<TableEntry> => {
			const relativePath = vscode.workspace.asRelativePath(uri, false);
			const text = await readFileText(uri).catch(() => null);
			return buildTableEntry(uri, relativePath, text);
		}),
	);
}

/**
 * Verdichtet Tabellen-Einträge zu den `TableOption`s der FK-Auswahl im Table
 * Editor: eine Zeile je logischer Identität (Duplikate — zwei Dateien mit
 * demselben `schema.name` — werden auf den ersten Treffer reduziert), nach
 * Label sortiert.
 */
export function toTableOptions(entries: TableEntry[]): TableOption[] {
	const byLabel = new Map<string, TableOption>();
	for (const entry of entries) {
		if (byLabel.has(entry.label)) {
			continue;
		}
		const columns = entry.table
			? entry.table.columns.map((column) => column.name.trim()).filter((name) => name.length > 0)
			: [];
		byLabel.set(entry.label, { label: entry.label, columns });
	}
	return Array.from(byLabel.values()).sort((a, b) => a.label.localeCompare(b.label));
}

/** Logische Tabellen-Identität (siehe `logicalTableName`); fällt auf `fallbackPath` zurück, solange kein Name gesetzt ist. */
export function tableLabel(table: Table, fallbackPath: string): string {
	return logicalTableName(table) || fallbackPath;
}

/**
 * Referenzierte Tabellen-Labels einer Tabelle (ohne Selbst-Referenzen):
 * aus FK-Spalten und den `table`-Referenzen der konfigurierten Generatoren.
 * Gemeinsamer Baustein von buildTableRefEdges und buildRequiredEdges.
 */
function collectRefLabels(table: Table, ownLabel: string, generatorsById: Map<string, GeneratorBase>): Set<string> {
	const ownColumns = table.columns.map((c) => c.name.trim()).filter((c) => c.length > 0);
	const targets = new Set<string>();
	for (const column of table.columns) {
		if (column.fk) {
			const fkTable = column.fkTable.trim();
			if (fkTable && fkTable !== ownLabel) {
				targets.add(fkTable);
			}
		}
		if (column.generator?.id.trim()) {
			const generator = generatorsById.get(column.generator.id);
			if (generator) {
				const refs = generator.requiredRefs(column.generator, {
					ownColumnName: column.name.trim(),
					ownColumns,
					fkTable: column.fkTable,
					fkColumn: column.fkColumn,
					tables: [],
					lookups: [],
				});
				for (const label of refs.tables) {
					const trimmed = label.trim();
					if (trimmed && trimmed !== ownLabel) {
						targets.add(trimmed);
					}
				}
			}
		}
	}
	return targets;
}

/** Generatoren als Map über ihre `id`, für die Referenz-Auflösung ohne lineare Suche je Spalte. */
export function generatorsById(generators: GeneratorBase[]): Map<string, GeneratorBase> {
	return new Map(generators.map((generator) => [generator.id, generator] as const));
}

/**
 * Referenz-Kanten zwischen den Tabellen des Workspace (logische Identität →
 * referenzierte Identitäten), aus FK-Spalten und den `table`-Referenzen der
 * konfigurierten Generatoren. Selbst-Referenzen werden übersprungen (die
 * meldet bereits die FK-Validierung). Grundlage der Zyklus-Erkennung
 * (findTableCycle in table/validation.ts).
 */
export function buildTableRefEdges(entries: TableEntry[], generators: GeneratorBase[]): Map<string, string[]> {
	const byId = generatorsById(generators);
	const edges = new Map<string, string[]>();
	for (const entry of entries) {
		if (!entry.table) {
			continue;
		}
		const ownLabel = tableLabel(entry.table, entry.relativePath);
		const targets = collectRefLabels(entry.table, ownLabel, byId);
		if (targets.size > 0 && !edges.has(ownLabel)) {
			edges.set(ownLabel, [...targets]);
		}
	}
	return edges;
}

/**
 * Referenz-Kanten auf *Pfad*-Ebene (workspace-relativer Pfad → benötigte
 * Pfade): dieselbe Ableitung wie buildTableRefEdges, aber die referenzierten
 * Labels sind bereits auf die (erste) Datei mit dieser logischen Identität
 * aufgelöst. Einmal gebaut, ist jede Hüllen-Berechnung (closureOf) reine
 * Graph-Traversierung — wichtig für den Tabellen-Tab des Projekt-Editors,
 * der den Sperr-Status jeder ausgewählten Tabelle über eine eigene Hülle
 * bestimmt (siehe buildPickerTree in project/editorProvider.ts).
 */
export function buildRequiredEdges(entries: TableEntry[], generators: GeneratorBase[]): Map<string, string[]> {
	const byId = generatorsById(generators);
	const byLabel = new Map<string, TableEntry>();
	for (const entry of entries) {
		if (entry.table && !byLabel.has(entry.label)) {
			byLabel.set(entry.label, entry);
		}
	}

	const edges = new Map<string, string[]>();
	for (const entry of entries) {
		if (!entry.table) {
			continue;
		}
		const ownLabel = tableLabel(entry.table, entry.relativePath);
		const targets: string[] = [];
		for (const label of collectRefLabels(entry.table, ownLabel, byId)) {
			const target = byLabel.get(label);
			if (target) {
				targets.push(target.relativePath);
			}
		}
		if (targets.length > 0) {
			edges.set(entry.relativePath, targets);
		}
	}
	return edges;
}

/**
 * Transitive Hülle über vorberechnete Pfad-Kanten (buildRequiredEdges):
 * alle Pfade, die von `selected` aus (rekursiv) referenziert werden —
 * inklusive Mitgliedern von `selected`, die von anderen referenziert werden.
 */
export function closureOf(selected: ReadonlySet<string>, edges: Map<string, string[]>): Set<string> {
	const required = new Set<string>();
	const visited = new Set<string>(selected);
	const queue = [...selected];
	while (queue.length > 0) {
		const path = queue.shift();
		const targets = path ? edges.get(path) : undefined;
		if (!targets) {
			continue;
		}
		for (const target of targets) {
			required.add(target);
			if (!visited.has(target)) {
				visited.add(target);
				queue.push(target);
			}
		}
	}
	return required;
}

/**
 * Löst die transitive Hülle der referenzierten Tabellen auf: ausgehend von
 * `selected` (workspace-relative Pfade) wird für jede Tabelle jede gültige
 * `fk_table`-Referenz aufgelöst und rekursiv weiterverfolgt — plus jede
 * Tabelle, die ein konfigurierter Spalten-Generator benötigt (Parameter vom
 * Typ `table`, siehe GeneratorBase.requiredRefs). Leere und Selbst-Referenzen
 * (siehe validation.ts) werden übersprungen, ebenso Referenzen auf nicht
 * (mehr) vorhandene Tabellen.
 *
 * Grundlage für den Projekt-Tabellenbaum: Tabellen in der zurückgegebenen
 * Menge müssen ausgewählt bleiben, damit jede ausgewählte Fremdschlüssel-
 * Spalte und jeder Generator ein gültiges Ziel hat.
 *
 * Bequeme Hülle über buildRequiredEdges + closureOf — wer mehrere Hüllen
 * über denselben Einträgen braucht, baut die Kanten einmal selbst.
 *
 * @param generators Alle verfügbaren Generatoren (eingebaute + benutzerdefinierte),
 * um Generator-Referenzen aufzulösen; ohne Angabe zählen nur FK-Referenzen.
 * @returns Die Pfade der (rekursiv) benötigten Tabellen — schließt `selected`
 * selbst nicht mit ein, auch wenn eine Tabelle sich selbst über einen Umweg
 * referenziert (durch die Selbst-Referenz-Prüfung ohnehin ausgeschlossen).
 */
export function computeRequiredClosure(
	selected: ReadonlySet<string>,
	entries: TableEntry[],
	generators: GeneratorBase[] = [],
): Set<string> {
	return closureOf(selected, buildRequiredEdges(entries, generators));
}
