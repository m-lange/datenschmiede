/**
 * Übersetzte Texte für die Projekt-Editor-Webview — Gegenstück zu
 * webviewStrings.ts für .tdproject-Dateien. Aus denselben Gründen (kein
 * `vscode.l10n` innerhalb einer Webview) ermittelt der Extension-Host die
 * passende Sprache und schickt dieses fertige Text-Objekt einmalig beim
 * Start (siehe project/editorProvider.ts).
 */
export interface ProjectWebviewStrings {
	tabOverview: string;
	tabTables: string;
	tabDiagram: string;

	/** Leerer Diagramm-Tab — noch keine Tabellen ausgewählt. */
	diagramEmptyText: string;
	/** Hinweis rechts in der Diagramm-Legende: Klick auf einen Kasten öffnet die `.td`-Datei. */
	diagramOpenHint: string;
	diagramLegendPk: string;
	diagramLegendFk: string;
	/** Tooltip des Datensatz-Zählers im Kasten-Kopf. */
	diagramRecordsTitle: string;

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
	/** Zusatz hinter der Datensatzanzahl einer referenzierten Tabelle; `{0}` = referenzierte Tabelle. */
	outputFilesPerRecordSuffix: string;
	outputFilesEmptyText: string;

	outputPathLabel: string;
	outputPathPlaceholder: string;
	outputPathHint: string;
	outputPathBrowseLabel: string;
	outputAddVariableButton: string;
	outputVariableGroupLabel: string;
	/** Anzeigenamen der `{…}`-Variablen — dieselben Beschriftungen wie im Table Editor (siehe table/webviewStrings.ts). */
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
	/** Platzhalter des Datensatz-Felds einer primären Tabelle — feste Zahl, ohne Bereich. */
	tablesRecordsPlaceholder: string;
	/** Platzhalter des Datensatz-Felds einer referenzierten (sekundären) Tabelle — Zahl oder Bereich. */
	tablesRecordsRangePlaceholder: string;
	tablesRecordsRequiredError: string;
	/** Fehlertext eines ungültigen Werts im Datensatz-Feld einer referenzierten Tabelle (weder Zahl noch Bereich). */
	tablesRecordsInvalidError: string;
	/** Tooltip des Icons vor dem Datensatz-Feld einer primären Tabelle (ohne ausgehenden Fremdschlüssel). */
	tablesPrimaryIconTooltip: string;
	/**
	 * Tooltip des Icons vor dem Datensatz-Feld einer referenzierten
	 * (sekundären) Tabelle; `{0}` = referenzierte Tabelle, von der Webview
	 * per einfachem Ersetzen ausgewertet.
	 */
	tablesReferencedIconTooltip: string;
	tablesMissingFileText: string;
	tablesInvalidTitle: string;
	tablesOpenFileLabel: string;
	tablesLockedTooltip: string;
	tablesExpandGroupTitle: string;
	tablesCollapseGroupTitle: string;
	/** Kontextmenü eines Namensraum-Knotens (siehe showGroupContextMenu in media/project.js). */
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
	tabDiagram: 'Diagram',

	diagramEmptyText: 'No tables selected yet — pick tables in the Tables tab.',
	diagramOpenHint: 'Click a table to open its definition',
	diagramLegendPk: 'Primary key',
	diagramLegendFk: 'Foreign key',
	diagramRecordsTitle: 'Records to generate',

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
	tabDiagram: 'Diagramm',

	diagramEmptyText: 'Noch keine Tabellen ausgewählt — Auswahl im Tabellen-Tab.',
	diagramOpenHint: 'Klick auf eine Tabelle öffnet ihre Definition',
	diagramLegendPk: 'Primärschlüssel',
	diagramLegendFk: 'Fremdschlüssel',
	diagramRecordsTitle: 'Zu erzeugende Datensätze',

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

/** Wählt den Text-Katalog passend zur VS-Code-Anzeigesprache (`vscode.env.language`). */
export function getProjectWebviewStrings(vscodeLanguage: string): ProjectWebviewStrings {
	const lang = vscodeLanguage.toLowerCase().split('-')[0];
	return CATALOG[lang] ?? en;
}
