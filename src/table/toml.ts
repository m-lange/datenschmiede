import { parse, TomlError } from 'smol-toml';
import { Column, Table } from './model';
import { ParseError, tomlString } from '../tomlUtil';

/** Liest den TOML-Text einer .td-Datei in unser Tabellenmodell ein. */
export function parseTableText(text: string): Table {
	if (!text.trim()) {
		return { schema: '', name: '', description: '', columns: [] };
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
	};
}

function toColumn(raw: unknown): Column {
	const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	return {
		name: toStr(c.name),
		type: toStr(c.type) || 'string',
		pk: c.pk === true,
		fk: c.fk === true,
		fkTable: toStr(c.fk_table),
		fkColumn: toStr(c.fk_column),
		description: toStr(c.description),
	};
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
	}

	lines.push('');
	return lines.join('\n');
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
		if (current && current.nameLine === null && /^\s*name\s*=/.test(line)) {
			current.nameLine = i;
		}
	}

	return result;
}
