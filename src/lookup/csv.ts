import { LookupList, LookupRow } from './model';
// Despite living in tomlUtil.ts, ParseError is format-agnostic (message +
// position only) and is reused here for CSV so the editor providers can handle
// parse errors of all three file formats identically.
import { ParseError } from '../tomlUtil';

/**
 * Reading/writing the CSV format of a .lkp lookup list.
 *
 * The format is deliberately kept simple (mirrored by the td generator):
 * semicolon-separated, every value in double quotes, the first data line is the
 * header whose last column is always the fixed weight column "weight". Since
 * CSV itself has no room for metadata, the list's name and description live in
 * `#` comment lines at the top of the file (line breaks in the description
 * escaped as `\n`):
 *
 *   # Datenschmiede Nachschlageliste
 *   # name: Currencies
 *   # description: First line\nsecond line
 *   "code";"name";"weight"
 *   "EUR";"Euro";"40"
 *   "USD";"US Dollar";"60"
 */

/** Name of the fixed weight column in the CSV header. */
export const WEIGHT_COLUMN = 'weight';

/** A raw CSV record together with its 0-based start line in the text (for diagnostics). */
interface CsvRecord {
	fields: string[];
	line: number;
}

/**
 * Splits the raw text into CSV records: semicolon-separated, values in double
 * quotes (`""` as an escaped quote; line breaks inside quotes are allowed too).
 * Unquoted values are tolerated while reading — writing always quotes (see
 * serializeLookup). Empty lines and `#` comment lines are skipped.
 */
function scanRecords(text: string): CsvRecord[] {
	const records: CsvRecord[] = [];
	let fields: string[] = [];
	let field = '';
	let recordLine = 0;
	let line = 0;
	let column = 0;
	type State = 'fieldStart' | 'unquoted' | 'quoted' | 'afterQuoted';
	let state: State = 'fieldStart';
	/** `true` as soon as the current record has content (including an empty first field from a leading `;`). */
	let recordStarted = false;

	const pushField = () => {
		fields.push(field);
		field = '';
	};
	const pushRecord = () => {
		pushField();
		records.push({ fields, line: recordLine });
		fields = [];
		recordStarted = false;
		state = 'fieldStart';
	};

	for (let i = 0; i < text.length; i++) {
		const c = text[i];

		if (state === 'quoted') {
			if (c === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
					column += 2;
					continue;
				}
				state = 'afterQuoted';
			} else {
				field += c;
			}
		} else if (c === '\r') {
			// Treat \r\n like \n — the following \n closes the record.
		} else if (c === '\n') {
			if (recordStarted) {
				pushRecord();
			}
		} else if (state === 'fieldStart') {
			if (c === '#' && !recordStarted) {
				// Comment line (only at the start of a line): skip to end of line.
				while (i < text.length && text[i] !== '\n') {
					i++;
				}
				line++;
				column = 0;
				continue;
			}
			if (!recordStarted) {
				recordStarted = true;
				recordLine = line;
			}
			if (c === '"') {
				state = 'quoted';
			} else if (c === ';') {
				pushField();
			} else {
				state = 'unquoted';
				field += c;
			}
		} else if (state === 'unquoted') {
			if (c === ';') {
				pushField();
				state = 'fieldStart';
			} else {
				field += c;
			}
		} else {
			// afterQuoted: only whitespace is allowed up to the separator/end of line.
			if (c === ';') {
				pushField();
				state = 'fieldStart';
			} else if (c !== ' ' && c !== '\t') {
				throw new ParseError('Unexpected character after closing double quote.', {
					line: line + 1,
					column: column + 1,
				});
			}
		}

		if (c === '\n') {
			line++;
			column = 0;
		} else {
			column++;
		}
	}

	if (state === 'quoted') {
		throw new ParseError('Unclosed double quote — the quoted value is never terminated.', {
			line: line + 1,
			column: column + 1,
		});
	}
	if (recordStarted) {
		pushRecord();
	}

	return records;
}

/** Reads the metadata comments (`# name:`, `# description:`) at the top of the file. */
function readMeta(text: string): { name: string; description: string } {
	let name = '';
	let description = '';
	for (const rawLine of text.split('\n')) {
		const trimmed = rawLine.trim();
		if (trimmed === '') {
			continue;
		}
		if (!trimmed.startsWith('#')) {
			// Metadata only appears before the first data line.
			break;
		}
		const nameMatch = /^#\s*name:\s?(.*)$/.exec(trimmed);
		if (nameMatch) {
			name = unescapeMetaValue(nameMatch[1]);
			continue;
		}
		const descriptionMatch = /^#\s*description:\s?(.*)$/.exec(trimmed);
		if (descriptionMatch) {
			description = unescapeMetaValue(descriptionMatch[1]);
		}
	}
	return { name, description };
}

/** Escapes a metadata value for its `#` comment line (line breaks as `\n`). */
function escapeMetaValue(value: string): string {
	return (value ?? '').replace(/\\/g, '\\\\').replace(/\r\n?|\n/g, '\\n');
}

/** Reverses {@link escapeMetaValue}. */
function unescapeMetaValue(value: string): string {
	let result = '';
	for (let i = 0; i < value.length; i++) {
		if (value[i] === '\\' && value[i + 1] === 'n') {
			result += '\n';
			i++;
		} else if (value[i] === '\\' && value[i + 1] === '\\') {
			result += '\\';
			i++;
		} else {
			result += value[i];
		}
	}
	return result;
}

/** Parses the CSV text of a .lkp file into our lookup list model. */
export function parseLookupText(text: string): LookupList {
	const { name, description } = readMeta(text);
	const records = scanRecords(text);
	if (records.length === 0) {
		return { name, description, columns: [], rows: [] };
	}

	const header = records[0].fields.map((h) => h.trim());
	// By format the weight column is always the last header column; if it is
	// missing (hand-edited file), all columns count as value columns and the
	// weights stay empty — validation then reports them as missing.
	const weightIndex = header.length > 0 && header[header.length - 1].toLowerCase() === WEIGHT_COLUMN ? header.length - 1 : -1;
	const columns = weightIndex >= 0 ? header.slice(0, weightIndex) : header.slice();

	const rows: LookupRow[] = records.slice(1).map((record) => {
		const fields = record.fields;
		if (weightIndex >= 0 && fields.length > weightIndex) {
			// Surplus fields behind the weight column are taken over as further
			// values (rather than being dropped silently) — the column list
			// grows accordingly below.
			return { values: [...fields.slice(0, weightIndex), ...fields.slice(weightIndex + 1)], weight: fields[weightIndex].trim() };
		}
		return { values: fields.slice(), weight: '' };
	});

	// Bring columns and rows to a common width: pad short rows, and add extra
	// (unnamed) columns for rows that are too long.
	const columnCount = Math.max(columns.length, ...rows.map((row) => row.values.length));
	while (columns.length < columnCount) {
		columns.push('');
	}
	for (const row of rows) {
		while (row.values.length < columnCount) {
			row.values.push('');
		}
	}

	return { name, description, columns, rows };
}

/**
 * Writes our lookup list model as CSV text — like table/toml.ts#serializeTable a
 * lean, fixed format: every value quoted, the weight column always last.
 */
export function serializeLookup(list: LookupList): string {
	const lines: string[] = [];
	lines.push('# Datenschmiede Nachschlageliste');
	lines.push(`# name: ${escapeMetaValue(list.name)}`);
	lines.push(`# description: ${escapeMetaValue(list.description)}`);
	lines.push([...list.columns, WEIGHT_COLUMN].map(csvField).join(';'));
	for (const row of list.rows) {
		const values = list.columns.map((_, index) => row.values[index] ?? '');
		lines.push([...values, row.weight].map(csvField).join(';'));
	}
	lines.push('');
	return lines.join('\n');
}

/** Quotes one CSV field, doubling any embedded quote. */
function csvField(value: string): string {
	return `"${(value ?? '').replace(/"/g, '""')}"`;
}

/** Line positions of the records in the raw text, for diagnostics (counterpart to findColumnLineInfo in table/toml.ts). */
export interface LookupLineInfo {
	/** 0-based line of the header row. */
	headerLine: number;
	/** 0-based start line of every value row, in the order of `LookupList.rows`. */
	rowLines: number[];
}

/** Determines the line positions of header and value rows; falls back to zeros on broken CSV. */
export function findLookupLineInfo(text: string): LookupLineInfo {
	try {
		const records = scanRecords(text);
		return { headerLine: records[0]?.line ?? 0, rowLines: records.slice(1).map((record) => record.line) };
	} catch {
		// Broken CSV -> the syntax error itself is already reported as a diagnostic.
		return { headerLine: 0, rowLines: [] };
	}
}
