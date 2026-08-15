/**
 * Mapping between the `.filegen` model (filegen/model.ts) and the cells of the
 * file generator notebook — deliberately vscode-free (easy to test); the thin
 * conversion into actual vscode.NotebookCellData happens in filegen/notebook.ts.
 *
 * Notebook layout (much smaller than the generator notebook — a file generator
 * has no parameters, just the one method that builds the file):
 *   1. markdown cell: `# <name>` + description
 *   2. settings cell (Python): `extension` and `structure` as plain
 *      assignments, read back on save
 *   3. scratch cell (Python): a small test frame for trying `write` out
 *   4. write() cell (Python): signature + body
 *
 * Cell roles live in the cell metadata, not in the position — reordering is
 * therefore harmless; unknown extra cells are appended to the scratch cell on
 * save instead of being lost.
 */

import { FILEGEN_STRUCTURES, FileGeneratorFile, FileGeneratorStructure, WRITE_SIGNATURE } from './model';

/** What a notebook cell means to the serializer; stored in the cell metadata. */
export type FileGenCellRole = 'header' | 'doc' | 'settings' | 'scratch' | 'write' | 'extra';

/** A vscode-free description of one notebook cell. */
export interface FileGenCellSpec {
	kind: 'markdown' | 'code';
	language: string;
	value: string;
	role: FileGenCellRole;
}

/**
 * Short descriptions rendered as markdown cells in front of the respective code
 * cells (role `doc`). They are generated when the file is opened and ignored on
 * save (not persisted) — edits to them deliberately do not reach the file.
 */
const CELL_DOCS: Record<string, { en: string; de: string }> = {
	settings: {
		de: '*__Einstellungen.__ `extension` ist die Dateiendung, die dieser Generator schreibt (ohne Punkt). `structure` legt fest, ob Tabellen, die ihn verwenden, einen Struktur-Tab bekommen: `"none"`, `"json"` oder `"xml"` — bei `json`/`xml` liefert `ctx.as_json(df)`/`ctx.as_xml(df)` genau diese Struktur fertig gerendert.*',
		en: '*__Settings.__ `extension` is the file extension this generator writes (without the dot). `structure` decides whether tables using it get a structure tab: `"none"`, `"json"` or `"xml"` — with `json`/`xml`, `ctx.as_json(df)`/`ctx.as_xml(df)` return exactly that structure ready-rendered.*',
	},
	scratch: {
		de: '*__Testwerte.__ Diese freie Zelle baut ein kleines `df` für den Testlauf der write-Zelle unten — anpassen und ausführen. Der Generator-Lauf ignoriert sie; zusätzliche eigene Zellen wandern beim Speichern hierher.*',
		en: '*__Test values.__ This free cell builds a small `df` for test-running the write cell below — adjust and execute. The generation run ignores it; additional custom cells are moved here on save.*',
	},
	write: {
		de: '*__write — Pflicht.__ Baut den Dateiinhalt aus den fertigen Datensätzen und gibt ihn als `str` (oder `bytes`) zurück. Fertige Renderings: `ctx.as_csv(df)`, `ctx.as_json(df)`, `ctx.as_xml(df)`, `ctx.as_fixed(df)`, `ctx.as_excel(df)`. Zum Lauf: `ctx.table_name`, `ctx.schema`, `ctx.label`, `ctx.records`, `ctx.file_name`, `ctx.now`, `ctx.columns`, `ctx.log(...)`.*',
		en: '*__write — required.__ Builds the file contents from the finished records and returns them as `str` (or `bytes`). Ready-made renderings: `ctx.as_csv(df)`, `ctx.as_json(df)`, `ctx.as_xml(df)`, `ctx.as_fixed(df)`, `ctx.as_excel(df)`. About the run: `ctx.table_name`, `ctx.schema`, `ctx.label`, `ctx.records`, `ctx.file_name`, `ctx.now`, `ctx.columns`, `ctx.log(...)`.*',
	},
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

/**
 * Extracts the body from the write cell: if the cell starts with `def write(`,
 * everything after it counts (dedented) as the body; otherwise the whole cell
 * is the body (the canonical signature is restored the next time the file is
 * opened).
 */
function extractWriteBody(cellText: string): string {
	const lines = cellText.split('\n');
	let firstIndex = 0;
	while (firstIndex < lines.length && lines[firstIndex].trim() === '') {
		firstIndex++;
	}
	const normalize = (body: string) => {
		const trimmed = body.replace(/\s+$/, '');
		// Empty cells are rendered as `pass` (indentBody) — normalize them back
		// to empty when reading, so the file stays stable.
		return trimmed.trim() === 'pass' ? '' : trimmed;
	};
	if (firstIndex < lines.length && /^def\s+write\s*\(/.test(lines[firstIndex].trim())) {
		return normalize(dedentBody(lines.slice(firstIndex + 1).join('\n')));
	}
	return normalize(cellText);
}

/** The settings cell as Python assignments. */
function settingsCellText(file: FileGeneratorFile): string {
	return [
		`extension = ${JSON.stringify(file.extension || 'txt')}`,
		`structure = ${JSON.stringify(file.structure || 'none')}`,
	].join('\n');
}

/** Reads `extension`/`structure` back from the settings cell (unparseable lines are ignored). */
function readSettings(cellText: string, file: FileGeneratorFile): void {
	for (const line of cellText.split('\n')) {
		const match = /^\s*(extension|structure)\s*=\s*(['"])(.*?)\2\s*(#.*)?$/.exec(line);
		if (!match) {
			continue;
		}
		if (match[1] === 'extension') {
			file.extension = match[3].replace(/^\./, '').trim();
		} else {
			const structure = match[3].trim().toLowerCase() as FileGeneratorStructure;
			// An unknown value keeps the previous one rather than silently
			// turning the structure tab off.
			if (FILEGEN_STRUCTURES.includes(structure)) {
				file.structure = structure;
			}
		}
	}
}

/** Builds the notebook cells for one file generator. */
export function fileGenToCells(file: FileGeneratorFile, locale: 'de' | 'en' = 'en'): FileGenCellSpec[] {
	const cells: FileGenCellSpec[] = [];
	// <small> renders the description cells smaller than regular markdown text
	// (see the generator notebook — same convention).
	const doc = (key: string) =>
		cells.push({
			kind: 'markdown',
			language: 'markdown',
			value: `<small>${CELL_DOCS[key][locale]}</small>`,
			role: 'doc',
		});

	const header = file.description.trim()
		? `# ${file.name.trim()}\n\n${file.description.trim()}`
		: `# ${file.name.trim()}`;
	cells.push({ kind: 'markdown', language: 'markdown', value: header, role: 'header' });

	doc('settings');
	cells.push({ kind: 'code', language: 'python', value: settingsCellText(file), role: 'settings' });

	doc('scratch');
	cells.push({ kind: 'code', language: 'python', value: file.code.scratch, role: 'scratch' });

	doc('write');
	cells.push({
		kind: 'code',
		language: 'python',
		value: `${WRITE_SIGNATURE}\n${indentBody(file.code.write)}`,
		role: 'write',
	});

	return cells;
}

/**
 * Reads the file model back from the notebook cells. `previous` supplies
 * fallback values (e.g. the name when there is no markdown heading). Unknown
 * extra cells are appended to the scratch cell so nothing is lost.
 */
export function cellsToFileGen(cells: FileGenCellSpec[], previous: FileGeneratorFile): FileGeneratorFile {
	const file: FileGeneratorFile = {
		name: previous.name,
		description: previous.description,
		extension: previous.extension,
		structure: previous.structure,
		code: { ...previous.code },
	};

	const extras: string[] = [];
	let scratch = '';
	let sawScratch = false;

	for (const cell of cells) {
		switch (cell.role) {
			case 'doc':
				// Description cells are generated on open and not persisted.
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
			case 'settings':
				readSettings(cell.value, file);
				break;
			case 'scratch':
				scratch = cell.value.replace(/\s+$/, '');
				sawScratch = true;
				break;
			case 'write':
				file.code.write = extractWriteBody(cell.value);
				break;
			default:
				if (cell.value.trim()) {
					extras.push(cell.kind === 'markdown' ? cell.value.replace(/^/gm, '# ') : cell.value);
				}
				break;
		}
	}

	// If the scratch cell was deleted, its previous content is preserved (as
	// with the write cell: deleting does not take effect permanently).
	const scratchBase = sawScratch ? scratch : previous.code.scratch;
	file.code.scratch = [scratchBase, ...extras.map((extra) => `# --- zusätzliche Zelle ---\n${extra}`)]
		.filter((part) => part.trim())
		.join('\n\n');

	return file;
}
