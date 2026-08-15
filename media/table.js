// @ts-check
// Webview script for the table editor. Deliberately kept as a standalone,
// uncompiled script (no bundling needed, no dependencies).
//
// The UI borrows from Oracle SQL Developer for VS Code: tabs (here "Overview" /
// "Columns", plus "Schema"/"Mapping" for the JSON and XML file types), a slim
// bordered toolbar above the grid, and a grid with a row number column, PK/FK
// checkbox columns, columns for the referenced table/column and the generator
// column (picker + parameter dialog). The overview tab additionally holds the
// output settings: the file name as a tag field (dynamic variables as clickable
// tags, similar to Power Automate) and the settings of the selected file type.
(function () {
	'use strict';

	/** @type {{ postMessage: (msg: any) => void }} */
	// eslint-disable-next-line no-undef
	const vscode = acquireVsCodeApi();

	// Shared, stateless building blocks from common.js (loaded before this
	// script, see getHtml in table/editorProvider.ts).
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

	/** Built-in file name variables — the counterpart to FILE_NAME_VARIABLES in src/table/model.ts. */
	const FILE_NAME_VARIABLES = ['date', 'time', 'datetime', 'timestamp', 'schema', 'table', 'records'];

	/**
	 * `hidden` is the eye toggle in the actions column (the row is dimmed): the
	 * column stays visible everywhere in the extension and is generated as usual
	 * during a generator run (usable as an FK source, for example) — it is
	 * merely not written to the output file. Stored as `hidden` in the .td file
	 * (counterpart: Column in the extension host).
	 * @typedef {{id:string,params:Record<string,string>}} GeneratorConfig
	 * @typedef {{name:string,type:string,pk:boolean,fk:boolean,fkTable:string,fkColumn:string,description:string,hidden:boolean,generator?:GeneratorConfig}} Column
	 */
	/** @typedef {{delimiter:string,quoteAll:boolean,decimal:string,dateFormat:string,datetimeFormat:string,includeHeader:boolean,encoding:string}} CsvOptions */
	/** @typedef {{sheetName:string,startCell:string,includeHeader:boolean,freezeHeader:boolean,autoFilter:boolean,autoFitColumns:boolean,dateFormat:string,datetimeFormat:string}} XlsxOptions */
	/**
	 * One node of the JSON/XML target structure — the counterpart to
	 * StructureNode in src/table/model.ts. Structure (name/kind/valueType) is
	 * edited in the schema tab, the mapping (sourceKind/source) in the mapping
	 * tab; both live on the same node.
	 * @typedef {{name:string,kind:'object'|'array'|'value'|'attribute',valueType:string,sourceKind:'column'|'constant',source:string,children:StructureNode[]}} StructureNode
	 */
	/** @typedef {{rootName:string,indent:number,jsonLines:boolean,asciiOnly:boolean,dateFormat:string,datetimeFormat:string,encoding:string,nodes:StructureNode[]}} JsonOptions */
	/** @typedef {{rootElement:string,recordElement:string,indent:number,declaration:boolean,dateFormat:string,datetimeFormat:string,encoding:string,nodes:StructureNode[]}} XmlOptions */
	/**
	 * One field of a fixed-length record — the counterpart to FixedField in
	 * src/table/model.ts. The fields sit next to each other without a
	 * separator, so order and width alone decide where a value starts.
	 * @typedef {{column:string,width:number,align:'left'|'right',pad:string}} FixedField
	 */
	/** @typedef {{includeHeader:boolean,truncate:boolean,lineEnding:string,dateFormat:string,datetimeFormat:string,decimal:string,encoding:string,fields:FixedField[]}} FixedOptions */
	/** @typedef {{fileName:string,format:string,csv:CsvOptions,xlsx:XlsxOptions,json:JsonOptions,xml:XmlOptions,fixed:FixedOptions}} OutputConfig */
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
	/** @type {'overview' | 'columns' | 'structure' | 'fixed'} the last two only exist for their file type */
	let activeTab = 'columns';
	/** @type {TableOption[]} Tables in the workspace (label + column names), for FK and generator references */
	let tableOptions = [];
	/** @type {GeneratorOption[]} Available generators (built-in + custom), supplied by the extension host */
	let generatorOptions = [];
	/** @type {LookupOption[]} Lookup lists (.lkp) in the workspace, for lookup parameters */
	let lookupOptions = [];
	/**
	 * Manually dragged grid column widths (px), per column key. It arrives
	 * initially from the extension host (remembered per machine across all .td
	 * files via globalState, see table/editorProvider.ts) and is sent back there
	 * on every resize. Where an entry is missing, the column keeps sizing itself
	 * to its content.
	 * @type {Record<string, number>}
	 */
	let columnWidths = {};
	/** @type {(() => void) | null} set by renderColumnsTab: computes the final column widths once the table is in the DOM (see render()). */
	let pendingColumnSizing = null;

	/** Resizable grid columns with their minimum width (px). */
	const RESIZABLE_COLUMNS = [
		{ key: 'name', minWidth: 140 },
		{ key: 'type', minWidth: 120 },
		{ key: 'desc', minWidth: 180 },
		{ key: 'refTable', minWidth: 170 },
		{ key: 'refColumn', minWidth: 150 },
		{ key: 'gen', minWidth: 385 },
	];

	const app = document.getElementById('app');

	/** Available output file types — the counterpart to OUTPUT_FORMATS in src/table/model.ts. */
	const OUTPUT_FORMATS = [
		{ value: 'csv', label: 'CSV' },
		{ value: 'xlsx', label: 'Excel (XLSX)' },
		{ value: 'json', label: 'JSON' },
		{ value: 'xml', label: 'XML' },
		{ value: 'fixed', label: 'Fixed length' },
	];

	/** File extension per format (counterpart to outputExtension in src/table/model.ts). */
	const OUTPUT_EXTENSIONS = { csv: 'csv', xlsx: 'xlsx', json: 'json', xml: 'xml', fixed: 'txt' };

	/** Default width of a derived fixed-length field (see FIXED_DEFAULT_WIDTH in src/table/model.ts). */
	const FIXED_DEFAULT_WIDTH = 20;

	/** @returns {OutputConfig} Default output until the extension host sends the real state (counterpart to createDefaultOutput in src/table/model.ts). */
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
			xlsx: {
				sheetName: '{table}',
				startCell: 'A1',
				includeHeader: true,
				freezeHeader: true,
				autoFilter: false,
				autoFitColumns: true,
				dateFormat: '%Y-%m-%d',
				datetimeFormat: '%Y-%m-%d %H:%M:%S',
			},
			json: {
				rootName: '',
				indent: 2,
				jsonLines: false,
				asciiOnly: false,
				dateFormat: '%Y-%m-%d',
				datetimeFormat: '%Y-%m-%dT%H:%M:%S',
				encoding: 'utf-8',
				nodes: [],
			},
			xml: {
				rootElement: 'rows',
				recordElement: 'row',
				indent: 2,
				declaration: true,
				dateFormat: '%Y-%m-%d',
				datetimeFormat: '%Y-%m-%dT%H:%M:%S',
				encoding: 'utf-8',
				nodes: [],
			},
			fixed: {
				includeHeader: false,
				truncate: true,
				lineEnding: 'lf',
				dateFormat: '%Y%m%d',
				datetimeFormat: '%Y%m%d%H%M%S',
				decimal: '.',
				encoding: 'utf-8',
				fields: [],
			},
		};
	}

	/** Currently selected output file type ('csv' when nothing valid is set). */
	function currentFormat() {
		const format = ((state.output && state.output.format) || 'csv').trim().toLowerCase();
		return OUTPUT_FORMATS.some((f) => f.value === format) ? format : 'csv';
	}

	/** `true` for the two record-shaped file types, which get the structure tab. */
	function isStructuredFormat() {
		const format = currentFormat();
		return format === 'json' || format === 'xml';
	}

	/** File extension the selected format writes. */
	function currentExtension() {
		return OUTPUT_EXTENSIONS[currentFormat()] || 'csv';
	}

	/**
	 * Fills in output blocks the extension host did not send (a `.td` file that
	 * predates a file type, or a hand-written one) — done ONCE per incoming
	 * state rather than on every access, so the render code can rely on the
	 * objects existing and keep editing them by reference.
	 */
	function normalizeState() {
		const defaults = defaultOutput();
		state.output = Object.assign({}, defaults, state.output || {});
		state.output.csv = Object.assign(defaults.csv, state.output.csv || {});
		state.output.xlsx = Object.assign(defaults.xlsx, state.output.xlsx || {});
		state.output.json = Object.assign(defaults.json, state.output.json || {});
		state.output.xml = Object.assign(defaults.xml, state.output.xml || {});
		state.output.fixed = Object.assign(defaults.fixed, state.output.fixed || {});
		if (!Array.isArray(state.output.json.nodes)) {
			state.output.json.nodes = [];
		}
		if (!Array.isArray(state.output.xml.nodes)) {
			state.output.xml.nodes = [];
		}
		if (!Array.isArray(state.output.fixed.fields)) {
			state.output.fixed.fields = [];
		}
		if (!Array.isArray(state.columns)) {
			state.columns = [];
		}
	}

	/**
	 * The structure options block of the selected file type (JSON or XML).
	 * @returns {JsonOptions | XmlOptions}
	 */
	function structureOptions() {
		return currentFormat() === 'xml' ? state.output.xml : state.output.json;
	}

	function postEdit() {
		vscode.postMessage({ type: 'edit', table: state });
	}

	const postEditDebounced = debounce(postEdit, 250);

	/**
	 * Logical identity of the table currently being edited (`schema.name`, or
	 * just `name` without a schema) — empty while it has no name yet. A small
	 * counterpart to `logicalTableName` in src/table/model.ts, used to detect a
	 * self-reference in the FK "referenced table" select (see
	 * populateTableOptions, refreshTableError in renderColumnRow).
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
	// Anti-flicker: option broadcasts from the extension host (after every file
	// change in the workspace) no longer trigger an immediate re-render.
	// Unchanged lists are ignored entirely; for real changes the re-render is
	// deferred while an input has focus (or the parameter dialog is open) —
	// otherwise the field would lose focus and cursor on every broadcast (the
	// former "flicker"). For the mechanism see createDeferredRenderer in
	// common.js.
	// ---------------------------------------------------------------------

	/** Last processed picker lists (JSON), used to ignore unchanged broadcasts. */
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
		// Tab bar and content are separate: the bar stays at the top, only the
		// content area scrolls (.tab-content, see main.css).
		const content = el('div', { className: 'tab-content' });
		if (parseError) {
			content.appendChild(renderErrorState(strings, parseError));
			app.appendChild(content);
			return;
		}
		app.appendChild(renderTabs());
		content.appendChild(renderActiveTab());
		app.appendChild(content);

		// Only now (with the table in the real DOM) can the width actually
		// needed per column be measured — see renderColumnsTab.
		if (pendingColumnSizing) {
			pendingColumnSizing();
		}
	}

	// ---------------------------------------------------------------------
	// Header area: tabs (SQL-Developer-style object navigation)
	// ---------------------------------------------------------------------

	function renderTabs() {
		const bar = el('div', { className: 'tabbar' });
		bar.setAttribute('role', 'tablist');
		bar.appendChild(renderTabButton('overview', strings.tabOverview));
		bar.appendChild(renderTabButton('columns', `${strings.tabColumns} (${state.columns.length})`));
		if (isStructuredFormat()) {
			// The target structure only exists for the record-shaped file types
			// (JSON/XML) — CSV and Excel write the columns as they are. The tab
			// is named after the file type, since the two keep separate
			// structures and only the selected one is shown.
			bar.appendChild(
				renderTabButton('structure', strings.tabStructure.replace('{0}', currentFormat().toUpperCase())),
			);
		} else if (currentFormat() === 'fixed') {
			bar.appendChild(renderTabButton('fixed', strings.tabFixedLayout));
		}
		return bar;
	}

	/** Content of the currently selected tab (falls back to the columns tab when the tab no longer exists). */
	function renderActiveTab() {
		if (activeTab === 'structure' && !isStructuredFormat()) {
			activeTab = 'columns';
		}
		if (activeTab === 'fixed' && currentFormat() !== 'fixed') {
			activeTab = 'columns';
		}
		switch (activeTab) {
			case 'overview':
				return renderOverviewTab();
			case 'structure':
				return renderStructureTab();
			case 'fixed':
				return renderFixedLayoutTab();
			default:
				return renderColumnsTab();
		}
	}

	/** @param {'overview'|'columns'|'structure'|'fixed'} tab */
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
	// "Overview" tab: name / schema / description + output (file name, CSV)
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
				// Large title font as in the generator editor.
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

	/** Thin wrapper around the shared text field (common.js), using this editor's commit functions. */
	function renderTextField(id, labelText, value, placeholder, onChange, extraClass) {
		return renderTextFieldCommon(id, labelText, value, placeholder, onChange, postEditDebounced, postEdit, extraClass);
	}

	// ---------------------------------------------------------------------
	// Overview: output card — file name as a tag field + CSV settings
	// ---------------------------------------------------------------------

	/** Anzeigename einer Dateinamen-Variable (`{…}`-Token ohne Klammern) — gemeinsame Beschriftungen, siehe common.js. @param {string} token */
	function variableLabel(token) {
		return variableLabelCommon(strings, token);
	}

	function renderOutputCard() {
		const card = el('section', { className: 'field-group card' });
		card.appendChild(el('h3', { className: 'card-title', text: strings.outputSectionTitle }));

		// --- File name as a tag field ---
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
		row.appendChild(el('span', { className: 'filename-ext', text: `.${currentExtension()}` }));
		nameField.appendChild(row);

		// "Insert dynamic value" on its own line below the field (the same
		// layout as the output folder in the project editor).
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

		// --- File type ---
		const formatField = el('div', { className: 'field field-narrow' });
		const formatLabel = el('label', { text: strings.outputFormatLabel });
		formatLabel.htmlFor = 'f-format';
		formatField.appendChild(formatLabel);
		const formatSelect = /** @type {HTMLSelectElement} */ (el('select', { className: 'text-input' }));
		formatSelect.id = 'f-format';
		for (const format of OUTPUT_FORMATS) {
			const option = /** @type {HTMLOptionElement} */ (el('option', { text: format.label }));
			option.value = format.value;
			formatSelect.appendChild(option);
		}
		formatSelect.value = currentFormat();
		formatSelect.addEventListener('change', () => {
			state.output.format = formatSelect.value;
			postEdit();
			// The file extension, the settings section and the tab bar (schema
			// and mapping only exist for JSON/XML) all follow the file type.
			render();
		});
		formatField.appendChild(wrapSelectWithChevron(formatSelect));
		card.appendChild(formatField);

		// --- Settings of the selected file type ---
		card.appendChild(renderFormatSettings());
		return card;
	}

	/** Settings section of the currently selected file type. */
	function renderFormatSettings() {
		switch (currentFormat()) {
			case 'xlsx':
				return renderXlsxSettings();
			case 'json':
				return renderJsonSettings();
			case 'xml':
				return renderXmlSettings();
			case 'fixed':
				return renderFixedSettings();
			default:
				return renderCsvSettings();
		}
	}

	/** Frame of a settings section: a title plus the grid its fields go into. */
	function renderSettingsSection(title) {
		const section = el('div', { className: 'csv-settings' });
		section.appendChild(el('h4', { className: 'csv-settings-title', text: title }));
		const grid = el('div', { className: 'csv-settings-grid' });
		section.appendChild(grid);
		return { section, grid };
	}

	/** Shared encoding picker of the file types that write text files. */
	function renderEncodingSelect(current, onChange) {
		return renderCsvSelect(strings.formatEncodingLabel, current, [
			{ value: 'utf-8', label: 'UTF-8' },
			{ value: 'utf-8-sig', label: 'UTF-8 (BOM)' },
			{ value: 'latin-1', label: 'Latin-1' },
			{ value: 'cp1252', label: 'Windows-1252' },
		], onChange);
	}

	/** Shared indentation picker of the JSON/XML settings. */
	function renderIndentSelect(labelText, current, compactLabel, onChange) {
		return renderCsvSelect(labelText, String(current), [
			{ value: '0', label: compactLabel },
			{ value: '2', label: '2' },
			{ value: '4', label: '4' },
			{ value: '8', label: '8' },
		], (value) => onChange(Number(value) || 0));
	}

	function renderCsvSettings() {
		const csv = state.output.csv;
		const { section, grid } = renderSettingsSection(strings.outputCsvSectionLabel);

		grid.appendChild(
			renderCsvSelect(strings.csvDelimiterLabel, csv.delimiter, [
				{ value: ';', label: ';' },
				{ value: ',', label: ',' },
				{ value: '|', label: '|' },
				{ value: '\t', label: strings.csvDelimiterTab },
			], (v) => {
				csv.delimiter = v;
			}),
		);
		grid.appendChild(
			renderCsvSelect(strings.csvDecimalLabel, csv.decimal, [
				{ value: '.', label: '.' },
				{ value: ',', label: ',' },
			], (v) => {
				csv.decimal = v;
			}),
		);
		grid.appendChild(
			renderCsvTextInput(strings.csvDateFormatLabel, csv.dateFormat, '%Y-%m-%d', (v) => {
				csv.dateFormat = v;
			}),
		);
		grid.appendChild(
			renderCsvTextInput(strings.csvDatetimeFormatLabel, csv.datetimeFormat, '%Y-%m-%d %H:%M:%S', (v) => {
				csv.datetimeFormat = v;
			}),
		);
		grid.appendChild(renderEncodingSelect(csv.encoding, (v) => {
			csv.encoding = v;
		}));

		section.appendChild(
			renderCsvCheckbox(strings.csvQuoteAllLabel, csv.quoteAll, (v) => {
				csv.quoteAll = v;
			}),
		);
		section.appendChild(
			renderCsvCheckbox(strings.csvIncludeHeaderLabel, csv.includeHeader, (v) => {
				csv.includeHeader = v;
			}),
		);
		return section;
	}

	function renderXlsxSettings() {
		const xlsx = state.output.xlsx;
		const { section, grid } = renderSettingsSection(strings.outputXlsxSectionLabel);

		grid.appendChild(
			renderCsvTextInput(
				strings.xlsxSheetNameLabel,
				xlsx.sheetName,
				strings.xlsxSheetNamePlaceholder,
				(v) => {
					xlsx.sheetName = v;
				},
				strings.xlsxSheetNameHint,
			),
		);
		grid.appendChild(
			renderCsvTextInput(
				strings.xlsxStartCellLabel,
				xlsx.startCell,
				'A1',
				(v) => {
					xlsx.startCell = v;
				},
				strings.xlsxStartCellHint,
			),
		);
		grid.appendChild(
			renderCsvTextInput(strings.formatDateFormatLabel, xlsx.dateFormat, '%Y-%m-%d', (v) => {
				xlsx.dateFormat = v;
			}),
		);
		grid.appendChild(
			renderCsvTextInput(strings.formatDatetimeFormatLabel, xlsx.datetimeFormat, '%Y-%m-%d %H:%M:%S', (v) => {
				xlsx.datetimeFormat = v;
			}),
		);

		section.appendChild(
			renderCsvCheckbox(strings.xlsxIncludeHeaderLabel, xlsx.includeHeader, (v) => {
				xlsx.includeHeader = v;
			}),
		);
		section.appendChild(
			renderCsvCheckbox(strings.xlsxFreezeHeaderLabel, xlsx.freezeHeader, (v) => {
				xlsx.freezeHeader = v;
			}),
		);
		section.appendChild(
			renderCsvCheckbox(strings.xlsxAutoFilterLabel, xlsx.autoFilter, (v) => {
				xlsx.autoFilter = v;
			}),
		);
		section.appendChild(
			renderCsvCheckbox(strings.xlsxAutoFitColumnsLabel, xlsx.autoFitColumns, (v) => {
				xlsx.autoFitColumns = v;
			}),
		);
		return section;
	}

	function renderJsonSettings() {
		const json = state.output.json;
		const { section, grid } = renderSettingsSection(strings.outputJsonSectionLabel);

		grid.appendChild(
			renderCsvTextInput(
				strings.jsonRootNameLabel,
				json.rootName,
				strings.jsonRootNamePlaceholder,
				(v) => {
					json.rootName = v;
				},
				strings.jsonRootNameHint,
			),
		);
		grid.appendChild(
			renderIndentSelect(strings.jsonIndentLabel, json.indent, strings.jsonIndentCompact, (v) => {
				json.indent = v;
			}),
		);
		grid.appendChild(
			renderCsvTextInput(strings.formatDateFormatLabel, json.dateFormat, '%Y-%m-%d', (v) => {
				json.dateFormat = v;
			}),
		);
		grid.appendChild(
			renderCsvTextInput(strings.formatDatetimeFormatLabel, json.datetimeFormat, '%Y-%m-%dT%H:%M:%S', (v) => {
				json.datetimeFormat = v;
			}),
		);
		grid.appendChild(renderEncodingSelect(json.encoding, (v) => {
			json.encoding = v;
		}));

		section.appendChild(
			renderCsvCheckbox(strings.jsonLinesLabel, json.jsonLines, (v) => {
				json.jsonLines = v;
			}),
		);
		section.appendChild(
			renderCsvCheckbox(strings.jsonAsciiOnlyLabel, json.asciiOnly, (v) => {
				json.asciiOnly = v;
			}),
		);
		return section;
	}

	function renderXmlSettings() {
		const xml = state.output.xml;
		const { section, grid } = renderSettingsSection(strings.outputXmlSectionLabel);

		grid.appendChild(
			renderCsvTextInput(strings.xmlRootElementLabel, xml.rootElement, 'rows', (v) => {
				xml.rootElement = v;
			}),
		);
		grid.appendChild(
			renderCsvTextInput(strings.xmlRecordElementLabel, xml.recordElement, 'row', (v) => {
				xml.recordElement = v;
			}),
		);
		grid.appendChild(
			renderIndentSelect(strings.xmlIndentLabel, xml.indent, strings.jsonIndentCompact, (v) => {
				xml.indent = v;
			}),
		);
		grid.appendChild(
			renderCsvTextInput(strings.formatDateFormatLabel, xml.dateFormat, '%Y-%m-%d', (v) => {
				xml.dateFormat = v;
			}),
		);
		grid.appendChild(
			renderCsvTextInput(strings.formatDatetimeFormatLabel, xml.datetimeFormat, '%Y-%m-%dT%H:%M:%S', (v) => {
				xml.datetimeFormat = v;
			}),
		);
		grid.appendChild(renderEncodingSelect(xml.encoding, (v) => {
			xml.encoding = v;
		}));

		section.appendChild(
			renderCsvCheckbox(strings.xmlDeclarationLabel, xml.declaration, (v) => {
				xml.declaration = v;
			}),
		);
		return section;
	}

	function renderFixedSettings() {
		const fixed = state.output.fixed;
		const { section, grid } = renderSettingsSection(strings.outputFixedSectionLabel);

		grid.appendChild(
			renderCsvSelect(strings.fixedLineEndingLabel, fixed.lineEnding, [
				{ value: 'lf', label: strings.fixedLineEndingLf },
				{ value: 'crlf', label: strings.fixedLineEndingCrlf },
			], (v) => {
				fixed.lineEnding = v;
			}),
		);
		grid.appendChild(
			renderCsvSelect(strings.csvDecimalLabel, fixed.decimal, [
				{ value: '.', label: '.' },
				{ value: ',', label: ',' },
			], (v) => {
				fixed.decimal = v;
			}),
		);
		grid.appendChild(
			renderCsvTextInput(strings.formatDateFormatLabel, fixed.dateFormat, '%Y%m%d', (v) => {
				fixed.dateFormat = v;
			}),
		);
		grid.appendChild(
			renderCsvTextInput(strings.formatDatetimeFormatLabel, fixed.datetimeFormat, '%Y%m%d%H%M%S', (v) => {
				fixed.datetimeFormat = v;
			}),
		);
		grid.appendChild(renderEncodingSelect(fixed.encoding, (v) => {
			fixed.encoding = v;
		}));

		section.appendChild(
			renderCsvCheckbox(strings.fixedIncludeHeaderLabel, fixed.includeHeader, (v) => {
				fixed.includeHeader = v;
			}),
		);
		section.appendChild(
			renderCsvCheckbox(strings.fixedTruncateLabel, fixed.truncate, (v) => {
				fixed.truncate = v;
			}),
		);
		return section;
	}

	/**
	 * Labelled dropdown of the CSV settings.
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
		// Still display a value hand-written into the TOML that is unknown here,
		// instead of silently replacing it.
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
	 * Labelled text input of a file type's settings.
	 * @param {string} labelText
	 * @param {string} current
	 * @param {string} placeholder
	 * @param {(value: string) => void} onChange
	 * @param {string} [hint] Explanatory text below the field.
	 */
	function renderCsvTextInput(labelText, current, placeholder, onChange, hint) {
		const field = el('div', { className: 'field' });
		field.appendChild(el('label', { text: labelText }));
		const input = /** @type {HTMLInputElement} */ (el('input', { className: 'text-input' }));
		input.type = 'text';
		input.placeholder = placeholder;
		input.value = current || '';
		bindText(input, onChange, postEditDebounced, postEdit);
		field.appendChild(input);
		if (hint) {
			field.appendChild(el('p', { className: 'hint', text: hint }));
		}
		return field;
	}

	/**
	 * Labelled checkbox of the CSV settings.
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
	 * The file name field's "insert dynamic value" menu: built-in variables plus
	 * this table's columns (value taken from the first generated record) — built
	 * on the shared floating menu (see showFloatingMenu in common.js).
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
	// "Structure" tab: the JSON/XML target structure AND the value mapping of
	// its leaves in ONE indented tree grid — shape and mapping belong to the
	// same node, so keeping them in separate tabs only meant switching back and
	// forth to see which column fills which element. The tree describes ONE
	// record; the writer repeats it for every generated row (see
	// python/generate.py).
	// ---------------------------------------------------------------------

	/** Indentation per nesting level (px) in the grid's name column. */
	const STRUCTURE_INDENT = 24;

	/**
	 * Fixed column widths (px) of the structure grid. The name column carries
	 * the indented tree and gets the room; the rest hold short selects and only
	 * need to fit their longest option (see buildColGroup in common.js — the
	 * width-less filler column at the end absorbs whatever is left).
	 */
	const STRUCTURE_COLUMN_WIDTHS = {
		name: 300,
		kind: 120,
		valueType: 130,
		sourceKind: 130,
		source: 190,
		actions: 118,
	};

	/**
	 * Flattens the structure tree into grid rows in document order, each with
	 * its nesting depth and its sibling list (which the move/remove actions
	 * operate on).
	 * @param {StructureNode[]} nodes
	 * @param {number} [depth]
	 * @returns {{node:StructureNode,depth:number,siblings:StructureNode[],index:number}[]}
	 */
	function flattenStructure(nodes, depth) {
		const level = depth || 0;
		const rows = [];
		nodes.forEach((node, index) => {
			rows.push({ node, depth: level, siblings: nodes, index });
			if (node.kind === 'object' || node.kind === 'array') {
				rows.push(...flattenStructure(node.children || [], level + 1));
			}
		});
		return rows;
	}

	/** @returns {StructureNode} A blank node (counterpart to createStructureNode in src/table/model.ts). */
	function createStructureNode(kind) {
		return { name: '', kind: kind || 'value', valueType: 'auto', sourceKind: 'column', source: '', children: [] };
	}

	/** Node kinds available for the current file type — attributes only exist in XML. */
	function structureKindOptions() {
		const kinds = [
			{ value: 'value', label: strings.schemaKindValue },
			{ value: 'object', label: strings.schemaKindObject },
			{ value: 'array', label: strings.schemaKindArray },
		];
		if (currentFormat() === 'xml') {
			kinds.push({ value: 'attribute', label: strings.schemaKindAttribute });
		}
		return kinds;
	}

	/** `true` for the node kinds that carry a mapped value (rather than children). */
	function isLeafKind(kind) {
		return kind === 'value' || kind === 'attribute';
	}

	function renderStructureTab() {
		const section = el('section', { className: 'tab-panel columns-section' });
		const options = structureOptions();

		const toolbar = el('div', { className: 'toolbar' });
		toolbar.appendChild(
			renderToolbarButton('add', strings.schemaAddNodeButton, () => {
				options.nodes.push(createStructureNode('value'));
				postEdit();
				render();
				focusLastStructureName();
			}),
		);
		toolbar.appendChild(
			renderToolbarButton('list-tree', strings.schemaFromColumnsButton, () => {
				options.nodes = structureFromColumns();
				postEdit();
				render();
			}),
		);
		if (options.nodes.length > 0) {
			toolbar.appendChild(
				renderToolbarButton('clear-all', strings.schemaClearButton, () => {
					options.nodes = [];
					postEdit();
					render();
				}),
			);
			toolbar.appendChild(renderDocumentPreviewButton());
		}
		section.appendChild(toolbar);
		section.appendChild(
			el('p', { className: 'hint', text: currentFormat() === 'xml' ? strings.schemaHintXml : strings.schemaHintJson }),
		);

		if (options.nodes.length === 0) {
			section.appendChild(
				renderStructureEmptyState('symbol-structure', strings.schemaEmptyText, strings.schemaEmptyAction, () => {
					options.nodes = structureFromColumns();
					postEdit();
					render();
				}),
			);
			return section;
		}

		const showValueType = currentFormat() === 'json';
		const wrap = el('div', { className: 'columns-table-wrap' });
		const table = el('table', { className: 'columns-table structure-table' });

		// Fixed widths rather than the columns grid's measure-then-freeze dance:
		// every cell here holds a short select or a name, so there is nothing to
		// measure — the width-less filler column at the end takes the rest
		// instead of stretching the selects across the whole panel.
		const order = showValueType
			? ['num', 'name', 'kind', 'valueType', 'sourceKind', 'source', 'actions']
			: ['num', 'name', 'kind', 'sourceKind', 'source', 'actions'];
		table.appendChild(buildColGroup(order, STRUCTURE_COLUMN_WIDTHS).colgroup);

		const thead = el('thead');
		const headRow = el('tr');
		headRow.appendChild(el('th', { className: 'col-num' }));
		headRow.appendChild(el('th', { className: 'col-node-name', text: strings.schemaColHeaderName }));
		headRow.appendChild(el('th', { className: 'col-kind', text: strings.schemaColHeaderKind }));
		if (showValueType) {
			// XML writes every leaf as text — a value type would have no effect
			// there, so the column only exists for JSON.
			headRow.appendChild(el('th', { className: 'col-kind', text: strings.schemaColHeaderType }));
		}
		headRow.appendChild(el('th', { className: 'col-source-kind', text: strings.mappingColHeaderSourceKind }));
		headRow.appendChild(el('th', { className: 'col-source', text: strings.mappingColHeaderSource }));
		headRow.appendChild(el('th', { className: 'col-actions col-actions-wide' }));
		headRow.appendChild(el('th', { className: 'col-spacer' }));
		thead.appendChild(headRow);
		table.appendChild(thead);

		const tbody = el('tbody');
		flattenStructure(options.nodes).forEach((row, position) => {
			tbody.appendChild(renderStructureRow(row, position, showValueType));
		});
		table.appendChild(tbody);

		wrap.appendChild(table);
		section.appendChild(wrap);
		return section;
	}

	/**
	 * One row of the structure grid: name, kind and (for JSON) value type
	 * describe the shape; "filled from" and the value below it are the mapping
	 * and only apply to the leaves.
	 * @param {{node:StructureNode,depth:number,siblings:StructureNode[],index:number}} entry
	 * @param {number} position Running number across the whole (flattened) tree.
	 * @param {boolean} showValueType
	 */
	function renderStructureRow(entry, position, showValueType) {
		const { node, depth, siblings, index } = entry;
		const row = el('tr');
		row.appendChild(el('td', { className: 'col-num', text: String(position + 1) }));

		// --- Name (indented by nesting depth) ---
		const nameTd = el('td');
		const nameWrap = el('div', { className: 'structure-name' });
		nameWrap.style.paddingLeft = `${depth * STRUCTURE_INDENT}px`;
		nameWrap.appendChild(el('i', { className: `codicon codicon-${structureIcon(node.kind)} structure-icon` }));
		const nameInput = /** @type {HTMLInputElement} */ (el('input', { className: 'text-input cell-input' }));
		nameInput.type = 'text';
		nameInput.placeholder = strings.schemaNamePlaceholder;
		nameInput.value = node.name || '';
		nameInput.setAttribute('data-role', 'structure-name');
		const refreshNameError = () => updateFieldError(nameInput, strings.schemaNameRequiredError, !nameInput.value.trim());
		bindText(
			nameInput,
			(v) => {
				node.name = v;
				refreshNameError();
			},
			postEditDebounced,
			postEdit,
		);
		refreshNameError();
		nameWrap.appendChild(nameInput);
		nameTd.appendChild(nameWrap);
		row.appendChild(nameTd);

		// --- Kind ---
		const kindTd = el('td', { className: 'col-kind' });
		const kindSelect = /** @type {HTMLSelectElement} */ (el('select', { className: 'text-input cell-input' }));
		const kinds = structureKindOptions();
		if (!kinds.some((k) => k.value === node.kind)) {
			// A kind that this file type does not offer (only reachable from
			// hand-edited TOML) still has to be displayed rather than silently
			// showing the first option instead.
			kinds.unshift({ value: node.kind, label: node.kind + strings.generatorNotFoundSuffix });
		}
		for (const kind of kinds) {
			const option = /** @type {HTMLOptionElement} */ (el('option', { text: kind.label }));
			option.value = kind.value;
			kindSelect.appendChild(option);
		}
		kindSelect.value = node.kind;
		kindSelect.addEventListener('change', () => {
			node.kind = /** @type {StructureNode['kind']} */ (kindSelect.value);
			if (isLeafKind(node.kind)) {
				// A leaf carries a mapping instead of children — drop them
				// rather than keeping an invisible subtree around.
				node.children = [];
			}
			postEdit();
			render();
		});
		kindTd.appendChild(wrapSelectWithChevron(kindSelect));
		row.appendChild(kindTd);

		// --- Value type (JSON only, leaves only) ---
		if (showValueType) {
			const typeTd = el('td', { className: 'col-kind' });
			if (isLeafKind(node.kind)) {
				const typeSelect = /** @type {HTMLSelectElement} */ (el('select', { className: 'text-input cell-input' }));
				for (const type of [
					{ value: 'auto', label: strings.schemaValueTypeAuto },
					{ value: 'string', label: strings.schemaValueTypeString },
					{ value: 'number', label: strings.schemaValueTypeNumber },
					{ value: 'integer', label: strings.schemaValueTypeInteger },
					{ value: 'boolean', label: strings.schemaValueTypeBoolean },
				]) {
					const option = /** @type {HTMLOptionElement} */ (el('option', { text: type.label }));
					option.value = type.value;
					typeSelect.appendChild(option);
				}
				typeSelect.value = node.valueType || 'auto';
				typeSelect.addEventListener('change', () => {
					node.valueType = typeSelect.value;
					postEdit();
				});
				typeTd.appendChild(wrapSelectWithChevron(typeSelect));
			}
			row.appendChild(typeTd);
		}

		// --- Mapping: where the value comes from, and the value itself ---
		const sourceKindTd = el('td', { className: 'col-source-kind' });
		const sourceTd = el('td', { className: 'col-source' });
		if (isLeafKind(node.kind)) {
			const sourceKindSelect = /** @type {HTMLSelectElement} */ (el('select', { className: 'text-input cell-input' }));
			for (const kind of [
				{ value: 'column', label: strings.mappingSourceKindColumn },
				{ value: 'constant', label: strings.mappingSourceKindConstant },
			]) {
				const option = /** @type {HTMLOptionElement} */ (el('option', { text: kind.label }));
				option.value = kind.value;
				sourceKindSelect.appendChild(option);
			}
			sourceKindSelect.value = node.sourceKind === 'constant' ? 'constant' : 'column';
			sourceKindTd.appendChild(wrapSelectWithChevron(sourceKindSelect));

			const rebuildSource = () => {
				sourceTd.innerHTML = '';
				sourceTd.appendChild(node.sourceKind === 'constant' ? buildConstantInput(node) : buildColumnSelect(node));
			};
			sourceKindSelect.addEventListener('change', () => {
				node.sourceKind = /** @type {StructureNode['sourceKind']} */ (sourceKindSelect.value);
				// The two source kinds mean completely different things —
				// keeping the old text as a column name (or vice versa) would
				// only produce a confusing "not found".
				node.source = '';
				postEdit();
				rebuildSource();
			});
			rebuildSource();
		}
		row.appendChild(sourceKindTd);
		row.appendChild(sourceTd);

		// --- Actions ---
		const actionsTd = el('td', { className: 'col-actions col-actions-wide' });
		const actions = el('div', { className: 'row-actions' });
		actions.appendChild(
			renderRowActionButton('add', strings.schemaAddChildLabel, () => {
				node.children = (node.children || []).concat([createStructureNode('value')]);
				postEdit();
				render();
				focusLastStructureName();
			}, { disabled: isLeafKind(node.kind) }),
		);
		actions.appendChild(
			renderRowActionButton('chevron-up', strings.schemaMoveNodeUpLabel, () => moveStructureNode(siblings, index, -1), {
				disabled: index === 0,
			}),
		);
		actions.appendChild(
			renderRowActionButton('chevron-down', strings.schemaMoveNodeDownLabel, () => moveStructureNode(siblings, index, 1), {
				disabled: index === siblings.length - 1,
			}),
		);
		actions.appendChild(
			renderRowActionButton('trash', strings.schemaRemoveNodeLabel, () => {
				siblings.splice(index, 1);
				postEdit();
				render();
			}, { danger: true }),
		);
		actionsTd.appendChild(actions);
		row.appendChild(actionsTd);
		row.appendChild(el('td', { className: 'col-spacer' }));
		return row;
	}

	/**
	 * Icon of a node kind: the literal notation for each concept, so the tree
	 * reads at a glance — braces for an object, brackets for an array, the `@`
	 * that marks an attribute in XPath, and quotes for a text value.
	 */
	function structureIcon(kind) {
		switch (kind) {
			case 'object':
				return 'symbol-namespace';
			case 'array':
				return 'symbol-array';
			case 'attribute':
				return 'mention';
			default:
				return 'symbol-string';
		}
	}

	/** Moves a node one position up (-1) or down (+1) among its siblings. */
	function moveStructureNode(siblings, index, delta) {
		const target = index + delta;
		if (target < 0 || target >= siblings.length) {
			return;
		}
		const [node] = siblings.splice(index, 1);
		siblings.splice(target, 0, node);
		postEdit();
		render();
	}

	/** Flat structure with one mapped leaf per written column (see structureFromColumns in src/table/model.ts). */
	function structureFromColumns() {
		return state.columns
			.filter((column) => !column.hidden && (column.name || '').trim() !== '')
			.map((column) => ({
				name: column.name.trim(),
				kind: /** @type {StructureNode['kind']} */ ('value'),
				valueType: 'auto',
				sourceKind: /** @type {StructureNode['sourceKind']} */ ('column'),
				source: column.name.trim(),
				children: [],
			}));
	}

	/** Focuses the name field of the row just added, so it can be typed straight away. */
	function focusLastStructureName() {
		const inputs = app.querySelectorAll('input[data-role="structure-name"]');
		const last = inputs[inputs.length - 1];
		if (last instanceof HTMLInputElement) {
			last.focus();
		}
	}

	/** Toolbar button with a codicon (structure toolbar). */
	function renderToolbarButton(icon, label, onClick) {
		const btn = /** @type {HTMLButtonElement} */ (el('button', { className: 'toolbar-btn' }));
		btn.type = 'button';
		btn.appendChild(el('i', { className: `codicon codicon-${icon}` }));
		btn.appendChild(document.createTextNode(label));
		btn.addEventListener('click', onClick);
		return btn;
	}

	/** Empty state of the structure tab (same layout as the columns tab's). */
	function renderStructureEmptyState(icon, text, actionLabel, onAction) {
		const empty = el('div', { className: 'empty-state' });
		empty.appendChild(el('i', { className: `codicon codicon-${icon}` }));
		empty.appendChild(el('p', { text }));
		const link = el('button', { className: 'link-button', text: actionLabel });
		link.type = 'button';
		link.addEventListener('click', onAction);
		empty.appendChild(link);
		return empty;
	}

	/**
	 * Column picker of a leaf. Deliberately offers hidden columns too:
	 * `hidden` keeps a column out of the *default* structure, but an explicitly
	 * mapped one is written — the mapping is the deliberate choice.
	 * @param {StructureNode} node
	 */
	function buildColumnSelect(node) {
		const select = /** @type {HTMLSelectElement} */ (el('select', { className: 'text-input cell-input' }));
		const columnNames = state.columns.map((c) => (c.name || '').trim()).filter((name) => name !== '');
		populateSelectOptions(
			select,
			columnNames,
			(node.source || '').trim(),
			strings.mappingColumnEmptyOption,
			strings.mappingColumnNotFoundSuffix,
		);
		const refreshError = () => {
			const value = select.value.trim();
			const notFound = !!value && !columnNames.includes(value);
			updateFieldError(
				select,
				value ? strings.mappingColumnNotFoundError : strings.mappingColumnRequiredError,
				!value || notFound,
			);
		};
		select.addEventListener('change', () => {
			node.source = select.value;
			postEdit();
			refreshError();
		});
		refreshError();
		return wrapSelectWithChevron(select);
	}

	// ---------------------------------------------------------------------
	// "Record layout" tab: the fixed-length field list. The fields sit next to
	// each other without a separator, so their order and widths alone decide
	// where a value starts and ends — which is why the grid also shows each
	// field's start offset and the resulting record length.
	// ---------------------------------------------------------------------

	/** Fixed column widths (px) of the layout grid — see STRUCTURE_COLUMN_WIDTHS. */
	const FIXED_COLUMN_WIDTHS = { column: 260, start: 80, width: 110, align: 130, pad: 140, actions: 118 };

	/** @returns {FixedField} A blank field (counterpart to createFixedField in src/table/model.ts). */
	function createFixedField(column) {
		return { column: column || '', width: FIXED_DEFAULT_WIDTH, align: 'left', pad: ' ' };
	}

	/** Layout with one field per written column (see fixedFieldsFromColumns in src/table/model.ts). */
	function fixedFieldsFromColumns() {
		return state.columns
			.filter((column) => !column.hidden && (column.name || '').trim() !== '')
			.map((column) => createFixedField(column.name.trim()));
	}

	/** Total record length in characters. */
	function fixedRecordLength(fields) {
		return fields.reduce((total, field) => total + Math.max(0, Math.trunc(field.width) || 0), 0);
	}

	function renderFixedLayoutTab() {
		const section = el('section', { className: 'tab-panel columns-section' });
		const fixed = state.output.fixed;

		const toolbar = el('div', { className: 'toolbar' });
		toolbar.appendChild(
			renderToolbarButton('add', strings.fixedAddFieldButton, () => {
				fixed.fields.push(createFixedField(''));
				postEdit();
				render();
				const inputs = app.querySelectorAll('select[data-role="fixed-column"]');
				const last = inputs[inputs.length - 1];
				if (last instanceof HTMLSelectElement) {
					last.focus();
				}
			}),
		);
		toolbar.appendChild(
			renderToolbarButton('list-tree', strings.fixedFromColumnsButton, () => {
				fixed.fields = fixedFieldsFromColumns();
				postEdit();
				render();
			}),
		);
		if (fixed.fields.length > 0) {
			toolbar.appendChild(
				renderToolbarButton('clear-all', strings.fixedClearButton, () => {
					fixed.fields = [];
					postEdit();
					render();
				}),
			);
			toolbar.appendChild(renderDocumentPreviewButton());
		}
		section.appendChild(toolbar);
		section.appendChild(el('p', { className: 'hint', text: strings.fixedLayoutHint }));

		if (fixed.fields.length === 0) {
			section.appendChild(
				renderStructureEmptyState('symbol-ruler', strings.fixedEmptyText, strings.fixedEmptyAction, () => {
					fixed.fields = fixedFieldsFromColumns();
					postEdit();
					render();
				}),
			);
			return section;
		}

		const wrap = el('div', { className: 'columns-table-wrap' });
		const table = el('table', { className: 'columns-table structure-table' });
		table.appendChild(
			buildColGroup(['num', 'column', 'start', 'width', 'align', 'pad', 'actions'], FIXED_COLUMN_WIDTHS).colgroup,
		);

		const thead = el('thead');
		const headRow = el('tr');
		headRow.appendChild(el('th', { className: 'col-num' }));
		headRow.appendChild(el('th', { text: strings.fixedColHeaderColumn }));
		headRow.appendChild(el('th', { className: 'col-num-value', text: strings.fixedColHeaderStart }));
		headRow.appendChild(el('th', { text: strings.fixedColHeaderWidth }));
		headRow.appendChild(el('th', { text: strings.fixedColHeaderAlign }));
		headRow.appendChild(el('th', { text: strings.fixedColHeaderPad }));
		headRow.appendChild(el('th', { className: 'col-actions col-actions-wide' }));
		headRow.appendChild(el('th', { className: 'col-spacer' }));
		thead.appendChild(headRow);
		table.appendChild(thead);

		const tbody = el('tbody');
		let offset = 0;
		fixed.fields.forEach((field, index) => {
			tbody.appendChild(renderFixedFieldRow(field, index, offset));
			offset += Math.max(0, Math.trunc(field.width) || 0);
		});
		table.appendChild(tbody);

		wrap.appendChild(table);
		section.appendChild(wrap);
		section.appendChild(
			el('p', {
				className: 'hint record-length',
				text: strings.fixedRecordLengthLabel.replace('{0}', String(fixedRecordLength(fixed.fields))),
			}),
		);
		return section;
	}

	/**
	 * One row of the layout grid.
	 * @param {FixedField} field
	 * @param {number} index
	 * @param {number} offset 0-based start position of this field in the line.
	 */
	function renderFixedFieldRow(field, index, offset) {
		const fields = state.output.fixed.fields;
		const row = el('tr');
		row.appendChild(el('td', { className: 'col-num', text: String(index + 1) }));

		// --- Column ---
		const columnTd = el('td');
		const columnSelect = /** @type {HTMLSelectElement} */ (el('select', { className: 'text-input cell-input' }));
		columnSelect.setAttribute('data-role', 'fixed-column');
		const columnNames = state.columns.map((c) => (c.name || '').trim()).filter((name) => name !== '');
		populateSelectOptions(
			columnSelect,
			columnNames,
			(field.column || '').trim(),
			strings.mappingColumnEmptyOption,
			strings.mappingColumnNotFoundSuffix,
		);
		const refreshColumnError = () => {
			const value = columnSelect.value.trim();
			const notFound = !!value && !columnNames.includes(value);
			updateFieldError(
				columnSelect,
				value ? strings.mappingColumnNotFoundError : strings.mappingColumnRequiredError,
				!value || notFound,
			);
		};
		columnSelect.addEventListener('change', () => {
			field.column = columnSelect.value;
			postEdit();
			refreshColumnError();
		});
		refreshColumnError();
		columnTd.appendChild(wrapSelectWithChevron(columnSelect));
		row.appendChild(columnTd);

		// --- Start offset (derived from the widths before this field) ---
		// 1-based, because that is how fixed-length layouts are always
		// documented ("positions 1-10").
		row.appendChild(el('td', { className: 'col-num-value', text: String(offset + 1) }));

		// --- Width ---
		const widthTd = el('td');
		const widthInput = /** @type {HTMLInputElement} */ (el('input', { className: 'text-input cell-input' }));
		widthInput.type = 'text';
		widthInput.inputMode = 'numeric';
		widthInput.value = String(field.width);
		const refreshWidthError = () =>
			updateFieldError(widthInput, strings.fixedWidthInvalidError, !(Number(widthInput.value) > 0));
		bindText(
			widthInput,
			(v) => {
				// Keep whatever was typed as a number; the validation marks a
				// zero or unparseable width rather than silently correcting it.
				field.width = Math.max(0, Math.trunc(Number(v)) || 0);
				refreshWidthError();
			},
			// A width change moves every following field, so the whole grid is
			// rebuilt on commit rather than only this row.
			postEditDebounced,
			() => {
				postEdit();
				render();
			},
		);
		refreshWidthError();
		widthTd.appendChild(widthInput);
		row.appendChild(widthTd);

		// --- Alignment ---
		const alignTd = el('td');
		const alignSelect = /** @type {HTMLSelectElement} */ (el('select', { className: 'text-input cell-input' }));
		for (const option of [
			{ value: 'left', label: strings.fixedAlignLeft },
			{ value: 'right', label: strings.fixedAlignRight },
		]) {
			const opt = /** @type {HTMLOptionElement} */ (el('option', { text: option.label }));
			opt.value = option.value;
			alignSelect.appendChild(opt);
		}
		alignSelect.value = field.align === 'right' ? 'right' : 'left';
		alignSelect.addEventListener('change', () => {
			field.align = /** @type {FixedField['align']} */ (alignSelect.value);
			postEdit();
		});
		alignTd.appendChild(wrapSelectWithChevron(alignSelect));
		row.appendChild(alignTd);

		// --- Padding character ---
		const padTd = el('td');
		const padSelect = /** @type {HTMLSelectElement} */ (el('select', { className: 'text-input cell-input' }));
		const padOptions = [
			{ value: ' ', label: strings.fixedPadSpace },
			{ value: '0', label: strings.fixedPadZero },
		];
		// A character hand-written into the TOML that is not on offer here is
		// still shown, instead of being silently replaced.
		if (field.pad && !padOptions.some((o) => o.value === field.pad)) {
			padOptions.push({ value: field.pad, label: field.pad });
		}
		for (const option of padOptions) {
			const opt = /** @type {HTMLOptionElement} */ (el('option', { text: option.label }));
			opt.value = option.value;
			padSelect.appendChild(opt);
		}
		padSelect.value = field.pad || ' ';
		padSelect.addEventListener('change', () => {
			field.pad = padSelect.value;
			postEdit();
		});
		padTd.appendChild(wrapSelectWithChevron(padSelect));
		row.appendChild(padTd);

		// --- Actions ---
		const actionsTd = el('td', { className: 'col-actions col-actions-wide' });
		const actions = el('div', { className: 'row-actions' });
		actions.appendChild(
			renderRowActionButton('chevron-up', strings.fixedMoveFieldUpLabel, () => moveFixedField(index, -1), {
				disabled: index === 0,
			}),
		);
		actions.appendChild(
			renderRowActionButton('chevron-down', strings.fixedMoveFieldDownLabel, () => moveFixedField(index, 1), {
				disabled: index === fields.length - 1,
			}),
		);
		actions.appendChild(
			renderRowActionButton('trash', strings.fixedRemoveFieldLabel, () => {
				fields.splice(index, 1);
				postEdit();
				render();
			}, { danger: true }),
		);
		actionsTd.appendChild(actions);
		row.appendChild(actionsTd);
		row.appendChild(el('td', { className: 'col-spacer' }));
		return row;
	}

	/** Moves a field one position up (-1) or down (+1) — this shifts every offset behind it. */
	function moveFixedField(index, delta) {
		const fields = state.output.fixed.fields;
		const target = index + delta;
		if (target < 0 || target >= fields.length) {
			return;
		}
		const [field] = fields.splice(index, 1);
		fields.splice(target, 0, field);
		postEdit();
		render();
	}

	/** Fixed-text input of a leaf. @param {StructureNode} node */
	function buildConstantInput(node) {
		const input = /** @type {HTMLInputElement} */ (el('input', { className: 'text-input cell-input' }));
		input.type = 'text';
		input.placeholder = strings.mappingConstantPlaceholder;
		input.value = node.source || '';
		bindText(
			input,
			(v) => {
				node.source = v;
			},
			postEditDebounced,
			postEdit,
		);
		return input;
	}

	// ---------------------------------------------------------------------
	// Generators: display text + warning checks (a small counterpart to
	// GeneratorBase.displayString/validate in src/generator/base.ts — the
	// webview works without module bundling, hence the duplication)
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
		// FK columns simply show the generator name ("Foreign Key") — which
		// table/column is referenced is already stated in the FK columns next to
		// it. This also applies without a stored generator (older files): the
		// foreign key generator then applies implicitly.
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
			// The template itself contains {column} placeholders — show it raw
			// instead of wrongly filling them as parameter placeholders.
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
	 * What a `column` parameter refers to: the value of the nearest preceding
	 * `table`/`lookup` parameter (see boundReferenceValue in
	 * src/generator/base.ts).
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
	 * First warning about a column's generator configuration, or null — the same
	 * rules produce the Problems view diagnostics in the extension host (see
	 * validateTable in src/table/validation.ts).
	 * @param {Column} column
	 */
	function generatorWarning(column) {
		const config = column.generator;
		if (!config || !config.id) {
			// Every column is expected to have a generator selected and
			// configured — the same rule produces the warning in the Problems
			// view. FK columns are exempt: they implicitly always use the
			// foreign key generator.
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
			// No longer reachable through the UI (the picker is locked) — this
			// can only come from hand-edited TOML.
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
					// A column of the own table: must exist and must not be the
					// generated column itself.
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
		// Numeric range min > max (Random Int/Float) — a small extra check
		// matching the builtins.
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
	// "Columns" tab: toolbar + grid
	// ---------------------------------------------------------------------

	/** Fixed column order of the grid, for buildColGroup (see common.js). */
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

		// Up to this point table-layout stays "auto" (see CSS) so that columns
		// without a manually set width can still settle on a content-based
		// width. Only once the table is really in the DOM (in the real layout,
		// not in this still-detached tree) can the width actually needed be
		// measured. Afterwards it switches to table-layout: fixed — only then
		// does a manually set <col> width reliably take effect (under "auto" a
		// specified <col> width is merely a hint that form fields in the cells,
		// for example, can override).
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

		// The referenced table/column controls are built here already (but only
		// attached to the row further below), so the FK checkbox handler can
		// enable/disable them directly instead of re-rendering the whole row.
		const refTableTd = el('td', { className: 'col-ref-table' });
		const tableSelect = /** @type {HTMLSelectElement} */ (el('select', { className: 'text-input cell-input' }));
		populateTableOptions(tableSelect, column.fkTable);
		tableSelect.disabled = !column.fk;
		// Mirrors the check in src/table/validation.ts: empty -> "select a
		// table", equals the own table -> "self-reference", set but no longer
		// present in tableOptions (e.g. the file was deleted or renamed) -> "not
		// found". The same message additionally lands as a diagnostic in the
		// Problems view.
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

		// Which columns are on offer depends on the referenced table selected.
		const refColumnTd = el('td', { className: 'col-ref-column' });
		const columnSelect = /** @type {HTMLSelectElement} */ (el('select', { className: 'text-input cell-input' }));
		populateColumnOptions(columnSelect, column.fkTable, column.fkColumn);
		columnSelect.disabled = !column.fk;
		const refreshColumnError = () => {
			const value = columnSelect.value.trim();
			const table = tableOptions.find((t) => t.label === column.fkTable.trim());
			// Only checked when the referenced table itself was found —
			// otherwise this would merely follow from the table error above.
			const notFound = !!value && !!table && !table.columns.includes(value);
			updateFieldError(
				columnSelect,
				value ? strings.fkColumnNotFoundError : strings.fkColumnRequiredError,
				column.fk && (!value || notFound),
			);
		};
		refColumnTd.appendChild(wrapSelectWithChevron(columnSelect));
		refreshColumnError();

		// Build the generator cell here already, so FK toggles and reference
		// changes can refresh its display directly.
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
			// Adapt the column list to the newly selected table; a previous value
			// is preserved (possibly shown as "not found") instead of being
			// discarded automatically.
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
				// Ticking FK automatically (and permanently) assigns the foreign
				// key generator — the generator picker is locked for FK columns;
				// unticking removes it again.
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

		// Empty filler cell matching the filler column in the header (see
		// renderColGroup): it absorbs the remaining space instead of stretching
		// the content columns.
		row.appendChild(el('td', { className: 'col-spacer' }));

		return row;
	}

	// ---------------------------------------------------------------------
	// Generator-Zelle: Auswahl + Stift (Parameter-Dialog) + Warnungs-Anzeige
	// ---------------------------------------------------------------------

	/**
	 * Builds a column's generator cell: a select over all applicable generators
	 * (the selected option shows the configuration's display text rather than
	 * just the name) plus a pencil button that opens the parameter dialog. On
	 * warnings (see generatorWarning) the cell is marked; the full message lives
	 * in the Problems view and as a tooltip on the cell.
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

		/** Rebuilds the select to match the column's current FK state. */
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

			// Still display a generator that is set but no longer available (e.g.
			// its .tdgen was deleted or renamed) instead of discarding it. FK
			// columns without a stored generator show the (implicitly applied)
			// foreign key generator rather than "— none —".
			const currentId = column.generator ? column.generator.id : column.fk ? 'foreign-key' : '';
			if (currentId && !available.some((o) => o.id === currentId)) {
				const opt = /** @type {HTMLOptionElement} */ (
					el('option', { text: currentId + strings.generatorNotFoundSuffix })
				);
				opt.value = currentId;
				select.appendChild(opt);
			}
			select.value = currentId;
			// FK columns always use the foreign key generator (assigned
			// automatically via the FK checkbox) — the picker is locked.
			select.disabled = column.fk;
		}

		/** Refreshes the display text, the pencil state and the warning marker. */
		function refresh() {
			// FK columns without a stored generator implicitly use the foreign
			// key generator (see rebuildSelect).
			const effectiveId = column.generator ? column.generator.id : column.fk ? 'foreign-key' : '';
			const option = effectiveId ? findGeneratorOption(effectiveId) : null;
			// The selected option shows the configuration's display text
			// (displayString) rather than just the generator name.
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

	/** Tears down an open parameter dialog (at most one at a time); `true` keeps the changes, otherwise they are discarded. @type {((keepChanges?: boolean) => void) | null} */
	let closeParamDialog = null;
	/**
	 * Closes the dialog without writing anything back — for the case where the
	 * document was replaced externally (e.g. undo/git): the dialog would then be
	 * editing a stale column state, and further input would go nowhere.
	 * @type {(() => void) | null}
	 */
	let abandonParamDialog = null;

	/** Closes the dialog like "Cancel" (discarding the changes). */
	function dismissParamDialog() {
		if (closeParamDialog) {
			closeParamDialog(false);
		}
	}

	/**
	 * A generator's parameter dialog (a VS-Code-style modal inside the
	 * webview): one input per parameter matching its data type — a picker for
	 * predefined value lists and reference types (table/lookup/column),
	 * date/time fields, number fields, otherwise free input. Values are written
	 * straight into the column configuration; **Done** keeps them, **Cancel**
	 * (including X/Escape/clicking outside) restores the state at opening time.
	 * @param {Column} column
	 * @param {GeneratorOption} option
	 * @param {() => void} onChanged Refreshes the generator cell (display text + warning).
	 */
	function openParamDialog(column, option, onChanged) {
		dismissParamDialog();
		if (!column.generator) {
			return;
		}
		const params = column.generator.params;
		// State at opening time, to restore it on cancel.
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

		/** Refill callbacks of the `column` parameter selects, invoked when their bound parameter changes. @type {(() => void)[]} */
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
					// Columns of the own table — excluding the column being
					// configured; their values apply to the same records.
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

		// Footer: Done keeps the values, Cancel restores the state at opening
		// time (X/Escape/clicking outside act as Cancel).
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
				// Cancel: discard every change made in this dialog.
				for (const key of Object.keys(params)) {
					delete params[key];
				}
				Object.assign(params, originalParams);
			}
			postEdit();
			onChanged();
			// Perform a re-render that was deferred while the dialog was open.
			deferredRender.flushIfIdle();
		};

		// Focus the first input so the dialog can be filled in from the keyboard
		// right away.
		const firstControl = dialog.querySelector('input, select');
		if (firstControl instanceof HTMLElement) {
			firstControl.focus();
		}
	}

	/**
	 * Checkbox for PK/FK.
	 * @param {Column} column
	 * @param {'pk'|'fk'} key
	 * @param {string} label
	 * @param {() => void} [onToggle] Additionally invoked when FK is toggled (to enable/disable the reference columns).
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
	 * Fills the "referenced table" select with the workspace's tables. The own
	 * table stays visible (e.g. if it was hand-written into the TOML as
	 * `fk_table` — the error display in refreshTableError then kicks in) but
	 * cannot be selected anew through the select.
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
	 * Fills the "referenced column" select with the columns of the currently
	 * selected referenced table (empty while no table, or an unknown one, is
	 * selected).
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
	// Preview: has the extension host (the Python runner) generate 20 records
	// with the current configuration — including every column, even those
	// hidden via the eye toggle — and shows them in a table inside a dialog.
	// ---------------------------------------------------------------------

	/** `true` while a preview generation is running (the button then shows a spinner). */
	let previewRunning = false;
	/** @type {HTMLButtonElement | null} Preview button of the current render, used to toggle the spinner. */
	let previewButton = null;

	/** Value grid preview (columns tab). */
	function renderPreviewButton() {
		return buildPreviewButton(strings.previewButton, 'grid');
	}

	/** Document preview (mapping tab): shows the rendered JSON/XML instead of a value grid. */
	function renderDocumentPreviewButton() {
		return buildPreviewButton(strings.previewDocumentButton, 'document');
	}

	/**
	 * Both preview buttons run the same generation — only the dialog showing
	 * the result differs (see the `mode` round trip in table/editorProvider.ts).
	 * @param {string} label
	 * @param {'grid'|'document'} mode
	 */
	function buildPreviewButton(label, mode) {
		const btn = /** @type {HTMLButtonElement} */ (el('button', { className: 'toolbar-btn' }));
		btn.type = 'button';
		btn.appendChild(el('i', { className: 'codicon codicon-play' }));
		btn.appendChild(document.createTextNode(label));
		btn.addEventListener('click', () => {
			if (previewRunning) {
				return;
			}
			previewRunning = true;
			refreshPreviewButton();
			vscode.postMessage({ type: 'preview', mode });
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
		const { body } = openPreviewShell('table', strings.previewDialogTitle.replace('{0}', String(rows.length)));

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
		body.appendChild(wrap);
	}

	/**
	 * Shows the JSON/XML document preview: the generated records rendered
	 * exactly as the run would write them (see render_json/render_xml in
	 * python/generate.py), so the target structure and its mapping can be
	 * checked without a full run.
	 * @param {string} text
	 * @param {number} recordCount
	 */
	function showDocumentPreviewDialog(text, recordCount) {
		const { dialog, body, close } = openPreviewShell(
			'file-code',
			strings.previewDocumentDialogTitle
				.replace('{0}', currentFormat().toUpperCase())
				.replace('{1}', String(recordCount)),
		);

		const pre = el('pre', { className: 'document-preview', text });
		body.appendChild(pre);

		// The webview has no VS Code editor to open the result in — a copy
		// button is the practical way to get it out (e.g. into a scratch file).
		const footer = el('div', { className: 'param-dialog-footer' });
		const copyBtn = el('button', { className: 'toolbar-btn', text: strings.previewCopyLabel });
		copyBtn.type = 'button';
		copyBtn.addEventListener('click', () => {
			void navigator.clipboard.writeText(text).then(() => {
				copyBtn.textContent = strings.previewCopiedLabel;
				window.setTimeout(() => {
					copyBtn.textContent = strings.previewCopyLabel;
				}, 1500);
			});
		});
		const closeBtn = el('button', { className: 'button-primary', text: strings.previewCloseLabel });
		closeBtn.type = 'button';
		closeBtn.addEventListener('click', close);
		footer.appendChild(copyBtn);
		footer.appendChild(closeBtn);
		dialog.appendChild(footer);
	}

	/**
	 * Modal shell shared by the preview dialogs (title row with a close button,
	 * Escape/click-outside handling) — returns the dialog, the content area to
	 * fill and the close function.
	 * @param {string} icon
	 * @param {string} title
	 */
	function openPreviewShell(icon, title) {
		if (closePreviewDialog) {
			closePreviewDialog();
		}

		const overlay = el('div', { className: 'dialog-overlay' });
		const dialog = el('div', { className: 'param-dialog preview-dialog card' });
		dialog.setAttribute('role', 'dialog');

		const titleRow = el('div', { className: 'param-dialog-title' });
		const heading = el('h3');
		heading.appendChild(el('i', { className: `codicon codicon-${icon} param-dialog-icon` }));
		heading.appendChild(document.createTextNode(title));
		titleRow.appendChild(heading);
		const closeIcon = el('button', { className: 'icon-button param-dialog-close' });
		closeIcon.type = 'button';
		closeIcon.title = strings.previewCloseLabel;
		closeIcon.setAttribute('aria-label', strings.previewCloseLabel);
		closeIcon.appendChild(el('i', { className: 'codicon codicon-close' }));
		closeIcon.addEventListener('click', () => closePreviewDialog && closePreviewDialog());
		titleRow.appendChild(closeIcon);
		dialog.appendChild(titleRow);

		const body = el('div', { className: 'preview-body' });
		dialog.appendChild(body);

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
		return { dialog, body, close: () => closePreviewDialog && closePreviewDialog() };
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
			hidden: false,
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
	 * Button of the actions column (move/remove) — the eye toggle has its own
	 * builder (renderHideToggle), since its icon changes.
	 * @param {string} icon codicon name without the prefix, e.g. "chevron-up"
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
	 * Eye toggle "hide column from the output" (the icon changes and the row is
	 * dimmed): the column is still generated but not written to the output file
	 * — the state is stored as `hidden` in the .td file (see the Column
	 * typedef).
	 * @param {Column} column
	 * @param {HTMLElement} row
	 */
	function renderHideToggle(column, row) {
		const btn = /** @type {HTMLButtonElement} */ (el('button', { className: 'icon-button' }));
		btn.type = 'button';
		const icon = el('i');
		btn.appendChild(icon);
		const refresh = () => {
			icon.className = `codicon ${column.hidden ? 'codicon-eye-closed' : 'codicon-eye'}`;
			const label = column.hidden ? strings.unhideColumnLabel : strings.hideColumnLabel;
			btn.title = label;
			btn.setAttribute('aria-label', label);
			row.classList.toggle('column-hidden', !!column.hidden);
		};
		btn.addEventListener('click', () => {
			column.hidden = !column.hidden;
			postEdit();
			refresh();
		});
		refresh();
		return btn;
	}

	/**
	 * Moves a column one position up (-1) or down (+1) and restores focus to the
	 * same button of the moved row, so a column can be moved further with
	 * repeated clicks or Enter presses.
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
					normalizeState();
				}
				render();
				break;
			case 'update':
				// External document change (undo, git, text editor): an open
				// parameter dialog would then be editing a stale state -> close
				// it without writing anything back.
				if (abandonParamDialog) {
					abandonParamDialog();
				}
				parseError = null;
				state = message.table;
				normalizeState();
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
				// Updated picker lists (tables/generators/lookup lists) after file
				// changes in the workspace. Unchanged -> do nothing at all;
				// changed -> re-render, but only once no input has focus (see
				// renderSoon).
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
			case 'previewResult': {
				previewRunning = false;
				refreshPreviewButton();
				const rows = Array.isArray(message.rows) ? message.rows : [];
				if (message.mode === 'document' && typeof message.text === 'string') {
					showDocumentPreviewDialog(message.text, rows.length);
				} else {
					showPreviewDialog(Array.isArray(message.columns) ? message.columns : [], rows);
				}
				break;
			}
			case 'previewDone':
				// Run finished without a result (the extension host already showed
				// the error as a notification) — just reset the button.
				previewRunning = false;
				refreshPreviewButton();
				break;
		}
	});

	vscode.postMessage({ type: 'ready' });
})();
