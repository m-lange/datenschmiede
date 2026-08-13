import { parse, TomlError } from 'smol-toml';
import { Project, ProjectTable, PythonLink } from './model';
import { ParseError, tomlString } from '../tomlUtil';

/** Liest den TOML-Text einer .tdproject-Datei in unser Projekt-Modell ein. */
export function parseProjectText(text: string): Project {
	if (!text.trim()) {
		return { name: '', description: '', python: null, tables: [] };
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
		tables,
	};
}

function toProjectTable(raw: unknown): ProjectTable | null {
	const t = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const path = toStr(t.path);
	if (!path) {
		// Ein Eintrag ohne Pfad kann nicht auf eine Tabelle zeigen -> überspringen
		// statt einen kaputten Eintrag ins Modell zu übernehmen.
		return null;
	}
	// `records` ist im Modell ein String (Zahl "100" oder Bereich "1..3", siehe
	// project/model.ts); im TOML steht eine feste Zahl unquoted (`records = 100`,
	// auch aus älteren Dateien), ein Bereich als String (`records = "1..3"`).
	// Ein ungültiger Wert bleibt als String erhalten, damit ihn die Validierung
	// meldet, statt ihn stillschweigend zu verwerfen.
	let records: string | undefined;
	if (typeof t.records === 'number' && Number.isFinite(t.records)) {
		records = String(t.records);
	} else if (typeof t.records === 'string' && t.records.trim() !== '') {
		records = t.records.trim();
	}
	return records !== undefined ? { path, records } : { path };
}

function toStr(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

/** Zeilenposition eines `[[tables]]`-Blocks im Rohtext, für Diagnostics. */
export interface ProjectTableLineInfo {
	/** 0-basierte Zeile der `[[tables]]`-Markierung dieses Blocks. */
	tablesLine: number;
	/** 0-basierte Zeile des `path`-Eintrags. */
	pathLine: number;
}

/**
 * Ermittelt für jeden `[[tables]]`-Block im Rohtext seine Zeilenposition,
 * geschlüsselt über seinen `path`-Wert statt über die Reihenfolge im Text:
 * anders als bei findColumnLineInfo in table/toml.ts kann `parseProjectText`
 * Blöcke ohne (lesbaren) Pfad überspringen, sodass Text-Reihenfolge und
 * `Project.tables`-Reihenfolge auseinanderlaufen könnten — ein Lookup über
 * den Pfad bleibt davon unabhängig richtig.
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

/** Bewusst nur die einfachen Fälle, die serializeProject selbst je schreibt (`"..."`) plus TOML-Literal-Strings (`'...'`); alles andere liefert `null` statt zu raten. */
function parseTomlStringLiteral(raw: string): string | null {
	try {
		if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
			return JSON.parse(raw);
		}
		if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) {
			return raw.slice(1, -1);
		}
	} catch {
		// Ungültiges Escape o. Ä. -> keine Position ermitteln, lieber als nicht gefunden behandeln.
	}
	return null;
}

/**
 * Schreibt unser Projekt-Modell als TOML-Text — analog zu toml.ts#serializeTable
 * bewusst ein schlankes, festes Format statt der generischen smol-toml-Ausgabe.
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

	for (const table of project.tables) {
		lines.push('');
		lines.push('[[tables]]');
		lines.push(`path = ${tomlString(table.path)}`);
		if (table.records !== undefined) {
			// Feste Zahl unquoted (wie bisher), Bereich ("1..3") als TOML-String
			// — Gegenstück zu toProjectTable.
			lines.push(/^\d+$/.test(table.records) ? `records = ${table.records}` : `records = ${tomlString(table.records)}`);
		}
	}

	lines.push('');
	return lines.join('\n');
}
