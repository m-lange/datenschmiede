/**
 * Datenmodell einer .td-Tabellendefinition.
 *
 * Dieses Modell ist die "Wahrheit", mit der die Webview arbeitet. Es wird vom
 * Extension-Host aus dem TOML-Text der Dokument-Datei erzeugt (siehe
 * table/toml.ts) und nach jeder Änderung wieder zu TOML serialisiert.
 */

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
}

export interface Table {
	schema: string;
	name: string;
	description: string;
	columns: Column[];
}

export function createEmptyTable(name = ''): Table {
	return { schema: '', name, description: '', columns: [] };
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
	};
}
