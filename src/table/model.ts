/**
 * Data model of a .td table definition.
 *
 * This model is the "truth" the webview works with. The extension host builds
 * it from the document's TOML text (see table/toml.ts) and serializes it back
 * to TOML after every change.
 */

import type { GeneratorConfig } from '../generator/types';

/** Predefined, commonly used data types for synthetic test data. */
export const COLUMN_TYPES = [
	'string',
	'text',
	'integer',
	'float',
	'decimal',
	'boolean',
	'date',
	'datetime',
	'time',
	'uuid',
	'email',
	'json',
] as const;

export type ColumnType = (typeof COLUMN_TYPES)[number];

/** A single column of a table definition. */
export interface Column {
	name: string;
	type: string;
	pk: boolean;
	fk: boolean;
	/** Logical identity (`schema.name`) of the referenced table (only relevant while `fk` is true). */
	fkTable: string;
	/** Name of the referenced column in that table (only relevant while `fk` is true). */
	fkColumn: string;
	description: string;
	/**
	 * Hidden column: still visible everywhere in the extension (editor, FK
	 * targets, preview) and generated as usual during a generator run — it is
	 * merely omitted from the output file (see python/generate.py). This allows
	 * helper columns whose values serve as an FK source, for example.
	 */
	hidden: boolean;
	/**
	 * Generator of this column (see src/generator/) — `undefined` while none is
	 * selected; a generator run then falls back to a per-data-type default (FK
	 * columns automatically get the foreign key generator).
	 */
	generator?: GeneratorConfig;
}

/** CSV output settings of a table (see python/generate.py for the counterpart). */
export interface CsvOptions {
	/** Column separator, e.g. ";" or ",". */
	delimiter: string;
	/** Wrap every value in double quotes (otherwise only where required). */
	quoteAll: boolean;
	/** Decimal separator for numeric values, "." or ",". */
	decimal: string;
	/** Date format (Python strftime, e.g. "%Y-%m-%d"). */
	dateFormat: string;
	/** Timestamp format (Python strftime, e.g. "%Y-%m-%d %H:%M:%S"). */
	datetimeFormat: string;
	/** Write a header row containing the column names. */
	includeHeader: boolean;
	/** File encoding, e.g. "utf-8". */
	encoding: string;
}

/** Output settings of a table: file name (with `{…}` variables) and file-type configuration. */
export interface OutputConfig {
	/**
	 * File name without extension, as a template with `{…}` variables —
	 * constant text plus dynamic parts such as `{date}`, `{timestamp}` or
	 * `{column:name}` (that column's value from the first generated record),
	 * see FILE_NAME_VARIABLES. Empty -> `schema_name` at run time.
	 */
	fileName: string;
	/** Output file type — for now exclusively "csv". */
	format: string;
	csv: CsvOptions;
}

/** Built-in file name variables (`{…}`) that a generator run resolves while writing. */
export const FILE_NAME_VARIABLES = ['date', 'time', 'datetime', 'timestamp', 'schema', 'table', 'records'] as const;

/** Output configuration used for newly created tables. */
export function createDefaultOutput(): OutputConfig {
	return {
		fileName: '',
		format: 'csv',
		csv: {
			delimiter: ';',
			quoteAll: true,
			decimal: '.',
			dateFormat: '%Y-%m-%d',
			datetimeFormat: '%Y-%m-%d %H:%M:%S',
			includeHeader: true,
			encoding: 'utf-8',
		},
	};
}

/** A complete `.td` table definition. */
export interface Table {
	schema: string;
	name: string;
	description: string;
	columns: Column[];
	output: OutputConfig;
}

/** Creates a blank table, used when a new `.td` file is created. */
export function createEmptyTable(name = ''): Table {
	return { schema: '', name, description: '', columns: [], output: createDefaultOutput() };
}

/**
 * Logical table identity `schema.name` (or just `name` if no schema is set), as
 * stored in `fk_table` — empty while the table has no name yet. Deliberately
 * free of any vscode/file system dependency so it can be used both by the
 * extension host (see table/repository.ts) and by the vscode-free checks in
 * table/validation.ts.
 */
export function logicalTableName(table: Table): string {
	const name = table.name.trim();
	if (!name) {
		return '';
	}
	const schema = table.schema.trim();
	return schema ? `${schema}.${name}` : name;
}

/** Creates a blank column with the default data type. */
export function createEmptyColumn(): Column {
	return {
		name: '',
		type: 'string',
		pk: false,
		fk: false,
		fkTable: '',
		fkColumn: '',
		description: '',
		hidden: false,
	};
}
