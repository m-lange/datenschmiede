import * as vscode from 'vscode';
import { Table, logicalTableName } from './model';
import { parseTableText } from './toml';

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
	/** Geparste Tabelle, oder `null`, wenn die Datei kein gültiges TOML enthält. */
	table: Table | null;
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
 * Liest und parst alle `.td`-Dateien im Workspace ein. Für offene, noch
 * ungesicherte Dateien wird der aktuelle Editor-Inhalt statt der
 * Festplattenversion gelesen (siehe readFileText). Dateien mit kaputtem TOML
 * landen trotzdem in der Liste (mit `table: null`), damit sie z. B. im
 * Projekt-Tabellenbaum sichtbar bleiben statt kommentarlos zu verschwinden.
 */
export async function listTables(): Promise<TableEntry[]> {
	const uris = await vscode.workspace.findFiles('**/*.td', '**/node_modules/**');
	return Promise.all(
		uris.map(async (uri): Promise<TableEntry> => {
			const relativePath = vscode.workspace.asRelativePath(uri, false);
			try {
				const text = await readFileText(uri);
				const table = parseTableText(text);
				return { uri, relativePath, table, label: tableLabel(table, relativePath) };
			} catch {
				return { uri, relativePath, table: null, label: relativePath };
			}
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
 * Löst die transitive Hülle der über Fremdschlüssel referenzierten Tabellen
 * auf: ausgehend von `selected` (workspace-relative Pfade) wird für jede
 * Tabelle jede gültige `fk_table`-Referenz aufgelöst und rekursiv
 * weiterverfolgt. Leere und Selbst-Referenzen (siehe validation.ts) werden
 * übersprungen, ebenso Referenzen auf nicht (mehr) vorhandene Tabellen.
 *
 * Grundlage für den Projekt-Tabellenbaum (project/tree.ts): Tabellen in der
 * zurückgegebenen Menge müssen ausgewählt bleiben, damit jede ausgewählte
 * Fremdschlüssel-Spalte ein gültiges Ziel hat.
 *
 * @returns Die Pfade der (rekursiv) benötigten Tabellen — schließt `selected`
 * selbst nicht mit ein, auch wenn eine Tabelle sich selbst über einen Umweg
 * referenziert (durch die Selbst-Referenz-Prüfung ohnehin ausgeschlossen).
 */
export function computeRequiredClosure(selected: ReadonlySet<string>, entries: TableEntry[]): Set<string> {
	const byLabel = new Map<string, TableEntry>();
	const byPath = new Map<string, TableEntry>();
	for (const entry of entries) {
		byPath.set(entry.relativePath, entry);
		if (entry.table && !byLabel.has(entry.label)) {
			byLabel.set(entry.label, entry);
		}
	}

	const required = new Set<string>();
	const visited = new Set<string>(selected);
	const queue = [...selected];

	while (queue.length > 0) {
		const path = queue.shift();
		const entry = path ? byPath.get(path) : undefined;
		if (!entry?.table) {
			continue;
		}
		const ownLabel = tableLabel(entry.table, entry.relativePath);
		for (const column of entry.table.columns) {
			if (!column.fk) {
				continue;
			}
			const fkTable = column.fkTable.trim();
			if (!fkTable || fkTable === ownLabel) {
				continue;
			}
			const target = byLabel.get(fkTable);
			if (!target) {
				continue;
			}
			required.add(target.relativePath);
			if (!visited.has(target.relativePath)) {
				visited.add(target.relativePath);
				queue.push(target.relativePath);
			}
		}
	}

	return required;
}
