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

/** Output file types a table can be written as (see python/generate.py). */
export const OUTPUT_FORMATS = ['csv', 'xlsx', 'json', 'xml'] as const;

export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/** File extension a format writes (also drives the `.xyz` hint next to the file name field). */
export function outputExtension(format: string): string {
	const normalized = (format || '').trim().toLowerCase();
	return (OUTPUT_FORMATS as readonly string[]).includes(normalized) ? normalized : 'csv';
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

/** Excel output settings of a table (written via pandas/openpyxl, see python/generate.py). */
export interface XlsxOptions {
	/**
	 * Worksheet name — a template with the same `{…}` variables as the file
	 * name (see FILE_NAME_VARIABLES). Empty -> the table name.
	 */
	sheetName: string;
	/** Top-left cell the table is placed at, e.g. "A1" or "B3". */
	startCell: string;
	/** Write a header row containing the column names. */
	includeHeader: boolean;
	/** Freeze everything above the first data row, so the header stays visible while scrolling. */
	freezeHeader: boolean;
	/** Put Excel's auto filter on the header row. */
	autoFilter: boolean;
	/** Widen every column to roughly fit its content. */
	autoFitColumns: boolean;
	/** Date format (Python strftime, e.g. "%Y-%m-%d") — dates are written as text. */
	dateFormat: string;
	/** Timestamp format (Python strftime, e.g. "%Y-%m-%d %H:%M:%S"). */
	datetimeFormat: string;
}

/** Node kinds of a JSON/XML target structure (see StructureNode). */
export const STRUCTURE_NODE_KINDS = ['object', 'array', 'value', 'attribute'] as const;

export type StructureNodeKind = (typeof STRUCTURE_NODE_KINDS)[number];

/** Value types a mapped leaf can be written as (`auto` keeps the generated value's own type). */
export const STRUCTURE_VALUE_TYPES = ['auto', 'string', 'number', 'integer', 'boolean'] as const;

/** Where a leaf takes its value from: a generated column, or a fixed text. */
export const STRUCTURE_SOURCE_KINDS = ['column', 'constant'] as const;

export type StructureSourceKind = (typeof STRUCTURE_SOURCE_KINDS)[number];

/**
 * One node of the JSON/XML target structure — the tree describes exactly ONE
 * record; the writer repeats it for every generated row (see python/generate.py).
 *
 * Structure (name/kind/valueType) and mapping (sourceKind/source) are edited in
 * two separate tabs of the table editor, but deliberately live in the same tree:
 * the mapping belongs to the leaf it fills, so renaming or moving a node keeps
 * its mapping attached.
 */
export interface StructureNode {
	/** Property name (JSON) or element/attribute name (XML). */
	name: string;
	/** `object`/`array` carry children; `value`/`attribute` are the mapped leaves. */
	kind: StructureNodeKind;
	/** Value type of a leaf, one of STRUCTURE_VALUE_TYPES (XML always writes text). */
	valueType: string;
	/** Mapping of a leaf: a column of this table, or a constant. */
	sourceKind: StructureSourceKind;
	/** Column name (`sourceKind === 'column'`) or the literal text (`'constant'`). */
	source: string;
	/** Child nodes of `object`/`array` (empty for leaves). */
	children: StructureNode[];
}

/** JSON output settings of a table. */
export interface JsonOptions {
	/**
	 * Property the record array is wrapped in, e.g. `{"customers": [ … ]}` —
	 * empty writes a bare top-level array.
	 */
	rootName: string;
	/** Indentation spaces of the pretty printer; 0 writes the whole document on one line. */
	indent: number;
	/** JSON Lines (NDJSON): one record object per line, without the surrounding array. */
	jsonLines: boolean;
	/** Escape every non-ASCII character as `\uXXXX` instead of writing it directly. */
	asciiOnly: boolean;
	/** Date format (Python strftime) — dates and timestamps are written as strings. */
	dateFormat: string;
	/** Timestamp format (Python strftime). */
	datetimeFormat: string;
	/** File encoding, e.g. "utf-8". */
	encoding: string;
	/** Structure of ONE record — empty falls back to one property per visible column. */
	nodes: StructureNode[];
}

/** XML output settings of a table. */
export interface XmlOptions {
	/** Name of the document element wrapping all records, e.g. "customers". */
	rootElement: string;
	/** Name of the element repeated per record, e.g. "customer". */
	recordElement: string;
	/** Indentation spaces per level; 0 writes the whole document on one line. */
	indent: number;
	/** Write the `<?xml …?>` declaration as the first line. */
	declaration: boolean;
	/** Date format (Python strftime). */
	dateFormat: string;
	/** Timestamp format (Python strftime). */
	datetimeFormat: string;
	/** File encoding, e.g. "utf-8" (also written into the declaration). */
	encoding: string;
	/** Structure of ONE record element — empty falls back to one child element per visible column. */
	nodes: StructureNode[];
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
	/** Output file type, one of OUTPUT_FORMATS. */
	format: string;
	csv: CsvOptions;
	xlsx: XlsxOptions;
	json: JsonOptions;
	xml: XmlOptions;
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
		xlsx: createDefaultXlsxOptions(),
		json: createDefaultJsonOptions(),
		xml: createDefaultXmlOptions(),
	};
}

/** Excel defaults — the table starts at A1 with a frozen, filterable header row. */
export function createDefaultXlsxOptions(): XlsxOptions {
	return {
		sheetName: '{table}',
		startCell: 'A1',
		includeHeader: true,
		freezeHeader: true,
		autoFilter: false,
		autoFitColumns: true,
		dateFormat: '%Y-%m-%d',
		datetimeFormat: '%Y-%m-%d %H:%M:%S',
	};
}

/** JSON defaults — a bare, two-space indented array of flat record objects. */
export function createDefaultJsonOptions(): JsonOptions {
	return {
		rootName: '',
		indent: 2,
		jsonLines: false,
		asciiOnly: false,
		dateFormat: '%Y-%m-%d',
		datetimeFormat: '%Y-%m-%dT%H:%M:%S',
		encoding: 'utf-8',
		nodes: [],
	};
}

/** XML defaults — `<rows><row>…</row></rows>` with a declaration and two-space indentation. */
export function createDefaultXmlOptions(): XmlOptions {
	return {
		rootElement: 'rows',
		recordElement: 'row',
		indent: 2,
		declaration: true,
		dateFormat: '%Y-%m-%d',
		datetimeFormat: '%Y-%m-%dT%H:%M:%S',
		encoding: 'utf-8',
		nodes: [],
	};
}

/** A blank structure node of the given kind (used by the schema tab's "add node"). */
export function createStructureNode(kind: StructureNodeKind = 'value', name = ''): StructureNode {
	return { name, kind, valueType: 'auto', sourceKind: 'column', source: '', children: [] };
}

/**
 * Flat default structure: one mapped leaf per column that is written to the
 * output file. Used both by the schema tab's "derive from columns" button and —
 * in python/generate.py — whenever a table has no structure of its own, so
 * switching a table to JSON/XML produces sensible output right away.
 */
export function structureFromColumns(columns: Column[], kind: StructureNodeKind = 'value'): StructureNode[] {
	return columns
		.filter((column) => !column.hidden && column.name.trim() !== '')
		.map((column) => ({
			name: column.name.trim(),
			kind,
			valueType: 'auto',
			sourceKind: 'column' as StructureSourceKind,
			source: column.name.trim(),
			children: [],
		}));
}

/** Depth-first walk over a structure tree, yielding every node with its path of names. */
export function walkStructure(
	nodes: StructureNode[],
	visit: (node: StructureNode, path: string[], parent: StructureNode | null) => void,
	parentPath: string[] = [],
	parent: StructureNode | null = null,
): void {
	for (const node of nodes) {
		const path = [...parentPath, node.name];
		visit(node, path, parent);
		if (node.children.length > 0) {
			walkStructure(node.children, visit, path, node);
		}
	}
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
