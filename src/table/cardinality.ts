/**
 * Cardinality of related records for a foreign key relationship, expressed as a
 * compact string: either a fixed number ("5") or a range ("1..3", both ends
 * inclusive). It is maintained in the project (the records field of referenced
 * tables in the project editor), no longer in the `.td` file.
 *
 * Deliberately free of any vscode dependency (easy to test); used both by
 * project/editorProvider.ts (diagnostics) and — as a small, standalone
 * counterpart — by media/project.js for immediate input feedback.
 */
export interface Cardinality {
	min: number;
	max: number;
}

/** A plain count ("5") or an inclusive range ("1..3"). */
const CARDINALITY_PATTERN = /^\s*(\d+)\s*(?:\.\.\s*(\d+)\s*)?$/;

/** Parses a cardinality string; returns `null` for malformed input or an inverted range. */
export function parseCardinality(raw: string): Cardinality | null {
	const match = CARDINALITY_PATTERN.exec(raw ?? '');
	if (!match) {
		return null;
	}
	const min = Number(match[1]);
	const max = match[2] !== undefined ? Number(match[2]) : min;
	if (min > max) {
		return null;
	}
	return { min, max };
}
