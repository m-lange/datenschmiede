/**
 * Übersetzte Texte für die Generator-Editor-Webview (.tdgen) — Gegenstück zu
 * table/webviewStrings.ts. Aus denselben Gründen (kein `vscode.l10n`
 * innerhalb einer Webview) ermittelt der Extension-Host die passende Sprache
 * und schickt dieses fertige Text-Objekt einmalig beim Start.
 */
export interface GeneratorWebviewStrings {
	fieldNameLabel: string;
	fieldNamePlaceholder: string;
	fieldDescriptionLabel: string;
	fieldDescriptionPlaceholder: string;

	parametersTitle: string;
	parametersHint: string;
	addParameterButton: string;
	paramColHeaderName: string;
	paramColHeaderType: string;
	paramColHeaderDescription: string;
	paramColHeaderChoices: string;
	paramColHeaderRequired: string;
	paramNamePlaceholder: string;
	paramDescriptionPlaceholder: string;
	paramChoicesPlaceholder: string;
	paramRequiredLabel: string;
	removeParameterLabel: string;
	moveParameterUpLabel: string;
	moveParameterDownLabel: string;
	paramNameRequiredError: string;
	paramNameDuplicateError: string;

	signatureFixedTooltip: string;
	generateCellTitle: string;
	generateCellHint: string;
	parseParamsCellTitle: string;
	parseParamsCellHint: string;
	displayValueCellTitle: string;
	displayValueCellHint: string;
	codePlaceholder: string;

	errorTitle: string;
	errorBody: string;
	errorHint: string;
}

const en: GeneratorWebviewStrings = {
	fieldNameLabel: 'Name',
	fieldNamePlaceholder: 'e.g. Season',
	fieldDescriptionLabel: 'Description',
	fieldDescriptionPlaceholder: 'What does this generator produce? Supports Markdown.',

	parametersTitle: 'Parameters',
	parametersHint:
		'Parameters this generator needs. Their values are set per column in the table editor; every value arrives in Python as a string (see parse_params).',
	addParameterButton: 'Add Parameter',
	paramColHeaderName: 'Name',
	paramColHeaderType: 'Data Type',
	paramColHeaderDescription: 'Description',
	paramColHeaderChoices: 'Predefined values',
	paramColHeaderRequired: 'Required',
	paramNamePlaceholder: 'Parameter name',
	paramDescriptionPlaceholder: 'Description (optional)',
	paramChoicesPlaceholder: 'Comma-separated — empty allows free input',
	paramRequiredLabel: 'Required',
	removeParameterLabel: 'Remove parameter',
	moveParameterUpLabel: 'Move parameter up',
	moveParameterDownLabel: 'Move parameter down',
	paramNameRequiredError: 'Enter a parameter name.',
	paramNameDuplicateError: 'Another parameter already uses this name.',

	signatureFixedTooltip: 'This signature is fixed and cannot be changed — edit the body below.',
	generateCellTitle: 'generate — required',
	generateCellHint:
		'Produces the column values: return a pandas Series of length n. Available: ctx.rng (numpy Generator), ctx.pd / ctx.np, ctx.faker(locale), ctx.column("name") for the generated values of another column of this table, ctx.lookup("list", "column") for lookup list values.',
	parseParamsCellTitle: 'parse_params — optional',
	parseParamsCellHint:
		'Converts the raw string parameter values into typed values before generate runs. Return the (converted) dict.',
	displayValueCellTitle: 'display_value — optional',
	displayValueCellHint:
		'Compact one-line summary of a configuration, used in the run log and preview. The table editor shows a generic summary of the parameter values.',
	codePlaceholder: '# Python code…',

	errorTitle: 'Unable to display file',
	errorBody: 'This .tdgen file contains invalid TOML and cannot be shown in the visual editor.',
	errorHint: 'Use "Reopen Editor With…" (right-click the tab) to open it as text and fix the error.',
};

const de: GeneratorWebviewStrings = {
	fieldNameLabel: 'Name',
	fieldNamePlaceholder: 'z. B. Season',
	fieldDescriptionLabel: 'Beschreibung',
	fieldDescriptionPlaceholder: 'Was erzeugt dieser Generator? Markdown wird unterstützt.',

	parametersTitle: 'Parameter',
	parametersHint:
		'Parameter, die dieser Generator benötigt. Ihre Werte werden je Spalte im Table Editor gesetzt; in Python kommt jeder Wert als String an (siehe parse_params).',
	addParameterButton: 'Parameter hinzufügen',
	paramColHeaderName: 'Name',
	paramColHeaderType: 'Datentyp',
	paramColHeaderDescription: 'Beschreibung',
	paramColHeaderChoices: 'Vordefinierte Werte',
	paramColHeaderRequired: 'Pflicht',
	paramNamePlaceholder: 'Parametername',
	paramDescriptionPlaceholder: 'Beschreibung (optional)',
	paramChoicesPlaceholder: 'Kommagetrennt — leer erlaubt freie Eingabe',
	paramRequiredLabel: 'Pflichtparameter',
	removeParameterLabel: 'Parameter entfernen',
	moveParameterUpLabel: 'Parameter nach oben verschieben',
	moveParameterDownLabel: 'Parameter nach unten verschieben',
	paramNameRequiredError: 'Parameternamen eingeben.',
	paramNameDuplicateError: 'Ein anderer Parameter verwendet diesen Namen bereits.',

	signatureFixedTooltip: 'Diese Signatur ist fest vorgegeben und kann nicht geändert werden — der Rumpf darunter ist editierbar.',
	generateCellTitle: 'generate — Pflicht',
	generateCellHint:
		'Erzeugt die Spaltenwerte: eine pandas Series der Länge n zurückgeben. Verfügbar: ctx.rng (numpy Generator), ctx.pd / ctx.np, ctx.faker(locale), ctx.column("name") für die generierten Werte einer anderen Spalte dieser Tabelle, ctx.lookup("liste", "spalte") für Werte einer Nachschlageliste.',
	parseParamsCellTitle: 'parse_params — optional',
	parseParamsCellHint:
		'Wandelt die rohen String-Parameterwerte in typisierte Werte um, bevor generate läuft. Das (umgewandelte) dict zurückgeben.',
	displayValueCellTitle: 'display_value — optional',
	displayValueCellHint:
		'Kompakte einzeilige Zusammenfassung einer Konfiguration, genutzt in Lauf-Protokoll und Vorschau. Der Table Editor zeigt eine generische Zusammenfassung der Parameterwerte.',
	codePlaceholder: '# Python-Code…',

	errorTitle: 'Datei kann nicht angezeigt werden',
	errorBody: 'Diese .tdgen-Datei enthält kein gültiges TOML und kann im visuellen Editor nicht dargestellt werden.',
	errorHint: 'Über „Reopen Editor With…“ (Rechtsklick auf den Tab) lässt sich die Datei als Text öffnen und der Fehler beheben.',
};

const CATALOG: Record<string, GeneratorWebviewStrings> = { en, de };

/** Wählt den Text-Katalog passend zur VS-Code-Anzeigesprache (`vscode.env.language`). */
export function getGeneratorWebviewStrings(vscodeLanguage: string): GeneratorWebviewStrings {
	const lang = vscodeLanguage.toLowerCase().split('-')[0];
	return CATALOG[lang] ?? en;
}
