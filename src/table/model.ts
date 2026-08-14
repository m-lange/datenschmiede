/**
 * Datenmodell einer .td-Tabellendefinition.
 *
 * Dieses Modell ist die "Wahrheit", mit der die Webview arbeitet. Es wird vom
 * Extension-Host aus dem TOML-Text der Dokument-Datei erzeugt (siehe
 * table/toml.ts) und nach jeder Änderung wieder zu TOML serialisiert.
 */

import type { GeneratorConfig } from '../generator/types';

/** Vordefinierte, gebräuchliche Datentypen für synthetische Testdaten. */
export const COLUMN_TYPES = [
	'string',
	'text',
	'integer',
	'float',
	'decimal',
	'boolean',
	'date',
	'datetime',
	'time',
	'uuid',
	'email',
	'json',
] as const;

export type ColumnType = (typeof COLUMN_TYPES)[number];

export interface Column {
	name: string;
	type: string;
	pk: boolean;
	fk: boolean;
	/** Logische Identität (`schema.name`) der referenzierten Tabelle (nur relevant, wenn `fk` true ist). */
	fkTable: string;
	/** Name der referenzierten Spalte in dieser Tabelle (nur relevant, wenn `fk` true ist). */
	fkColumn: string;
	description: string;
	/**
	 * Ausgeblendete Spalte: überall in der Extension sichtbar (Editor, FK-Ziele,
	 * Vorschau) und beim Generator-Lauf ganz normal generiert — nur in die
	 * Ausgabedatei wird sie nicht geschrieben (siehe python/generate.py). So
	 * lassen sich Hilfsspalten erzeugen, deren Werte z. B. als FK-Quelle dienen.
	 */
	hidden: boolean;
	/**
	 * Generator dieser Spalte (siehe src/generator/) — `undefined`, solange
	 * keiner gewählt ist; beim Generator-Lauf greift dann ein Standard je
	 * Datentyp (FK-Spalten bekommen den Fremdschlüssel-Generator automatisch).
	 */
	generator?: GeneratorConfig;
}

/** Einstellungen der CSV-Ausgabe einer Tabelle (siehe python/generate.py fürs Gegenstück). */
export interface CsvOptions {
	/** Spaltentrenner, z. B. ";" oder ",". */
	delimiter: string;
	/** Jeden Wert in doppelte Anführungszeichen setzen (sonst nur bei Bedarf). */
	quoteAll: boolean;
	/** Dezimaltrenner für Zahlenwerte, "." oder ",". */
	decimal: string;
	/** Datumsformat (Python strftime, z. B. "%Y-%m-%d"). */
	dateFormat: string;
	/** Zeitstempelformat (Python strftime, z. B. "%Y-%m-%d %H:%M:%S"). */
	datetimeFormat: string;
	/** Kopfzeile mit den Spaltennamen schreiben. */
	includeHeader: boolean;
	/** Datei-Encoding, z. B. "utf-8". */
	encoding: string;
}

/** Ausgabe-Einstellungen einer Tabelle: Dateiname (mit `{…}`-Variablen) und Dateityp-Konfiguration. */
export interface OutputConfig {
	/**
	 * Dateiname ohne Endung, als Vorlage mit `{…}`-Variablen — konstante
	 * Textteile plus dynamische Teile wie `{date}`, `{timestamp}` oder
	 * `{column:name}` (Wert der Spalte aus dem ersten generierten Datensatz),
	 * siehe FILE_NAME_VARIABLES. Leer -> beim Lauf `schema_name`.
	 */
	fileName: string;
	/** Dateityp der Ausgabe — vorerst ausschließlich "csv". */
	format: string;
	csv: CsvOptions;
}

/** Eingebaute Dateinamen-Variablen (`{…}`), die der Generator-Lauf beim Schreiben auflöst. */
export const FILE_NAME_VARIABLES = ['date', 'time', 'datetime', 'timestamp', 'schema', 'table', 'records'] as const;

export function createDefaultOutput(): OutputConfig {
	return {
		fileName: '',
		format: 'csv',
		csv: {
			delimiter: ';',
			quoteAll: true,
			decimal: '.',
			dateFormat: '%Y-%m-%d',
			datetimeFormat: '%Y-%m-%d %H:%M:%S',
			includeHeader: true,
			encoding: 'utf-8',
		},
	};
}

export interface Table {
	schema: string;
	name: string;
	description: string;
	columns: Column[];
	output: OutputConfig;
}

export function createEmptyTable(name = ''): Table {
	return { schema: '', name, description: '', columns: [], output: createDefaultOutput() };
}

/**
 * Logische Tabellen-Identität `schema.name` (bzw. nur `name`, falls kein Schema
 * gesetzt ist), wie sie in `fk_table` gespeichert wird — leer, solange die Tabelle
 * (noch) keinen Namen hat. Bewusst frei von jeder vscode-/Dateisystem-Abhängigkeit,
 * damit sie sowohl vom Extension-Host (siehe table/repository.ts) als auch von den
 * vscode-freien Prüfungen in table/validation.ts genutzt werden kann.
 */
export function logicalTableName(table: Table): string {
	const name = table.name.trim();
	if (!name) {
		return '';
	}
	const schema = table.schema.trim();
	return schema ? `${schema}.${name}` : name;
}

export function createEmptyColumn(): Column {
	return {
		name: '',
		type: 'string',
		pk: false,
		fk: false,
		fkTable: '',
		fkColumn: '',
		description: '',
		hidden: false,
	};
}
