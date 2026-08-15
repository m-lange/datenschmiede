/**
 * Data model of a .filegen file (a custom file generator).
 *
 * Where a `.tdgen` produces the values of ONE column, a `.filegen` produces the
 * whole FILE: after all records of a table have been generated, its `write`
 * method receives the finished DataFrame and returns the file contents. That
 * covers formats the built-in writers do not reach — a CSV behind a block of
 * header lines, a report with a trailer, a proprietary layout.
 *
 * As in generator/model.ts the code lives as a Python method body with a fixed
 * signature, shown in the notebook editor as a read-only header above the
 * editable body.
 */

/**
 * Target structure a file generator needs from the table editor. A generator
 * that only wraps the records (`none`) needs none; one that emits a JSON or XML
 * document for the data part gets the matching structure tab, and its `write`
 * method receives that rendering ready-made via `ctx.as_json()`/`ctx.as_xml()`.
 */
export const FILEGEN_STRUCTURES = ['none', 'json', 'xml'] as const;

export type FileGeneratorStructure = (typeof FILEGEN_STRUCTURES)[number];

/** A custom file generator as stored in a .filegen file. */
export interface FileGeneratorFile {
	name: string;
	description: string;
	/** Extension of the file it writes, without the dot (e.g. "csv"); empty -> "txt". */
	extension: string;
	/** Which structure tab tables using this generator get, one of FILEGEN_STRUCTURES. */
	structure: string;
	code: FileGeneratorCode;
}

/** The Python method bodies of the code cells (body only, without the fixed signature). */
export interface FileGeneratorCode {
	/**
	 * Required: builds the file contents (see WRITE_SIGNATURE). Returns either a
	 * `str` — written with the table's configured encoding — or `bytes`, which
	 * are written unchanged (that is how ctx.as_excel() gets out).
	 */
	write: string;
	/**
	 * Free-form notebook cell for experiments (e.g. building a small test frame
	 * to run `write` against) — saved, but ignored by a generator run.
	 */
	scratch: string;
}

/** Fixed Python signature of the write cell (its first line in the notebook). */
export const WRITE_SIGNATURE = 'def write(df, ctx) -> "str | bytes":';

/** Default body of a freshly created .filegen — a working CSV writer with the ctx API in comments. */
export const DEFAULT_WRITE_BODY = [
	'# df: the finished records as a pandas DataFrame (hidden columns already dropped,',
	'#     dates/timestamps already formatted as text).',
	'# Return the file contents as str — or as bytes for a binary format.',
	'#',
	'# Ready-made renderings of the data part:',
	'#   ctx.as_csv(df, delimiter=";", include_header=True)   -> str',
	'#   ctx.as_json(df)                                      -> str  (uses the JSON structure tab)',
	'#   ctx.as_xml(df)                                       -> str  (uses the XML structure tab)',
	'#   ctx.as_excel(df)                                     -> bytes',
	'#   ctx.as_fixed(df)                                     -> str  (uses the record layout)',
	'#',
	'# About the run:',
	'#   ctx.table_name / ctx.schema / ctx.label   the table',
	'#   ctx.records                               number of records',
	'#   ctx.file_name                             resolved file name (without extension)',
	'#   ctx.now                                   run timestamp (datetime)',
	'#   ctx.columns                               column names being written',
	'#   ctx.log("…")                              writes to the run log',
	'return ctx.as_csv(df)',
].join('\n');

/** Default content of the scratch cell — a tiny frame to try `write` against. */
export const DEFAULT_SCRATCH = [
	'# Test values for the write cell below — adjust and execute, then run write(df, ctx).',
	'import pandas as pd',
	'',
	'df = pd.DataFrame({"id": [1, 2, 3], "name": ["Anna", "Bert", "Cem"]})',
].join('\n');

/** Creates a blank file generator prefilled with the default code. */
export function createEmptyFileGeneratorFile(name = ''): FileGeneratorFile {
	return {
		name,
		description: '',
		extension: 'csv',
		structure: 'none',
		code: { write: DEFAULT_WRITE_BODY, scratch: DEFAULT_SCRATCH },
	};
}

/** Prefix of the `format` value a table uses to point at a file generator. */
export const CUSTOM_FORMAT_PREFIX = 'custom:';

/** `true` when a table's output format refers to a custom file generator. */
export function isCustomFormat(format: string): boolean {
	return (format || '').trim().toLowerCase().startsWith(CUSTOM_FORMAT_PREFIX);
}

/** Generator name behind a `custom:<name>` output format (empty when it is not one). */
export function customFormatName(format: string): string {
	const value = (format || '').trim();
	return isCustomFormat(value) ? value.slice(CUSTOM_FORMAT_PREFIX.length).trim() : '';
}
