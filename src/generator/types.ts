/**
 * Grundtypen des Generator-Systems: Jede Spalte einer Tabelle kann einen
 * Generator zugewiesen bekommen, der beim Generator-Lauf ihre Werte erzeugt.
 * Es gibt eingebaute Generatoren (src/generator/builtins/, je einer pro
 * Datei) und benutzerdefinierte Generatoren als `.tdgen`-Dateien im
 * Workspace (siehe generator/model.ts, generator/custom.ts).
 *
 * Bewusst frei von jeder vscode-Abhängigkeit (einfach testbar) — wie
 * table/model.ts wird alles hier sowohl vom Extension-Host als auch von den
 * vscode-freien Prüfungen genutzt.
 */

import { COLUMN_TYPES } from '../table/model';

/**
 * Datentypen eines Generator-Parameters: dieselben wie für Spalten im Table
 * Editor, erweitert um Nachschlageliste (`lookup`), referenzierte Tabelle
 * (`table`), referenzierte Spalte (`column`) und eine Spalte der *eigenen*
 * Tabelle (`own_column`). Ein `column`-Parameter bezieht seine Auswahl aus
 * dem nächsten davorstehenden `table`- bzw. `lookup`-Parameter (analog zum
 * Paar fk_table/fk_column der Tabellenspalten); ein `own_column`-Parameter
 * bietet die Spalten der Tabelle an, zu der die generierte Spalte gehört —
 * `ctx.column(...)` liefert dann deren Werte für **dieselben Datensätze**,
 * und die referenzierte Spalte wird garantiert *vor* dieser generiert.
 */
export const PARAMETER_TYPES = [...COLUMN_TYPES, 'lookup', 'table', 'column', 'own_column'] as const;

export type ParameterType = (typeof PARAMETER_TYPES)[number];

/** Ein Parameter eines Generators (Name, Datentyp, Beschreibung — der Wert wird je Spalte im Table Editor gesetzt). */
export interface GeneratorParameter {
	name: string;
	type: string;
	description: string;
	/**
	 * Vordefinierte Werteliste: ist sie gesetzt (nicht leer), bietet der Table
	 * Editor eine Auswahl statt freier Eingabe an — jeder Parameter akzeptiert
	 * also entweder freie Eingabe oder Werte aus dieser Liste.
	 */
	choices?: string[];
	/** Pflichtparameter: fehlt der Wert, meldet die Validierung eine Warnung. */
	required?: boolean;
	/** Platzhalter-/Beispieltext für das Eingabefeld im Table Editor. */
	placeholder?: string;
}

/**
 * Die je Spalte gespeicherte Generator-Konfiguration: welcher Generator
 * (`id`, bei benutzerdefinierten mit Präfix `custom:`) mit welchen
 * Parameterwerten. Alle Werte bleiben bewusst Strings (analog zu `records`
 * in project/model.ts), damit ungültige Eingaben erhalten bleiben und von
 * der Validierung gemeldet werden können, statt sie stillschweigend zu
 * verwerfen.
 */
export interface GeneratorConfig {
	id: string;
	params: Record<string, string>;
}

/** Präfix der `id` benutzerdefinierter Generatoren (`custom:<name>`, siehe generator/custom.ts). */
export const CUSTOM_GENERATOR_PREFIX = 'custom:';

/** Eine Tabelle des Workspace zum Gegenprüfen von Referenzen (Gegenstück zu KnownTable in table/validation.ts). */
export interface KnownTableRef {
	/** Logische Identität (`schema.name`), wie sie in Parametern vom Typ `table` gespeichert wird. */
	label: string;
	columns: string[];
}

/** Eine Nachschlageliste (.lkp) des Workspace zum Gegenprüfen von Referenzen. */
export interface KnownLookupRef {
	/** Name der Liste (aus ihrer `# name:`-Metadaten-Zeile). */
	name: string;
	columns: string[];
}

/**
 * Umgebung, in der eine Generator-Konfiguration geprüft wird: die eigene
 * Spalte/Tabelle plus alles, was im Workspace referenzierbar ist.
 */
export interface GeneratorContext {
	/** Name der Spalte, zu der die Konfiguration gehört. */
	ownColumnName: string;
	/** Namen aller Spalten der eigenen Tabelle (z. B. für den Kombinations-Generator). */
	ownColumns: string[];
	/** `fk_table` der Spalte (nur für den Fremdschlüssel-Generator relevant). */
	fkTable: string;
	/** `fk_column` der Spalte (nur für den Fremdschlüssel-Generator relevant). */
	fkColumn: string;
	tables: KnownTableRef[];
	lookups: KnownLookupRef[];
}

/** Prüfergebnis-Arten einer Generator-Konfiguration — Übersetzung übernimmt der Aufrufer (table/editorProvider.ts) über vscode.l10n. */
export type GeneratorIssueKind =
	| 'gen-param-missing'
	| 'gen-param-invalid'
	| 'gen-table-not-found'
	| 'gen-column-not-found'
	| 'gen-lookup-not-found'
	| 'gen-lookup-column-not-found'
	| 'gen-own-column-not-found';

/** Eine Warnung zur aktuellen Generator-Konfiguration einer Spalte (landet in VS Codes Problems-Ansicht). */
export interface GeneratorIssue {
	kind: GeneratorIssueKind;
	/** Name des betroffenen Parameters. */
	paramName: string;
	/** Zusätzliche Angabe für die Meldung, z. B. der nicht (mehr) gefundene Wert. */
	detail?: string;
}

/**
 * Von einer Generator-Konfiguration benötigte Referenzen — Grundlage für die
 * Generier-Reihenfolge (Spalte für Spalte) und die automatische
 * Tabellen-Mitnahme im Projekt-Editor (siehe computeRequiredClosure in
 * table/repository.ts).
 */
export interface RequiredRefs {
	/** Logische Identitäten (`schema.name`) benötigter Tabellen. */
	tables: string[];
	/** Benötigte Spalten fremder Tabellen (`{ table, column }`). */
	columns: { table: string; column: string }[];
	/** Benötigte Spalten der eigenen Tabelle (z. B. Platzhalter des Kombinations-Generators). */
	ownColumns: string[];
	/** Namen benötigter Nachschlagelisten (.lkp). */
	lookups: string[];
}

export function emptyRequiredRefs(): RequiredRefs {
	return { tables: [], columns: [], ownColumns: [], lookups: [] };
}

/**
 * Anzeige-Text einer Generator-Konfiguration aus einer Vorlage mit
 * `{param}`-Platzhaltern (z. B. `"{min} … {max}"`). Leere Parameter erscheinen
 * als `?`. Wird von GeneratorBase.displayString genutzt und ist als kleines,
 * eigenständiges Gegenstück in media/table.js dupliziert (Webviews kommen
 * ohne Modul-Bundling aus).
 */
export function fillDisplayTemplate(template: string, params: Record<string, string>): string {
	return template.replace(/\{([^}]+)\}/g, (_m, name: string) => {
		const value = (params[name] ?? '').trim();
		return value === '' ? '?' : value;
	});
}
