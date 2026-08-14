/**
 * Mapping between the `.tdgen` model (generator/model.ts) and the cells of the
 * generator notebook — deliberately vscode-free (easy to test); the thin
 * conversion into actual vscode.NotebookCellData happens in
 * generator/notebook.ts.
 *
 * Notebook layout:
 *   1. markdown cell: `# <name>` + description
 *   2. parameters() cell (Python): returns the parameter definitions as a
 *      literal list of dicts — on save the serializer derives the
 *      `[[parameters]]` blocks from it (pyliteral.ts); the code itself is
 *      stored verbatim in `[code] parameters`
 *   3. scratch cell (Python): test values (`params = {...}`, `n = 10`) and free
 *      experiments — persisted in `[code] scratch`
 *   4. the four method cells (generate/parse_params/display_value/validate),
 *      each as a complete function (signature + body)
 *
 * Cell roles live in the cell metadata, not in the position — reordering is
 * therefore harmless; unknown extra cells are appended to the scratch cell on
 * save instead of being lost.
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

/** What a notebook cell means to the serializer; stored in the cell metadata. */
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

/** A vscode-free description of one notebook cell. */
export interface CellSpec {
	kind: 'markdown' | 'code';
	language: string;
	value: string;
	role: CellRole;
}

/**
 * Short descriptions rendered as markdown cells in front of the respective code
 * cells (role `doc`). They are generated when the file is opened and ignored on
 * save (not persisted) — edits to them deliberately do not reach the file.
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

/** Fixed first line of each method cell, keyed by cell role. */
const METHOD_SIGNATURES: Record<string, string> = {
	parameters: PARAMETERS_SIGNATURE,
	generate: GENERATE_SIGNATURE,
	parse_params: PARSE_PARAMS_SIGNATURE,
	display_value: DISPLAY_VALUE_SIGNATURE,
	validate: VALIDATE_SIGNATURE,
};

/** Indents a method body for display beneath its signature in the cell. */
function indentBody(body: string): string {
	return (body || 'pass')
		.split('\n')
		.map((line) => (line.trim() === '' ? line : `    ${line}`))
		.join('\n');
}

/** Removes the indentation of a function body again (counterpart to indentBody). */
function dedentBody(text: string): string {
	return text
		.split('\n')
		.map((line) => (line.startsWith('    ') ? line.slice(4) : line.startsWith('\t') ? line.slice(1) : line))
		.join('\n');
}

/** Builds the complete function cell (signature + indented body). */
function methodCellText(role: string, body: string): string {
	return `${METHOD_SIGNATURES[role]}\n${indentBody(body)}`;
}

/**
 * Extracts the body from a function cell: if the cell starts with
 * `def <name>(`, everything after it counts (dedented) as the body; otherwise
 * the whole cell is the body (the canonical signature is restored the next time
 * the file is opened).
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
		// Empty cells are rendered as `pass` (indentBody) — normalize them back
		// to empty when reading, so the file stays stable.
		return trimmed.trim() === 'pass' ? '' : trimmed;
	};
	if (firstIndex < lines.length && new RegExp(`^def\\s+${name}\\s*\\(`).test(lines[firstIndex].trim())) {
		return normalize(dedentBody(lines.slice(firstIndex + 1).join('\n')));
	}
	return normalize(cellText);
}

/** Formats a JS string as a Python string literal (JSON escapes are Python-compatible). */
function pyString(value: string): string {
	return JSON.stringify(value ?? '');
}

/** Builds the canonical parameters() body from the declarative `[[parameters]]` blocks. */
export function parametersBodyFromList(parameters: GeneratorParameter[]): string {
	if (parameters.length === 0) {
		return [
			'# One dict per parameter: name, type (a column type or lookup / table / column / own_column),',
			'# optional description, choices, required.',
			'# Example:',
			'#   return [',
			'#       {"name": "prefix", "type": "string", "required": True},',
			'#       {"name": "digits", "type": "string", "choices": ["4", "6", "8"]},',
			'#   ]',
			'return []',
		].join('\n');
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
 * Reads the parameter definitions from the parameters() body (literal
 * evaluation of the `return [...]`). `null` if the return value is not a
 * literal or not a list of dicts — the caller then keeps the previous list and
 * the background validation reports it.
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

/** Default content of the scratch cell: test values for every declared parameter. */
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

/** Builds the notebook cells from the file model (`locale` picks the language of the description cells). */
export function fileToCells(file: GeneratorFile, locale: 'de' | 'en' = 'en'): CellSpec[] {
	const cells: CellSpec[] = [];
	// <small> renders the description cells smaller than regular markdown text
	// (the tag is part of the notebook renderer's allowed HTML subset; removing
	// it just leaves the text at normal size).
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
 * Reads the file model back from the notebook cells. `previous` supplies
 * fallback values (the name when there is no markdown heading, the parameter
 * list when the parameters() body does not evaluate to a literal). Unknown
 * extra cells are appended to the scratch cell so nothing is lost.
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
				// Description cells are generated on open and not persisted
				// (edits to them deliberately do not reach the file).
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
					// Without a heading the previous name is kept (the background
					// validation reports a missing name anyway).
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

	// If the scratch cell was deleted, its previous content is preserved (as
	// with the method cells: deleting does not take effect permanently).
	const scratchBase = sawScratch ? scratch : previous.code.scratch;
	file.code.scratch = [scratchBase, ...extras.map((extra) => `# --- zusätzliche Zelle ---\n${extra}`)]
		.filter((part) => part.trim())
		.join('\n\n');

	return file;
}
