/**
 * Data model of a .lkp lookup list for the test data generator.
 *
 * As in table/model.ts this model is the "truth" the webview works with. The
 * extension host builds it from the document's CSV text (see lookup/csv.ts) and
 * serializes it back to CSV after every change.
 */

/**
 * One value row of the list: the values per column (in the order of
 * `LookupList.columns`) plus its weight in percent. The weight deliberately
 * stays a string (as `records` does in project/model.ts) so that invalid input
 * is preserved and can be reported by validation instead of being silently
 * dropped.
 */
export interface LookupRow {
	values: string[];
	/** Weight in percent ("25" or "12.5"/"12,5") — all rows together are meant to add up to 100. */
	weight: string;
}

/** A complete `.lkp` lookup list. */
export interface LookupList {
	name: string;
	description: string;
	/** Names of the value columns — the fixed weight column ("weight") is not among them; it always exists as the last column. */
	columns: string[];
	rows: LookupRow[];
}

/** Creates a blank lookup list, used when a new `.lkp` file is created. */
export function createEmptyLookup(name = ''): LookupList {
	return { name, description: '', columns: [], rows: [] };
}

/**
 * Parses a weight ("25", "12.5", or with a decimal comma "12,5") as a number;
 * `null` for empty or invalid input (e.g. negative or not a number format).
 * Deliberately vscode-free; the webview (media/lookup.js) keeps an identical
 * copy since it works without module bundling.
 *
 * There is deliberately no sum check ("all weights = 100 %"): the entered
 * weights apply as-is (even far above 100 % in total); the webview's total row
 * shows the sum for information only.
 */
export function parseWeight(raw: string): number | null {
	const text = (raw ?? '').trim().replace(',', '.');
	if (!/^\d+(\.\d+)?$/.test(text)) {
		return null;
	}
	const value = Number(text);
	return Number.isFinite(value) ? value : null;
}
