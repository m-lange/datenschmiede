/**
 * Semantic checks for a test data project — the counterpart to
 * table/validation.ts for .tdproject files: every selected table needs a valid
 * record count (a fixed number for primary tables, a number or a range "1..3"
 * for referenced ones), and its `.td` file must still exist.
 *
 * Deliberately free of any vscode dependency (easy to test); the caller
 * (project/editorProvider.ts) translates the messages for the Problems view via
 * vscode.l10n, while the webview surfaces the same rules inline on the field
 * (see media/project.js).
 */

import { parseCardinality } from '../table/cardinality';

export type ProjectIssueKind =
	| 'missing-records'
	| 'invalid-records'
	/** Range written with the wrong separator (e.g. "1-3" or "1.3" instead of "1..3") — gets its own, targeted message. */
	| 'invalid-records-range-separator'
	| 'table-missing';

/** A single problem found on one selected table of a project. */
export interface ProjectIssue {
	/** Workspace-relative path of the affected `.td` file (used to map to a line). */
	path: string;
	/** Display name (`schema.name`, or the path as a fallback). */
	label: string;
	kind: ProjectIssueKind;
	/** The rejected value, e.g. "1-3". */
	detail?: string;
	/** `true` -> warning instead of error in the Problems view. */
	warning?: boolean;
}

/** A selected table with its derived display info (see buildTableRows in project/editorProvider.ts). */
export interface ProjectRecordsRow {
	path: string;
	label: string;
	found: boolean;
	secondary: boolean;
	records?: string;
}

/** Detects a value meant as a range but written with the wrong separator: two numbers joined by "-", "–", ":", "." or "…". */
const WRONG_RANGE_SEPARATOR_PATTERN = /^\s*\d+\s*(?:[-–:…]|\.(?!\.)|\.{3,})\s*\d+\s*$/;

/** Checks the record count of every selected table and reports the problems found. */
export function validateProjectRecords(rows: ProjectRecordsRow[]): ProjectIssue[] {
	const issues: ProjectIssue[] = [];

	for (const row of rows) {
		if (!row.found) {
			// File deleted, renamed or moved — a run could no longer generate
			// this table.
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
