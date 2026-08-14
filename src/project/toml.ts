import { parse, TomlError } from 'smol-toml';
import { Project, ProjectTable, PythonLink } from './model';
import { ParseError, tomlString } from '../tomlUtil';

/** Parses the TOML text of a .tdproject file into our project model. */
export function parseProjectText(text: string): Project {
	if (!text.trim()) {
		return { name: '', description: '', python: null, outputPath: '', tables: [] };
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

	const pythonPath = toStr(data.python_path);
	const python: PythonLink | null = pythonPath ? { path: pythonPath, id: toStr(data.python_id) || undefined } : null;

	const rawTables = Array.isArray(data.tables) ? data.tables : [];
	const tables: ProjectTable[] = [];
	for (const raw of rawTables) {
		const table = toProjectTable(raw);
		if (table) {
			tables.push(table);
		}
	}

	return {
		name: toStr(data.name),
		description: toStr(data.description),
		python,
		outputPath: toStr(data.output_path),
		tables,
	};
}

/** Reads one `[[tables]]` block; returns `null` for entries without a usable path. */
function toProjectTable(raw: unknown): ProjectTable | null {
	const t = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const path = toStr(t.path);
	if (!path) {
		// An entry without a path cannot point at a table -> skip it instead of
		// carrying a broken entry into the model.
		return null;
	}
	// In the model `records` is a string (a number "100" or a range "1..3", see
	// project/model.ts); in TOML a fixed number is unquoted (`records = 100`,
	// including in older files) while a range is a string (`records = "1..3"`).
	// An invalid value is preserved as a string so validation can report it
	// instead of it being silently dropped.
	let records: string | undefined;
	if (typeof t.records === 'number' && Number.isFinite(t.records)) {
		records = String(t.records);
	} else if (typeof t.records === 'string' && t.records.trim() !== '') {
		records = t.records.trim();
	}
	return records !== undefined ? { path, records } : { path };
}

/** Coerces an unknown TOML value to a string, treating anything else as empty. */
function toStr(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

/** Line position of a `[[tables]]` block in the raw text, used for diagnostics. */
export interface ProjectTableLineInfo {
	/** 0-based line of this block's `[[tables]]` marker. */
	tablesLine: number;
	/** 0-based line of the `path` entry. */
	pathLine: number;
}

/**
 * Determines the line position of every `[[tables]]` block in the raw text,
 * keyed by its `path` value rather than by its order in the text: unlike
 * findColumnLineInfo in table/toml.ts, `parseProjectText` may skip blocks
 * without a (readable) path, so text order and `Project.tables` order could
 * drift apart — a lookup by path stays correct regardless.
 */
export function findTableLineInfo(text: string): Map<string, ProjectTableLineInfo> {
	const lines = text.split('\n');
	const result = new Map<string, ProjectTableLineInfo>();
	let currentTablesLine: number | null = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (/^\s*\[\[tables\]\]/.test(line)) {
			currentTablesLine = i;
			continue;
		}
		if (currentTablesLine === null) {
			continue;
		}
		const match = /^\s*path\s*=\s*(.+?)\s*$/.exec(line);
		if (match) {
			const path = parseTomlStringLiteral(match[1]);
			if (path !== null && !result.has(path)) {
				result.set(path, { tablesLine: currentTablesLine, pathLine: i });
			}
		}
	}

	return result;
}

/** Deliberately only the simple cases serializeProject itself ever writes (`"..."`) plus TOML literal strings (`'...'`); anything else returns `null` rather than guessing. */
function parseTomlStringLiteral(raw: string): string | null {
	try {
		if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
			return JSON.parse(raw);
		}
		if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) {
			return raw.slice(1, -1);
		}
	} catch {
		// Invalid escape or similar -> determine no position, treat it as not found.
	}
	return null;
}

/**
 * Writes our project model as TOML text — like toml.ts#serializeTable this
 * deliberately emits a lean, fixed format instead of smol-toml's generic output.
 */
export function serializeProject(project: Project): string {
	const lines: string[] = [];
	lines.push('# Datenschmiede Testdatenprojekt');
	lines.push(`name = ${tomlString(project.name)}`);
	lines.push(`description = ${tomlString(project.description)}`);
	if (project.python) {
		lines.push(`python_path = ${tomlString(project.python.path)}`);
		if (project.python.id) {
			lines.push(`python_id = ${tomlString(project.python.id)}`);
		}
	}
	if (project.outputPath.trim()) {
		// Only written when set — empty means the default `output`.
		lines.push(`output_path = ${tomlString(project.outputPath)}`);
	}

	for (const table of project.tables) {
		lines.push('');
		lines.push('[[tables]]');
		lines.push(`path = ${tomlString(table.path)}`);
		if (table.records !== undefined) {
			// Fixed number unquoted (as before), a range ("1..3") as a TOML
			// string — the counterpart to toProjectTable.
			lines.push(/^\d+$/.test(table.records) ? `records = ${table.records}` : `records = ${tomlString(table.records)}`);
		}
	}

	lines.push('');
	return lines.join('\n');
}
