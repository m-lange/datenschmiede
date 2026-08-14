// @ts-check
// Webview-Skript für den Table Editor. Bewusst als eigenständiges,
// unkompiliertes Skript gehalten (kein Bundling nötig, keine Abhängigkeiten).
//
// UI-Anleihen an Oracle SQL Developer for VS Code: Tabs (hier: "Übersicht" /
// "Spalten"), ein schlankes Bordered-Toolbar über dem Grid, ein Grid mit
// Zeilennummern-Spalte, PK-/FK-Checkbox-Spalten, Spalten für referenzierte
// Tabelle/Spalte sowie der Generator-Spalte (Auswahl + Parameter-Dialog).
// Der Übersicht-Tab enthält zusätzlich die Ausgabe-Einstellungen: Dateiname
// als Tag-Feld (dynamische Variablen als klickbare Tags, ähnlich Power
// Automate) und die CSV-Konfiguration.
(function () {
	'use strict';

	/** @type {{ postMessage: (msg: any) => void }} */
	// eslint-disable-next-line no-undef
	const vscode = acquireVsCodeApi();

	// Gemeinsame, zustandslose Bausteine aus common.js (vor diesem Skript
	// eingebunden, siehe getHtml in table/editorProvider.ts).
	// eslint-disable-next-line no-undef
	const {
		el,
		bindText,
		debounce,
		renderMarkdownField,
		renderTextField: renderTextFieldCommon,
		renderLabeledMarkdownField,
		renderErrorState,
		variableLabel: variableLabelCommon,
		createDeferredRenderer,
		updateFieldError,
		wrapSelectWithChevron,
		populateSelectOptions,
		buildColGroup,
		attachColumnResizeHandle,
		fixColumnWidths,
		showFloatingMenu,
		renderTagField,
	} = window.DatenschmiedeCommon;

	const COLUMN_TYPES = [
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
	];

	/** Eingebaute Dateinamen-Variablen — Gegenstück zu FILE_NAME_VARIABLES in src/table/model.ts. */
	const FILE_NAME_VARIABLES = ['date', 'time', 'datetime', 'timestamp', 'schema', 'table', 'records'];

	/**
	 * `uiHidden` ist ein rein visueller Merkzustand des Auge-Umschalters in der
	 * Aktionsspalte (Zeile gedimmt) — bewusst ohne jede weitere Funktion, wird
	 * nicht in die .td-Datei geschrieben (serializeTable im Extension-Host kennt
	 * das Feld nicht) und geht bei externen Änderungen am Dokument verloren.
	 * @typedef {{id:string,params:Record<string,string>}} GeneratorConfig
	 * @typedef {{name:string,type:string,pk:boolean,fk:boolean,fkTable:string,fkColumn:string,description:string,generator?:GeneratorConfig,uiHidden?:boolean}} Column
	 */
	/** @typedef {{delimiter:string,quoteAll:boolean,decimal:string,dateFormat:string,datetimeFormat:string,includeHeader:boolean,encoding:string}} CsvOptions */
	/** @typedef {{fileName:string,format:string,csv:CsvOptions}} OutputConfig */
	/** @typedef {{schema:string,name:string,description:string,columns:Column[],output:OutputConfig}} Table */
	/** @typedef {{label:string,columns:string[]}} TableOption */
	/** @typedef {{name:string,type:string,description:string,choices?:string[],required?:boolean,placeholder?:string}} GeneratorParameter */
	/** @typedef {{id:string,label:string,description:string,parameters:GeneratorParameter[],displayTemplate?:string,custom:boolean,fkOnly:boolean}} GeneratorOption */
	/** @typedef {{name:string,columns:string[]}} LookupOption */
	/** @typedef {import('../src/table/webviewStrings').WebviewStrings} WebviewStrings */

	/** @type {WebviewStrings | null} strings kommen einmalig per 'init'-Message vom Extension-Host */
	let strings = null;
	/** @type {Table} */
	let state = { schema: '', name: '', description: '', columns: [], output: defaultOutput() };
	/** @type {string | null} */
	let parseError = null;
	/** @type {'overview' | 'columns'} */
	let activeTab = 'columns';
	/** @type {TableOption[]} Tabellen im Workspace (Label + Spaltennamen), für FK- und Generator-Referenzen */
	let tableOptions = [];
	/** @type {GeneratorOption[]} Verfügbare Generatoren (eingebaute + benutzerdefinierte), kommen vom Extension-Host */
	let generatorOptions = [];
	/** @type {LookupOption[]} Nachschlagelisten (.lkp) im Workspace, für Lookup-Parameter */
	let lookupOptions = [];
	/**
	 * Von Hand gezogene Spaltenbreiten im Grid (px), je Spalten-Schlüssel.
	 * Kommt initial vom Extension-Host (per globalState geräteweit über alle
	 * .td-Dateien hinweg gemerkt, siehe table/editorProvider.ts) und wird bei jeder
	 * Größenänderung dorthin zurückgeschickt. Fehlt ein Eintrag, wird die
	 * Spalte weiterhin automatisch an ihren Inhalt angepasst.
	 * @type {Record<string, number>}
	 */
	let columnWidths = {};
	/** @type {(() => void) | null} von renderColumnsTab gesetzt: berechnet die finalen Spaltenbreiten, sobald die Tabelle im DOM hängt (siehe render()). */
	let pendingColumnSizing = null;

	/** Größenziehbare Grid-Spalten mit ihrer Mindestbreite (px). */
	const RESIZABLE_COLUMNS = [
		{ key: 'name', minWidth: 140 },
		{ key: 'type', minWidth: 120 },
		{ key: 'desc', minWidth: 180 },
		{ key: 'refTable', minWidth: 170 },
		{ key: 'refColumn', minWidth: 150 },
		{ key: 'gen', minWidth: 385 },
	];

	const app = document.getElementById('app');

	/** @returns {OutputConfig} Standard-Ausgabe, bis der Extension-Host den echten Stand schickt (Gegenstück zu createDefaultOutput in src/table/model.ts). */
	function defaultOutput() {
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

	function postEdit() {
		vscode.postMessage({ type: 'edit', table: state });
	}

	const postEditDebounced = debounce(postEdit, 250);

	/**
	 * Eigene logische Identität der gerade bearbeiteten Tabelle (`schema.name`,
	 * bzw. nur `name` ohne Schema) — leer, solange sie noch keinen Namen hat.
	 * Kleines Gegenstück zu `logicalTableName` in src/table/model.ts, um im FK-„Referenzierte
	 * Tabelle“-Select eine Selbst-Referenz zu erkennen (siehe populateTableOptions,
	 * refreshTableError in renderColumnRow).
	 */
	function ownTableLabel() {
		const name = (state.name || '').trim();
		if (!name) {
			return '';
		}
		const schema = (state.schema || '').trim();
		return schema ? `${schema}.${name}` : name;
	}

	// ---------------------------------------------------------------------
	// Anti-Flacker: Options-Broadcasts vom Extension-Host (nach jeder
	// Datei-Änderung im Workspace) lösen kein sofortiges Neuzeichnen mehr
	// aus. Unveränderte Listen werden komplett ignoriert; bei echten
	// Änderungen wird das Neuzeichnen aufgeschoben, solange gerade ein
	// Eingabefeld fokussiert ist (oder der Parameter-Dialog offen ist) —
	// sonst verlöre das Feld bei jedem Broadcast Fokus und Cursor (das
	// frühere „Flackern“). Mechanik siehe createDeferredRenderer in common.js.
	// ---------------------------------------------------------------------

	/** Zuletzt verarbeitete Auswahllisten (JSON), um unveränderte Broadcasts zu ignorieren. */
	let lastOptionsJson = '';

	const deferredRender = createDeferredRenderer(
		() => render(),
		() => !!closeParamDialog,
	);

	function render() {
		app.innerHTML = '';
		deferredRender.clearPending();
		pendingColumnSizing = null;
		if (!strings) {
			return;
		}
		if (parseError) {
			app.appendChild(renderErrorState(strings, parseError));
			return;
		}
		app.appendChild(renderTabs());
		app.appendChild(activeTab === 'overview' ? renderOverviewTab() : renderColumnsTab());

		// Erst jetzt (Tabelle hängt im echten DOM) lässt sich die tatsächlich
		// benötigte Breite je Spalte messen — siehe renderColumnsTab.
		if (pendingColumnSizing) {
			pendingColumnSizing();
		}
	}

	// ---------------------------------------------------------------------
	// Kopfbereich: Tabs (SQL-Developer-artige Objekt-Navigation)
	// ---------------------------------------------------------------------

	function renderTabs() {
		const bar = el('div', { className: 'tabbar' });
		bar.setAttribute('role', 'tablist');
		bar.appendChild(renderTabButton('overview', strings.tabOverview));
		bar.appendChild(renderTabButton('columns', `${strings.tabColumns} (${state.columns.length})`));
		return bar;
	}

	/** @param {'overview'|'columns'} tab */
	function renderTabButton(tab, label) {
		const btn = el('button', { className: 'tab' + (activeTab === tab ? ' active' : ''), text: label });
		btn.type = 'button';
		btn.setAttribute('role', 'tab');
		btn.setAttribute('aria-selected', String(activeTab === tab));
		btn.addEventListener('click', () => {
			if (activeTab !== tab) {
				activeTab = tab;
				render();
			}
		});
		return btn;
	}

	// ---------------------------------------------------------------------
	// Tab "Übersicht": Name / Schema / Beschreibung + Ausgabe (Dateiname, CSV)
	// ---------------------------------------------------------------------

	function renderOverviewTab() {
		const stack = el('div', { className: 'tab-panel overview-stack' });

		const section = el('section', { className: 'field-group card' });
		section.appendChild(
			renderTextField(
				'f-name',
				strings.fieldNameLabel,
				state.name,
				strings.fieldNamePlaceholder,
				(v) => {
					state.name = v;
				},
				// Große Titel-Schrift wie im Generator-Editor.
				'title-input',
			),
		);
		section.appendChild(
			renderTextField('f-schema', strings.fieldSchemaLabel, state.schema, strings.fieldSchemaPlaceholder, (v) => {
				state.schema = v;
			}),
		);
		section.appendChild(
			renderLabeledMarkdownField(
				strings.fieldDescriptionLabel,
				strings.fieldDescriptionPlaceholder,
				state.description,
				(v) => {
					state.description = v;
				},
				postEditDebounced,
				postEdit,
			),
		);
		stack.appendChild(section);

		stack.appendChild(renderOutputCard());

		return stack;
	}

	/** Dünner Umschlag um das gemeinsame Textfeld (common.js), mit den Commit-Funktionen dieses Editors. */
	function renderTextField(id, labelText, value, placeholder, onChange, extraClass) {
		return renderTextFieldCommon(id, labelText, value, placeholder, onChange, postEditDebounced, postEdit, extraClass);
	}

	// ---------------------------------------------------------------------
	// Übersicht: Ausgabe-Karte — Dateiname als Tag-Feld + CSV-Einstellungen
	// ---------------------------------------------------------------------

	/** Anzeigename einer Dateinamen-Variable (`{…}`-Token ohne Klammern) — gemeinsame Beschriftungen, siehe common.js. @param {string} token */
	function variableLabel(token) {
		return variableLabelCommon(strings, token);
	}

	function renderOutputCard() {
		const card = el('section', { className: 'field-group card' });
		card.appendChild(el('h3', { className: 'card-title', text: strings.outputSectionTitle }));

		// --- Dateiname als Tag-Feld ---
		const nameField = el('div', { className: 'field' });
		nameField.appendChild(el('label', { text: strings.outputFileNameLabel }));

		const row = el('div', { className: 'filename-row' });
		const tagField = renderTagField({
			value: state.output.fileName || '',
			placeholder: strings.outputFileNamePlaceholder,
			ariaLabel: strings.outputFileNameLabel,
			labelFor: variableLabel,
			iconFor: (token) => (token.startsWith('column:') ? 'symbol-field' : 'symbol-variable'),
			onChange: (value, immediate) => {
				state.output.fileName = value;
				if (immediate) {
					postEdit();
				} else {
					postEditDebounced();
				}
			},
		});
		row.appendChild(tagField.element);
		row.appendChild(el('span', { className: 'filename-ext', text: `.${(state.output.format || 'csv').toLowerCase()}` }));
		nameField.appendChild(row);

		// „Dynamischen Wert einfügen“ in einer eigenen Zeile unter dem Feld
		// (gleiches Layout wie der Ausgabeordner im Projekt-Editor).
		const actionsRow = el('div', { className: 'filename-actions' });
		const addBtn = el('button', { className: 'toolbar-btn' });
		addBtn.type = 'button';
		addBtn.appendChild(el('i', { className: 'codicon codicon-add' }));
		addBtn.appendChild(document.createTextNode(strings.outputAddVariableButton));
		addBtn.addEventListener('click', (event) => {
			const rect = addBtn.getBoundingClientRect();
			event.stopPropagation();
			showVariableMenu(rect.left, rect.bottom + 2, (token) => tagField.insertVariable(token));
		});
		actionsRow.appendChild(addBtn);
		nameField.appendChild(actionsRow);

		nameField.appendChild(el('p', { className: 'hint', text: strings.outputFileNameHint }));
		card.appendChild(nameField);

		// --- Dateityp (vorerst nur CSV) ---
		const formatField = el('div', { className: 'field field-narrow' });
		const formatLabel = el('label', { text: strings.outputFormatLabel });
		formatLabel.htmlFor = 'f-format';
		formatField.appendChild(formatLabel);
		const formatSelect = /** @type {HTMLSelectElement} */ (el('select', { className: 'text-input' }));
		formatSelect.id = 'f-format';
		const csvOption = /** @type {HTMLOptionElement} */ (el('option', { text: 'CSV' }));
		csvOption.value = 'csv';
		csvOption.selected = true;
		formatSelect.appendChild(csvOption);
		formatSelect.addEventListener('change', () => {
			state.output.format = formatSelect.value;
			postEdit();
		});
		formatField.appendChild(wrapSelectWithChevron(formatSelect));
		card.appendChild(formatField);

		// --- CSV-Einstellungen ---
		const csvSection = el('div', { className: 'csv-settings' });
		csvSection.appendChild(el('h4', { className: 'csv-settings-title', text: strings.outputCsvSectionLabel }));
		const grid = el('div', { className: 'csv-settings-grid' });

		grid.appendChild(
			renderCsvSelect(strings.csvDelimiterLabel, state.output.csv.delimiter, [
				{ value: ';', label: ';' },
				{ value: ',', label: ',' },
				{ value: '|', label: '|' },
				{ value: '\t', label: strings.csvDelimiterTab },
			], (v) => {
				state.output.csv.delimiter = v;
			}),
		);
		grid.appendChild(
			renderCsvSelect(strings.csvDecimalLabel, state.output.csv.decimal, [
				{ value: '.', label: '.' },
				{ value: ',', label: ',' },
			], (v) => {
				state.output.csv.decimal = v;
			}),
		);
		grid.appendChild(
			renderCsvTextInput(strings.csvDateFormatLabel, state.output.csv.dateFormat, '%Y-%m-%d', (v) => {
				state.output.csv.dateFormat = v;
			}),
		);
		grid.appendChild(
			renderCsvTextInput(strings.csvDatetimeFormatLabel, state.output.csv.datetimeFormat, '%Y-%m-%d %H:%M:%S', (v) => {
				state.output.csv.datetimeFormat = v;
			}),
		);
		grid.appendChild(
			renderCsvSelect(strings.csvEncodingLabel, state.output.csv.encoding, [
				{ value: 'utf-8', label: 'UTF-8' },
				{ value: 'utf-8-sig', label: 'UTF-8 (BOM)' },
				{ value: 'latin-1', label: 'Latin-1' },
				{ value: 'cp1252', label: 'Windows-1252' },
			], (v) => {
				state.output.csv.encoding = v;
			}),
		);
		csvSection.appendChild(grid);

		csvSection.appendChild(
			renderCsvCheckbox(strings.csvQuoteAllLabel, state.output.csv.quoteAll, (v) => {
				state.output.csv.quoteAll = v;
			}),
		);
		csvSection.appendChild(
			renderCsvCheckbox(strings.csvIncludeHeaderLabel, state.output.csv.includeHeader, (v) => {
				state.output.csv.includeHeader = v;
			}),
		);

		card.appendChild(csvSection);
		return card;
	}

	/**
	 * @param {string} labelText
	 * @param {string} current
	 * @param {{value:string,label:string}[]} options
	 * @param {(value: string) => void} onChange
	 */
	function renderCsvSelect(labelText, current, options, onChange) {
		const field = el('div', { className: 'field' });
		field.appendChild(el('label', { text: labelText }));
		const select = /** @type {HTMLSelectElement} */ (el('select', { className: 'text-input' }));
		const values = options.map((o) => o.value);
		// Einen von Hand ins TOML geschriebenen, hier unbekannten Wert trotzdem
		// anzeigen statt ihn stillschweigend zu ersetzen.
		if (current && !values.includes(current)) {
			const opt = /** @type {HTMLOptionElement} */ (el('option', { text: current }));
			opt.value = current;
			select.appendChild(opt);
		}
		for (const option of options) {
			const opt = /** @type {HTMLOptionElement} */ (el('option', { text: option.label }));
			opt.value = option.value;
			select.appendChild(opt);
		}
		select.value = current;
		select.addEventListener('change', () => {
			onChange(select.value);
			postEdit();
		});
		field.appendChild(wrapSelectWithChevron(select));
		return field;
	}

	/**
	 * @param {string} labelText
	 * @param {string} current
	 * @param {string} placeholder
	 * @param {(value: string) => void} onChange
	 */
	function renderCsvTextInput(labelText, current, placeholder, onChange) {
		const field = el('div', { className: 'field' });
		field.appendChild(el('label', { text: labelText }));
		const input = /** @type {HTMLInputElement} */ (el('input', { className: 'text-input' }));
		input.type = 'text';
		input.placeholder = placeholder;
		input.value = current || '';
		bindText(input, onChange, postEditDebounced, postEdit);
		field.appendChild(input);
		return field;
	}

	/**
	 * @param {string} labelText
	 * @param {boolean} current
	 * @param {(value: boolean) => void} onChange
	 */
	function renderCsvCheckbox(labelText, current, onChange) {
		const wrap = el('label', { className: 'checkbox-field' });
		const checkbox = /** @type {HTMLInputElement} */ (el('input'));
		checkbox.type = 'checkbox';
		checkbox.checked = current;
		checkbox.addEventListener('change', () => {
			onChange(checkbox.checked);
			postEdit();
		});
		wrap.appendChild(checkbox);
		wrap.appendChild(el('span', { text: labelText }));
		return wrap;
	}

	/**
	 * Menü „Dynamischen Wert einfügen“ des Dateinamen-Felds: eingebaute
	 * Variablen plus die Spalten dieser Tabelle (Wert aus dem ersten
	 * generierten Datensatz) — auf Basis des gemeinsamen schwebenden Menüs
	 * (siehe showFloatingMenu in common.js).
	 * @param {number} x
	 * @param {number} y
	 * @param {(token: string) => void} onPick
	 */
	function showVariableMenu(x, y, onPick) {
		/** @type {any[]} */
		const entries = [{ kind: 'label', text: strings.outputVariableGroupLabel }];
		for (const variable of FILE_NAME_VARIABLES) {
			entries.push({ kind: 'item', text: variableLabel(variable), icon: 'symbol-variable', onPick: () => onPick(variable) });
		}
		const columnNames = state.columns.map((c) => (c.name || '').trim()).filter((n) => n.length > 0);
		if (columnNames.length > 0) {
			entries.push({ kind: 'separator' });
			entries.push({ kind: 'label', text: strings.outputColumnGroupLabel });
			for (const name of columnNames) {
				entries.push({ kind: 'item', text: name, icon: 'symbol-field', onPick: () => onPick(`column:${name}`) });
			}
		}
		showFloatingMenu(x, y, entries);
	}


	// ---------------------------------------------------------------------
	// Generatoren: Anzeige-Text + Warnungs-Prüfung (kleines Gegenstück zu
	// GeneratorBase.displayString/validate in src/generator/base.ts — die
	// Webview kommt ohne Modul-Bundling aus, daher dupliziert)
	// ---------------------------------------------------------------------

	/** @param {string} template @param {Record<string,string>} params */
	function fillDisplayTemplate(template, params) {
		return template.replace(/\{([^}]+)\}/g, (_m, name) => {
			const value = (params[name] || '').trim();
			return value === '' ? '?' : value;
		});
	}

	/** @param {string} id */
	function findGeneratorOption(id) {
		return generatorOptions.find((o) => o.id === id) || null;
	}

	/** Anzeige-Text der Generator-Konfiguration einer Spalte (leer ohne Generator). @param {Column} column */
	function generatorDisplayString(column) {
		const config = column.generator;
		// FK-Spalten zeigen schlicht den Generator-Namen („Foreign Key“) —
		// welche Tabelle/Spalte referenziert wird, steht bereits in den
		// FK-Spalten daneben. Gilt auch ohne gespeicherten Generator (ältere
		// Dateien): dann greift der Fremdschlüssel-Generator implizit.
		if ((config && config.id === 'foreign-key') || (!config?.id && column.fk)) {
			const fkOption = findGeneratorOption('foreign-key');
			return fkOption ? fkOption.label : 'Foreign Key';
		}
		if (!config || !config.id) {
			return '';
		}
		const option = findGeneratorOption(config.id);
		if (!option) {
			return config.id + strings.generatorNotFoundSuffix;
		}
		if (config.id === 'combine') {
			// Die Vorlage enthält selbst {spalten}-Platzhalter — roh anzeigen
			// statt sie fälschlich als Parameter-Platzhalter zu füllen.
			const template = (config.params.template || '').trim();
			return template ? `${option.label}: ${template}` : option.label;
		}
		if (option.displayTemplate) {
			return `${option.label}: ${fillDisplayTemplate(option.displayTemplate, config.params)}`;
		}
		const parts = option.parameters
			.map((p) => {
				const value = (config.params[p.name] || '').trim();
				return value ? `${p.name}: ${value}` : '';
			})
			.filter((part) => part !== '');
		return parts.length > 0 ? `${option.label} (${parts.join(', ')})` : option.label;
	}

	/**
	 * Worauf sich ein `column`-Parameter bezieht: der Wert des nächsten
	 * davorstehenden `table`-/`lookup`-Parameters (siehe boundReferenceValue
	 * in src/generator/base.ts).
	 * @param {GeneratorOption} option
	 * @param {GeneratorParameter} parameter
	 * @param {Record<string,string>} params
	 * @returns {{kind:'table'|'lookup',value:string} | null}
	 */
	function boundReference(option, parameter, params) {
		const index = option.parameters.indexOf(parameter);
		for (let i = index - 1; i >= 0; i--) {
			const candidate = option.parameters[i];
			if (candidate.type === 'table' || candidate.type === 'lookup') {
				const value = (params[candidate.name] || '').trim();
				return value ? { kind: candidate.type, value } : null;
			}
		}
		return null;
	}

	/**
	 * Erste Warnung zur Generator-Konfiguration einer Spalte, oder null —
	 * dieselben Regeln erzeugen im Extension-Host die Diagnostics der
	 * Problems-Ansicht (siehe validateTable in src/table/validation.ts).
	 * @param {Column} column
	 */
	function generatorWarning(column) {
		const config = column.generator;
		if (!config || !config.id) {
			// Jede Spalte soll einen Generator ausgewählt und konfiguriert
			// haben — dieselbe Regel erzeugt die Warnung in der Problems-
			// Ansicht. FK-Spalten sind ausgenommen: sie verwenden implizit
			// immer den Fremdschlüssel-Generator.
			return column.fk ? null : strings.genWarnNoGenerator;
		}
		const option = findGeneratorOption(config.id);
		if (!option) {
			return strings.genWarnNotFound;
		}
		if (option.fkOnly && !column.fk) {
			return strings.genWarnFkOnly;
		}
		if (column.fk && config.id !== 'foreign-key') {
			// Über die Oberfläche nicht mehr möglich (Auswahl gesperrt) — kann
			// nur aus von Hand bearbeitetem TOML stammen.
			return strings.genWarnFkMismatch;
		}
		if (config.id === 'combine') {
			const template = (config.params.template || '').trim();
			if (!template) {
				return strings.genWarnParamMissing.replace('{0}', 'template');
			}
			const ownColumns = state.columns.map((c) => (c.name || '').trim());
			const matches = template.matchAll(/\{([^{}]+)\}/g);
			for (const match of matches) {
				const name = match[1].trim();
				if (name === (column.name || '').trim() || !ownColumns.includes(name)) {
					return strings.genWarnRefNotFound.replace('{0}', 'template').replace('{1}', name);
				}
			}
			return null;
		}
		for (const parameter of option.parameters) {
			const value = (config.params[parameter.name] || '').trim();
			if (value === '') {
				if (parameter.required) {
					return strings.genWarnParamMissing.replace('{0}', parameter.name);
				}
				continue;
			}
			switch (parameter.type) {
				case 'integer':
					if (!/^-?\d+$/.test(value)) {
						return strings.genWarnParamInvalid.replace('{0}', parameter.name);
					}
					break;
				case 'float':
				case 'decimal':
					if (!/^-?\d+([.,]\d+)?$/.test(value)) {
						return strings.genWarnParamInvalid.replace('{0}', parameter.name);
					}
					break;
				case 'boolean':
					if (value !== 'true' && value !== 'false') {
						return strings.genWarnParamInvalid.replace('{0}', parameter.name);
					}
					break;
				case 'table':
					if (!tableOptions.some((t) => t.label === value)) {
						return strings.genWarnRefNotFound.replace('{0}', parameter.name).replace('{1}', value);
					}
					break;
				case 'lookup':
					if (!lookupOptions.some((l) => l.name === value)) {
						return strings.genWarnRefNotFound.replace('{0}', parameter.name).replace('{1}', value);
					}
					break;
				case 'column': {
					const target = boundReference(option, parameter, config.params);
					if (!target) {
						break;
					}
					const columns =
						target.kind === 'table'
							? (tableOptions.find((t) => t.label === target.value) || { columns: [] }).columns
							: (lookupOptions.find((l) => l.name === target.value) || { columns: [] }).columns;
					if (columns.length > 0 && !columns.includes(value)) {
						return strings.genWarnRefNotFound.replace('{0}', parameter.name).replace('{1}', value);
					}
					break;
				}
				case 'own_column': {
					// Spalte der eigenen Tabelle: muss existieren und darf nicht
					// die generierte Spalte selbst sein.
					const ownColumns = state.columns.map((c) => (c.name || '').trim());
					if (value === (column.name || '').trim() || !ownColumns.includes(value)) {
						return strings.genWarnRefNotFound.replace('{0}', parameter.name).replace('{1}', value);
					}
					break;
				}
				default:
					if (parameter.choices && parameter.choices.length > 0 && !parameter.choices.includes(value)) {
						return strings.genWarnParamInvalid.replace('{0}', parameter.name);
					}
					break;
			}
		}
		// Zahlenbereich min > max (Random Int/Float) — kleine Zusatzprüfung
		// passend zu den builtins.
		if ((config.id === 'random-int' || config.id === 'random-float') && config.params.min && config.params.max) {
			const min = Number((config.params.min || '').replace(',', '.'));
			const max = Number((config.params.max || '').replace(',', '.'));
			if (Number.isFinite(min) && Number.isFinite(max) && min > max) {
				return strings.genWarnParamInvalid.replace('{0}', 'min');
			}
		}
		return null;
	}

	// ---------------------------------------------------------------------
	// Tab "Spalten": Toolbar + Grid
	// ---------------------------------------------------------------------

	/** Feste Spaltenreihenfolge für das Grid, für buildColGroup (siehe common.js). */
	const COLUMN_ORDER = ['num', 'name', 'type', 'desc', 'pk', 'fk', 'refTable', 'refColumn', 'gen', 'actions'];

	function renderColumnsTab() {
		const section = el('section', { className: 'tab-panel columns-section' });

		const toolbar = el('div', { className: 'toolbar' });
		const addBtn = el('button', { className: 'toolbar-btn' });
		addBtn.type = 'button';
		addBtn.appendChild(el('i', { className: 'codicon codicon-add' }));
		addBtn.appendChild(document.createTextNode(strings.addColumnButton));
		addBtn.addEventListener('click', addColumn);
		toolbar.appendChild(addBtn);
		toolbar.appendChild(renderPreviewButton());
		section.appendChild(toolbar);

		if (state.columns.length === 0) {
			const empty = el('div', { className: 'empty-state' });
			empty.appendChild(el('i', { className: 'codicon codicon-table' }));
			empty.appendChild(el('p', { text: strings.emptyStateText }));
			const link = el('button', { className: 'link-button', text: strings.emptyStateAction });
			link.type = 'button';
			link.addEventListener('click', addColumn);
			empty.appendChild(link);
			section.appendChild(empty);
			return section;
		}

		const wrap = el('div', { className: 'columns-table-wrap' });
		const table = el('table', { className: 'columns-table' });

		const { colgroup, cols } = buildColGroup(COLUMN_ORDER, columnWidths);
		table.appendChild(colgroup);

		const thead = el('thead');
		const headRow = el('tr');
		headRow.appendChild(el('th', { className: 'col-num' }));

		const thName = el('th', { className: 'col-name', text: strings.colHeaderName });
		const thType = el('th', { className: 'col-type', text: strings.colHeaderType });
		const thDesc = el('th', { className: 'col-desc', text: strings.colHeaderDescription });
		headRow.appendChild(thName);
		headRow.appendChild(thType);
		headRow.appendChild(thDesc);

		headRow.appendChild(el('th', { className: 'col-flag', text: strings.colHeaderPk }));
		headRow.appendChild(el('th', { className: 'col-flag', text: strings.colHeaderFk }));

		const thRefTable = el('th', { className: 'col-ref-table', text: strings.fkTableLabel });
		const thRefColumn = el('th', { className: 'col-ref-column', text: strings.fkColumnLabel });
		headRow.appendChild(thRefTable);
		headRow.appendChild(thRefColumn);

		const thGen = el('th', { className: 'col-generator', text: strings.generatorColumnHeader });
		headRow.appendChild(thGen);

		headRow.appendChild(el('th', { className: 'col-actions col-actions-wide' }));
		headRow.appendChild(el('th', { className: 'col-spacer' }));
		thead.appendChild(headRow);
		table.appendChild(thead);

		const resizableHeaders = {
			name: thName,
			type: thType,
			desc: thDesc,
			refTable: thRefTable,
			refColumn: thRefColumn,
			gen: thGen,
		};
		for (const { key, minWidth } of RESIZABLE_COLUMNS) {
			attachColumnResizeHandle(resizableHeaders[key], cols[key], key, minWidth, columnWidths, (widths) =>
				vscode.postMessage({ type: 'columnWidths', columnWidths: widths }),
			);
		}

		const tbody = el('tbody');
		state.columns.forEach((column, index) => {
			tbody.appendChild(renderColumnRow(column, index));
		});
		table.appendChild(tbody);

		wrap.appendChild(table);
		section.appendChild(wrap);

		// table-layout bleibt bis hierhin "auto" (siehe CSS), damit Spalten
		// ohne von Hand gesetzte Breite sich noch inhaltsbasiert einpendeln
		// können. Erst wenn die Tabelle wirklich im DOM hängt (im echten
		// Layout, nicht in diesem noch losgelösten Baum), lässt sich die
		// dafür tatsächlich benötigte Breite messen. Danach wird auf
		// table-layout: fixed umgeschaltet — nur damit ist eine per Hand
		// gesetzte <col>-Breite zuverlässig maßgeblich (unter "auto" ist ein
		// spezifiziertes <col>-width nur ein Hinweis, den z. B. Formularfelder
		// in den Zellen überstimmen können).
		pendingColumnSizing = () => fixColumnWidths(table, RESIZABLE_COLUMNS, resizableHeaders, cols, columnWidths);

		return section;
	}

	/**
	 * @param {Column} column
	 * @param {number} index
	 */
	function renderColumnRow(column, index) {
		const row = el('tr');

		row.appendChild(el('td', { className: 'col-num', text: String(index + 1) }));

		const nameTd = el('td');
		const nameInput = /** @type {HTMLInputElement} */ (el('input', { className: 'text-input cell-input' }));
		nameInput.type = 'text';
		nameInput.placeholder = strings.columnNamePlaceholder;
		nameInput.value = column.name || '';
		nameInput.setAttribute('data-role', 'column-name');
		bindText(
			nameInput,
			(v) => {
				column.name = v;
			},
			postEditDebounced,
			postEdit,
		);
		nameTd.appendChild(nameInput);
		row.appendChild(nameTd);

		const typeTd = el('td');
		const select = /** @type {HTMLSelectElement} */ (el('select', { className: 'text-input cell-input' }));
		const types = COLUMN_TYPES.includes(column.type) ? COLUMN_TYPES : [column.type, ...COLUMN_TYPES];
		for (const type of types) {
			const opt = /** @type {HTMLOptionElement} */ (el('option', { text: type }));
			opt.value = type;
			if (type === column.type) {
				opt.selected = true;
			}
			select.appendChild(opt);
		}
		select.addEventListener('change', () => {
			column.type = select.value;
			postEdit();
		});
		typeTd.appendChild(wrapSelectWithChevron(select));
		row.appendChild(typeTd);

		const descTd = el('td');
		descTd.appendChild(
			renderMarkdownField(
				column.description,
				strings.columnDescriptionPlaceholder,
				(v) => {
					column.description = v;
				},
				postEditDebounced,
				postEdit,
				{ autoGrow: true, rows: 1, ariaLabel: strings.colHeaderDescription, gridCell: true },
			),
		);
		row.appendChild(descTd);

		const pkTd = el('td', { className: 'col-flag' });
		pkTd.appendChild(renderFlagCheckbox(column, 'pk', strings.primaryKeyLabel));
		row.appendChild(pkTd);

		// Referenzierte Tabelle/Spalte werden schon hier aufgebaut
		// (aber erst weiter unten in die Zeile eingehängt), damit der
		// FK-Checkbox-Handler sie direkt aktivieren/deaktivieren kann, statt
		// die ganze Zeile neu zu rendern.
		const refTableTd = el('td', { className: 'col-ref-table' });
		const tableSelect = /** @type {HTMLSelectElement} */ (el('select', { className: 'text-input cell-input' }));
		populateTableOptions(tableSelect, column.fkTable);
		tableSelect.disabled = !column.fk;
		// Spiegelt die Prüfung in src/table/validation.ts: leer -> "Tabelle wählen",
		// gleicht der eigenen Tabelle -> "Selbst-Referenz", gesetzt aber in
		// tableOptions nicht (mehr) vorhanden (z. B. Datei gelöscht/umbenannt)
		// -> "nicht gefunden". Dieselbe Meldung landet zusätzlich als
		// Diagnostic in der Problems-Ansicht.
		const refreshTableError = () => {
			const value = tableSelect.value.trim();
			const ownLabel = ownTableLabel();
			const isSelf = !!value && !!ownLabel && value === ownLabel;
			const notFound = !!value && !isSelf && !tableOptions.some((t) => t.label === value);
			const errorText = isSelf
				? strings.fkTableSelfReferenceError
				: value
					? strings.fkTableNotFoundError
					: strings.fkTableRequiredError;
			updateFieldError(tableSelect, errorText, column.fk && (!value || isSelf || notFound));
		};
		refTableTd.appendChild(wrapSelectWithChevron(tableSelect));
		refreshTableError();

		// Welche Spalten zur Auswahl stehen, hängt von der gewählten
		// referenzierten Tabelle ab.
		const refColumnTd = el('td', { className: 'col-ref-column' });
		const columnSelect = /** @type {HTMLSelectElement} */ (el('select', { className: 'text-input cell-input' }));
		populateColumnOptions(columnSelect, column.fkTable, column.fkColumn);
		columnSelect.disabled = !column.fk;
		const refreshColumnError = () => {
			const value = columnSelect.value.trim();
			const table = tableOptions.find((t) => t.label === column.fkTable.trim());
			// Nur prüfen, wenn die referenzierte Tabelle selbst gefunden wurde —
			// sonst wäre das nur eine Folge des Tabellenfehlers oben.
			const notFound = !!value && !!table && !table.columns.includes(value);
			updateFieldError(
				columnSelect,
				value ? strings.fkColumnNotFoundError : strings.fkColumnRequiredError,
				column.fk && (!value || notFound),
			);
		};
		refColumnTd.appendChild(wrapSelectWithChevron(columnSelect));
		refreshColumnError();

		// Generator-Zelle schon hier aufbauen, damit FK-Wechsel und
		// Referenz-Änderungen ihre Anzeige direkt auffrischen können.
		const genCell = renderGeneratorCell(column);

		columnSelect.addEventListener('change', () => {
			column.fkColumn = columnSelect.value;
			postEdit();
			refreshColumnError();
			genCell.refresh();
		});

		tableSelect.addEventListener('change', () => {
			column.fkTable = tableSelect.value;
			postEdit();
			refreshTableError();
			// Spaltenliste an die neu gewählte Tabelle anpassen; ein bisheriger
			// Wert bleibt erhalten (zeigt ggf. "nicht gefunden" an), statt ihn
			// automatisch zu verwerfen.
			populateColumnOptions(columnSelect, column.fkTable, column.fkColumn);
			refreshColumnError();
			genCell.refresh();
		});

		const fkTd = el('td', { className: 'col-flag' });
		fkTd.appendChild(
			renderFlagCheckbox(column, 'fk', strings.foreignKeyLabel, () => {
				tableSelect.disabled = !column.fk;
				columnSelect.disabled = !column.fk;
				refreshTableError();
				refreshColumnError();
				// FK anhaken weist automatisch (und fest) den Fremdschlüssel-
				// Generator zu — die Generator-Auswahl ist für FK-Spalten
				// gesperrt; Abhaken entfernt ihn wieder.
				if (column.fk) {
					column.generator = { id: 'foreign-key', params: {} };
					postEdit();
				} else if (column.generator && column.generator.id === 'foreign-key') {
					delete column.generator;
					postEdit();
				}
				genCell.rebuild();
			}),
		);
		row.appendChild(fkTd);
		row.appendChild(refTableTd);
		row.appendChild(refColumnTd);
		row.appendChild(genCell.element);

		const actionsTd = el('td', { className: 'col-actions col-actions-wide' });
		const actions = el('div', { className: 'row-actions' });
		actions.appendChild(
			renderRowActionButton('chevron-up', strings.moveColumnUpLabel, () => moveColumn(index, -1), {
				disabled: index === 0,
				action: 'move-up',
			}),
		);
		actions.appendChild(
			renderRowActionButton('chevron-down', strings.moveColumnDownLabel, () => moveColumn(index, 1), {
				disabled: index === state.columns.length - 1,
				action: 'move-down',
			}),
		);
		actions.appendChild(renderHideToggle(column, row));
		actions.appendChild(
			renderRowActionButton('trash', strings.removeColumnLabel, () => removeColumn(index), { danger: true }),
		);
		actionsTd.appendChild(actions);
		row.appendChild(actionsTd);

		// Leere Füll-Zelle passend zur Füll-Spalte im Kopf (siehe renderColGroup):
		// nimmt Restplatz auf, statt die Inhaltsspalten zu strecken.
		row.appendChild(el('td', { className: 'col-spacer' }));

		return row;
	}

	// ---------------------------------------------------------------------
	// Generator-Zelle: Auswahl + Stift (Parameter-Dialog) + Warnungs-Anzeige
	// ---------------------------------------------------------------------

	/**
	 * Baut die Generator-Zelle einer Spalte: ein Select über alle passenden
	 * Generatoren (die gewählte Option zeigt den Anzeige-Text der
	 * Konfiguration statt nur des Namens) plus ein Stift-Knopf, der den
	 * Parameter-Dialog öffnet. Bei Warnungen (siehe generatorWarning) wird
	 * die Zelle markiert; die ausführliche Meldung steht in der
	 * Problems-Ansicht und als Tooltip an der Zelle.
	 * @param {Column} column
	 */
	function renderGeneratorCell(column) {
		const td = el('td', { className: 'col-generator' });
		const wrap = el('span', { className: 'generator-cell-row' });
		td.appendChild(wrap);

		const select = /** @type {HTMLSelectElement} */ (el('select', { className: 'text-input cell-input' }));
		const pencil = /** @type {HTMLButtonElement} */ (el('button', { className: 'icon-button generator-edit-btn' }));
		pencil.type = 'button';
		pencil.title = strings.generatorEditParamsLabel;
		pencil.setAttribute('aria-label', strings.generatorEditParamsLabel);
		pencil.appendChild(el('i', { className: 'codicon codicon-edit' }));

		/** Befüllt das Select passend zum aktuellen FK-Zustand der Spalte neu. */
		function rebuildSelect() {
			select.innerHTML = '';
			const emptyOption = /** @type {HTMLOptionElement} */ (el('option', { text: strings.generatorEmptyOption }));
			emptyOption.value = '';
			select.appendChild(emptyOption);

			const available = generatorOptions.filter((o) => !o.fkOnly || column.fk);
			const builtins = available.filter((o) => !o.custom);
			const customs = available.filter((o) => o.custom);

			const appendGroup = (label, options) => {
				if (options.length === 0) {
					return;
				}
				const group = /** @type {HTMLOptGroupElement} */ (el('optgroup'));
				group.label = label;
				for (const option of options) {
					const opt = /** @type {HTMLOptionElement} */ (el('option', { text: option.label }));
					opt.value = option.id;
					opt.title = option.description;
					group.appendChild(opt);
				}
				select.appendChild(group);
			};
			appendGroup(strings.generatorBuiltinGroupLabel, builtins);
			appendGroup(strings.generatorCustomGroupLabel, customs);

			// Einen gesetzten, aber nicht (mehr) vorhandenen Generator trotzdem
			// anzeigen (z. B. .tdgen gelöscht/umbenannt), statt ihn zu verwerfen.
			// FK-Spalten ohne gespeicherten Generator zeigen den (implizit
			// geltenden) Fremdschlüssel-Generator statt „— keiner —“.
			const currentId = column.generator ? column.generator.id : column.fk ? 'foreign-key' : '';
			if (currentId && !available.some((o) => o.id === currentId)) {
				const opt = /** @type {HTMLOptionElement} */ (
					el('option', { text: currentId + strings.generatorNotFoundSuffix })
				);
				opt.value = currentId;
				select.appendChild(opt);
			}
			select.value = currentId;
			// FK-Spalten verwenden immer den Fremdschlüssel-Generator (wird über
			// die FK-Checkbox automatisch zugewiesen) — die Auswahl ist gesperrt.
			select.disabled = column.fk;
		}

		/** Frischt Anzeige-Text, Stift-Zustand und Warnungs-Markierung auf. */
		function refresh() {
			// FK-Spalten ohne gespeicherten Generator verwenden implizit den
			// Fremdschlüssel-Generator (siehe rebuildSelect).
			const effectiveId = column.generator ? column.generator.id : column.fk ? 'foreign-key' : '';
			const option = effectiveId ? findGeneratorOption(effectiveId) : null;
			// Die gewählte Option zeigt den Anzeige-Text der Konfiguration
			// (displayString) statt nur des Generator-Namens.
			for (const opt of select.options) {
				if (opt.value === '') {
					continue;
				}
				const optOption = findGeneratorOption(opt.value);
				if (effectiveId && opt.value === effectiveId) {
					opt.textContent = generatorDisplayString(column) || (optOption ? optOption.label : opt.value);
				} else if (optOption) {
					opt.textContent = optOption.label;
				}
			}
			pencil.disabled = !option || option.parameters.length === 0;
			const warning = generatorWarning(column);
			wrap.classList.toggle('has-warning-cell', !!warning);
			select.classList.toggle('has-warning', !!warning);
			if (warning) {
				select.title = warning;
			} else {
				select.title = effectiveId ? generatorDisplayString(column) : '';
			}
		}

		function rebuild() {
			rebuildSelect();
			refresh();
		}

		select.addEventListener('change', () => {
			const id = select.value;
			if (!id) {
				delete column.generator;
			} else {
				const previous = column.generator;
				column.generator = { id, params: previous && previous.id === id ? previous.params : {} };
			}
			postEdit();
			refresh();
			// Direkt den Parameter-Dialog anbieten, wenn der neue Generator
			// Parameter hat — spart den zweiten Klick auf den Stift.
			const option = id ? findGeneratorOption(id) : null;
			if (option && option.parameters.length > 0) {
				openParamDialog(column, option, refresh);
			}
		});

		pencil.addEventListener('click', () => {
			const config = column.generator;
			const option = config ? findGeneratorOption(config.id) : null;
			if (option) {
				openParamDialog(column, option, refresh);
			}
		});

		wrap.appendChild(wrapSelectWithChevron(select));
		wrap.appendChild(pencil);

		rebuild();
		return { element: td, refresh, rebuild };
	}

	/** Räumt einen evtl. offenen Parameter-Dialog ab (höchstens einen gleichzeitig); `true` übernimmt die Änderungen, sonst werden sie verworfen. @type {((keepChanges?: boolean) => void) | null} */
	let closeParamDialog = null;
	/**
	 * Schließt den Dialog, ohne etwas zurückzuschreiben — für den Fall, dass
	 * das Dokument von außen ersetzt wurde (z. B. Undo/Git): der Dialog
	 * bearbeitet dann einen veralteten Spalten-Stand, weitere Eingaben würden
	 * ins Leere laufen. @type {(() => void) | null}
	 */
	let abandonParamDialog = null;

	/** Schließt den Dialog wie „Abbrechen“ (Änderungen verwerfen). */
	function dismissParamDialog() {
		if (closeParamDialog) {
			closeParamDialog(false);
		}
	}

	/**
	 * Parameter-Dialog eines Generators (VS-Code-artiges Modal in der
	 * Webview): je Parameter ein zum Datentyp passendes Eingabefeld —
	 * Auswahl bei vordefinierten Wertelisten und Referenz-Typen
	 * (table/lookup/column), Datums-/Zeit-Felder, Zahlenfelder, sonst freie
	 * Eingabe. Werte werden direkt in die Spalten-Konfiguration geschrieben;
	 * **Fertig** behält sie, **Abbrechen** (auch X/Escape/Klick daneben)
	 * stellt den Stand beim Öffnen wieder her.
	 * @param {Column} column
	 * @param {GeneratorOption} option
	 * @param {() => void} onChanged Frischt die Generator-Zelle auf (Anzeige-Text + Warnung).
	 */
	function openParamDialog(column, option, onChanged) {
		dismissParamDialog();
		if (!column.generator) {
			return;
		}
		const params = column.generator.params;
		// Stand beim Öffnen, um ihn bei Abbrechen wiederherzustellen.
		const originalParams = JSON.parse(JSON.stringify(params));

		const overlay = el('div', { className: 'dialog-overlay' });
		const dialog = el('div', { className: 'param-dialog card' });
		dialog.setAttribute('role', 'dialog');
		dialog.setAttribute('aria-label', option.label);

		const titleRow = el('div', { className: 'param-dialog-title' });
		const heading = el('h3');
		heading.appendChild(el('i', { className: 'codicon codicon-settings-gear param-dialog-icon' }));
		heading.appendChild(document.createTextNode(option.label));
		titleRow.appendChild(heading);
		const closeBtn = el('button', { className: 'icon-button param-dialog-close' });
		closeBtn.type = 'button';
		closeBtn.title = strings.generatorCancelLabel;
		closeBtn.setAttribute('aria-label', strings.generatorCancelLabel);
		closeBtn.appendChild(el('i', { className: 'codicon codicon-close' }));
		closeBtn.addEventListener('click', () => dismissParamDialog());
		titleRow.appendChild(closeBtn);
		dialog.appendChild(titleRow);

		if (option.description) {
			dialog.appendChild(el('p', { className: 'hint param-dialog-desc', text: option.description }));
		}

		/** Nachschlage-Selects für `column`-Parameter, um sie bei Änderung ihres Bezugs-Parameters neu zu befüllen. @type {(() => void)[]} */
		const dependentRefreshers = [];
		const refreshDependents = () => {
			for (const refresh of dependentRefreshers) {
				refresh();
			}
		};

		if (option.parameters.length === 0) {
			dialog.appendChild(el('p', { className: 'hint', text: strings.generatorDialogNoParams }));
		}

		for (const parameter of option.parameters) {
			const field = el('div', { className: 'field param-field' });
			const label = el('label', {
				text: parameter.name + (parameter.required ? strings.generatorRequiredSuffix : ''),
			});
			field.appendChild(label);
			field.appendChild(renderParamControl(parameter));
			if (parameter.description) {
				field.appendChild(el('p', { className: 'hint param-hint', text: parameter.description }));
			}
			dialog.appendChild(field);
		}

		/**
		 * Zum Datentyp passendes Eingabefeld eines Parameters.
		 * @param {GeneratorParameter} parameter
		 */
		function renderParamControl(parameter) {
			const commit = (value, immediate) => {
				if (value.trim() === '') {
					delete params[parameter.name];
				} else {
					params[parameter.name] = value;
				}
				if (immediate) {
					postEdit();
				} else {
					postEditDebounced();
				}
				onChanged();
			};

			/** @param {string[]} values @param {boolean} notFoundSuffix */
			const buildSelect = (values, notFoundSuffix) => {
				const select = /** @type {HTMLSelectElement} */ (el('select', { className: 'text-input' }));
				populateSelectOptions(
					select,
					values,
					(params[parameter.name] || '').trim(),
					strings.generatorParamEmptyOption,
					notFoundSuffix ? strings.generatorNotFoundSuffix : '',
				);
				select.addEventListener('change', () => {
					commit(select.value, true);
					refreshDependents();
				});
				return wrapSelectWithChevron(select);
			};

			switch (parameter.type) {
				case 'lookup':
					return buildSelect(lookupOptions.map((l) => l.name), true);
				case 'table':
					return buildSelect(tableOptions.map((t) => t.label), true);
				case 'own_column': {
					// Spalten der eigenen Tabelle — ohne die gerade konfigurierte
					// Spalte selbst; ihre Werte gelten für dieselben Datensätze.
					const ownColumns = state.columns
						.map((c) => (c.name || '').trim())
						.filter((name) => name && name !== (column.name || '').trim());
					return buildSelect(ownColumns, true);
				}
				case 'column': {
					const select = /** @type {HTMLSelectElement} */ (el('select', { className: 'text-input' }));
					const populate = () => {
						const target = boundReference(option, parameter, params);
						const columns = !target
							? []
							: target.kind === 'table'
								? (tableOptions.find((t) => t.label === target.value) || { columns: [] }).columns
								: (lookupOptions.find((l) => l.name === target.value) || { columns: [] }).columns;
						populateSelectOptions(
							select,
							columns,
							(params[parameter.name] || '').trim(),
							strings.generatorParamEmptyOption,
							strings.generatorNotFoundSuffix,
						);
					};
					populate();
					dependentRefreshers.push(populate);
					select.addEventListener('change', () => commit(select.value, true));
					return wrapSelectWithChevron(select);
				}
				case 'boolean': {
					const select = /** @type {HTMLSelectElement} */ (el('select', { className: 'text-input' }));
					for (const { value, label: optLabel } of [
						{ value: '', label: strings.generatorParamEmptyOption },
						{ value: 'true', label: strings.generatorTrueLabel },
						{ value: 'false', label: strings.generatorFalseLabel },
					]) {
						const opt = /** @type {HTMLOptionElement} */ (el('option', { text: optLabel }));
						opt.value = value;
						select.appendChild(opt);
					}
					select.value = ['true', 'false'].includes((params[parameter.name] || '').trim())
						? (params[parameter.name] || '').trim()
						: '';
					select.addEventListener('change', () => commit(select.value, true));
					return wrapSelectWithChevron(select);
				}
				default: {
					if (parameter.choices && parameter.choices.length > 0) {
						return buildSelect(parameter.choices, false);
					}
					const input = /** @type {HTMLInputElement} */ (el('input', { className: 'text-input' }));
					if (parameter.type === 'date') {
						input.type = 'date';
					} else if (parameter.type === 'datetime') {
						input.type = 'datetime-local';
					} else if (parameter.type === 'time') {
						input.type = 'time';
					} else {
						input.type = 'text';
						if (parameter.type === 'integer') {
							input.inputMode = 'numeric';
						} else if (parameter.type === 'float' || parameter.type === 'decimal') {
							input.inputMode = 'decimal';
						}
					}
					input.placeholder = parameter.placeholder || '';
					input.value = params[parameter.name] || '';
					input.addEventListener('input', () => commit(input.value, false));
					input.addEventListener('blur', () => commit(input.value, true));
					return input;
				}
			}
		}

		// Fußzeile: Fertig übernimmt die Werte, Abbrechen stellt den Stand beim
		// Öffnen wieder her (X/Escape/Klick daneben wirken wie Abbrechen).
		const footer = el('div', { className: 'param-dialog-footer' });
		const cancelBtn = el('button', { className: 'toolbar-btn', text: strings.generatorCancelLabel });
		cancelBtn.type = 'button';
		cancelBtn.addEventListener('click', () => dismissParamDialog());
		const doneBtn = el('button', { className: 'button-primary', text: strings.generatorDoneLabel });
		doneBtn.type = 'button';
		doneBtn.addEventListener('click', () => {
			if (closeParamDialog) {
				closeParamDialog(true);
			}
		});
		footer.appendChild(cancelBtn);
		footer.appendChild(doneBtn);
		dialog.appendChild(footer);

		overlay.appendChild(dialog);
		document.body.appendChild(overlay);

		overlay.addEventListener('mousedown', (event) => {
			if (event.target === overlay) {
				dismissParamDialog();
			}
		});
		/** @param {KeyboardEvent} event */
		const onKeyDown = (event) => {
			if (event.key === 'Escape') {
				event.stopPropagation();
				dismissParamDialog();
			}
		};
		document.addEventListener('keydown', onKeyDown, true);

		const cleanup = () => {
			closeParamDialog = null;
			abandonParamDialog = null;
			document.removeEventListener('keydown', onKeyDown, true);
			overlay.remove();
		};
		abandonParamDialog = cleanup;
		closeParamDialog = (keepChanges) => {
			cleanup();
			if (!keepChanges) {
				// Abbrechen: alle Änderungen dieses Dialogs verwerfen.
				for (const key of Object.keys(params)) {
					delete params[key];
				}
				Object.assign(params, originalParams);
			}
			postEdit();
			onChanged();
			// Ein während des Dialogs aufgeschobenes Neuzeichnen jetzt nachholen.
			deferredRender.flushIfIdle();
		};

		// Erstes Eingabefeld fokussieren, damit sich der Dialog sofort per
		// Tastatur ausfüllen lässt.
		const firstControl = dialog.querySelector('input, select');
		if (firstControl instanceof HTMLElement) {
			firstControl.focus();
		}
	}

	/**
	 * Checkbox für PK/FK.
	 * @param {Column} column
	 * @param {'pk'|'fk'} key
	 * @param {string} label
	 * @param {() => void} [onToggle] Wird zusätzlich aufgerufen, wenn FK umgeschaltet wird (Referenz-Spalten (de)aktivieren).
	 */
	function renderFlagCheckbox(column, key, label, onToggle) {
		const checkbox = /** @type {HTMLInputElement} */ (el('input'));
		checkbox.type = 'checkbox';
		checkbox.checked = !!column[key];
		checkbox.title = label;
		checkbox.setAttribute('aria-label', label);
		checkbox.addEventListener('change', () => {
			column[key] = checkbox.checked;
			postEdit();
			if (onToggle) {
				onToggle();
			}
		});
		return checkbox;
	}

	/**
	 * Füllt das "Referenzierte Tabelle"-Select mit den Tabellen des Workspace.
	 * Die eigene Tabelle bleibt sichtbar (z. B. falls von Hand im TOML als
	 * `fk_table` eingetragen — dann greift die Fehleranzeige in
	 * refreshTableError), lässt sich über das Select aber nicht neu auswählen.
	 * @param {HTMLSelectElement} select
	 * @param {string} currentValue
	 */
	function populateTableOptions(select, currentValue) {
		populateSelectOptions(
			select,
			tableOptions.map((t) => t.label),
			currentValue,
			strings.fkTableEmptyOption,
			strings.fkTableNotFoundSuffix,
		);
		const ownLabel = ownTableLabel();
		if (ownLabel) {
			for (const option of select.options) {
				if (option.value === ownLabel) {
					option.disabled = true;
				}
			}
		}
	}

	/**
	 * Füllt das "Referenzierte Spalte"-Select mit den Spalten der aktuell
	 * gewählten referenzierten Tabelle (leer, solange keine/eine unbekannte
	 * Tabelle gewählt ist).
	 * @param {HTMLSelectElement} select
	 * @param {string} tableLabel
	 * @param {string} currentValue
	 */
	function populateColumnOptions(select, tableLabel, currentValue) {
		const table = tableOptions.find((t) => t.label === tableLabel);
		populateSelectOptions(
			select,
			table ? table.columns : [],
			currentValue,
			strings.fkColumnEmptyOption,
			strings.fkColumnNotFoundSuffix,
		);
	}

	// ---------------------------------------------------------------------
	// Vorschau: erzeugt über den Extension-Host (Python-Läufer) 20
	// Datensätze mit der aktuellen Konfiguration — inklusive aller (auch
	// per Auge-Umschalter ausgeblendeter) Spalten — und zeigt sie in einer
	// Tabelle im Dialog.
	// ---------------------------------------------------------------------

	/** `true`, solange eine Vorschau-Generierung läuft (Knopf zeigt dann einen Spinner). */
	let previewRunning = false;
	/** @type {HTMLButtonElement | null} Vorschau-Knopf des aktuellen Renderings, um den Spinner umzuschalten. */
	let previewButton = null;

	function renderPreviewButton() {
		const btn = /** @type {HTMLButtonElement} */ (el('button', { className: 'toolbar-btn' }));
		btn.type = 'button';
		btn.appendChild(el('i', { className: 'codicon codicon-play' }));
		btn.appendChild(document.createTextNode(strings.previewButton));
		btn.addEventListener('click', () => {
			if (previewRunning) {
				return;
			}
			previewRunning = true;
			refreshPreviewButton();
			vscode.postMessage({ type: 'preview' });
		});
		previewButton = btn;
		refreshPreviewButton();
		return btn;
	}

	function refreshPreviewButton() {
		if (!previewButton) {
			return;
		}
		previewButton.disabled = previewRunning;
		const icon = previewButton.querySelector('.codicon');
		if (icon) {
			icon.className = previewRunning ? 'codicon codicon-loading codicon-modifier-spin' : 'codicon codicon-play';
		}
	}

	/** @type {(() => void) | null} */
	let closePreviewDialog = null;

	/**
	 * Zeigt das Vorschau-Ergebnis als Tabelle im Dialog (gleiches Modal-Muster
	 * wie der Parameter-Dialog).
	 * @param {string[]} columns
	 * @param {string[][]} rows
	 */
	function showPreviewDialog(columns, rows) {
		if (closePreviewDialog) {
			closePreviewDialog();
		}

		const overlay = el('div', { className: 'dialog-overlay' });
		const dialog = el('div', { className: 'param-dialog preview-dialog card' });
		dialog.setAttribute('role', 'dialog');

		const titleRow = el('div', { className: 'param-dialog-title' });
		const heading = el('h3');
		heading.appendChild(el('i', { className: 'codicon codicon-table param-dialog-icon' }));
		heading.appendChild(document.createTextNode(strings.previewDialogTitle.replace('{0}', String(rows.length))));
		titleRow.appendChild(heading);
		const closeBtn = el('button', { className: 'icon-button param-dialog-close' });
		closeBtn.type = 'button';
		closeBtn.title = strings.previewCloseLabel;
		closeBtn.setAttribute('aria-label', strings.previewCloseLabel);
		closeBtn.appendChild(el('i', { className: 'codicon codicon-close' }));
		closeBtn.addEventListener('click', () => closePreviewDialog && closePreviewDialog());
		titleRow.appendChild(closeBtn);
		dialog.appendChild(titleRow);

		const wrap = el('div', { className: 'columns-table-wrap preview-table-wrap' });
		const table = el('table', { className: 'columns-table preview-table' });
		const thead = el('thead');
		const headRow = el('tr');
		headRow.appendChild(el('th', { className: 'col-num' }));
		for (const column of columns) {
			headRow.appendChild(el('th', { text: column }));
		}
		thead.appendChild(headRow);
		table.appendChild(thead);
		const tbody = el('tbody');
		rows.forEach((row, index) => {
			const tr = el('tr');
			tr.appendChild(el('td', { className: 'col-num', text: String(index + 1) }));
			for (const value of row) {
				tr.appendChild(el('td', { className: 'preview-cell', text: value }));
			}
			tbody.appendChild(tr);
		});
		table.appendChild(tbody);
		wrap.appendChild(table);
		dialog.appendChild(wrap);

		overlay.appendChild(dialog);
		document.body.appendChild(overlay);

		overlay.addEventListener('mousedown', (event) => {
			if (event.target === overlay && closePreviewDialog) {
				closePreviewDialog();
			}
		});
		/** @param {KeyboardEvent} event */
		const onKeyDown = (event) => {
			if (event.key === 'Escape' && closePreviewDialog) {
				event.stopPropagation();
				closePreviewDialog();
			}
		};
		document.addEventListener('keydown', onKeyDown, true);

		closePreviewDialog = () => {
			closePreviewDialog = null;
			document.removeEventListener('keydown', onKeyDown, true);
			overlay.remove();
		};
	}

	function addColumn() {
		state.columns.push({
			name: '',
			type: 'string',
			pk: false,
			fk: false,
			fkTable: '',
			fkColumn: '',
			description: '',
		});
		postEdit();
		render();
		const lastNameInput = app.querySelector(
			'.columns-table tbody tr:last-child input[data-role="column-name"]',
		);
		if (lastNameInput instanceof HTMLInputElement) {
			lastNameInput.focus();
		}
	}

	/** @param {number} index */
	function removeColumn(index) {
		state.columns.splice(index, 1);
		postEdit();
		render();
	}

	/**
	 * Knopf der Aktionsspalte (verschieben/entfernen) — der Auge-Umschalter
	 * hat seinen eigenen Aufbau (renderHideToggle), da sein Icon wechselt.
	 * @param {string} icon codicon-Name ohne Präfix, z. B. "chevron-up"
	 * @param {string} label
	 * @param {() => void} onClick
	 * @param {{ disabled?: boolean, danger?: boolean, action?: string }} [options]
	 */
	function renderRowActionButton(icon, label, onClick, options) {
		const opts = options || {};
		const btn = /** @type {HTMLButtonElement} */ (
			el('button', { className: opts.danger ? 'icon-button icon-button-danger' : 'icon-button' })
		);
		btn.type = 'button';
		btn.title = label;
		btn.setAttribute('aria-label', label);
		if (opts.action) {
			btn.setAttribute('data-action', opts.action);
		}
		btn.disabled = !!opts.disabled;
		btn.appendChild(el('i', { className: `codicon codicon-${icon}` }));
		btn.addEventListener('click', onClick);
		return btn;
	}

	/**
	 * Auge-Umschalter „Spalte aus-/einblenden“: rein visueller Merkzustand
	 * (Icon wechselt, Zeile wird gedimmt) ohne jede weitere Funktion — bewusst
	 * kein postEdit, das Dokument bleibt unverändert (siehe Column-Typedef).
	 * @param {Column} column
	 * @param {HTMLElement} row
	 */
	function renderHideToggle(column, row) {
		const btn = /** @type {HTMLButtonElement} */ (el('button', { className: 'icon-button' }));
		btn.type = 'button';
		const icon = el('i');
		btn.appendChild(icon);
		const refresh = () => {
			icon.className = `codicon ${column.uiHidden ? 'codicon-eye-closed' : 'codicon-eye'}`;
			const label = column.uiHidden ? strings.unhideColumnLabel : strings.hideColumnLabel;
			btn.title = label;
			btn.setAttribute('aria-label', label);
			row.classList.toggle('column-hidden', !!column.uiHidden);
		};
		btn.addEventListener('click', () => {
			column.uiHidden = !column.uiHidden;
			refresh();
		});
		refresh();
		return btn;
	}

	/**
	 * Verschiebt eine Spalte um eine Position nach oben (-1) oder unten (+1)
	 * und setzt den Fokus wieder auf denselben Knopf der verschobenen Zeile,
	 * damit sich eine Spalte per wiederholtem Klick/Enter weiterbewegen lässt.
	 * @param {number} index
	 * @param {-1|1} delta
	 */
	function moveColumn(index, delta) {
		const target = index + delta;
		if (target < 0 || target >= state.columns.length) {
			return;
		}
		const [column] = state.columns.splice(index, 1);
		state.columns.splice(target, 0, column);
		postEdit();
		render();
		const rowEl = app.querySelectorAll('.columns-table tbody tr')[target];
		const btn = rowEl && rowEl.querySelector(`button[data-action="${delta === -1 ? 'move-up' : 'move-down'}"]`);
		if (btn instanceof HTMLButtonElement && !btn.disabled) {
			btn.focus();
		}
	}

	// ---------------------------------------------------------------------
	// Nachrichten vom Extension-Host
	// ---------------------------------------------------------------------

	window.addEventListener('message', (event) => {
		const message = event.data;
		switch (message.type) {
			case 'init':
				strings = message.strings;
				tableOptions = Array.isArray(message.tableOptions) ? message.tableOptions : [];
				generatorOptions = Array.isArray(message.generatorOptions) ? message.generatorOptions : [];
				lookupOptions = Array.isArray(message.lookupOptions) ? message.lookupOptions : [];
				lastOptionsJson = JSON.stringify([message.tableOptions, message.generatorOptions, message.lookupOptions]);
				columnWidths = message.columnWidths && typeof message.columnWidths === 'object' ? message.columnWidths : {};
				parseError = 'parseError' in message ? message.parseError : null;
				if ('table' in message) {
					state = message.table;
				}
				render();
				break;
			case 'update':
				// Externer Dokumentwechsel (Undo, Git, Texteditor): ein offener
				// Parameter-Dialog bearbeitet danach einen veralteten Stand ->
				// schließen, ohne etwas zurückzuschreiben.
				if (abandonParamDialog) {
					abandonParamDialog();
				}
				parseError = null;
				state = message.table;
				render();
				break;
			case 'parseError':
				if (abandonParamDialog) {
					abandonParamDialog();
				}
				parseError = message.message;
				render();
				break;
			case 'options': {
				// Aktualisierte Auswahllisten (Tabellen/Generatoren/Nachschlage-
				// listen) nach Datei-Änderungen im Workspace. Unverändert ->
				// gar nichts tun; geändert -> neu zeichnen, aber erst, wenn
				// gerade kein Eingabefeld fokussiert ist (siehe renderSoon).
				const optionsJson = JSON.stringify([message.tableOptions, message.generatorOptions, message.lookupOptions]);
				tableOptions = Array.isArray(message.tableOptions) ? message.tableOptions : [];
				generatorOptions = Array.isArray(message.generatorOptions) ? message.generatorOptions : [];
				lookupOptions = Array.isArray(message.lookupOptions) ? message.lookupOptions : [];
				if (optionsJson === lastOptionsJson) {
					break;
				}
				lastOptionsJson = optionsJson;
				if (!parseError) {
					deferredRender.renderSoon();
				}
				break;
			}
			case 'previewResult':
				previewRunning = false;
				refreshPreviewButton();
				showPreviewDialog(
					Array.isArray(message.columns) ? message.columns : [],
					Array.isArray(message.rows) ? message.rows : [],
				);
				break;
			case 'previewDone':
				// Lauf beendet ohne Ergebnis (Fehler wurde vom Extension-Host
				// als Meldung angezeigt) — nur den Knopf zurücksetzen.
				previewRunning = false;
				refreshPreviewButton();
				break;
		}
	});

	vscode.postMessage({ type: 'ready' });
})();
