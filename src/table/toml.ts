import { parse, TomlError } from 'smol-toml';
import {
	Column,
	CsvOptions,
	FIXED_ALIGNMENTS,
	FixedAlignment,
	FixedField,
	FixedOptions,
	JsonOptions,
	OutputConfig,
	STRUCTURE_NODE_KINDS,
	STRUCTURE_SOURCE_KINDS,
	STRUCTURE_VALUE_TYPES,
	StructureNode,
	StructureNodeKind,
	StructureSourceKind,
	Table,
	XlsxOptions,
	XmlOptions,
	createDefaultFixedOptions,
	createDefaultJsonOptions,
	createDefaultOutput,
	createDefaultXlsxOptions,
	createDefaultXmlOptions,
} from './model';
import { ParseError, tomlString } from '../tomlUtil';
import { encodeGeneratorConfigLines, parseGeneratorConfig } from '../generator/configToml';

/** Parses the TOML text of a .td file into our table model. */
export function parseTableText(text: string): Table {
	if (!text.trim()) {
		return { schema: '', name: '', description: '', drivingLookup: '', columns: [], output: createDefaultOutput() };
	}

	let data: Record<string, unknown>;
	try {
		data = parse(text);
	} catch (err) {
		if (err instanceof TomlError) {
			throw new ParseError(err.message, { line: err.line, column: err.column });
		}
		throw new ParseError(err instanceof Error ? err.message : String(err));
	}

	const rawColumns = Array.isArray(data.columns) ? data.columns : [];
	const columns: Column[] = rawColumns.map((raw) => toColumn(raw));

	return {
		schema: toStr(data.schema),
		name: toStr(data.name),
		description: toStr(data.description),
		drivingLookup: toStr(data.driving_lookup),
		columns,
		output: toOutput(data.output),
	};
}

/** Reads one `[[columns]]` block; unknown or missing values fall back to defaults. */
function toColumn(raw: unknown): Column {
	const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const column: Column = {
		name: toStr(c.name),
		type: toStr(c.type) || 'string',
		pk: c.pk === true,
		fk: c.fk === true,
		fkTable: toStr(c.fk_table),
		fkColumn: toStr(c.fk_column),
		description: toStr(c.description),
		hidden: c.hidden === true,
	};
	// The generator part is parsed by the generator layer itself (see
	// generator/configToml.ts).
	const generator = parseGeneratorConfig(c);
	if (generator) {
		column.generator = generator;
	}
	return column;
}

/** Reads the `[output]` block (missing values fall back to the defaults, see createDefaultOutput). */
function toOutput(raw: unknown): OutputConfig {
	const output = createDefaultOutput();
	const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	output.fileName = toStr(o.file_name);
	output.format = toStr(o.format) || 'csv';

	const csv = subTable(o.csv);
	const defaults = output.csv;
	output.csv = {
		delimiter: toStr(csv.delimiter) || defaults.delimiter,
		quoteAll: typeof csv.quote_all === 'boolean' ? csv.quote_all : defaults.quoteAll,
		decimal: toStr(csv.decimal) || defaults.decimal,
		dateFormat: toStr(csv.date_format) || defaults.dateFormat,
		datetimeFormat: toStr(csv.datetime_format) || defaults.datetimeFormat,
		includeHeader: typeof csv.include_header === 'boolean' ? csv.include_header : defaults.includeHeader,
		encoding: toStr(csv.encoding) || defaults.encoding,
	};

	output.xlsx = toXlsx(subTable(o.xlsx));
	output.json = toJson(subTable(o.json));
	output.xml = toXml(subTable(o.xml));
	output.fixed = toFixed(subTable(o.fixed));
	return output;
}

/** Reads the `[output.fixed]` block including its `[[output.fixed.fields]]` layout. */
function toFixed(raw: Record<string, unknown>): FixedOptions {
	const defaults = createDefaultFixedOptions();
	const rawFields = Array.isArray(raw.fields) ? raw.fields : [];
	return {
		includeHeader: toBool(raw.include_header, defaults.includeHeader),
		truncate: toBool(raw.truncate, defaults.truncate),
		lineEnding: toStr(raw.line_ending).toLowerCase() === 'crlf' ? 'crlf' : 'lf',
		dateFormat: toStr(raw.date_format) || defaults.dateFormat,
		datetimeFormat: toStr(raw.datetime_format) || defaults.datetimeFormat,
		decimal: toStr(raw.decimal) || defaults.decimal,
		encoding: toStr(raw.encoding) || defaults.encoding,
		fields: rawFields.map((entry): FixedField => {
			const field = subTable(entry);
			const align = toStr(field.align) as FixedAlignment;
			return {
				column: toStr(field.column),
				width: toInt(field.width, 0),
				align: FIXED_ALIGNMENTS.includes(align) ? align : 'left',
				// A pad character written as an empty string in the file would
				// silently shrink every field — fall back to a space.
				pad: toStr(field.pad).slice(0, 1) || ' ',
			};
		}),
	};
}

/** Reads the `[output.xlsx]` block. */
function toXlsx(raw: Record<string, unknown>): XlsxOptions {
	const defaults = createDefaultXlsxOptions();
	return {
		sheetName: typeof raw.sheet_name === 'string' ? raw.sheet_name : defaults.sheetName,
		startCell: toStr(raw.start_cell) || defaults.startCell,
		includeHeader: toBool(raw.include_header, defaults.includeHeader),
		freezeHeader: toBool(raw.freeze_header, defaults.freezeHeader),
		autoFilter: toBool(raw.auto_filter, defaults.autoFilter),
		autoFitColumns: toBool(raw.auto_fit_columns, defaults.autoFitColumns),
		dateFormat: toStr(raw.date_format) || defaults.dateFormat,
		datetimeFormat: toStr(raw.datetime_format) || defaults.datetimeFormat,
	};
}

/** Reads the `[output.json]` block including its `[[output.json.nodes]]` structure. */
function toJson(raw: Record<string, unknown>): JsonOptions {
	const defaults = createDefaultJsonOptions();
	return {
		// An empty root name is meaningful here (bare top-level array), so it is
		// taken over as written rather than falling back to the default.
		rootName: typeof raw.root_name === 'string' ? raw.root_name : defaults.rootName,
		indent: toInt(raw.indent, defaults.indent),
		jsonLines: toBool(raw.json_lines, defaults.jsonLines),
		asciiOnly: toBool(raw.ascii_only, defaults.asciiOnly),
		dateFormat: toStr(raw.date_format) || defaults.dateFormat,
		datetimeFormat: toStr(raw.datetime_format) || defaults.datetimeFormat,
		encoding: toStr(raw.encoding) || defaults.encoding,
		nodes: toStructureNodes(raw.nodes),
	};
}

/** Reads the `[output.xml]` block including its `[[output.xml.nodes]]` structure. */
function toXml(raw: Record<string, unknown>): XmlOptions {
	const defaults = createDefaultXmlOptions();
	return {
		rootElement: toStr(raw.root_element) || defaults.rootElement,
		recordElement: toStr(raw.record_element) || defaults.recordElement,
		indent: toInt(raw.indent, defaults.indent),
		declaration: toBool(raw.declaration, defaults.declaration),
		dateFormat: toStr(raw.date_format) || defaults.dateFormat,
		datetimeFormat: toStr(raw.datetime_format) || defaults.datetimeFormat,
		encoding: toStr(raw.encoding) || defaults.encoding,
		nodes: toStructureNodes(raw.nodes),
	};
}

/**
 * Rebuilds the structure tree from the flat `[[output.*.nodes]]` list.
 *
 * Nesting is expressed by `depth` (omitted at the root) and the list is in
 * document order, which is also the child order — so the tree is rebuilt with a
 * simple parent stack. Identity is deliberately POSITIONAL rather than by name:
 * several siblings may share one name, which is exactly how a repeating XML
 * element (`<Tag>a</Tag><Tag>b</Tag>`) is built.
 *
 * Files written by the first release of this feature instead carry a `path`
 * array of names; they are still read (their depth follows from the path
 * length) and are rewritten in the current form on the next save.
 */
function toStructureNodes(raw: unknown): StructureNode[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const roots: StructureNode[] = [];
	/** The currently open parents, indexed by their depth. */
	const parents: StructureNode[] = [];

	for (const entry of raw) {
		const node = subTable(entry);
		const path = Array.isArray(node.path) ? node.path.filter((p): p is string => typeof p === 'string') : [];
		const name = typeof node.name === 'string' ? node.name : (path[path.length - 1] ?? '');
		const depth = node.depth !== undefined ? toInt(node.depth, 0) : Math.max(0, path.length - 1);

		const kind = STRUCTURE_NODE_KINDS.includes(toStr(node.kind) as StructureNodeKind)
			? (toStr(node.kind) as StructureNodeKind)
			: 'value';
		const sourceKind = STRUCTURE_SOURCE_KINDS.includes(toStr(node.source_kind) as StructureSourceKind)
			? (toStr(node.source_kind) as StructureSourceKind)
			: 'column';
		const valueType = STRUCTURE_VALUE_TYPES.includes(toStr(node.value_type) as (typeof STRUCTURE_VALUE_TYPES)[number])
			? toStr(node.value_type)
			: 'auto';

		const built: StructureNode = { name, kind, valueType, sourceKind, source: toStr(node.source), children: [] };

		// A depth that skips a level (only possible in a hand-edited file) is
		// clamped to the next open one instead of dropping the node.
		const level = Math.min(depth, parents.length);
		if (level === 0) {
			roots.push(built);
		} else {
			parents[level - 1].children.push(built);
		}
		parents.length = level;
		parents.push(built);
	}

	return roots;
}

/** Coerces an unknown TOML value to a string, treating anything else as empty. */
function toStr(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

/** Coerces an unknown TOML value to a boolean, falling back to `fallback`. */
function toBool(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

/** Coerces an unknown TOML value to a non-negative integer, falling back to `fallback`. */
function toInt(value: unknown, fallback: number): number {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return Math.max(0, Math.trunc(value));
	}
	if (typeof value === 'bigint') {
		return Math.max(0, Number(value));
	}
	return fallback;
}

/** Reads a nested TOML table, treating anything else as empty. */
function subTable(value: unknown): Record<string, unknown> {
	return (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
}

/**
 * Writes our table model as TOML text.
 *
 * smol-toml's generic stringify function is deliberately not used; a lean,
 * fixed format is emitted instead: it keeps the file readable and
 * git-diff-friendly and uses a multi-line TOML string for the description where
 * needed.
 */
export function serializeTable(table: Table): string {
	const lines: string[] = [];
	lines.push('# Datenschmiede Tabellendefinition');
	lines.push(`schema = ${tomlString(table.schema)}`);
	lines.push(`name = ${tomlString(table.name)}`);
	lines.push(`description = ${tomlString(table.description)}`);
	if (table.drivingLookup.trim()) {
		// Only written when set — the table then takes its record count from the
		// list instead of the project (see Table.drivingLookup).
		lines.push(`driving_lookup = ${tomlString(table.drivingLookup.trim())}`);
	}

	// The [output] block must precede the [[columns]] tables — after them TOML
	// would read it as another key of the last column.
	lines.push(...serializeOutput(table.output));

	for (const column of table.columns) {
		lines.push('');
		lines.push('[[columns]]');
		lines.push(`name = ${tomlString(column.name)}`);
		lines.push(`type = ${tomlString(column.type || 'string')}`);
		lines.push(`pk = ${column.pk ? 'true' : 'false'}`);
		lines.push(`fk = ${column.fk ? 'true' : 'false'}`);
		if (column.fk) {
			// Only relevant (and only written) when the column really is a
			// foreign key — keeps the file clean otherwise.
			lines.push(`fk_table = ${tomlString(column.fkTable)}`);
			lines.push(`fk_column = ${tomlString(column.fkColumn)}`);
		}
		if (column.hidden) {
			// Only written when set — the column is generated but not carried
			// into the output file (see Column.hidden in the model).
			lines.push('hidden = true');
		}
		lines.push(`description = ${tomlString(column.description)}`);
		// The generator part comes from the generator layer itself — and must
		// come last, because [columns.generator_params] opens a sub-table (see
		// generator/configToml.ts).
		lines.push(...encodeGeneratorConfigLines(column.generator, tomlString));
	}

	lines.push('');
	return lines.join('\n');
}

/**
 * Writes the `[output]` block (file name + the file-type settings).
 *
 * `[output.csv]` is always written — it is the default file type and the
 * historical baseline of every existing `.td` file. The blocks of the other
 * file types are only written when they are actually in use or have been
 * changed from their defaults, so a plain CSV table keeps the same lean file it
 * has always had while a table that was configured for Excel/JSON/XML and later
 * switched back does not silently lose that configuration.
 */
function serializeOutput(output: OutputConfig): string[] {
	const lines: string[] = [];
	lines.push('');
	lines.push('[output]');
	lines.push(`file_name = ${tomlString(output.fileName)}`);
	const format = output.format || 'csv';
	lines.push(`format = ${tomlString(format)}`);
	lines.push('');
	lines.push('[output.csv]');
	const csv: CsvOptions = output.csv;
	lines.push(`delimiter = ${tomlString(csv.delimiter)}`);
	lines.push(`quote_all = ${csv.quoteAll ? 'true' : 'false'}`);
	lines.push(`decimal = ${tomlString(csv.decimal)}`);
	lines.push(`date_format = ${tomlString(csv.dateFormat)}`);
	lines.push(`datetime_format = ${tomlString(csv.datetimeFormat)}`);
	lines.push(`include_header = ${csv.includeHeader ? 'true' : 'false'}`);
	lines.push(`encoding = ${tomlString(csv.encoding)}`);

	if (format === 'xlsx' || !isDefaultOptions(output.xlsx, createDefaultXlsxOptions())) {
		lines.push(...serializeXlsx(output.xlsx));
	}
	if (format === 'json' || !isDefaultOptions(output.json, createDefaultJsonOptions())) {
		lines.push(...serializeJson(output.json));
	}
	if (format === 'xml' || !isDefaultOptions(output.xml, createDefaultXmlOptions())) {
		lines.push(...serializeXml(output.xml));
	}
	if (format === 'fixed' || !isDefaultOptions(output.fixed, createDefaultFixedOptions())) {
		lines.push(...serializeFixed(output.fixed));
	}
	return lines;
}

/** Writes the `[output.fixed]` block plus its layout as `[[output.fixed.fields]]` tables. */
function serializeFixed(fixed: FixedOptions): string[] {
	const lines = [
		'',
		'[output.fixed]',
		`include_header = ${fixed.includeHeader ? 'true' : 'false'}`,
		`truncate = ${fixed.truncate ? 'true' : 'false'}`,
		`line_ending = ${tomlString(fixed.lineEnding || 'lf')}`,
		`date_format = ${tomlString(fixed.dateFormat)}`,
		`datetime_format = ${tomlString(fixed.datetimeFormat)}`,
		`decimal = ${tomlString(fixed.decimal)}`,
		`encoding = ${tomlString(fixed.encoding)}`,
	];
	for (const field of fixed.fields) {
		lines.push('');
		lines.push('[[output.fixed.fields]]');
		lines.push(`column = ${tomlString(field.column)}`);
		lines.push(`width = ${Math.max(0, Math.trunc(field.width))}`);
		lines.push(`align = ${tomlString(field.align || 'left')}`);
		lines.push(`pad = ${tomlString(field.pad || ' ')}`);
	}
	return lines;
}

/** `true` while a file-type configuration still matches its defaults (nothing worth writing). */
function isDefaultOptions(options: unknown, defaults: unknown): boolean {
	return JSON.stringify(options) === JSON.stringify(defaults);
}

/** Writes the `[output.xlsx]` block. */
function serializeXlsx(xlsx: XlsxOptions): string[] {
	return [
		'',
		'[output.xlsx]',
		`sheet_name = ${tomlString(xlsx.sheetName)}`,
		`start_cell = ${tomlString(xlsx.startCell)}`,
		`include_header = ${xlsx.includeHeader ? 'true' : 'false'}`,
		`freeze_header = ${xlsx.freezeHeader ? 'true' : 'false'}`,
		`auto_filter = ${xlsx.autoFilter ? 'true' : 'false'}`,
		`auto_fit_columns = ${xlsx.autoFitColumns ? 'true' : 'false'}`,
		`date_format = ${tomlString(xlsx.dateFormat)}`,
		`datetime_format = ${tomlString(xlsx.datetimeFormat)}`,
	];
}

/** Writes the `[output.json]` block plus its structure as `[[output.json.nodes]]` tables. */
function serializeJson(json: JsonOptions): string[] {
	return [
		'',
		'[output.json]',
		`root_name = ${tomlString(json.rootName)}`,
		`indent = ${Math.max(0, Math.trunc(json.indent))}`,
		`json_lines = ${json.jsonLines ? 'true' : 'false'}`,
		`ascii_only = ${json.asciiOnly ? 'true' : 'false'}`,
		`date_format = ${tomlString(json.dateFormat)}`,
		`datetime_format = ${tomlString(json.datetimeFormat)}`,
		`encoding = ${tomlString(json.encoding)}`,
		...serializeStructureNodes('output.json.nodes', json.nodes),
	];
}

/** Writes the `[output.xml]` block plus its structure as `[[output.xml.nodes]]` tables. */
function serializeXml(xml: XmlOptions): string[] {
	return [
		'',
		'[output.xml]',
		`root_element = ${tomlString(xml.rootElement)}`,
		`record_element = ${tomlString(xml.recordElement)}`,
		`indent = ${Math.max(0, Math.trunc(xml.indent))}`,
		`declaration = ${xml.declaration ? 'true' : 'false'}`,
		`date_format = ${tomlString(xml.dateFormat)}`,
		`datetime_format = ${tomlString(xml.datetimeFormat)}`,
		`encoding = ${tomlString(xml.encoding)}`,
		...serializeStructureNodes('output.xml.nodes', xml.nodes),
	];
}

/**
 * Writes the structure tree as a FLAT list of array-of-tables entries in
 * document order, each carrying its nesting `depth` (omitted at the root). A
 * nested TOML representation would need one table header per level and could
 * not preserve the child order.
 *
 * The depth is written rather than a path of names on purpose: several siblings
 * may share one name — that is how a repeating XML element is built — and a
 * name path could not tell them apart (see toStructureNodes).
 */
function serializeStructureNodes(header: string, nodes: StructureNode[], depth = 0): string[] {
	const lines: string[] = [];
	for (const node of nodes) {
		lines.push('');
		lines.push(`[[${header}]]`);
		lines.push(`name = ${tomlString(node.name)}`);
		lines.push(`kind = ${tomlString(node.kind)}`);
		if (depth > 0) {
			lines.push(`depth = ${depth}`);
		}
		if (node.kind === 'value' || node.kind === 'attribute') {
			// Only leaves carry a value type and a mapping — objects and arrays
			// are pure structure.
			lines.push(`value_type = ${tomlString(node.valueType || 'auto')}`);
			lines.push(`source_kind = ${tomlString(node.sourceKind || 'column')}`);
			lines.push(`source = ${tomlString(node.source)}`);
		}
		lines.push(...serializeStructureNodes(header, node.children, depth + 1));
	}
	return lines;
}

/**
 * 0-based line of the `[output]` table in the raw text (0 when it is missing) —
 * where the diagnostics place problems that concern the output configuration
 * rather than a single column.
 */
export function findOutputLine(text: string): number {
	const lines = text.split('\n');
	const index = lines.findIndex((line) => /^\s*\[output\]/.test(line));
	return index >= 0 ? index : 0;
}

/** Line position of a `[[columns]]` table in the raw text, used for diagnostics. */
export interface ColumnLineInfo {
	/** 0-based line of the `[[columns]]` marker itself. */
	columnsLine: number;
	/** 0-based line of the `name` entry inside that table, if present. */
	nameLine: number | null;
}

/**
 * Determines the line position of every `[[columns]]` table in the raw text (in
 * document order, matching the order of `Table.columns`). smol-toml only
 * reports a position for parse *errors*, never for individual values — hence
 * this simple line-based scan, which the extension host's diagnostics use to
 * place messages at the right spot.
 */
export function findColumnLineInfo(text: string): ColumnLineInfo[] {
	const lines = text.split('\n');
	const result: ColumnLineInfo[] = [];
	let current: ColumnLineInfo | null = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (/^\s*\[\[columns\]\]/.test(line)) {
			current = { columnsLine: i, nameLine: null };
			result.push(current);
			continue;
		}
		if (/^\s*\[columns\.generator_params\]/.test(line)) {
			// From here on keys (including `name`) belong to the parameter
			// sub-table, no longer to the column itself.
			current = null;
			continue;
		}
		if (current && current.nameLine === null && /^\s*name\s*=/.test(line)) {
			current.nameLine = i;
		}
	}

	return result;
}
