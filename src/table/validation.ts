import { Table, logicalTableName } from './model';
import { GeneratorBase } from '../generator/base';
import { GeneratorContext, GeneratorIssueKind, KnownLookupRef } from '../generator/types';

/**
 * Inhaltliche Prüfungen für eine Tabellendefinition, unabhängig davon, ob
 * das TOML syntaktisch gültig ist (das prüft table/toml.ts/parseTableText bereits).
 *
 * Bewusst frei von jeder vscode-Abhängigkeit (einfach testbar); die
 * Übersetzung der Meldungen für die Problems-Ansicht übernimmt der Aufrufer
 * (table/editorProvider.ts) über vscode.l10n, die Webview zeigt dieselben
 * Regeln nochmal direkt am Feld an (siehe media/table.js).
 *
 * Neben den FK-Prüfungen (Fehler) laufen hier die Generator-Prüfungen
 * (Warnungen): jeder Generator prüft seine eigene Konfiguration selbst
 * (GeneratorBase.validate) — inklusive Referenzen auf Tabellen/Spalten/
 * Nachschlagelisten/Generatoren, die nach der Konfiguration umbenannt oder
 * gelöscht wurden.
 */
export type IssueKind =
	| 'fk-missing-table'
	| 'fk-table-not-found'
	| 'fk-self-reference'
	| 'fk-missing-column'
	| 'fk-column-not-found'
	| 'gen-not-found'
	| 'gen-fk-only'
	| 'gen-fk-mismatch'
	| GeneratorIssueKind;

export interface Issue {
	columnIndex: number;
	columnName: string;
	kind: IssueKind;
	/** Zusätzliche Angabe für die Meldung, z. B. der (nicht gefundene) `fk_table`-/`fk_column`-Wert. */
	detail?: string;
	/** Name des betroffenen Generator-Parameters (nur bei Generator-Prüfungen). */
	paramName?: string;
	/** `true` für Generator-Prüfungen — sie erscheinen als Warnung statt als Fehler in der Problems-Ansicht. */
	warning?: boolean;
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
 * @param generators Alle verfügbaren Generatoren (eingebaute + benutzerdefinierte aus
 * `.tdgen`-Dateien), um Generator-Konfigurationen gegenzuprüfen.
 * @param lookups Alle `.lkp`-Nachschlagelisten des Workspace (für den Lookup-Generator).
 */
export function validateTable(
	table: Table,
	knownTables: KnownTable[] = [],
	generators: GeneratorBase[] = [],
	lookups: KnownLookupRef[] = [],
): Issue[] {
	const issues: Issue[] = [];
	// Eigene logische Identität dieser Tabelle, um eine Selbst-Referenz zu erkennen
	// (leer, solange die Tabelle noch keinen Namen hat -> dann kann fk_table ihr
	// auch nicht gleichen, der Vergleich unten greift also erst, sobald sie einen hat).
	const ownLabel = logicalTableName(table);
	const ownColumns = table.columns.map((c) => c.name.trim()).filter((c) => c.length > 0);

	table.columns.forEach((column, columnIndex) => {
		if (column.fk) {
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
		}

		if (!column.generator || !column.generator.id.trim()) {
			return;
		}

		const generator = generators.find((g) => g.id === column.generator?.id);
		if (!generator) {
			// Der konfigurierte (i. d. R. benutzerdefinierte) Generator existiert
			// nicht (mehr) — Datei gelöscht oder ihr Name geändert.
			issues.push({
				columnIndex,
				columnName: column.name,
				kind: 'gen-not-found',
				detail: column.generator.id,
				warning: true,
			});
			return;
		}

		if (generator.id === 'foreign-key' && !column.fk) {
			issues.push({ columnIndex, columnName: column.name, kind: 'gen-fk-only', warning: true });
			return;
		}

		if (column.fk && generator.id !== 'foreign-key') {
			// Über die Oberfläche nicht mehr möglich (die Generator-Auswahl ist
			// für FK-Spalten gesperrt) — kann nur aus von Hand bearbeitetem TOML
			// stammen.
			issues.push({ columnIndex, columnName: column.name, kind: 'gen-fk-mismatch', warning: true });
			return;
		}

		const ctx: GeneratorContext = {
			ownColumnName: column.name.trim(),
			ownColumns,
			fkTable: column.fkTable,
			fkColumn: column.fkColumn,
			tables: knownTables,
			lookups,
		};
		for (const issue of generator.validate(column.generator, ctx)) {
			issues.push({
				columnIndex,
				columnName: column.name,
				kind: issue.kind,
				detail: issue.detail,
				paramName: issue.paramName,
				warning: true,
			});
		}
	});

	return issues;
}
