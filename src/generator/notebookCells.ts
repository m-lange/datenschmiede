/**
 * Abbildung zwischen dem `.tdgen`-Modell (generator/model.ts) und den
 * Zellen des Generator-Notebooks — bewusst vscode-frei (einfach testbar);
 * die dünne Umwandlung in echte vscode.NotebookCellData übernimmt
 * generator/notebook.ts.
 *
 * Notebook-Aufbau:
 *   1. Markdown-Zelle:  `# <name>` + Beschreibung
 *   2. parameters()-Zelle (Python): gibt die Parameterdefinitionen als
 *      Literal-Liste von dicts zurück — beim Speichern leitet der
 *      Serializer daraus die `[[parameters]]`-Blöcke ab (pyliteral.ts);
 *      der Code selbst wird verbatim in `[code] parameters` gespeichert
 *   3. Scratch-Zelle (Python): Testwerte (`params = {...}`, `n = 10`) und
 *      freie Experimente — persistiert in `[code] scratch`
 *   4. die vier Methoden-Zellen (generate/parse_params/display_value/
 *      validate), jeweils als vollständige Funktion (Signatur + Rumpf)
 *
 * Die Zellen-Rollen stecken in den Zell-Metadaten, nicht in der Position —
 * Umsortieren ist damit unkritisch; unbekannte Zusatz-Zellen werden beim
 * Speichern an die Scratch-Zelle angehängt statt verloren zu gehen.
 */

import {
	DISPLAY_VALUE_SIGNATURE,
	GENERATE_SIGNATURE,
	GeneratorFile,
	PARAMETERS_SIGNATURE,
	PARSE_PARAMS_SIGNATURE,
	VALIDATE_SIGNATURE,
} from './model';
import { GeneratorParameter, PARAMETER_TYPES } from './types';
import { parseReturnLiteral } from './pyliteral';

export type CellRole =
	| 'header'
	| 'doc'
	| 'parameters'
	| 'scratch'
	| 'generate'
	| 'parse_params'
	| 'display_value'
	| 'validate'
	| 'extra';

export interface CellSpec {
	kind: 'markdown' | 'code';
	language: string;
	value: string;
	role: CellRole;
}

/**
 * Kurzbeschreibungen, die als Markdown-Zellen vor den jeweiligen
 * Code-Zellen stehen (Rolle `doc`). Sie werden beim Öffnen erzeugt und
 * beim Speichern ignoriert (nicht persistiert) — Änderungen daran gehen
 * also bewusst nicht in die Datei ein.
 */
const CELL_DOCS: Record<string, { en: string; de: string }> = {
	parameters: {
		de: '*__parameters() — Pflicht.__ Definiert die Parameter dieses Generators als Literal-Liste von dicts (`name`, `type` — Spaltentypen plus `lookup`/`table`/`column`/`own_column` —, optional `description`, `choices`, `required`). Beim Speichern wird daraus die Parameterliste der Datei abgeleitet; die Werte je Spalte setzt später der Table Editor.*',
		en: '*__parameters() — required.__ Defines this generator’s parameters as a literal list of dicts (`name`, `type` — column types plus `lookup`/`table`/`column`/`own_column` —, optional `description`, `choices`, `required`). Saving derives the file’s parameter list from it; the per-column values are set later in the table editor.*',
	},
	scratch: {
		de: '*__Testwerte.__ Diese freie Zelle setzt `params` und `n` für die Testläufe der Methoden-Zellen unten — anpassen und ausführen. Der Generator-Lauf ignoriert sie; zusätzliche eigene Zellen wandern beim Speichern hierher.*',
		en: '*__Test values.__ This free cell sets `params` and `n` for test-running the method cells below — adjust and execute. The generation run ignores it; additional custom cells are moved here on save.*',
	},
	generate: {
		de: '*__generate — Pflicht.__ Erzeugt die Spaltenwerte: eine pandas Series der Länge `n` zurückgeben. Verfügbar: `ctx.rng`, `ctx.pd`/`ctx.np`, `ctx.faker(locale)`, `ctx.column("spalte")`, `ctx.related("fk", "spalte")`, `ctx.table(...)`, `ctx.lookup(...)`/`ctx.lookup_value(...)`, `ctx.log(...)`. Ausführen ruft die Methode mit den Testwerten auf.*',
		en: '*__generate — required.__ Produces the column values: return a pandas Series of length `n`. Available: `ctx.rng`, `ctx.pd`/`ctx.np`, `ctx.faker(locale)`, `ctx.column("name")`, `ctx.related("fk", "column")`, `ctx.table(...)`, `ctx.lookup(...)`/`ctx.lookup_value(...)`, `ctx.log(...)`. Executing calls the method with the test values.*',
	},
	parse_params: {
		de: '*__parse_params — optional.__ Wandelt die rohen String-Parameterwerte in typisierte Werte um, bevor `generate` läuft.*',
		en: '*__parse_params — optional.__ Converts the raw string parameter values into typed values before `generate` runs.*',
	},
	display_value: {
		de: '*__display_value — optional.__ Kompakte einzeilige Zusammenfassung einer Konfiguration für Lauf-Protokoll und Vorschau.*',
		en: '*__display_value — optional.__ Compact one-line summary of a configuration for the run log and preview.*',
	},
	validate: {
		de: '*__validate — optional.__ Liefert Warnungs-Texte zu den (rohen) Parameterwerten — sie erscheinen an den konfigurierten Spalten in der Problems-Ansicht.*',
		en: '*__validate — optional.__ Returns warning texts for the (raw) parameter values — they appear at the configured columns in the Problems view.*',
	},
};

const METHOD_SIGNATURES: Record<string, string> = {
	parameters: PARAMETERS_SIGNATURE,
	generate: GENERATE_SIGNATURE,
	parse_params: PARSE_PARAMS_SIGNATURE,
	display_value: DISPLAY_VALUE_SIGNATURE,
	validate: VALIDATE_SIGNATURE,
};

/** Rückt einen Methodenrumpf für die Zellen-Darstellung unter seiner Signatur ein. */
function indentBody(body: string): string {
	return (body || 'pass')
		.split('\n')
		.map((line) => (line.trim() === '' ? line : `    ${line}`))
		.join('\n');
}

/** Entfernt die Einrückung eines Funktionsrumpfs wieder (Gegenstück zu indentBody). */
function dedentBody(text: string): string {
	return text
		.split('\n')
		.map((line) => (line.startsWith('    ') ? line.slice(4) : line.startsWith('\t') ? line.slice(1) : line))
		.join('\n');
}

/** Baut die vollständige Funktions-Zelle (Signatur + eingerückter Rumpf). */
function methodCellText(role: string, body: string): string {
	return `${METHOD_SIGNATURES[role]}\n${indentBody(body)}`;
}

/**
 * Extrahiert den Rumpf aus einer Funktions-Zelle: beginnt die Zelle mit
 * `def <name>(`, zählt alles danach (dedentet) als Rumpf; sonst gilt die
 * ganze Zelle als Rumpf (die kanonische Signatur wird beim nächsten Öffnen
 * wiederhergestellt).
 */
function extractBody(role: string, cellText: string): string {
	const lines = cellText.split('\n');
	let firstIndex = 0;
	while (firstIndex < lines.length && lines[firstIndex].trim() === '') {
		firstIndex++;
	}
	const name = role === 'parameters' ? 'parameters' : role;
	const normalize = (body: string) => {
		const trimmed = body.replace(/\s+$/, '');
		// Leere Zellen werden als `pass` dargestellt (indentBody) — beim
		// Zurücklesen wieder zu leer normalisieren, damit die Datei stabil bleibt.
		return trimmed.trim() === 'pass' ? '' : trimmed;
	};
	if (firstIndex < lines.length && new RegExp(`^def\\s+${name}\\s*\\(`).test(lines[firstIndex].trim())) {
		return normalize(dedentBody(lines.slice(firstIndex + 1).join('\n')));
	}
	return normalize(cellText);
}

/** Formatiert einen JS-String als Python-String-Literal (JSON-Escapes sind Python-kompatibel). */
function pyString(value: string): string {
	return JSON.stringify(value ?? '');
}

/** Baut den kanonischen parameters()-Rumpf aus den deklarativen `[[parameters]]`-Blöcken. */
export function parametersBodyFromList(parameters: GeneratorParameter[]): string {
	if (parameters.length === 0) {
		return ['# type: eine Spaltenart oder lookup / table / column / own_column', 'return []'].join('\n');
	}
	const lines: string[] = ['return ['];
	for (const parameter of parameters) {
		const parts = [`"name": ${pyString(parameter.name)}`, `"type": ${pyString(parameter.type)}`];
		if (parameter.description) {
			parts.push(`"description": ${pyString(parameter.description)}`);
		}
		if (parameter.choices && parameter.choices.length > 0) {
			parts.push(`"choices": [${parameter.choices.map((c) => pyString(c)).join(', ')}]`);
		}
		if (parameter.required) {
			parts.push('"required": True');
		}
		lines.push(`    {${parts.join(', ')}},`);
	}
	lines.push(']');
	return lines.join('\n');
}

/**
 * Liest die Parameterdefinitionen aus dem parameters()-Rumpf (Literal-
 * Auswertung des `return [...]`). `null`, wenn der Rückgabewert kein
 * Literal bzw. keine Liste von dicts ist — der Aufrufer behält dann die
 * bisherige Liste, die Hintergrund-Prüfung meldet es.
 */
export function parametersFromBody(body: string): GeneratorParameter[] | null {
	const value = parseReturnLiteral(body);
	if (!Array.isArray(value)) {
		return null;
	}
	const result: GeneratorParameter[] = [];
	for (const entry of value) {
		if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
			return null;
		}
		const record = entry as { [key: string]: unknown };
		const parameter: GeneratorParameter = {
			name: typeof record.name === 'string' ? record.name : '',
			type:
				typeof record.type === 'string' && record.type
					? record.type
					: (PARAMETER_TYPES[0] as string),
			description: typeof record.description === 'string' ? record.description : '',
		};
		if (Array.isArray(record.choices)) {
			const choices = record.choices.filter((c): c is string => typeof c === 'string');
			if (choices.length > 0) {
				parameter.choices = choices;
			}
		}
		if (record.required === true) {
			parameter.required = true;
		}
		result.push(parameter);
	}
	return result;
}

/** Standard-Inhalt der Scratch-Zelle: Testwerte für alle deklarierten Parameter. */
export function defaultScratch(parameters: GeneratorParameter[]): string {
	const entries = parameters
		.filter((p) => p.name.trim())
		.map((p) => `    ${pyString(p.name.trim())}: ${pyString(p.choices?.[0] ?? '')},`);
	return [
		'# Testwerte für die Zellen unten — anpassen und ausführen (params/n gelten für die Methoden-Zellen).',
		entries.length > 0 ? `params = {\n${entries.join('\n')}\n}` : 'params = {}',
		'n = 10',
	].join('\n');
}

/** Baut die Notebook-Zellen aus dem Datei-Modell (`locale` wählt die Sprache der Beschreibungs-Zellen). */
export function fileToCells(file: GeneratorFile, locale: 'de' | 'en' = 'en'): CellSpec[] {
	const cells: CellSpec[] = [];
	// <small> verkleinert die Beschreibungs-Zellen gegenüber normalem
	// Markdown-Text (das Tag gehört zur erlaubten HTML-Teilmenge des
	// Notebook-Renderers; wird es entfernt, bleibt der Text normal groß).
	const doc = (key: string) =>
		cells.push({ kind: 'markdown', language: 'markdown', value: `<small>${CELL_DOCS[key][locale]}</small>`, role: 'doc' });

	const header = file.description.trim()
		? `# ${file.name.trim()}\n\n${file.description.trim()}`
		: `# ${file.name.trim()}`;
	cells.push({ kind: 'markdown', language: 'markdown', value: header, role: 'header' });

	doc('parameters');
	const parametersBody = file.code.parameters.trim()
		? file.code.parameters
		: parametersBodyFromList(file.parameters);
	cells.push({ kind: 'code', language: 'python', value: methodCellText('parameters', parametersBody), role: 'parameters' });

	doc('scratch');
	const scratch = file.code.scratch.trim() ? file.code.scratch : defaultScratch(file.parameters);
	cells.push({ kind: 'code', language: 'python', value: scratch, role: 'scratch' });

	doc('generate');
	cells.push({ kind: 'code', language: 'python', value: methodCellText('generate', file.code.generate), role: 'generate' });
	doc('parse_params');
	cells.push({
		kind: 'code',
		language: 'python',
		value: methodCellText('parse_params', file.code.parseParams),
		role: 'parse_params',
	});
	doc('display_value');
	cells.push({
		kind: 'code',
		language: 'python',
		value: methodCellText('display_value', file.code.displayValue),
		role: 'display_value',
	});
	doc('validate');
	cells.push({ kind: 'code', language: 'python', value: methodCellText('validate', file.code.validate), role: 'validate' });

	return cells;
}

/**
 * Liest das Datei-Modell aus den Notebook-Zellen zurück. `previous` liefert
 * Rückfall-Werte (Name ohne Markdown-Überschrift, Parameterliste bei nicht
 * literal auswertbarem parameters()-Rumpf). Unbekannte Zusatz-Zellen werden
 * an die Scratch-Zelle angehängt, damit nichts verloren geht.
 */
export function cellsToFile(cells: CellSpec[], previous: GeneratorFile): GeneratorFile {
	const file: GeneratorFile = {
		name: previous.name,
		description: previous.description,
		parameters: previous.parameters,
		code: { ...previous.code },
	};

	const extras: string[] = [];
	let scratch = '';
	let sawScratch = false;

	for (const cell of cells) {
		switch (cell.role) {
			case 'doc':
				// Beschreibungs-Zellen werden beim Öffnen erzeugt und nicht
				// persistiert (Änderungen daran gehen bewusst nicht in die Datei).
				break;
			case 'header': {
				const lines = cell.value.split('\n');
				const headingIndex = lines.findIndex((line) => line.trim().startsWith('# '));
				if (headingIndex >= 0) {
					file.name = lines[headingIndex].trim().replace(/^#\s+/, '').trim();
					file.description = lines
						.slice(headingIndex + 1)
						.join('\n')
						.trim();
				} else {
					// Ohne Überschrift bleibt der bisherige Name erhalten (die
					// Hintergrund-Prüfung meldet einen fehlenden Namen ohnehin).
					file.description = cell.value.trim();
				}
				break;
			}
			case 'parameters': {
				file.code.parameters = extractBody('parameters', cell.value);
				const parsed = parametersFromBody(file.code.parameters);
				if (parsed !== null) {
					file.parameters = parsed;
				}
				break;
			}
			case 'scratch':
				scratch = cell.value.replace(/\s+$/, '');
				sawScratch = true;
				break;
			case 'generate':
			case 'parse_params':
			case 'display_value':
			case 'validate': {
				const body = extractBody(cell.role, cell.value);
				if (cell.role === 'generate') {
					file.code.generate = body;
				} else if (cell.role === 'parse_params') {
					file.code.parseParams = body;
				} else if (cell.role === 'display_value') {
					file.code.displayValue = body;
				} else {
					file.code.validate = body;
				}
				break;
			}
			default:
				if (cell.value.trim()) {
					extras.push(cell.kind === 'markdown' ? cell.value.replace(/^/gm, '# ') : cell.value);
				}
				break;
		}
	}

	// Wurde die Scratch-Zelle gelöscht, bleibt ihr bisheriger Inhalt erhalten
	// (wie bei den Methoden-Zellen: Löschen wirkt nicht dauerhaft).
	const scratchBase = sawScratch ? scratch : previous.code.scratch;
	file.code.scratch = [scratchBase, ...extras.map((extra) => `# --- zusätzliche Zelle ---\n${extra}`)]
		.filter((part) => part.trim())
		.join('\n\n');

	return file;
}
