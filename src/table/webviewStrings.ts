/**
 * Translated texts for the webview (the form).
 *
 * `vscode.l10n` is not available inside a webview (it runs in its own browser
 * context, independent of the extension). The extension host therefore
 * determines the matching language (see table/editorProvider.ts,
 * `vscode.env.language`) and sends the webview this ready-made text object once
 * at startup.
 */
export interface WebviewStrings {
	tabOverview: string;
	tabColumns: string;
	/** Only shown for the JSON/XML file types; `{0}` = the file type ("JSON"/"XML"). */
	tabStructure: string;
	/** Only shown for the fixed-length file type. */
	tabFixedLayout: string;
	/** Custom file generators (.filegen) in the file type picker. */
	outputCustomGroupLabel: string;
	outputCustomSectionLabel: string;
	outputCustomHint: string;
	outputCustomMissingHint: string;
	outputTempHint: string;

	fieldNameLabel: string;
	fieldNamePlaceholder: string;
	fieldSchemaLabel: string;
	fieldSchemaPlaceholder: string;
	fieldDescriptionLabel: string;
	fieldDescriptionPlaceholder: string;
	/** Leading lookup list: one record per list row (see Table.drivingLookup). */
	fieldDrivingLookupLabel: string;
	fieldDrivingLookupHint: string;
	fieldDrivingLookupEmptyOption: string;
	fieldDrivingLookupNotFoundError: string;

	addColumnButton: string;
	/** Shared: clear a search field, and reset manually dragged grid column widths. */
	searchClearLabel: string;
	autoSizeColumnsLabel: string;

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
	/** Picker dialog for the referenced table and column (opened by the FK checkbox / the pencil). */
	fkPickerTitle: string;
	fkPickerSearchPlaceholder: string;
	fkPickerHint: string;
	fkPickerNoTables: string;
	fkPickerNoMatches: string;
	fkPickerCurrent: string;
	fkPickerClear: string;
	/** Display text of the foreign key generator; `{0}` = table, `{1}` = column. */
	fkGeneratorDisplay: string;
	fkGeneratorUnset: string;
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
	/** Note in the parameter dialog that values may reference other columns. */
	generatorTemplateHint: string;
	/** Tooltip of the button switching a picker field to free text (and back). */
	generatorTemplateToggleLabel: string;
	generatorTemplatePlaceholder: string;
	/** Warning texts — short forms of the messages in table/editorProvider.ts, used for the cell tooltip. */
	genWarnNoGenerator: string;
	genWarnNotFound: string;
	genWarnFkOnly: string;
	genWarnFkMismatch: string;
	genWarnParamMissing: string;
	genWarnParamInvalid: string;
	genWarnRefNotFound: string;

	previewButton: string;
	/** Title of the preview dialog; `{0}` = number of records. */
	previewDialogTitle: string;
	previewCloseLabel: string;

	outputSectionTitle: string;
	/** Title of the second output card: file type and its settings. */
	outputFormatSectionTitle: string;
	outputFileNameLabel: string;
	outputFileNameHint: string;
	outputFileNamePlaceholder: string;
	outputAddVariableButton: string;
	outputVariableGroupLabel: string;
	outputColumnGroupLabel: string;
	/** Display names of the built-in file name variables (see FILE_NAME_VARIABLES in table/model.ts). */
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

	/** Excel (.xlsx) settings. */
	outputXlsxSectionLabel: string;
	xlsxSheetNameLabel: string;
	xlsxSheetNameHint: string;
	xlsxSheetNamePlaceholder: string;
	xlsxStartCellLabel: string;
	xlsxStartCellHint: string;
	xlsxIncludeHeaderLabel: string;
	xlsxFreezeHeaderLabel: string;
	xlsxAutoFilterLabel: string;
	xlsxAutoFitColumnsLabel: string;

	/** JSON settings. */
	outputJsonSectionLabel: string;
	jsonRootNameLabel: string;
	jsonRootNameHint: string;
	jsonRootNamePlaceholder: string;
	jsonIndentLabel: string;
	jsonIndentCompact: string;
	jsonLinesLabel: string;
	jsonAsciiOnlyLabel: string;

	/** XML settings. */
	outputXmlSectionLabel: string;
	xmlRootElementLabel: string;
	xmlRecordElementLabel: string;
	xmlIndentLabel: string;
	xmlDeclarationLabel: string;

	/** Shared date/timestamp/encoding labels of the non-CSV file types. */
	formatDateFormatLabel: string;
	formatDatetimeFormatLabel: string;
	formatEncodingLabel: string;

	/**
	 * Structure tab (JSON/XML): the target structure and the value mapping of
	 * its leaves in ONE grid — shape and mapping belong to the same node.
	 */
	schemaHintJson: string;
	schemaHintXml: string;
	schemaAddNodeButton: string;
	schemaAddChildLabel: string;
	schemaFromColumnsButton: string;
	schemaClearButton: string;
	schemaEmptyText: string;
	schemaEmptyAction: string;
	schemaColHeaderName: string;
	schemaColHeaderKind: string;
	schemaColHeaderType: string;
	schemaNamePlaceholder: string;
	schemaNameRequiredError: string;
	schemaKindObject: string;
	schemaKindArray: string;
	schemaKindValue: string;
	schemaKindAttribute: string;
	schemaValueTypeAuto: string;
	schemaValueTypeString: string;
	schemaValueTypeNumber: string;
	schemaValueTypeInteger: string;
	schemaValueTypeBoolean: string;
	schemaRemoveNodeLabel: string;
	schemaMoveNodeUpLabel: string;
	schemaMoveNodeDownLabel: string;

	/** Fixed-length settings + the record layout grid. */
	outputFixedSectionLabel: string;
	fixedIncludeHeaderLabel: string;
	fixedTruncateLabel: string;
	fixedLineEndingLabel: string;
	fixedLineEndingLf: string;
	fixedLineEndingCrlf: string;
	fixedLayoutHint: string;
	/** `{0}` = total record length in characters. */
	fixedRecordLengthLabel: string;
	fixedAddFieldButton: string;
	fixedFromColumnsButton: string;
	fixedClearButton: string;
	fixedEmptyText: string;
	fixedEmptyAction: string;
	fixedColHeaderColumn: string;
	fixedColHeaderStart: string;
	fixedColHeaderWidth: string;
	fixedColHeaderAlign: string;
	fixedColHeaderPad: string;
	fixedAlignLeft: string;
	fixedAlignRight: string;
	fixedPadSpace: string;
	fixedPadZero: string;
	fixedWidthInvalidError: string;
	fixedRemoveFieldLabel: string;
	fixedMoveFieldUpLabel: string;
	fixedMoveFieldDownLabel: string;

	/** Mapping columns of the structure grid (which value fills a leaf). */
	mappingColHeaderSourceKind: string;
	mappingColHeaderSource: string;
	mappingSourceKindColumn: string;
	mappingSourceKindConstant: string;
	mappingColumnEmptyOption: string;
	mappingColumnNotFoundSuffix: string;
	mappingConstantPlaceholder: string;
	mappingColumnRequiredError: string;
	mappingColumnNotFoundError: string;

	emptyStateText: string;
	emptyStateAction: string;

	errorTitle: string;
	errorBody: string;
	errorHint: string;
}

const en: WebviewStrings = {
	tabOverview: 'Overview',
	tabColumns: 'Columns',
	tabStructure: '{0} structure',
	tabFixedLayout: 'Record layout',
	outputCustomGroupLabel: 'Custom file generators',
	outputCustomSectionLabel: 'Custom file generator',
	outputCustomHint:
		'This generator writes the file itself. The CSV settings below stay available to it through ctx.as_csv(…); everything else is up to its code.',
	outputCustomMissingHint:
		'This file generator was not found. Its .filegen file may have been deleted, or the generator was renamed.',
	outputTempHint:
		'The records are generated as usual — other tables can reference them by foreign key and generators can read them — but no file is written.',

	fieldNameLabel: 'Name',
	fieldNamePlaceholder: 'e.g. customers',
	fieldSchemaLabel: 'Schema',
	fieldSchemaPlaceholder: 'e.g. public',
	fieldDescriptionLabel: 'Description',
	fieldDescriptionPlaceholder: 'What is this table used for? Supports Markdown.',
	fieldDrivingLookupLabel: 'Leading lookup list',
	fieldDrivingLookupHint:
		'Generates exactly one record per row of the list, each row used once and in list order — the record count then comes from the list instead of the project. Every lookup column of this table reads that same row.',
	fieldDrivingLookupEmptyOption: '— none —',
	fieldDrivingLookupNotFoundError: 'This lookup list was not found. It may have been deleted or renamed.',

	addColumnButton: 'Add Column',
	searchClearLabel: 'Clear search',
	autoSizeColumnsLabel: 'Fit column widths to the content',

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
	hideColumnLabel: 'Exclude column from output file (values are still generated)',
	unhideColumnLabel: 'Include column in output file',

	fkTableLabel: 'Referenced table',
	fkTableEmptyOption: '— select table —',
	fkTableNotFoundSuffix: ' (not found)',
	fkColumnLabel: 'Referenced column',
	fkColumnEmptyOption: '— select column —',
	fkColumnNotFoundSuffix: ' (not found)',
	fkPickerTitle: 'Referenced table and column',
	fkPickerSearchPlaceholder: 'Search table or column…',
	fkPickerHint: 'Pick the column this foreign key points at. Type to filter; the tree groups tables by their schema.',
	fkPickerNoTables: 'There is no other table in this workspace to reference yet.',
	fkPickerNoMatches: 'No table or column matches the search.',
	fkPickerCurrent: 'Currently referenced',
	fkPickerClear: 'Remove reference',
	fkGeneratorDisplay: 'Foreign key → {0}.{1}',
	fkGeneratorUnset: 'Foreign key → not set',
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
	generatorTemplateHint:
		'Values may reference other columns of this table as {column} — the parameter then differs from record to record.',
	generatorTemplateToggleLabel: 'Enter a value with {column} references',
	generatorTemplatePlaceholder: 'e.g. {country}',
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

	outputSectionTitle: 'File name',
	outputFormatSectionTitle: 'File type',
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

	outputXlsxSectionLabel: 'Excel settings',
	xlsxSheetNameLabel: 'Sheet name',
	xlsxSheetNameHint: 'Supports the same {…} variables as the file name. Empty uses the table name.',
	xlsxSheetNamePlaceholder: 'e.g. {table}',
	xlsxStartCellLabel: 'Place table at',
	xlsxStartCellHint: 'Top-left cell of the table, e.g. "A1" or "B3".',
	xlsxIncludeHeaderLabel: 'Write header row',
	xlsxFreezeHeaderLabel: 'Freeze header row',
	xlsxAutoFilterLabel: 'Add auto filter to the header row',
	xlsxAutoFitColumnsLabel: 'Fit column widths to the content',

	outputJsonSectionLabel: 'JSON settings',
	jsonRootNameLabel: 'Root property',
	jsonRootNameHint: 'Wraps the records in {"name": [ … ]}. Empty writes a bare top-level array.',
	jsonRootNamePlaceholder: 'e.g. customers',
	jsonIndentLabel: 'Indentation',
	jsonIndentCompact: 'None (one line)',
	jsonLinesLabel: 'JSON Lines: one record per line, without the surrounding array',
	jsonAsciiOnlyLabel: 'Escape non-ASCII characters as \\uXXXX',

	outputXmlSectionLabel: 'XML settings',
	xmlRootElementLabel: 'Root element',
	xmlRecordElementLabel: 'Record element',
	xmlIndentLabel: 'Indentation',
	xmlDeclarationLabel: 'Write the <?xml …?> declaration',

	formatDateFormatLabel: 'Date format',
	formatDatetimeFormatLabel: 'Timestamp format',
	formatEncodingLabel: 'Encoding',

	schemaHintJson:
		'Describes ONE record: objects nest, values are the leaves that a column (or a fixed text) fills, and an array writes one entry per child node — an array entry has no name of its own, so the child names are not used.',
	schemaHintXml:
		'Describes ONE record element: objects become nested elements, values become child elements, attributes become attributes of their parent, and an array becomes a repeating element — every child writes one element named after the ARRAY, so its own name is not used.',
	schemaAddNodeButton: 'Add node',
	schemaAddChildLabel: 'Add child node',
	schemaFromColumnsButton: 'Derive from columns',
	schemaClearButton: 'Clear structure',
	schemaEmptyText: 'No structure defined — every column is written as a flat field.',
	schemaEmptyAction: 'Derive structure from the columns',
	schemaColHeaderName: 'Name',
	schemaColHeaderKind: 'Kind',
	schemaColHeaderType: 'Value type',
	schemaNamePlaceholder: 'Node name',
	schemaNameRequiredError: 'Give this node a name — it cannot be written without one.',
	schemaKindObject: 'Object',
	schemaKindArray: 'Array',
	schemaKindValue: 'Value',
	schemaKindAttribute: 'Attribute',
	schemaValueTypeAuto: 'Automatic',
	schemaValueTypeString: 'Text',
	schemaValueTypeNumber: 'Number',
	schemaValueTypeInteger: 'Integer',
	schemaValueTypeBoolean: 'Boolean',
	schemaRemoveNodeLabel: 'Remove node',
	schemaMoveNodeUpLabel: 'Move node up',
	schemaMoveNodeDownLabel: 'Move node down',

	outputFixedSectionLabel: 'Fixed-length settings',
	fixedIncludeHeaderLabel: 'Write header line (column names, padded the same way)',
	fixedTruncateLabel: 'Cut values that do not fit their field',
	fixedLineEndingLabel: 'Line ending',
	fixedLineEndingLf: 'LF (Unix)',
	fixedLineEndingCrlf: 'CRLF (Windows)',
	fixedLayoutHint:
		'The fields sit next to each other without a separator, so order and width alone decide where a value starts and ends.',
	fixedRecordLengthLabel: 'Record length: {0} characters',
	fixedAddFieldButton: 'Add field',
	fixedFromColumnsButton: 'Derive from columns',
	fixedClearButton: 'Clear layout',
	fixedEmptyText: 'No layout defined — every column is written as a 20 character field.',
	fixedEmptyAction: 'Derive layout from the columns',
	fixedColHeaderColumn: 'Column',
	fixedColHeaderStart: 'From',
	fixedColHeaderWidth: 'Width',
	fixedColHeaderAlign: 'Alignment',
	fixedColHeaderPad: 'Padding',
	fixedAlignLeft: 'Left',
	fixedAlignRight: 'Right',
	fixedPadSpace: 'Space',
	fixedPadZero: 'Zero',
	fixedWidthInvalidError: 'Give this field a width of at least one character.',
	fixedRemoveFieldLabel: 'Remove field',
	fixedMoveFieldUpLabel: 'Move field up',
	fixedMoveFieldDownLabel: 'Move field down',

	mappingColHeaderSourceKind: 'Filled from',
	mappingColHeaderSource: 'Value',
	mappingSourceKindColumn: 'Column',
	mappingSourceKindConstant: 'Fixed text',
	mappingColumnEmptyOption: '— select column —',
	mappingColumnNotFoundSuffix: ' (not found)',
	mappingConstantPlaceholder: 'Fixed text',
	mappingColumnRequiredError: 'Select a column.',
	mappingColumnNotFoundError: 'This column was not found in the table. It may have been renamed or removed.',

	emptyStateText: 'No columns yet.',
	emptyStateAction: 'Add first column',

	errorTitle: 'Unable to display file',
	errorBody: 'This .td file contains invalid TOML and cannot be shown in the visual editor.',
	errorHint: 'Use "Reopen Editor With…" (right-click the tab) to open it as text and fix the error.',
};

const de: WebviewStrings = {
	tabOverview: 'Übersicht',
	tabColumns: 'Spalten',
	tabStructure: '{0}-Struktur',
	tabFixedLayout: 'Satzaufbau',
	outputCustomGroupLabel: 'Eigene Dateigeneratoren',
	outputCustomSectionLabel: 'Eigener Dateigenerator',
	outputCustomHint:
		'Dieser Generator schreibt die Datei selbst. Die CSV-Einstellungen unten bleiben ihm über ctx.as_csv(…) zugänglich; alles Weitere bestimmt sein Code.',
	outputCustomMissingHint:
		'Dieser Dateigenerator wurde nicht gefunden. Seine .filegen-Datei wurde möglicherweise gelöscht oder der Generator umbenannt.',
	outputTempHint:
		'Die Datensätze werden wie gewohnt erzeugt — andere Tabellen können sie über Fremdschlüssel referenzieren und Generatoren sie lesen —, es wird aber keine Datei geschrieben.',

	fieldNameLabel: 'Name',
	fieldNamePlaceholder: 'z. B. customers',
	fieldSchemaLabel: 'Schema',
	fieldSchemaPlaceholder: 'z. B. public',
	fieldDescriptionLabel: 'Beschreibung',
	fieldDescriptionPlaceholder: 'Wofür wird diese Tabelle verwendet? Markdown wird unterstützt.',
	fieldDrivingLookupLabel: 'Führende Nachschlageliste',
	fieldDrivingLookupHint:
		'Erzeugt genau einen Datensatz je Zeile der Liste — jede Zeile genau einmal, in Listenreihenfolge. Die Datensatzanzahl kommt dann aus der Liste statt aus dem Projekt; alle Nachschlage-Spalten dieser Tabelle lesen dieselbe Zeile.',
	fieldDrivingLookupEmptyOption: '— keine —',
	fieldDrivingLookupNotFoundError:
		'Diese Nachschlageliste wurde nicht gefunden. Sie wurde möglicherweise gelöscht oder umbenannt.',

	addColumnButton: 'Spalte hinzufügen',
	searchClearLabel: 'Suche leeren',
	autoSizeColumnsLabel: 'Spaltenbreiten an den Inhalt anpassen',

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
	hideColumnLabel: 'Spalte nicht in die Ausgabedatei schreiben (Werte werden trotzdem generiert)',
	unhideColumnLabel: 'Spalte in die Ausgabedatei aufnehmen',

	fkTableLabel: 'Referenzierte Tabelle',
	fkTableEmptyOption: '— Tabelle wählen —',
	fkTableNotFoundSuffix: ' (nicht gefunden)',
	fkColumnLabel: 'Referenzierte Spalte',
	fkColumnEmptyOption: '— Spalte wählen —',
	fkColumnNotFoundSuffix: ' (nicht gefunden)',
	fkPickerTitle: 'Referenzierte Tabelle und Spalte',
	fkPickerSearchPlaceholder: 'Tabelle oder Spalte suchen…',
	fkPickerHint:
		'Die Spalte auswählen, auf die dieser Fremdschlüssel zeigt. Tippen filtert; der Baum gruppiert die Tabellen nach ihrem Schema.',
	fkPickerNoTables: 'In diesem Workspace gibt es noch keine andere Tabelle zum Referenzieren.',
	fkPickerNoMatches: 'Keine Tabelle und keine Spalte passt zur Suche.',
	fkPickerCurrent: 'Aktuell referenziert',
	fkPickerClear: 'Referenz entfernen',
	fkGeneratorDisplay: 'Fremdschlüssel → {0}.{1}',
	fkGeneratorUnset: 'Fremdschlüssel → nicht gesetzt',
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
	generatorTemplateHint:
		'Werte dürfen andere Spalten dieser Tabelle als {spalte} referenzieren — der Parameter unterscheidet sich dann von Datensatz zu Datensatz.',
	generatorTemplateToggleLabel: 'Wert mit {spalte}-Referenzen eingeben',
	generatorTemplatePlaceholder: 'z. B. {land}',
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

	outputSectionTitle: 'Dateiname',
	outputFormatSectionTitle: 'Dateityp',
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

	outputXlsxSectionLabel: 'Excel-Einstellungen',
	xlsxSheetNameLabel: 'Blattname',
	xlsxSheetNameHint: 'Unterstützt dieselben {…}-Variablen wie der Dateiname. Leer verwendet den Tabellennamen.',
	xlsxSheetNamePlaceholder: 'z. B. {table}',
	xlsxStartCellLabel: 'Tabelle platzieren ab',
	xlsxStartCellHint: 'Linke obere Zelle der Tabelle, z. B. „A1“ oder „B3“.',
	xlsxIncludeHeaderLabel: 'Kopfzeile schreiben',
	xlsxFreezeHeaderLabel: 'Kopfzeile fixieren',
	xlsxAutoFilterLabel: 'Autofilter auf der Kopfzeile setzen',
	xlsxAutoFitColumnsLabel: 'Spaltenbreiten an den Inhalt anpassen',

	outputJsonSectionLabel: 'JSON-Einstellungen',
	jsonRootNameLabel: 'Wurzel-Eigenschaft',
	jsonRootNameHint: 'Klammert die Datensätze in {"name": [ … ]}. Leer schreibt ein reines Array auf oberster Ebene.',
	jsonRootNamePlaceholder: 'z. B. customers',
	jsonIndentLabel: 'Einrückung',
	jsonIndentCompact: 'Keine (eine Zeile)',
	jsonLinesLabel: 'JSON Lines: ein Datensatz je Zeile, ohne umschließendes Array',
	jsonAsciiOnlyLabel: 'Nicht-ASCII-Zeichen als \\uXXXX maskieren',

	outputXmlSectionLabel: 'XML-Einstellungen',
	xmlRootElementLabel: 'Wurzelelement',
	xmlRecordElementLabel: 'Datensatz-Element',
	xmlIndentLabel: 'Einrückung',
	xmlDeclarationLabel: 'Deklaration <?xml …?> schreiben',

	formatDateFormatLabel: 'Datumsformat',
	formatDatetimeFormatLabel: 'Zeitstempelformat',
	formatEncodingLabel: 'Encoding',

	schemaHintJson:
		'Beschreibt EINEN Datensatz: Objekte verschachteln, Werte sind die Blätter, die eine Spalte (oder ein fester Text) füllt, und ein Array schreibt einen Eintrag je Kindknoten — ein Array-Eintrag hat keinen eigenen Namen, die Kindnamen werden also nicht verwendet.',
	schemaHintXml:
		'Beschreibt EIN Datensatz-Element: Objekte werden zu verschachtelten Elementen, Werte zu Kindelementen, Attribute zu Attributen ihres Elternelements, und ein Array wird zum wiederholten Element — jedes Kind schreibt ein Element mit dem Namen des ARRAYS, sein eigener Name wird also nicht verwendet.',
	schemaAddNodeButton: 'Knoten hinzufügen',
	schemaAddChildLabel: 'Unterknoten hinzufügen',
	schemaFromColumnsButton: 'Aus Spalten erzeugen',
	schemaClearButton: 'Struktur leeren',
	schemaEmptyText: 'Keine Struktur festgelegt — jede Spalte wird als flaches Feld geschrieben.',
	schemaEmptyAction: 'Struktur aus den Spalten erzeugen',
	schemaColHeaderName: 'Name',
	schemaColHeaderKind: 'Art',
	schemaColHeaderType: 'Werttyp',
	schemaNamePlaceholder: 'Name des Knotens',
	schemaNameRequiredError: 'Diesem Knoten einen Namen geben — ohne Namen kann er nicht geschrieben werden.',
	schemaKindObject: 'Objekt',
	schemaKindArray: 'Array',
	schemaKindValue: 'Wert',
	schemaKindAttribute: 'Attribut',
	schemaValueTypeAuto: 'Automatisch',
	schemaValueTypeString: 'Text',
	schemaValueTypeNumber: 'Zahl',
	schemaValueTypeInteger: 'Ganzzahl',
	schemaValueTypeBoolean: 'Wahrheitswert',
	schemaRemoveNodeLabel: 'Knoten entfernen',
	schemaMoveNodeUpLabel: 'Knoten nach oben verschieben',
	schemaMoveNodeDownLabel: 'Knoten nach unten verschieben',

	outputFixedSectionLabel: 'Einstellungen für feste Satzlänge',
	fixedIncludeHeaderLabel: 'Kopfzeile schreiben (Spaltennamen, gleich aufgefüllt)',
	fixedTruncateLabel: 'Werte abschneiden, die nicht ins Feld passen',
	fixedLineEndingLabel: 'Zeilenende',
	fixedLineEndingLf: 'LF (Unix)',
	fixedLineEndingCrlf: 'CRLF (Windows)',
	fixedLayoutHint:
		'Die Felder stehen ohne Trennzeichen nebeneinander — allein Reihenfolge und Breite bestimmen, wo ein Wert beginnt und endet.',
	fixedRecordLengthLabel: 'Satzlänge: {0} Zeichen',
	fixedAddFieldButton: 'Feld hinzufügen',
	fixedFromColumnsButton: 'Aus Spalten erzeugen',
	fixedClearButton: 'Aufbau leeren',
	fixedEmptyText: 'Kein Aufbau festgelegt — jede Spalte wird als 20 Zeichen breites Feld geschrieben.',
	fixedEmptyAction: 'Aufbau aus den Spalten erzeugen',
	fixedColHeaderColumn: 'Spalte',
	fixedColHeaderStart: 'Ab',
	fixedColHeaderWidth: 'Breite',
	fixedColHeaderAlign: 'Ausrichtung',
	fixedColHeaderPad: 'Auffüllen',
	fixedAlignLeft: 'Links',
	fixedAlignRight: 'Rechts',
	fixedPadSpace: 'Leerzeichen',
	fixedPadZero: 'Null',
	fixedWidthInvalidError: 'Diesem Feld eine Breite von mindestens einem Zeichen geben.',
	fixedRemoveFieldLabel: 'Feld entfernen',
	fixedMoveFieldUpLabel: 'Feld nach oben verschieben',
	fixedMoveFieldDownLabel: 'Feld nach unten verschieben',

	mappingColHeaderSourceKind: 'Gefüllt aus',
	mappingColHeaderSource: 'Wert',
	mappingSourceKindColumn: 'Spalte',
	mappingSourceKindConstant: 'Fester Text',
	mappingColumnEmptyOption: '— Spalte wählen —',
	mappingColumnNotFoundSuffix: ' (nicht gefunden)',
	mappingConstantPlaceholder: 'Fester Text',
	mappingColumnRequiredError: 'Spalte auswählen.',
	mappingColumnNotFoundError:
		'Diese Spalte wurde in der Tabelle nicht gefunden. Sie wurde möglicherweise umbenannt oder entfernt.',

	emptyStateText: 'Noch keine Spalten vorhanden.',
	emptyStateAction: 'Erste Spalte hinzufügen',

	errorTitle: 'Datei kann nicht angezeigt werden',
	errorBody: 'Diese .td-Datei enthält kein gültiges TOML und kann im visuellen Editor nicht dargestellt werden.',
	errorHint: 'Über „Reopen Editor With…“ (Rechtsklick auf den Tab) lässt sich die Datei als Text öffnen und der Fehler beheben.',
};

const CATALOG: Record<string, WebviewStrings> = { en, de };

/** Picks the text catalog matching VS Code's display language (`vscode.env.language`). */
export function getWebviewStrings(vscodeLanguage: string): WebviewStrings {
	const lang = vscodeLanguage.toLowerCase().split('-')[0];
	return CATALOG[lang] ?? en;
}
