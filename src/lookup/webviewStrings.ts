/**
 * Translated texts for the lookup webview — the same mechanism as
 * table/webviewStrings.ts: `vscode.l10n` is not available inside a webview, so
 * the extension host sends this ready-made text object once at startup (see
 * lookup/editorProvider.ts).
 */
export interface LookupWebviewStrings {
	tabOverview: string;
	tabValues: string;

	fieldNameLabel: string;
	fieldNamePlaceholder: string;
	fieldDescriptionLabel: string;
	fieldDescriptionPlaceholder: string;

	chartTitle: string;
	chartEmpty: string;
	/** {0} = row number — fallback label for a row without a value in the first column. */
	chartRowFallback: string;

	addRowButton: string;
	addColumnButton: string;
	/** Secondary action next to the toolbar buttons: reset manual column widths. */
	autoSizeColumnsLabel: string;
	/** Toolbar button: distribute 100 % evenly across all rows. */
	distributeEvenlyButton: string;
	distributeEvenlyTooltip: string;
	/** Toolbar button: scale the existing weights proportionally to a sum of 100 %. */
	normalizeWeightsButton: string;
	normalizeWeightsTooltip: string;

	colHeaderWeight: string;
	columnNamePlaceholder: string;
	newColumnPlaceholder: string;
	valuePlaceholder: string;
	removeRowLabel: string;
	removeColumnLabel: string;

	totalLabel: string;
	weightRequiredError: string;
	weightInvalidError: string;

	emptyStateText: string;
	emptyStateAction: string;

	errorTitle: string;
	errorBody: string;
	errorHint: string;
}

const en: LookupWebviewStrings = {
	tabOverview: 'Overview',
	tabValues: 'Values',

	fieldNameLabel: 'Name',
	fieldNamePlaceholder: 'e.g. currencies',
	fieldDescriptionLabel: 'Description',
	fieldDescriptionPlaceholder: 'What is this lookup list used for? Supports Markdown.',

	chartTitle: 'Weight distribution',
	chartEmpty: 'No values yet — add rows in the Values tab to see their distribution here.',
	chartRowFallback: 'Row {0}',

	addRowButton: 'Add Row',
	addColumnButton: 'Add Column',
	autoSizeColumnsLabel: 'Fit column widths to the content',
	distributeEvenlyButton: 'Distribute Evenly',
	distributeEvenlyTooltip: 'Set all weights to the same value so the total is 100%.',
	normalizeWeightsButton: 'Scale to 100%',
	normalizeWeightsTooltip: 'Rescale the current weights proportionally so the total is 100%.',

	colHeaderWeight: 'Weight (%)',
	columnNamePlaceholder: 'Column name',
	newColumnPlaceholder: '+ New column',
	valuePlaceholder: 'Value',
	removeRowLabel: 'Remove row',
	removeColumnLabel: 'Remove column',

	totalLabel: 'Total',
	weightRequiredError: 'Enter a weight in percent.',
	weightInvalidError: 'Invalid weight (use e.g. "25" or "12.5").',

	emptyStateText: 'No values yet.',
	emptyStateAction: 'Add first row',

	errorTitle: 'Unable to display file',
	errorBody: 'This .lkp file contains invalid CSV and cannot be shown in the visual editor.',
	errorHint: 'Use "Reopen Editor With…" (right-click the tab) to open it as text and fix the error.',
};

const de: LookupWebviewStrings = {
	tabOverview: 'Übersicht',
	tabValues: 'Werte',

	fieldNameLabel: 'Name',
	fieldNamePlaceholder: 'z. B. currencies',
	fieldDescriptionLabel: 'Beschreibung',
	fieldDescriptionPlaceholder: 'Wofür wird diese Nachschlageliste verwendet? Markdown wird unterstützt.',

	chartTitle: 'Gewichtsverteilung',
	chartEmpty: 'Noch keine Werte — im Tab „Werte“ Zeilen hinzufügen, um hier ihre Verteilung zu sehen.',
	chartRowFallback: 'Zeile {0}',

	addRowButton: 'Zeile hinzufügen',
	addColumnButton: 'Spalte hinzufügen',
	autoSizeColumnsLabel: 'Spaltenbreiten an den Inhalt anpassen',
	distributeEvenlyButton: 'Gleichmäßig verteilen',
	distributeEvenlyTooltip: 'Alle Gewichte auf denselben Wert setzen, sodass die Summe 100 % ergibt.',
	normalizeWeightsButton: 'Auf 100 % skalieren',
	normalizeWeightsTooltip: 'Vorhandene Gewichte proportional umrechnen, sodass die Summe 100 % ergibt.',

	colHeaderWeight: 'Gewicht (%)',
	columnNamePlaceholder: 'Spaltenname',
	newColumnPlaceholder: '+ Neue Spalte',
	valuePlaceholder: 'Wert',
	removeRowLabel: 'Zeile entfernen',
	removeColumnLabel: 'Spalte entfernen',

	totalLabel: 'Summe',
	weightRequiredError: 'Gewicht in Prozent eingeben.',
	weightInvalidError: 'Ungültiges Gewicht (z. B. „25“ oder „12,5“ verwenden).',

	emptyStateText: 'Noch keine Werte vorhanden.',
	emptyStateAction: 'Erste Zeile hinzufügen',

	errorTitle: 'Datei kann nicht angezeigt werden',
	errorBody: 'Diese .lkp-Datei enthält kein gültiges CSV und kann im visuellen Editor nicht dargestellt werden.',
	errorHint: 'Über „Reopen Editor With…“ (Rechtsklick auf den Tab) lässt sich die Datei als Text öffnen und der Fehler beheben.',
};

const CATALOG: Record<string, LookupWebviewStrings> = { en, de };

/** Picks the text catalog matching VS Code's display language (`vscode.env.language`). */
export function getLookupWebviewStrings(vscodeLanguage: string): LookupWebviewStrings {
	const lang = vscodeLanguage.toLowerCase().split('-')[0];
	return CATALOG[lang] ?? en;
}
