import { LookupList, LookupRow } from './model';
// ParseError ist trotz seines Wohnorts in tomlUtil.ts formatunabhängig (nur
// Meldung + Position) und wird hier für CSV wiederverwendet, damit der
// Editor-Provider Parse-Fehler aller drei Dateiformate gleich behandeln kann.
import { ParseError } from '../tomlUtil';

/**
 * Lesen/Schreiben des CSV-Formats einer .lkp-Nachschlageliste.
 *
 * Das Format ist bewusst einfach gehalten (Gegenstück im td-Generator):
 * Semikolon-getrennt, jeder Wert in doppelten Anführungszeichen, erste
 * Datenzeile ist die Kopfzeile, deren letzte Spalte immer die feste
 * Gewichtsspalte "weight" ist. Name und Beschreibung der Liste stehen —
 * da CSV selbst keinen Platz für Metadaten hat — in `#`-Kommentarzeilen
 * am Dateianfang (Zeilenumbrüche der Beschreibung als `\n` escaped):
 *
 *   # Datenschmiede Nachschlageliste
 *   # name: Currencies
 *   # description: Erste Zeile\nzweite Zeile
 *   "code";"name";"weight"
 *   "EUR";"Euro";"40"
 *   "USD";"US Dollar";"60"
 */

/** Name der festen Gewichtsspalte in der CSV-Kopfzeile. */
export const WEIGHT_COLUMN = 'weight';

/** Ein roher CSV-Datensatz samt 0-basierter Startzeile im Text (für Diagnostics). */
interface CsvRecord {
	fields: string[];
	line: number;
}

/**
 * Zerlegt den Rohtext in CSV-Datensätze: Semikolon-getrennt, Werte in
 * doppelten Anführungszeichen (`""` als escaptes Anführungszeichen, auch
 * Zeilenumbrüche innerhalb von Anführungszeichen sind erlaubt). Unquotierte
 * Werte werden beim Lesen toleriert — geschrieben wird immer quotiert
 * (siehe serializeLookup). Leere Zeilen und `#`-Kommentarzeilen werden
 * übersprungen.
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
	/** `true`, sobald der aktuelle Datensatz Inhalt hat (auch ein leeres erstes Feld durch ein führendes `;`). */
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
			// \r\n wie \n behandeln — das nachfolgende \n schließt den Datensatz ab.
		} else if (c === '\n') {
			if (recordStarted) {
				pushRecord();
			}
		} else if (state === 'fieldStart') {
			if (c === '#' && !recordStarted) {
				// Kommentarzeile (nur am Zeilenanfang): bis zum Zeilenende überspringen.
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
			// afterQuoted: bis zum Trenner/Zeilenende sind nur Leerzeichen erlaubt.
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

/** Liest die Metadaten-Kommentare (`# name:`, `# description:`) am Dateianfang. */
function readMeta(text: string): { name: string; description: string } {
	let name = '';
	let description = '';
	for (const rawLine of text.split('\n')) {
		const trimmed = rawLine.trim();
		if (trimmed === '') {
			continue;
		}
		if (!trimmed.startsWith('#')) {
			// Metadaten stehen nur vor der ersten Datenzeile.
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

/** Escaped einen Metadaten-Wert für seine `#`-Kommentarzeile (Zeilenumbrüche als `\n`). */
function escapeMetaValue(value: string): string {
	return (value ?? '').replace(/\\/g, '\\\\').replace(/\r\n?|\n/g, '\\n');
}

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

/** Liest den CSV-Text einer .lkp-Datei in unser Nachschlagelisten-Modell ein. */
export function parseLookupText(text: string): LookupList {
	const { name, description } = readMeta(text);
	const records = scanRecords(text);
	if (records.length === 0) {
		return { name, description, columns: [], rows: [] };
	}

	const header = records[0].fields.map((h) => h.trim());
	// Die Gewichtsspalte ist per Format immer die letzte Kopfspalte; fehlt sie
	// (von Hand bearbeitete Datei), gelten alle Spalten als Wertespalten und
	// die Gewichte bleiben leer — die Validierung meldet sie dann als fehlend.
	const weightIndex = header.length > 0 && header[header.length - 1].toLowerCase() === WEIGHT_COLUMN ? header.length - 1 : -1;
	const columns = weightIndex >= 0 ? header.slice(0, weightIndex) : header.slice();

	const rows: LookupRow[] = records.slice(1).map((record) => {
		const fields = record.fields;
		if (weightIndex >= 0 && fields.length > weightIndex) {
			// Überzählige Felder hinter der Gewichtsspalte werden als weitere
			// Werte übernommen (statt sie stillschweigend zu verwerfen) — die
			// Spaltenliste wächst dafür unten entsprechend mit.
			return { values: [...fields.slice(0, weightIndex), ...fields.slice(weightIndex + 1)], weight: fields[weightIndex].trim() };
		}
		return { values: fields.slice(), weight: '' };
	});

	// Spalten und Zeilen auf eine gemeinsame Breite bringen: zu kurze Zeilen
	// auffüllen, für überlange Zeilen zusätzliche (namenlose) Spalten anlegen.
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
 * Schreibt unser Nachschlagelisten-Modell als CSV-Text — analog zu
 * table/toml.ts#serializeTable ein schlankes, festes Format: jeder Wert
 * quotiert, die Gewichtsspalte immer als letzte Spalte.
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

function csvField(value: string): string {
	return `"${(value ?? '').replace(/"/g, '""')}"`;
}

/** Zeilenpositionen der Datensätze im Rohtext, für Diagnostics (Gegenstück zu findColumnLineInfo in table/toml.ts). */
export interface LookupLineInfo {
	/** 0-basierte Zeile der Kopfzeile. */
	headerLine: number;
	/** 0-basierte Startzeile jeder Wertezeile, in der Reihenfolge von `LookupList.rows`. */
	rowLines: number[];
}

export function findLookupLineInfo(text: string): LookupLineInfo {
	try {
		const records = scanRecords(text);
		return { headerLine: records[0]?.line ?? 0, rowLines: records.slice(1).map((record) => record.line) };
	} catch {
		// Kaputtes CSV -> der Syntaxfehler selbst wird bereits als Diagnostic gemeldet.
		return { headerLine: 0, rowLines: [] };
	}
}
