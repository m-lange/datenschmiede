// @ts-check
// Webview-Skript für den Generator-Editor (.tdgen). Die Oberfläche ist einem
// Jupyter-Notebook nachempfunden: oben Name/Beschreibung als Markdown-Zelle,
// darunter die Parameter-Tabelle und drei Python-Code-Zellen (generate,
// parse_params, display_value) mit fest vorgegebener, nicht änderbarer
// Signatur und editierbarem Rumpf. Teilt sich die zustandslosen Bausteine
// mit table.js/project.js über common.js (vor diesem Skript eingebunden,
// siehe getHtml in generator/editorProvider.ts).
(function () {
	'use strict';

	/** @type {{ postMessage: (msg: any) => void }} */
	// eslint-disable-next-line no-undef
	const vscode = acquireVsCodeApi();

	// eslint-disable-next-line no-undef
	const {
		el,
		bindText,
		autoGrowCellTextarea,
		renderMarkdownField,
		updateFieldError,
		wrapSelectWithChevron,
		buildColGroup,
		attachColumnResizeHandle,
		fixColumnWidths,
	} = window.DatenschmiedeCommon;

	/** @typedef {{name:string,type:string,description:string,choices?:string[],required?:boolean}} Parameter */
	/** @typedef {{generate:string,parseParams:string,displayValue:string}} GeneratorCode */
	/** @typedef {{name:string,description:string,parameters:Parameter[],code:GeneratorCode}} GeneratorFile */
	/** @typedef {import('../src/generator/webviewStrings').GeneratorWebviewStrings} GeneratorWebviewStrings */

	// Feste, nicht änderbare Python-Signaturen der Code-Zellen — Gegenstück
	// zu den Konstanten in src/generator/model.ts.
	const GENERATE_SIGNATURE = 'def generate(params: dict, n: int, ctx) -> "pandas.Series":';
	const PARSE_PARAMS_SIGNATURE = 'def parse_params(params: dict[str, str]) -> dict:';
	const DISPLAY_VALUE_SIGNATURE = 'def display_value(params: dict) -> str:';

	/** @type {GeneratorWebviewStrings | null} strings kommen einmalig per 'init'-Message vom Extension-Host */
	let strings = null;
	/** @type {GeneratorFile} */
	let state = {
		name: '',
		description: '',
		parameters: [],
		code: { generate: '', parseParams: '', displayValue: '' },
	};
	/** @type {string | null} */
	let parseError = null;
	/** @type {string[]} Bekannte Parametertypen (Spaltentypen + lookup/table/column), kommen per 'init'. */
	let parameterTypes = [];
	/** Von Hand gezogene Spaltenbreiten der Parameter-Tabelle (px), analog zu table.js. @type {Record<string, number>} */
	let columnWidths = {};
	/** @type {(() => void) | null} */
	let pendingColumnSizing = null;

	/** Größenziehbare Spalten der Parameter-Tabelle mit ihrer Mindestbreite (px). */
	const RESIZABLE_COLUMNS = [
		{ key: 'name', minWidth: 140 },
		{ key: 'type', minWidth: 120 },
		{ key: 'desc', minWidth: 180 },
		{ key: 'choices', minWidth: 180 },
	];
	/** Feste Spaltenreihenfolge der Parameter-Tabelle, für buildColGroup (siehe common.js). */
	const COLUMN_ORDER = ['num', 'name', 'type', 'desc', 'choices', 'required', 'actions'];

	const app = document.getElementById('app');

	function postEdit() {
		vscode.postMessage({ type: 'edit', generator: state });
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

		const notebook = el('div', { className: 'notebook' });
		notebook.appendChild(renderHeaderCell());
		notebook.appendChild(renderParametersCell());
		notebook.appendChild(
			renderCodeCell('generate', strings.generateCellTitle, strings.generateCellHint, GENERATE_SIGNATURE, true),
		);
		notebook.appendChild(
			renderCodeCell('parseParams', strings.parseParamsCellTitle, strings.parseParamsCellHint, PARSE_PARAMS_SIGNATURE, false),
		);
		notebook.appendChild(
			renderCodeCell(
				'displayValue',
				strings.displayValueCellTitle,
				strings.displayValueCellHint,
				DISPLAY_VALUE_SIGNATURE,
				false,
			),
		);
		app.appendChild(notebook);

		// Erst jetzt (Tabelle hängt im echten DOM) lässt sich die tatsächlich
		// benötigte Breite je Spalte messen — siehe renderParametersCell.
		if (pendingColumnSizing) {
			pendingColumnSizing();
		}
	}

	// ---------------------------------------------------------------------
	// Markdown-Kopfzelle: Name (als große Überschrift) + Beschreibung
	// ---------------------------------------------------------------------

	function renderHeaderCell() {
		const cell = el('section', { className: 'notebook-cell card field-group' });

		const nameField = el('div', { className: 'field' });
		const nameLabel = el('label', { text: strings.fieldNameLabel });
		nameLabel.htmlFor = 'g-name';
		const nameInput = /** @type {HTMLInputElement} */ (el('input', { className: 'text-input title-input' }));
		nameInput.type = 'text';
		nameInput.id = 'g-name';
		nameInput.placeholder = strings.fieldNamePlaceholder;
		nameInput.value = state.name || '';
		bindText(
			nameInput,
			(v) => {
				state.name = v;
			},
			postEditDebounced,
			postEdit,
		);
		nameField.appendChild(nameLabel);
		nameField.appendChild(nameInput);
		cell.appendChild(nameField);

		const descField = el('div', { className: 'field' });
		descField.appendChild(el('label', { text: strings.fieldDescriptionLabel }));
		descField.appendChild(
			renderMarkdownField(
				state.description,
				strings.fieldDescriptionPlaceholder,
				(v) => {
					state.description = v;
				},
				postEditDebounced,
				postEdit,
				{ autoGrow: true, rows: 4, ariaLabel: strings.fieldDescriptionLabel },
			),
		);
		cell.appendChild(descField);

		return cell;
	}

	// ---------------------------------------------------------------------
	// Parameter-Zelle: Tabelle mit Name / Datentyp / Beschreibung /
	// vordefinierte Werte / Pflicht
	// ---------------------------------------------------------------------

	function renderParametersCell() {
		const cell = el('section', { className: 'notebook-cell' });

		const header = el('div', { className: 'cell-header' });
		header.appendChild(el('h3', { text: strings.parametersTitle }));
		header.appendChild(el('p', { className: 'hint', text: strings.parametersHint }));
		cell.appendChild(header);

		const toolbar = el('div', { className: 'toolbar' });
		const addBtn = el('button', { className: 'toolbar-btn' });
		addBtn.type = 'button';
		addBtn.appendChild(el('i', { className: 'codicon codicon-add' }));
		addBtn.appendChild(document.createTextNode(strings.addParameterButton));
		addBtn.addEventListener('click', addParameter);
		toolbar.appendChild(addBtn);
		cell.appendChild(toolbar);

		if (state.parameters.length === 0) {
			// Ohne Parameter nur Überschrift, Hinweis und den Hinzufügen-Knopf
			// zeigen — keine leere Tabelle und kein großer Leerzustands-Block.
			return cell;
		}

		const wrap = el('div', { className: 'columns-table-wrap' });
		const table = el('table', { className: 'columns-table' });

		const { colgroup, cols } = buildColGroup(COLUMN_ORDER, columnWidths);
		table.appendChild(colgroup);

		const thead = el('thead');
		const headRow = el('tr');
		headRow.appendChild(el('th', { className: 'col-num' }));
		const thName = el('th', { className: 'col-name', text: strings.paramColHeaderName });
		const thType = el('th', { className: 'col-type', text: strings.paramColHeaderType });
		const thDesc = el('th', { className: 'col-desc', text: strings.paramColHeaderDescription });
		const thChoices = el('th', { className: 'col-desc', text: strings.paramColHeaderChoices });
		headRow.appendChild(thName);
		headRow.appendChild(thType);
		headRow.appendChild(thDesc);
		headRow.appendChild(thChoices);
		headRow.appendChild(el('th', { className: 'col-flag', text: strings.paramColHeaderRequired }));
		headRow.appendChild(el('th', { className: 'col-actions col-actions-wide' }));
		headRow.appendChild(el('th', { className: 'col-spacer' }));
		thead.appendChild(headRow);
		table.appendChild(thead);

		const resizableHeaders = { name: thName, type: thType, desc: thDesc, choices: thChoices };
		for (const { key, minWidth } of RESIZABLE_COLUMNS) {
			attachColumnResizeHandle(resizableHeaders[key], cols[key], key, minWidth, columnWidths, (widths) =>
				vscode.postMessage({ type: 'columnWidths', columnWidths: widths }),
			);
		}

		const tbody = el('tbody');
		state.parameters.forEach((parameter, index) => {
			tbody.appendChild(renderParameterRow(parameter, index));
		});
		table.appendChild(tbody);

		wrap.appendChild(table);
		cell.appendChild(wrap);

		// Siehe renderColumnsTab in table.js: erst im echten DOM messen, dann
		// auf table-layout: fixed umschalten.
		pendingColumnSizing = () => fixColumnWidths(table, RESIZABLE_COLUMNS, resizableHeaders, cols, columnWidths);

		return cell;
	}

	/**
	 * @param {Parameter} parameter
	 * @param {number} index
	 */
	function renderParameterRow(parameter, index) {
		const row = el('tr');

		row.appendChild(el('td', { className: 'col-num', text: String(index + 1) }));

		const nameTd = el('td');
		const nameInput = /** @type {HTMLInputElement} */ (el('input', { className: 'text-input cell-input' }));
		nameInput.type = 'text';
		nameInput.placeholder = strings.paramNamePlaceholder;
		nameInput.value = parameter.name || '';
		nameInput.setAttribute('data-role', 'parameter-name');
		const refreshNameError = () => {
			const name = nameInput.value.trim();
			const duplicate = !!name && state.parameters.some((p, i) => i !== index && p.name.trim() === name);
			updateFieldError(nameInput, name ? strings.paramNameDuplicateError : strings.paramNameRequiredError, !name || duplicate);
		};
		bindText(
			nameInput,
			(v) => {
				parameter.name = v;
				refreshNameError();
			},
			postEditDebounced,
			postEdit,
		);
		refreshNameError();
		nameTd.appendChild(nameInput);
		row.appendChild(nameTd);

		const typeTd = el('td');
		const select = /** @type {HTMLSelectElement} */ (el('select', { className: 'text-input cell-input' }));
		const types = parameterTypes.includes(parameter.type) ? parameterTypes : [parameter.type, ...parameterTypes];
		for (const type of types) {
			const opt = /** @type {HTMLOptionElement} */ (el('option', { text: type }));
			opt.value = type;
			if (type === parameter.type) {
				opt.selected = true;
			}
			select.appendChild(opt);
		}
		select.addEventListener('change', () => {
			parameter.type = select.value;
			postEdit();
		});
		typeTd.appendChild(wrapSelectWithChevron(select));
		row.appendChild(typeTd);

		const descTd = el('td');
		const descInput = /** @type {HTMLInputElement} */ (el('input', { className: 'text-input cell-input' }));
		descInput.type = 'text';
		descInput.placeholder = strings.paramDescriptionPlaceholder;
		descInput.value = parameter.description || '';
		bindText(
			descInput,
			(v) => {
				parameter.description = v;
			},
			postEditDebounced,
			postEdit,
		);
		descTd.appendChild(descInput);
		row.appendChild(descTd);

		// Vordefinierte Werteliste, kommagetrennt eingegeben: gesetzt bietet
		// der Table Editor eine Auswahl statt freier Eingabe an.
		const choicesTd = el('td');
		const choicesInput = /** @type {HTMLInputElement} */ (el('input', { className: 'text-input cell-input' }));
		choicesInput.type = 'text';
		choicesInput.placeholder = strings.paramChoicesPlaceholder;
		choicesInput.value = (parameter.choices || []).join(', ');
		bindText(
			choicesInput,
			(v) => {
				const choices = v
					.split(',')
					.map((c) => c.trim())
					.filter((c) => c.length > 0);
				if (choices.length > 0) {
					parameter.choices = choices;
				} else {
					delete parameter.choices;
				}
			},
			postEditDebounced,
			postEdit,
		);
		choicesTd.appendChild(choicesInput);
		row.appendChild(choicesTd);

		const requiredTd = el('td', { className: 'col-flag' });
		const requiredCheckbox = /** @type {HTMLInputElement} */ (el('input'));
		requiredCheckbox.type = 'checkbox';
		requiredCheckbox.checked = !!parameter.required;
		requiredCheckbox.title = strings.paramRequiredLabel;
		requiredCheckbox.setAttribute('aria-label', strings.paramRequiredLabel);
		requiredCheckbox.addEventListener('change', () => {
			if (requiredCheckbox.checked) {
				parameter.required = true;
			} else {
				delete parameter.required;
			}
			postEdit();
		});
		requiredTd.appendChild(requiredCheckbox);
		row.appendChild(requiredTd);

		const actionsTd = el('td', { className: 'col-actions col-actions-wide' });
		const actions = el('div', { className: 'row-actions' });
		actions.appendChild(
			renderRowActionButton('chevron-up', strings.moveParameterUpLabel, () => moveParameter(index, -1), {
				disabled: index === 0,
				action: 'move-up',
			}),
		);
		actions.appendChild(
			renderRowActionButton('chevron-down', strings.moveParameterDownLabel, () => moveParameter(index, 1), {
				disabled: index === state.parameters.length - 1,
				action: 'move-down',
			}),
		);
		actions.appendChild(
			renderRowActionButton('trash', strings.removeParameterLabel, () => removeParameter(index), { danger: true }),
		);
		actionsTd.appendChild(actions);
		row.appendChild(actionsTd);

		row.appendChild(el('td', { className: 'col-spacer' }));

		return row;
	}

	function addParameter() {
		state.parameters.push({ name: '', type: 'string', description: '' });
		postEdit();
		render();
		const lastNameInput = app.querySelector('.columns-table tbody tr:last-child input[data-role="parameter-name"]');
		if (lastNameInput instanceof HTMLInputElement) {
			lastNameInput.focus();
		}
	}

	/** @param {number} index */
	function removeParameter(index) {
		state.parameters.splice(index, 1);
		postEdit();
		render();
	}

	/**
	 * @param {number} index
	 * @param {-1|1} delta
	 */
	function moveParameter(index, delta) {
		const target = index + delta;
		if (target < 0 || target >= state.parameters.length) {
			return;
		}
		const [parameter] = state.parameters.splice(index, 1);
		state.parameters.splice(target, 0, parameter);
		postEdit();
		render();
		const rowEl = app.querySelectorAll('.columns-table tbody tr')[target];
		const btn = rowEl && rowEl.querySelector(`button[data-action="${delta === -1 ? 'move-up' : 'move-down'}"]`);
		if (btn instanceof HTMLButtonElement && !btn.disabled) {
			btn.focus();
		}
	}

	/**
	 * @param {string} icon
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

	// ---------------------------------------------------------------------
	// Code-Zellen: Beschreibung + feste Signatur + editierbarer Rumpf
	// ---------------------------------------------------------------------

	/**
	 * @param {'generate'|'parseParams'|'displayValue'} key
	 * @param {string} title
	 * @param {string} hint
	 * @param {string} signature
	 * @param {boolean} required
	 */
	function renderCodeCell(key, title, hint, signature, required) {
		const cell = el('section', { className: 'notebook-cell notebook-code-cell' });

		const header = el('div', { className: 'cell-header' });
		const titleRow = el('h3');
		titleRow.appendChild(el('i', { className: 'codicon codicon-symbol-method cell-method-icon' }));
		titleRow.appendChild(document.createTextNode(title));
		header.appendChild(titleRow);
		header.appendChild(el('p', { className: 'hint', text: hint }));
		cell.appendChild(header);

		const editor = el('div', { className: 'code-cell' + (required ? ' code-cell-required' : '') });

		// Die Signatur ist fest vorgegeben und nicht editierbar — wie die
		// vorbelegten Zellen eines Notebooks.
		const signatureEl = el('div', { className: 'code-signature', text: signature });
		signatureEl.title = strings.signatureFixedTooltip;
		editor.appendChild(signatureEl);

		const body = /** @type {HTMLTextAreaElement} */ (el('textarea', { className: 'code-body' }));
		body.value = state.code[key] || '';
		body.placeholder = strings.codePlaceholder;
		body.spellcheck = false;
		body.setAttribute('aria-label', title);
		body.addEventListener('input', () => {
			state.code[key] = body.value;
			postEditDebounced();
			autoGrowCellTextarea(body);
		});
		body.addEventListener('blur', () => {
			state.code[key] = body.value;
			postEdit();
		});
		// Tab rückt ein statt den Fokus zu verschieben — in einer Code-Zelle
		// die erwartbare Belegung (Fokuswechsel weiterhin per Escape + Tab).
		body.addEventListener('keydown', (event) => {
			if (event.key === 'Tab' && !event.shiftKey) {
				event.preventDefault();
				const start = body.selectionStart;
				const end = body.selectionEnd;
				body.value = `${body.value.slice(0, start)}    ${body.value.slice(end)}`;
				body.selectionStart = body.selectionEnd = start + 4;
				state.code[key] = body.value;
				postEditDebounced();
			}
		});
		editor.appendChild(body);

		cell.appendChild(editor);

		// Höhe an den Inhalt anpassen, sobald die Zelle im DOM hängt.
		window.requestAnimationFrame(() => autoGrowCellTextarea(body));

		return cell;
	}

	// ---------------------------------------------------------------------
	// Fehlerzustand (kaputtes TOML) — wie table.js
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
				parameterTypes = Array.isArray(message.parameterTypes) ? message.parameterTypes : [];
				columnWidths = message.columnWidths && typeof message.columnWidths === 'object' ? message.columnWidths : {};
				parseError = 'parseError' in message ? message.parseError : null;
				if ('generator' in message) {
					state = message.generator;
				}
				render();
				break;
			case 'update':
				parseError = null;
				state = message.generator;
				render();
				break;
			case 'parseError':
				parseError = message.message;
				render();
				break;
		}
	});

	vscode.postMessage({ type: 'ready' });
})();
