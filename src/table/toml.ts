import { parse, TomlError } from 'smol-toml';
import { Column, CsvOptions, OutputConfig, Table, createDefaultOutput } from './model';
import { ParseError, tomlString } from '../tomlUtil';
import { encodeGeneratorConfigLines, parseGeneratorConfig } from '../generator/configToml';

/** Liest den TOML-Text einer .td-Datei in unser Tabellenmodell ein. */
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
	};
	// Den Generator-Teil parst der jeweilige Generator selbst (siehe
	// generator/configToml.ts).
	const generator = parseGeneratorConfig(c);
	if (generator) {
		column.generator = generator;
	}
	return column;
}

/** Liest den `[output]`-Block (fehlende Werte bekommen die Standardwerte, siehe createDefaultOutput). */
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

function toStr(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

/**
 * Schreibt unser Tabellenmodell als TOML-Text.
 *
 * Es wird bewusst nicht die generische stringify-Funktion von smol-toml
 * verwendet, sondern ein schlankes, festes Format: das hält die Datei
 * lesbar, git-diff-freundlich und benutzt für die Beschreibung bei Bedarf
 * einen mehrzeiligen TOML-String.
 */
export function serializeTable(table: Table): string {
	const lines: string[] = [];
	lines.push('# Datenschmiede Tabellendefinition');
	lines.push(`schema = ${tomlString(table.schema)}`);
	lines.push(`name = ${tomlString(table.name)}`);
	lines.push(`description = ${tomlString(table.description)}`);

	// Der [output]-Block muss vor den [[columns]]-Tabellen stehen — dahinter
	// würde TOML ihn als weiteren Schlüssel der letzten Spalte lesen.
	lines.push(...serializeOutput(table.output));

	for (const column of table.columns) {
		lines.push('');
		lines.push('[[columns]]');
		lines.push(`name = ${tomlString(column.name)}`);
		lines.push(`type = ${tomlString(column.type || 'string')}`);
		lines.push(`pk = ${column.pk ? 'true' : 'false'}`);
		lines.push(`fk = ${column.fk ? 'true' : 'false'}`);
		if (column.fk) {
			// Nur relevant (und nur geschrieben), wenn die Spalte tatsächlich
			// ein Fremdschlüssel ist — hält die Datei sauber, wenn nicht.
			lines.push(`fk_table = ${tomlString(column.fkTable)}`);
			lines.push(`fk_column = ${tomlString(column.fkColumn)}`);
		}
		lines.push(`description = ${tomlString(column.description)}`);
		// Der Generator-Teil kommt vom Generator selbst — und muss als
		// letztes stehen, weil [columns.generator_params] eine Untertabelle
		// eröffnet (siehe generator/configToml.ts).
		lines.push(...encodeGeneratorConfigLines(column.generator, tomlString));
	}

	lines.push('');
	return lines.join('\n');
}

/** Schreibt den `[output]`-Block (Dateiname + CSV-Einstellungen). */
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

/** Zeilenposition einer `[[columns]]`-Tabelle im Rohtext, für Diagnostics. */
export interface ColumnLineInfo {
	/** 0-basierte Zeile der `[[columns]]`-Markierung selbst. */
	columnsLine: number;
	/** 0-basierte Zeile des `name`-Eintrags innerhalb dieser Tabelle, falls vorhanden. */
	nameLine: number | null;
}

/**
 * Ermittelt für jede `[[columns]]`-Tabelle im Rohtext (in Dokumentreihenfolge,
 * passend zur Reihenfolge von `Table.columns`) ihre Zeilenposition. smol-toml
 * liefert nur für Parse-*Fehler* eine Position, keine für einzelne Werte —
 * daher hier ein einfacher zeilenbasierter Scan, den die Diagnostics-Erzeugung
 * im Extension-Host nutzt, um Meldungen an der richtigen Stelle zu platzieren.
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
			// Ab hier gehören Schlüssel (auch `name`) zur Parameter-Untertabelle,
			// nicht mehr zur Spalte selbst.
			current = null;
			continue;
		}
		if (current && current.nameLine === null && /^\s*name\s*=/.test(line)) {
			current.nameLine = i;
		}
	}

	return result;
}
