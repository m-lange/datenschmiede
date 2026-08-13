/**
 * Übersetzte Texte für die Webview (das Formular).
 *
 * `vscode.l10n` ist innerhalb einer Webview nicht verfügbar (sie läuft in
 * einem eigenen, von der Extension unabhängigen Browser-Kontext). Deshalb
 * ermittelt der Extension-Host die passende Sprache (siehe
 * table/editorProvider.ts, `vscode.env.language`) und schickt der Webview
 * dieses fertige Text-Objekt einmalig beim Start.
 */
export interface WebviewStrings {
	tabOverview: string;
	tabColumns: string;

	fieldNameLabel: string;
	fieldNamePlaceholder: string;
	fieldSchemaLabel: string;
	fieldSchemaPlaceholder: string;
	fieldDescriptionLabel: string;
	fieldDescriptionPlaceholder: string;

	addColumnButton: string;

	colHeaderName: string;
	colHeaderType: string;
	colHeaderDescription: string;
	colHeaderPk: string;
	colHeaderFk: string;

	columnNamePlaceholder: string;
	columnDescriptionPlaceholder: string;
	primaryKeyLabel: string;
	foreignKeyLabel: string;
	removeColumnLabel: string;
	moveColumnUpLabel: string;
	moveColumnDownLabel: string;
	hideColumnLabel: string;
	unhideColumnLabel: string;

	fkTableLabel: string;
	fkTableEmptyOption: string;
	fkTableNotFoundSuffix: string;
	fkColumnLabel: string;
	fkColumnEmptyOption: string;
	fkColumnNotFoundSuffix: string;
	fkTableRequiredError: string;
	fkTableNotFoundError: string;
	fkTableSelfReferenceError: string;
	fkColumnRequiredError: string;
	fkColumnNotFoundError: string;

	emptyStateText: string;
	emptyStateAction: string;

	errorTitle: string;
	errorBody: string;
	errorHint: string;
}

const en: WebviewStrings = {
	tabOverview: 'Overview',
	tabColumns: 'Columns',

	fieldNameLabel: 'Name',
	fieldNamePlaceholder: 'e.g. customers',
	fieldSchemaLabel: 'Schema',
	fieldSchemaPlaceholder: 'e.g. public',
	fieldDescriptionLabel: 'Description',
	fieldDescriptionPlaceholder: 'What is this table used for? Supports Markdown.',

	addColumnButton: 'Add Column',

	colHeaderName: 'Name',
	colHeaderType: 'Data Type',
	colHeaderDescription: 'Description',
	colHeaderPk: 'PK',
	colHeaderFk: 'FK',

	columnNamePlaceholder: 'Column name',
	columnDescriptionPlaceholder: 'Description (optional). Supports Markdown.',
	primaryKeyLabel: 'Primary key',
	foreignKeyLabel: 'Foreign key',
	removeColumnLabel: 'Remove column',
	moveColumnUpLabel: 'Move column up',
	moveColumnDownLabel: 'Move column down',
	hideColumnLabel: 'Hide column',
	unhideColumnLabel: 'Show column',

	fkTableLabel: 'Referenced table',
	fkTableEmptyOption: '— select table —',
	fkTableNotFoundSuffix: ' (not found)',
	fkColumnLabel: 'Referenced column',
	fkColumnEmptyOption: '— select column —',
	fkColumnNotFoundSuffix: ' (not found)',
	fkTableRequiredError: 'Select a referenced table.',
	fkTableNotFoundError: 'This table was not found. It may have been deleted, renamed, or moved.',
	fkTableSelfReferenceError: 'A table cannot reference itself.',
	fkColumnRequiredError: 'Select a referenced column.',
	fkColumnNotFoundError: 'This column was not found in the referenced table.',

	emptyStateText: 'No columns yet.',
	emptyStateAction: 'Add first column',

	errorTitle: 'Unable to display file',
	errorBody: 'This .td file contains invalid TOML and cannot be shown in the visual editor.',
	errorHint: 'Use "Reopen Editor With…" (right-click the tab) to open it as text and fix the error.',
};

const de: WebviewStrings = {
	tabOverview: 'Übersicht',
	tabColumns: 'Spalten',

	fieldNameLabel: 'Name',
	fieldNamePlaceholder: 'z. B. customers',
	fieldSchemaLabel: 'Schema',
	fieldSchemaPlaceholder: 'z. B. public',
	fieldDescriptionLabel: 'Beschreibung',
	fieldDescriptionPlaceholder: 'Wofür wird diese Tabelle verwendet? Markdown wird unterstützt.',

	addColumnButton: 'Spalte hinzufügen',

	colHeaderName: 'Name',
	colHeaderType: 'Datentyp',
	colHeaderDescription: 'Beschreibung',
	colHeaderPk: 'PK',
	colHeaderFk: 'FK',

	columnNamePlaceholder: 'Spaltenname',
	columnDescriptionPlaceholder: 'Beschreibung (optional). Markdown wird unterstützt.',
	primaryKeyLabel: 'Primärschlüssel',
	foreignKeyLabel: 'Fremdschlüssel',
	removeColumnLabel: 'Spalte entfernen',
	moveColumnUpLabel: 'Spalte nach oben verschieben',
	moveColumnDownLabel: 'Spalte nach unten verschieben',
	hideColumnLabel: 'Spalte ausblenden',
	unhideColumnLabel: 'Spalte einblenden',

	fkTableLabel: 'Referenzierte Tabelle',
	fkTableEmptyOption: '— Tabelle wählen —',
	fkTableNotFoundSuffix: ' (nicht gefunden)',
	fkColumnLabel: 'Referenzierte Spalte',
	fkColumnEmptyOption: '— Spalte wählen —',
	fkColumnNotFoundSuffix: ' (nicht gefunden)',
	fkTableRequiredError: 'Tabelle auswählen.',
	fkTableNotFoundError: 'Diese Tabelle wurde nicht gefunden. Sie wurde möglicherweise gelöscht, umbenannt oder verschoben.',
	fkTableSelfReferenceError: 'Eine Tabelle kann nicht sich selbst referenzieren.',
	fkColumnRequiredError: 'Spalte auswählen.',
	fkColumnNotFoundError: 'Diese Spalte wurde in der referenzierten Tabelle nicht gefunden.',

	emptyStateText: 'Noch keine Spalten vorhanden.',
	emptyStateAction: 'Erste Spalte hinzufügen',

	errorTitle: 'Datei kann nicht angezeigt werden',
	errorBody: 'Diese .td-Datei enthält kein gültiges TOML und kann im visuellen Editor nicht dargestellt werden.',
	errorHint: 'Über „Reopen Editor With…“ (Rechtsklick auf den Tab) lässt sich die Datei als Text öffnen und der Fehler beheben.',
};

const CATALOG: Record<string, WebviewStrings> = { en, de };

/** Wählt den Text-Katalog passend zur VS-Code-Anzeigesprache (`vscode.env.language`). */
export function getWebviewStrings(vscodeLanguage: string): WebviewStrings {
	const lang = vscodeLanguage.toLowerCase().split('-')[0];
	return CATALOG[lang] ?? en;
}
