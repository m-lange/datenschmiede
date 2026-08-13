import { Table, logicalTableName } from './model';

/**
 * Inhaltliche Prüfungen für eine Tabellendefinition, unabhängig davon, ob
 * das TOML syntaktisch gültig ist (das prüft table/toml.ts/parseTableText bereits).
 *
 * Bewusst frei von jeder vscode-Abhängigkeit (einfach testbar); die
 * Übersetzung der Meldungen für die Problems-Ansicht übernimmt der Aufrufer
 * (table/editorProvider.ts) über vscode.l10n, die Webview zeigt dieselben
 * Regeln nochmal direkt am Feld an (siehe media/table.js).
 */
export type IssueKind =
	| 'fk-missing-table'
	| 'fk-table-not-found'
	| 'fk-self-reference'
	| 'fk-missing-column'
	| 'fk-column-not-found';

export interface Issue {
	columnIndex: number;
	columnName: string;
	kind: IssueKind;
	/** Zusätzliche Angabe für die Meldung, z. B. der (nicht gefundene) `fk_table`-/`fk_column`-Wert. */
	detail?: string;
}

/** Eine Tabelle des Workspace, um FK-Referenzen gegenzuprüfen (siehe TableOption in table/repository.ts). */
export interface KnownTable {
	/** Logische Identität (`schema.name` bzw. nur `name`), wie sie in `fk_table` gespeichert wird. */
	label: string;
	columns: string[];
}

/**
 * @param knownTables Alle `.td`-Tabellen, die aktuell im Workspace gefunden wurden. Wird
 * genutzt, um veraltete FK-Referenzen zu erkennen, z. B. wenn die referenzierte Datei
 * inzwischen gelöscht oder die Spalte dort umbenannt/entfernt wurde.
 */
export function validateTable(table: Table, knownTables: KnownTable[] = []): Issue[] {
	const issues: Issue[] = [];
	// Eigene logische Identität dieser Tabelle, um eine Selbst-Referenz zu erkennen
	// (leer, solange die Tabelle noch keinen Namen hat -> dann kann fk_table ihr
	// auch nicht gleichen, der Vergleich unten greift also erst, sobald sie einen hat).
	const ownLabel = logicalTableName(table);

	table.columns.forEach((column, columnIndex) => {
		if (!column.fk) {
			return;
		}

		const fkTable = column.fkTable.trim();
		const referencedTable = fkTable ? knownTables.find((t) => t.label === fkTable) : undefined;
		if (!fkTable) {
			issues.push({ columnIndex, columnName: column.name, kind: 'fk-missing-table' });
		} else if (ownLabel && fkTable === ownLabel) {
			issues.push({ columnIndex, columnName: column.name, kind: 'fk-self-reference' });
		} else if (!referencedTable) {
			issues.push({ columnIndex, columnName: column.name, kind: 'fk-table-not-found', detail: fkTable });
		}

		const fkColumn = column.fkColumn.trim();
		if (!fkColumn) {
			issues.push({ columnIndex, columnName: column.name, kind: 'fk-missing-column' });
		} else if (referencedTable && !referencedTable.columns.includes(fkColumn)) {
			// Nur prüfen, wenn die referenzierte Tabelle selbst gefunden wurde — sonst wäre das
			// nur eine Folge von fk-table-not-found und würde die Meldung verdoppeln.
			issues.push({ columnIndex, columnName: column.name, kind: 'fk-column-not-found', detail: fkColumn });
		}
	});

	return issues;
}
