// @ts-check
// Webview-Skript für den Table Editor. Bewusst als eigenständiges,
// unkompiliertes Skript gehalten (kein Bundling nötig, keine Abhängigkeiten).
//
// UI-Anleihen an Oracle SQL Developer for VS Code: Tabs (hier: "Übersicht" /
// "Spalten" statt dessen Columns/Data/Constraints/…), ein schlankes
// Bordered-Toolbar über dem Grid, ein Grid mit Zeilennummern-Spalte sowie
// PK-/FK-Checkbox-Spalten und eigenen Spalten für referenzierte Tabelle
// und Kardinalität (nur aktiv, wenn FK angehakt ist).
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
		autoGrowCellTextarea,
		renderMarkdownField,
		updateFieldError,
		wrapSelectWithChevron,
		populateSelectOptions,
		buildColGroup,
		attachColumnResizeHandle,
		fixColumnWidths,
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

	/**
	 * `uiHidden` ist ein rein visueller Merkzustand des Auge-Umschalters in der
	 * Aktionsspalte (Zeile gedimmt) — bewusst ohne jede weitere Funktion, wird
	 * nicht in die .td-Datei geschrieben (serializeTable im Extension-Host kennt
	 * das Feld nicht) und geht bei externen Änderungen am Dokument verloren.
	 * @typedef {{name:string,type:string,pk:boolean,fk:boolean,fkTable:string,fkColumn:string,description:string,uiHidden?:boolean}} Column
	 */
	/** @typedef {{schema:string,name:string,description:string,columns:Column[]}} Table */
	/** @typedef {{label:string,columns:string[]}} TableOption */
	/** @typedef {import('../src/table/webviewStrings').WebviewStrings} WebviewStrings */

	/** @type {WebviewStrings | null} strings kommen einmalig per 'init'-Message vom Extension-Host */
	let strings = null;
	/** @type {Table} */
	let state = { schema: '', name: '', description: '', columns: [] };
	/** @type {string | null} */
	let parseError = null;
	/** @type {'overview' | 'columns'} */
	let activeTab = 'columns';
	/** @type {TableOption[]} Tabellen im Workspace (Label + Spaltennamen), für die FK-Auswahl */
	let tableOptions = [];
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
	];

	const app = document.getElementById('app');

	function postEdit() {
		vscode.postMessage({ type: 'edit', table: state });
	}

	/** @type {number | undefined} */
	let debounceHandle;
	function postEditDebounced() {
		if (debounceHandle !== undefined) {
			window.clearTimeout(debounceHandle);
		}
		debounceHandle = window.setTimeout(() => {
			debounceHandle = undefined;
			postEdit();
		}, 250);
	}

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

	function render() {
		app.innerHTML = '';
		pendingColumnSizing = null;
		if (!strings) {
			return;
		}
		if (parseError) {
			app.appendChild(renderError(parseError));
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
	// Tab "Übersicht": Name / Schema / Beschreibung
	// ---------------------------------------------------------------------

	function renderOverviewTab() {
		const section = el('section', { className: 'tab-panel field-group card' });

		section.appendChild(
			renderTextField('f-name', strings.fieldNameLabel, state.name, strings.fieldNamePlaceholder, (v) => {
				state.name = v;
			}),
		);
		section.appendChild(
			renderTextField('f-schema', strings.fieldSchemaLabel, state.schema, strings.fieldSchemaPlaceholder, (v) => {
				state.schema = v;
			}),
		);
		section.appendChild(renderDescriptionField());

		return section;
	}

	/**
	 * @param {string} id
	 * @param {string} labelText
	 * @param {string} value
	 * @param {string} placeholder
	 * @param {(value: string) => void} onChange
	 */
	function renderTextField(id, labelText, value, placeholder, onChange) {
		const field = el('div', { className: 'field' });
		const label = el('label', { text: labelText });
		label.htmlFor = id;
		const input = /** @type {HTMLInputElement} */ (el('input', { className: 'text-input' }));
		input.type = 'text';
		input.id = id;
		input.placeholder = placeholder;
		input.value = value || '';
		bindText(input, onChange, postEditDebounced, postEdit);
		field.appendChild(label);
		field.appendChild(input);
		return field;
	}

	function renderDescriptionField() {
		const field = el('div', { className: 'field' });
		const label = el('label', { text: strings.fieldDescriptionLabel });
		field.appendChild(label);
		field.appendChild(
			renderMarkdownField(
				state.description,
				strings.fieldDescriptionPlaceholder,
				(v) => {
					state.description = v;
				},
				postEditDebounced,
				postEdit,
				{ autoGrow: true, rows: 5, ariaLabel: strings.fieldDescriptionLabel },
			),
		);
		return field;
	}

	// ---------------------------------------------------------------------
	// Tab "Spalten": Toolbar + Grid
	// ---------------------------------------------------------------------

	/** Feste Spaltenreihenfolge für das Grid, für buildColGroup (siehe common.js). */
	const COLUMN_ORDER = ['num', 'name', 'type', 'desc', 'pk', 'fk', 'refTable', 'refColumn', 'actions'];

	function renderColumnsTab() {
		const section = el('section', { className: 'tab-panel columns-section' });

		const toolbar = el('div', { className: 'toolbar' });
		const addBtn = el('button', { className: 'toolbar-btn' });
		addBtn.type = 'button';
		addBtn.appendChild(el('i', { className: 'codicon codicon-add' }));
		addBtn.appendChild(document.createTextNode(strings.addColumnButton));
		addBtn.addEventListener('click', addColumn);
		toolbar.appendChild(addBtn);
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
		columnSelect.addEventListener('change', () => {
			column.fkColumn = columnSelect.value;
			postEdit();
			refreshColumnError();
		});
		refColumnTd.appendChild(wrapSelectWithChevron(columnSelect));
		refreshColumnError();

		tableSelect.addEventListener('change', () => {
			column.fkTable = tableSelect.value;
			postEdit();
			refreshTableError();
			// Spaltenliste an die neu gewählte Tabelle anpassen; ein bisheriger
			// Wert bleibt erhalten (zeigt ggf. "nicht gefunden" an), statt ihn
			// automatisch zu verwerfen.
			populateColumnOptions(columnSelect, column.fkTable, column.fkColumn);
			refreshColumnError();
		});

		const fkTd = el('td', { className: 'col-flag' });
		fkTd.appendChild(
			renderFlagCheckbox(column, 'fk', strings.foreignKeyLabel, () => {
				tableSelect.disabled = !column.fk;
				columnSelect.disabled = !column.fk;
				refreshTableError();
				refreshColumnError();
			}),
		);
		row.appendChild(fkTd);
		row.appendChild(refTableTd);
		row.appendChild(refColumnTd);

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
	// Fehlerzustand (kaputtes TOML)
	// ---------------------------------------------------------------------

	/** @param {string} message */
	function renderError(message) {
		const wrap = el('div', { className: 'error-state' });
		wrap.appendChild(el('i', { className: 'codicon codicon-warning error-icon' }));
		wrap.appendChild(el('h2', { text: strings.errorTitle }));
		wrap.appendChild(el('p', { text: strings.errorBody }));
		wrap.appendChild(el('pre', { className: 'error-detail', text: message }));
		wrap.appendChild(el('p', { className: 'hint', text: strings.errorHint }));
		return wrap;
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
				columnWidths = message.columnWidths && typeof message.columnWidths === 'object' ? message.columnWidths : {};
				parseError = 'parseError' in message ? message.parseError : null;
				if ('table' in message) {
					state = message.table;
				}
				render();
				break;
			case 'update':
				parseError = null;
				state = message.table;
				render();
				break;
			case 'parseError':
				parseError = message.message;
				render();
				break;
			case 'tableOptions':
				tableOptions = Array.isArray(message.tableOptions) ? message.tableOptions : [];
				if (!parseError) {
					render();
				}
				break;
		}
	});

	vscode.postMessage({ type: 'ready' });
})();
