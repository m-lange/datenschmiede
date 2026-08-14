import { parse, TomlError } from 'smol-toml';
import { Column, CsvOptions, OutputConfig, Table, createDefaultOutput } from './model';
import { ParseError, tomlString } from '../tomlUtil';
import { encodeGeneratorConfigLines, parseGeneratorConfig } from '../generator/configToml';

/** Parses the TOML text of a .td file into our table model. */
export function parseTableText(text: string): Table {
	if (!text.trim()) {
		return { schema: '', name: '', description: '', columns: [], output: createDefaultOutput() };
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

	const csv = (o.csv && typeof o.csv === 'object' ? o.csv : {}) as Record<string, unknown>;
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
	return output;
}

/** Coerces an unknown TOML value to a string, treating anything else as empty. */
function toStr(value: unknown): string {
	return typeof value === 'string' ? value : '';
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

/** Writes the `[output]` block (file name + CSV settings). */
function serializeOutput(output: OutputConfig): string[] {
	const lines: string[] = [];
	lines.push('');
	lines.push('[output]');
	lines.push(`file_name = ${tomlString(output.fileName)}`);
	lines.push(`format = ${tomlString(output.format || 'csv')}`);
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
	return lines;
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
