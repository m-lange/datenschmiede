/**
 * Inhaltliche Prüfungen für ein Testdatenprojekt — Gegenstück zu
 * table/validation.ts für .tdproject-Dateien: jede ausgewählte Tabelle
 * braucht eine gültige Datensatzanzahl (primär eine feste Zahl, referenziert
 * eine Zahl oder ein Bereich "1..3"), und ihre `.td`-Datei muss (noch)
 * existieren.
 *
 * Bewusst frei von jeder vscode-Abhängigkeit (einfach testbar); die
 * Übersetzung der Meldungen für die Problems-Ansicht übernimmt der Aufrufer
 * (project/editorProvider.ts) über vscode.l10n, die Webview zeigt dieselben
 * Regeln direkt am Feld an (siehe media/project.js).
 */

import { parseCardinality } from '../table/cardinality';

export type ProjectIssueKind =
	| 'missing-records'
	| 'invalid-records'
	/** Bereich mit falschem Trenner geschrieben (z. B. "1-3" oder "1.3" statt "1..3") — eigene, gezielte Meldung. */
	| 'invalid-records-range-separator'
	| 'table-missing';

export interface ProjectIssue {
	/** Workspace-relativer Pfad der betroffenen `.td`-Datei (für die Zeilen-Zuordnung). */
	path: string;
	/** Anzeigename (`schema.name`, oder der Pfad als Fallback). */
	label: string;
	kind: ProjectIssueKind;
	/** Der beanstandete Wert, z. B. "1-3". */
	detail?: string;
	/** `true` -> Warnung statt Fehler in der Problems-Ansicht. */
	warning?: boolean;
}

/** Eine ausgewählte Tabelle mit ihren abgeleiteten Anzeige-Infos (siehe buildTableRows in project/editorProvider.ts). */
export interface ProjectRecordsRow {
	path: string;
	label: string;
	found: boolean;
	secondary: boolean;
	records?: string;
}

/** Erkennt einen als Bereich gemeinten Wert mit falschem Trenner: zwei Zahlen mit "-", "–", ":", "." oder "…" dazwischen. */
const WRONG_RANGE_SEPARATOR_PATTERN = /^\s*\d+\s*(?:[-–:…]|\.(?!\.)|\.{3,})\s*\d+\s*$/;

export function validateProjectRecords(rows: ProjectRecordsRow[]): ProjectIssue[] {
	const issues: ProjectIssue[] = [];

	for (const row of rows) {
		if (!row.found) {
			// Datei gelöscht/umbenannt/verschoben — der Lauf könnte die Tabelle
			// nicht mehr generieren.
			issues.push({ path: row.path, label: row.label, kind: 'table-missing', warning: true });
			continue;
		}
		const raw = row.records?.trim() ?? '';
		if (raw === '') {
			issues.push({ path: row.path, label: row.label, kind: 'missing-records' });
		} else if (row.secondary && !parseCardinality(raw)) {
			issues.push({
				path: row.path,
				label: row.label,
				kind: WRONG_RANGE_SEPARATOR_PATTERN.test(raw) ? 'invalid-records-range-separator' : 'invalid-records',
				detail: raw,
			});
		} else if (!row.secondary && !/^\d+$/.test(raw)) {
			issues.push({ path: row.path, label: row.label, kind: 'invalid-records', detail: raw });
		}
	}

	return issues;
}
