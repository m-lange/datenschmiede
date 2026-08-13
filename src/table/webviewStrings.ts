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

	generatorColumnHeader: string;
	generatorEmptyOption: string;
	generatorNotFoundSuffix: string;
	generatorCustomGroupLabel: string;
	generatorBuiltinGroupLabel: string;
	generatorEditParamsLabel: string;
	generatorDialogNoParams: string;
	generatorParamEmptyOption: string;
	generatorDoneLabel: string;
	generatorCancelLabel: string;
	generatorRequiredSuffix: string;
	generatorTrueLabel: string;
	generatorFalseLabel: string;
	/** Warnungstexte — Kurzfassungen der Meldungen aus table/editorProvider.ts für den Zell-Tooltip. */
	genWarnNoGenerator: string;
	genWarnNotFound: string;
	genWarnFkOnly: string;
	genWarnFkMismatch: string;
	genWarnParamMissing: string;
	genWarnParamInvalid: string;
	genWarnRefNotFound: string;

	previewButton: string;
	/** Titel des Vorschau-Dialogs; `{0}` = Anzahl der Datensätze. */
	previewDialogTitle: string;
	previewCloseLabel: string;

	outputSectionTitle: string;
	outputFileNameLabel: string;
	outputFileNameHint: string;
	outputFileNamePlaceholder: string;
	outputAddVariableButton: string;
	outputVariableGroupLabel: string;
	outputColumnGroupLabel: string;
	/** Anzeigenamen der eingebauten Dateinamen-Variablen (siehe FILE_NAME_VARIABLES in table/model.ts). */
	outputVarDate: string;
	outputVarTime: string;
	outputVarDatetime: string;
	outputVarTimestamp: string;
	outputVarSchema: string;
	outputVarTable: string;
	outputVarRecords: string;
	outputFormatLabel: string;
	outputCsvSectionLabel: string;
	csvDelimiterLabel: string;
	csvDelimiterTab: string;
	csvQuoteAllLabel: string;
	csvDecimalLabel: string;
	csvDateFormatLabel: string;
	csvDatetimeFormatLabel: string;
	csvIncludeHeaderLabel: string;
	csvEncodingLabel: string;

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

	generatorColumnHeader: 'Column generator',
	generatorEmptyOption: '— none —',
	generatorNotFoundSuffix: ' (not found)',
	generatorCustomGroupLabel: 'Custom generators',
	generatorBuiltinGroupLabel: 'Built-in generators',
	generatorEditParamsLabel: 'Edit generator parameters',
	generatorDialogNoParams: 'This generator has no parameters.',
	generatorParamEmptyOption: '— select —',
	generatorDoneLabel: 'Done',
	generatorCancelLabel: 'Cancel',
	generatorRequiredSuffix: ' *',
	generatorTrueLabel: 'true',
	generatorFalseLabel: 'false',
	genWarnNoGenerator: 'No generator selected — select and configure one for this column.',
	genWarnNotFound: 'This generator was not found. Its .tdgen file may have been deleted, or the generator was renamed.',
	genWarnFkOnly: 'The Foreign Key generator can only be used on foreign key columns.',
	genWarnFkMismatch: 'Foreign key columns always use the Foreign Key generator.',
	genWarnParamMissing: 'Required parameter "{0}" has no value.',
	genWarnParamInvalid: 'Parameter "{0}" has an invalid value.',
	genWarnRefNotFound: 'Parameter "{0}" references "{1}", which was not found. It may have been deleted or renamed.',

	previewButton: 'Preview',
	previewDialogTitle: 'Preview — {0} records',
	previewCloseLabel: 'Close',

	outputSectionTitle: 'Output',
	outputFileNameLabel: 'File name',
	outputFileNameHint:
		'Combine fixed text with dynamic values. Dynamic parts appear as tags — click a tag to remove it. Empty uses "schema_table".',
	outputFileNamePlaceholder: 'e.g. customers_{date}',
	outputAddVariableButton: 'Add dynamic value',
	outputVariableGroupLabel: 'Variables',
	outputColumnGroupLabel: 'Column value (first record)',
	outputVarDate: 'Current date',
	outputVarTime: 'Current time',
	outputVarDatetime: 'Current date + time',
	outputVarTimestamp: 'Unix timestamp',
	outputVarSchema: 'Schema',
	outputVarTable: 'Table name',
	outputVarRecords: 'Number of records',
	outputFormatLabel: 'File type',
	outputCsvSectionLabel: 'CSV settings',
	csvDelimiterLabel: 'Column separator',
	csvDelimiterTab: 'Tab',
	csvQuoteAllLabel: 'Wrap every value in double quotes',
	csvDecimalLabel: 'Decimal separator',
	csvDateFormatLabel: 'Date format',
	csvDatetimeFormatLabel: 'Timestamp format',
	csvIncludeHeaderLabel: 'Write header row',
	csvEncodingLabel: 'Encoding',

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

	generatorColumnHeader: 'Spaltengenerator',
	generatorEmptyOption: '— keiner —',
	generatorNotFoundSuffix: ' (nicht gefunden)',
	generatorCustomGroupLabel: 'Eigene Generatoren',
	generatorBuiltinGroupLabel: 'Eingebaute Generatoren',
	generatorEditParamsLabel: 'Generator-Parameter bearbeiten',
	generatorDialogNoParams: 'Dieser Generator hat keine Parameter.',
	generatorParamEmptyOption: '— auswählen —',
	generatorDoneLabel: 'Fertig',
	generatorCancelLabel: 'Abbrechen',
	generatorRequiredSuffix: ' *',
	generatorTrueLabel: 'wahr',
	generatorFalseLabel: 'falsch',
	genWarnNoGenerator: 'Kein Generator ausgewählt — für diese Spalte einen Generator auswählen und konfigurieren.',
	genWarnNotFound:
		'Dieser Generator wurde nicht gefunden. Seine .tdgen-Datei wurde möglicherweise gelöscht oder der Generator umbenannt.',
	genWarnFkOnly: 'Der Fremdschlüssel-Generator kann nur für Fremdschlüssel-Spalten verwendet werden.',
	genWarnFkMismatch: 'Fremdschlüssel-Spalten verwenden immer den Fremdschlüssel-Generator.',
	genWarnParamMissing: 'Pflichtparameter „{0}“ hat keinen Wert.',
	genWarnParamInvalid: 'Parameter „{0}“ hat einen ungültigen Wert.',
	genWarnRefNotFound: 'Parameter „{0}“ referenziert „{1}“ — wurde nicht gefunden, möglicherweise gelöscht oder umbenannt.',

	previewButton: 'Vorschau',
	previewDialogTitle: 'Vorschau — {0} Datensätze',
	previewCloseLabel: 'Schließen',

	outputSectionTitle: 'Ausgabe',
	outputFileNameLabel: 'Dateiname',
	outputFileNameHint:
		'Fester Text kombiniert mit dynamischen Werten. Dynamische Teile erscheinen als Tags — Klick auf ein Tag entfernt es. Leer verwendet „schema_tabelle“.',
	outputFileNamePlaceholder: 'z. B. customers_{date}',
	outputAddVariableButton: 'Dynamischen Wert einfügen',
	outputVariableGroupLabel: 'Variablen',
	outputColumnGroupLabel: 'Spaltenwert (erster Datensatz)',
	outputVarDate: 'Aktuelles Datum',
	outputVarTime: 'Aktuelle Uhrzeit',
	outputVarDatetime: 'Aktuelles Datum + Uhrzeit',
	outputVarTimestamp: 'Unix-Zeitstempel',
	outputVarSchema: 'Schema',
	outputVarTable: 'Tabellenname',
	outputVarRecords: 'Datensatzanzahl',
	outputFormatLabel: 'Dateityp',
	outputCsvSectionLabel: 'CSV-Einstellungen',
	csvDelimiterLabel: 'Spaltentrenner',
	csvDelimiterTab: 'Tabulator',
	csvQuoteAllLabel: 'Jeden Wert in doppelte Anführungszeichen setzen',
	csvDecimalLabel: 'Dezimaltrenner',
	csvDateFormatLabel: 'Datumsformat',
	csvDatetimeFormatLabel: 'Zeitstempelformat',
	csvIncludeHeaderLabel: 'Kopfzeile schreiben',
	csvEncodingLabel: 'Encoding',

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
