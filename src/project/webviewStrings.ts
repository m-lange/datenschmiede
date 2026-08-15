/**
 * Translated texts for the project editor webview — the counterpart to
 * table/webviewStrings.ts for .tdproject files. For the same reason (no
 * `vscode.l10n` inside a webview) the extension host determines the matching
 * language and sends this ready-made text object once at startup (see
 * project/editorProvider.ts).
 */
export interface ProjectWebviewStrings {
	tabOverview: string;
	tabTables: string;
	tabDiagram: string;

	/** Empty diagram tab — no tables selected yet. */
	diagramEmptyText: string;
	/** Hint on the right of the diagram legend: clicking a box opens the `.td` file. */
	diagramOpenHint: string;
	diagramLegendPk: string;
	diagramLegendFk: string;
	/** Tooltip of the record counter in the box header (without a previous run: the estimated/configured count). */
	diagramRecordsTitle: string;
	/** Tooltip line of the counter showing the real count; `{0}` = count, `{1}` = time of the run. */
	diagramRecordsLastRun: string;
	/** Tooltip line showing the configured value below the real count; `{0}` = configured value. */
	diagramRecordsConfigured: string;

	fieldNameLabel: string;
	fieldNamePlaceholder: string;
	fieldDescriptionLabel: string;
	fieldDescriptionPlaceholder: string;

	pythonSectionLabel: string;
	pythonNotLinkedText: string;
	pythonUnresolvedText: string;
	pythonBelowMinVersionText: string;
	pythonChangeButton: string;
	pythonLinkButton: string;

	runButtonLabel: string;
	outputFilesTitle: string;
	outputFilesHint: string;
	outputFilesColTable: string;
	outputFilesColFile: string;
	outputFilesColFileName: string;
	outputFilesColRecords: string;
	/** Suffix after a referenced table's record count; `{0}` = referenced table. */
	outputFilesPerRecordSuffix: string;
	outputFilesEmptyText: string;

	/** requirements.txt with the extra Python packages this project's generators need. */
	requirementsLabel: string;
	requirementsHint: string;
	requirementsPlaceholder: string;
	requirementsBrowseLabel: string;
	requirementsClearLabel: string;

	outputPathLabel: string;
	outputPathPlaceholder: string;
	outputPathHint: string;
	outputPathBrowseLabel: string;
	outputAddVariableButton: string;
	outputVariableGroupLabel: string;
	/** Display names of the `{…}` variables — the same labels as in the table editor (see table/webviewStrings.ts). */
	outputVarDate: string;
	outputVarTime: string;
	outputVarDatetime: string;
	outputVarTimestamp: string;
	outputVarSchema: string;
	outputVarTable: string;
	outputVarRecords: string;
	outputVarProject: string;

	tablesSearchPlaceholder: string;
	tablesColHeaderTable: string;
	tablesColHeaderPath: string;
	tablesColHeaderRecords: string;
	/** Placeholder of a primary table's records field — a fixed number, no range. */
	tablesRecordsPlaceholder: string;
	/** Placeholder of a referenced (secondary) table's records field — a number or a range. */
	tablesRecordsRangePlaceholder: string;
	tablesRecordsRequiredError: string;
	/** Error text for an invalid value in a referenced table's records field (neither a number nor a range). */
	tablesRecordsInvalidError: string;
	/** Tooltip of the icon in front of a primary table's records field (no outgoing foreign key). */
	tablesPrimaryIconTooltip: string;
	/**
	 * Tooltip of the icon in front of a referenced (secondary) table's records
	 * field; `{0}` = referenced table, substituted by the webview with a simple
	 * replace.
	 */
	tablesReferencedIconTooltip: string;
	tablesMissingFileText: string;
	tablesInvalidTitle: string;
	tablesOpenFileLabel: string;
	tablesLockedTooltip: string;
	tablesExpandGroupTitle: string;
	tablesCollapseGroupTitle: string;
	/** Context menu of a namespace node (see showGroupContextMenu in media/project.js). */
	tablesMenuSelectAll: string;
	tablesMenuDeselectAll: string;
	tablesMenuExpandAll: string;
	tablesMenuCollapseAll: string;

	tablesEmptyStateText: string;
	tablesEmptyStateHint: string;
	tablesNoMatchesText: string;

	errorTitle: string;
	errorBody: string;
	errorHint: string;
}

const en: ProjectWebviewStrings = {
	tabOverview: 'Overview',
	tabTables: 'Tables',
	tabDiagram: 'ER Diagram',

	diagramEmptyText: 'No tables selected yet — pick tables in the Tables tab.',
	diagramOpenHint: 'Click a table to open its definition',
	diagramLegendPk: 'Primary key',
	diagramLegendFk: 'Foreign key',
	diagramRecordsTitle: 'Records to generate',
	diagramRecordsLastRun: 'Last run: {0} records ({1})',
	diagramRecordsConfigured: 'Configured: {0}',

	fieldNameLabel: 'Name',
	fieldNamePlaceholder: 'e.g. Sales Reporting Demo',
	fieldDescriptionLabel: 'Description',
	fieldDescriptionPlaceholder: 'What is this test data project for? Supports Markdown.',

	pythonSectionLabel: 'Python Interpreter',
	pythonNotLinkedText: 'No Python interpreter linked yet.',
	pythonUnresolvedText: 'This interpreter could not be found. It may have been removed.',
	pythonBelowMinVersionText: 'This interpreter is older than Python 3.10.',
	pythonChangeButton: 'Change…',
	pythonLinkButton: 'Select Interpreter…',

	runButtonLabel: 'Generate Test Data',
	outputFilesTitle: 'Generated files',
	outputFilesHint:
		'One file per selected table. File name and format are configured in the table editor, the number of records in the Tables tab.',
	outputFilesColTable: 'Table',
	outputFilesColFile: 'Definition',
	outputFilesColFileName: 'File name',
	outputFilesColRecords: 'Records',
	outputFilesPerRecordSuffix: 'per record of {0}',
	outputFilesEmptyText: 'No tables selected yet — pick tables in the Tables tab.',

	requirementsLabel: 'Additional Python packages',
	requirementsHint:
		'Path to a requirements.txt with the packages your custom generators import beyond pandas/numpy. Before a run the linked interpreter is checked against it and anything missing is offered for installation — nothing is installed silently.',
	requirementsPlaceholder: 'e.g. requirements.txt',
	requirementsBrowseLabel: 'Select requirements file',
	requirementsClearLabel: 'Remove requirements file',
	outputPathLabel: 'Output folder',
	outputPathPlaceholder: 'output',
	outputPathHint:
		'Relative to the project file (absolute paths allowed). Combine fixed text with dynamic values — click a tag to remove it. Empty uses "output".',
	outputPathBrowseLabel: 'Choose folder…',
	outputAddVariableButton: 'Add dynamic value',
	outputVariableGroupLabel: 'Variables',
	outputVarDate: 'Current date',
	outputVarTime: 'Current time',
	outputVarDatetime: 'Current date + time',
	outputVarTimestamp: 'Unix timestamp',
	outputVarSchema: 'Schema',
	outputVarTable: 'Table name',
	outputVarRecords: 'Number of records',
	outputVarProject: 'Project name',

	tablesSearchPlaceholder: 'Search tables…',
	tablesColHeaderTable: 'Table',
	tablesColHeaderPath: 'File',
	tablesColHeaderRecords: 'Records',
	tablesRecordsPlaceholder: 'e.g. 100',
	tablesRecordsRangePlaceholder: 'e.g. 5 or 1..3',
	tablesRecordsRequiredError: 'Enter the number of records to generate.',
	tablesRecordsInvalidError: 'Enter a number (e.g. 5) or a range (e.g. 1..3).',
	tablesPrimaryIconTooltip: 'Primary table — enter the total number of records to generate.',
	tablesReferencedIconTooltip:
		'Referenced table — enter how many records to generate per record of {0}: a number (e.g. 5) or a range (e.g. 1..3).',
	tablesMissingFileText: 'File not found — it may have been deleted, renamed, or moved.',
	tablesInvalidTitle: 'This file contains invalid TOML and cannot be selected.',
	tablesOpenFileLabel: 'Open file',
	tablesLockedTooltip: 'Required by another selected table’s foreign key — this table stays included automatically.',
	tablesExpandGroupTitle: 'Expand',
	tablesCollapseGroupTitle: 'Collapse',
	tablesMenuSelectAll: 'Select All',
	tablesMenuDeselectAll: 'Deselect All',
	tablesMenuExpandAll: 'Expand All',
	tablesMenuCollapseAll: 'Collapse All',

	tablesEmptyStateText: 'No .td tables found in this workspace.',
	tablesEmptyStateHint: 'Use "Datenschmiede: New Table…" to create one.',
	tablesNoMatchesText: 'No tables match your search.',

	errorTitle: 'Unable to display file',
	errorBody: 'This .tdproject file contains invalid TOML and cannot be shown in the visual editor.',
	errorHint: 'Use "Reopen Editor With…" (right-click the tab) to open it as text and fix the error.',
};

const de: ProjectWebviewStrings = {
	tabOverview: 'Übersicht',
	tabTables: 'Tabellen',
	tabDiagram: 'ER-Diagramm',

	diagramEmptyText: 'Noch keine Tabellen ausgewählt — Auswahl im Tabellen-Tab.',
	diagramOpenHint: 'Klick auf eine Tabelle öffnet ihre Definition',
	diagramLegendPk: 'Primärschlüssel',
	diagramLegendFk: 'Fremdschlüssel',
	diagramRecordsTitle: 'Zu erzeugende Datensätze',
	diagramRecordsLastRun: 'Letzter Lauf: {0} Datensätze ({1})',
	diagramRecordsConfigured: 'Konfiguriert: {0}',

	fieldNameLabel: 'Name',
	fieldNamePlaceholder: 'z. B. Demo Vertriebsauswertung',
	fieldDescriptionLabel: 'Beschreibung',
	fieldDescriptionPlaceholder: 'Wofür wird dieses Testdatenprojekt verwendet? Markdown wird unterstützt.',

	pythonSectionLabel: 'Python-Interpreter',
	pythonNotLinkedText: 'Noch kein Python-Interpreter verknüpft.',
	pythonUnresolvedText: 'Dieser Interpreter wurde nicht gefunden. Er wurde möglicherweise entfernt.',
	pythonBelowMinVersionText: 'Dieser Interpreter ist älter als Python 3.10.',
	pythonChangeButton: 'Ändern…',
	pythonLinkButton: 'Interpreter auswählen…',

	runButtonLabel: 'Testdaten generieren',
	outputFilesTitle: 'Generierte Dateien',
	outputFilesHint:
		'Eine Datei je ausgewählter Tabelle. Dateiname und Format werden im Table Editor konfiguriert, die Datensatzanzahl im Tabellen-Tab.',
	outputFilesColTable: 'Tabelle',
	outputFilesColFile: 'Definition',
	outputFilesColFileName: 'Dateiname',
	outputFilesColRecords: 'Datensätze',
	outputFilesPerRecordSuffix: 'je Datensatz von {0}',
	outputFilesEmptyText: 'Noch keine Tabellen ausgewählt — Auswahl im Tabellen-Tab.',

	requirementsLabel: 'Zusätzliche Python-Pakete',
	requirementsHint:
		'Pfad zu einer requirements.txt mit den Paketen, die eigene Generatoren über pandas/numpy hinaus importieren. Vor einem Lauf wird der verknüpfte Interpreter dagegen geprüft; Fehlendes wird zur Installation angeboten — installiert wird nichts von allein.',
	requirementsPlaceholder: 'z. B. requirements.txt',
	requirementsBrowseLabel: 'Requirements-Datei auswählen',
	requirementsClearLabel: 'Requirements-Datei entfernen',
	outputPathLabel: 'Ausgabeordner',
	outputPathPlaceholder: 'output',
	outputPathHint:
		'Relativ zur Projektdatei (absolute Pfade erlaubt). Fester Text kombiniert mit dynamischen Werten — Klick auf ein Tag entfernt es. Leer verwendet „output“.',
	outputPathBrowseLabel: 'Ordner auswählen…',
	outputAddVariableButton: 'Dynamischen Wert einfügen',
	outputVariableGroupLabel: 'Variablen',
	outputVarDate: 'Aktuelles Datum',
	outputVarTime: 'Aktuelle Uhrzeit',
	outputVarDatetime: 'Aktuelles Datum + Uhrzeit',
	outputVarTimestamp: 'Unix-Zeitstempel',
	outputVarSchema: 'Schema',
	outputVarTable: 'Tabellenname',
	outputVarRecords: 'Datensatzanzahl',
	outputVarProject: 'Projektname',

	tablesSearchPlaceholder: 'Tabellen durchsuchen…',
	tablesColHeaderTable: 'Tabelle',
	tablesColHeaderPath: 'Datei',
	tablesColHeaderRecords: 'Datensätze',
	tablesRecordsPlaceholder: 'z. B. 100',
	tablesRecordsRangePlaceholder: 'z. B. 5 oder 1..3',
	tablesRecordsRequiredError: 'Anzahl zu erzeugender Datensätze eingeben.',
	tablesRecordsInvalidError: 'Zahl (z. B. 5) oder Bereich (z. B. 1..3) eingeben.',
	tablesPrimaryIconTooltip: 'Primäre Tabelle — Gesamtanzahl der zu erzeugenden Datensätze eingeben.',
	tablesReferencedIconTooltip:
		'Referenzierte Tabelle — Anzahl der zu erzeugenden Datensätze je Datensatz von {0} eingeben: Zahl (z. B. 5) oder Bereich (z. B. 1..3).',
	tablesMissingFileText: 'Datei nicht gefunden — sie wurde möglicherweise gelöscht, umbenannt oder verschoben.',
	tablesInvalidTitle: 'Diese Datei enthält kein gültiges TOML und kann nicht ausgewählt werden.',
	tablesOpenFileLabel: 'Datei öffnen',
	tablesLockedTooltip: 'Wird von einer anderen ausgewählten Tabelle über einen Fremdschlüssel benötigt — bleibt automatisch Teil des Projekts.',
	tablesExpandGroupTitle: 'Aufklappen',
	tablesCollapseGroupTitle: 'Einklappen',
	tablesMenuSelectAll: 'Alle auswählen',
	tablesMenuDeselectAll: 'Alle abwählen',
	tablesMenuExpandAll: 'Alle aufklappen',
	tablesMenuCollapseAll: 'Alle zuklappen',

	tablesEmptyStateText: 'Keine .td-Tabellen in diesem Workspace gefunden.',
	tablesEmptyStateHint: 'Über „Datenschmiede: Neue Tabelle erstellen…“ lässt sich eine anlegen.',
	tablesNoMatchesText: 'Keine Tabellen gefunden.',

	errorTitle: 'Datei kann nicht angezeigt werden',
	errorBody: 'Diese .tdproject-Datei enthält kein gültiges TOML und kann im visuellen Editor nicht dargestellt werden.',
	errorHint: 'Über „Reopen Editor With…“ (Rechtsklick auf den Tab) lässt sich die Datei als Text öffnen und der Fehler beheben.',
};

const CATALOG: Record<string, ProjectWebviewStrings> = { en, de };

/** Picks the text catalog matching VS Code's display language (`vscode.env.language`). */
export function getProjectWebviewStrings(vscodeLanguage: string): ProjectWebviewStrings {
	const lang = vscodeLanguage.toLowerCase().split('-')[0];
	return CATALOG[lang] ?? en;
}
