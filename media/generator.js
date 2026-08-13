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
	/** @typedef {{generate:string,parseParams:string,displayValue:string,validate:string}} GeneratorCode */
	/** @typedef {{name:string,description:string,parameters:Parameter[],code:GeneratorCode}} GeneratorFile */
	/** @typedef {import('../src/generator/webviewStrings').GeneratorWebviewStrings} GeneratorWebviewStrings */

	// Feste, nicht änderbare Python-Signaturen der Code-Zellen — Gegenstück
	// zu den Konstanten in src/generator/model.ts.
	const GENERATE_SIGNATURE = 'def generate(params: dict, n: int, ctx) -> "pandas.Series":';
	const PARSE_PARAMS_SIGNATURE = 'def parse_params(params: dict[str, str]) -> dict:';
	const DISPLAY_VALUE_SIGNATURE = 'def display_value(params: dict) -> str:';
	const VALIDATE_SIGNATURE = 'def validate(params: dict[str, str]) -> "list[str]":';

	/** @type {GeneratorWebviewStrings | null} strings kommen einmalig per 'init'-Message vom Extension-Host */
	let strings = null;
	/** @type {GeneratorFile} */
	let state = {
		name: '',
		description: '',
		parameters: [],
		code: { generate: '', parseParams: '', displayValue: '', validate: '' },
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
		cellViews = {};
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
		notebook.appendChild(
			renderCodeCell('validate', strings.validateCellTitle, strings.validateCellHint, VALIDATE_SIGNATURE, false),
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
	// Code-Zellen: Beschreibung + feste Signatur + editierbarer Rumpf mit
	// Python-Syntaxhervorhebung + Run-Knopf mit Ergebnis-Ausgabe darunter
	// ---------------------------------------------------------------------

	/**
	 * Sehr kleine, bewusst eingeschränkte Python-Hervorhebung für die
	 * Code-Zellen — gleiche Philosophie wie der Mini-Markdown-Renderer in
	 * common.js: erst konsequent HTML escapen, dann eine sichere Teilmenge
	 * an Tokens einfärben (Kommentare, Strings, Zahlen, Schlüsselwörter,
	 * bekannte Builtins, def/class-Namen, Dekoratoren). Die Farbklassen
	 * (.py-*) sind in main.css je Theme-Helligkeit definiert — Webviews
	 * haben keinen Zugriff auf die TextMate-Token-Farben des Editors.
	 * @param {string} code
	 */
	function highlightPython(code) {
		const escaped = (code || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		const pattern =
			/(?<com>#[^\n]*)|(?<tri>'''[\s\S]*?'''|"""[\s\S]*?"""|'''[\s\S]*$|"""[\s\S]*$)|(?<str>[rbfRBF]{0,2}(?:'(?:\\.|[^'\\\n])*'?|"(?:\\.|[^"\\\n])*"?))|(?<num>\b(?:\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?j?|0[xXoObB][0-9a-fA-F_]+)\b)|(?<dec>@\w+)|(?<defkw>\b(?:def|class)\b)(?<ws>\s+)(?<fname>\w+)|(?<kw>\b(?:return|if|elif|else|for|while|in|not|and|or|is|None|True|False|import|from|as|with|try|except|finally|raise|lambda|pass|break|continue|global|nonlocal|yield|assert|del|async|await)\b)|(?<blt>\b(?:len|range|str|int|float|bool|list|dict|set|tuple|print|enumerate|zip|sum|min|max|abs|round|sorted|isinstance|type|repr|format|next|iter|any|all)\b)/g;
		return escaped.replace(pattern, (...args) => {
			const groups = args[args.length - 1];
			if (groups.com !== undefined) {
				return `<span class="py-com">${groups.com}</span>`;
			}
			if (groups.tri !== undefined) {
				return `<span class="py-str">${groups.tri}</span>`;
			}
			if (groups.str !== undefined) {
				return `<span class="py-str">${groups.str}</span>`;
			}
			if (groups.num !== undefined) {
				return `<span class="py-num">${groups.num}</span>`;
			}
			if (groups.dec !== undefined) {
				return `<span class="py-dec">${groups.dec}</span>`;
			}
			if (groups.defkw !== undefined) {
				return `<span class="py-kw">${groups.defkw}</span>${groups.ws}<span class="py-fn">${groups.fname}</span>`;
			}
			if (groups.kw !== undefined) {
				return `<span class="py-kw">${groups.kw}</span>`;
			}
			return `<span class="py-blt">${groups.blt}</span>`;
		});
	}

	/** Webview-Zellen-Schlüssel -> Python-Zellenname (Protokoll mit dem Extension-Host / run_cell.py). */
	const CELL_NAMES = { generate: 'generate', parseParams: 'parse_params', displayValue: 'display_value', validate: 'validate' };

	/** Zuletzt im Run-Dialog eingegebene Test-Parameterwerte (rein Sitzungs-lokal). @type {Record<string, string>} */
	const lastTestParams = {};
	let lastTestN = '10';
	/** Gerade laufende Zelle (Webview-Schlüssel), oder null. @type {string | null} */
	let runningCell = null;
	/** Letzte Ergebnisse je Zelle. @type {Record<string, {ok:boolean, lines?:string[], error?:string, traceback?:string}>} */
	const cellResults = {};
	/** Ausgabe-Container + Run-Knopf des aktuellen Renderings je Zelle (für gezielte Updates ohne Voll-Neuaufbau). @type {Record<string, {output: HTMLElement, runBtn: HTMLButtonElement}>} */
	let cellViews = {};

	/**
	 * @param {'generate'|'parseParams'|'displayValue'|'validate'} key
	 * @param {string} title
	 * @param {string} hint
	 * @param {string} signature
	 * @param {boolean} required
	 */
	function renderCodeCell(key, title, hint, signature, required) {
		const cell = el('section', { className: 'notebook-cell notebook-code-cell' });

		const header = el('div', { className: 'cell-header' });
		const headerRow = el('div', { className: 'cell-header-row' });
		const titleRow = el('h3');
		titleRow.appendChild(el('i', { className: 'codicon codicon-symbol-method cell-method-icon' }));
		titleRow.appendChild(document.createTextNode(title));
		headerRow.appendChild(titleRow);

		// Run-Knopf: führt genau diese Zelle mit im Dialog eingegebenen
		// Parameterwerten aus (siehe openRunDialog / python/run_cell.py).
		const runBtn = /** @type {HTMLButtonElement} */ (el('button', { className: 'icon-button cell-run-btn' }));
		runBtn.type = 'button';
		runBtn.title = strings.runCellLabel;
		runBtn.setAttribute('aria-label', strings.runCellLabel);
		runBtn.appendChild(el('i', { className: 'codicon codicon-play' }));
		runBtn.addEventListener('click', () => {
			if (!runningCell) {
				openRunDialog(key);
			}
		});
		headerRow.appendChild(runBtn);
		header.appendChild(headerRow);
		header.appendChild(el('p', { className: 'hint', text: hint }));
		cell.appendChild(header);

		const editor = el('div', { className: 'code-cell' + (required ? ' code-cell-required' : '') });

		// Die Signatur ist fest vorgegeben und nicht editierbar — wie die
		// vorbelegten Zellen eines Notebooks.
		const signatureEl = el('div', { className: 'code-signature' });
		signatureEl.innerHTML = highlightPython(signature);
		signatureEl.title = strings.signatureFixedTooltip;
		editor.appendChild(signatureEl);

		// Hervorhebungs-Overlay: ein <pre> mit identischer Metrik liegt hinter
		// der Textarea (deren Text transparent ist, nur der Cursor bleibt
		// sichtbar) — der Klassiker für Highlighting ohne echten Editor.
		const editorWrap = el('div', { className: 'code-editor-wrap' });
		const highlightEl = el('pre', { className: 'code-highlight' });
		highlightEl.setAttribute('aria-hidden', 'true');

		const body = /** @type {HTMLTextAreaElement} */ (el('textarea', { className: 'code-body' }));
		body.value = state.code[key] || '';
		body.placeholder = strings.codePlaceholder;
		body.spellcheck = false;
		body.setAttribute('aria-label', title);
		const refreshHighlight = () => {
			// Abschließender Zeilenumbruch, damit das <pre> auch bei einer
			// leeren letzten Zeile dieselbe Höhe hat wie die Textarea.
			highlightEl.innerHTML = `${highlightPython(body.value)}\n`;
			highlightEl.scrollLeft = body.scrollLeft;
		};
		body.addEventListener('input', () => {
			state.code[key] = body.value;
			postEditDebounced();
			autoGrowCellTextarea(body);
			refreshHighlight();
		});
		body.addEventListener('scroll', () => {
			highlightEl.scrollLeft = body.scrollLeft;
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
				refreshHighlight();
			}
		});
		editorWrap.appendChild(highlightEl);
		editorWrap.appendChild(body);
		editor.appendChild(editorWrap);

		cell.appendChild(editor);

		// Ergebnis-Ausgabe des letzten Testlaufs unter der Zelle.
		const output = el('div', { className: 'cell-output-host' });
		cell.appendChild(output);
		cellViews[key] = { output, runBtn };
		refreshCellView(key);

		// Höhe an den Inhalt anpassen, sobald die Zelle im DOM hängt.
		window.requestAnimationFrame(() => {
			autoGrowCellTextarea(body);
			refreshHighlight();
		});
		refreshHighlight();

		return cell;
	}

	/** Frischt Run-Knopf (Spinner) und Ausgabe-Bereich einer Zelle gezielt auf — ohne Voll-Neuaufbau (Fokus bleibt erhalten). @param {string} key */
	function refreshCellView(key) {
		const view = cellViews[key];
		if (!view) {
			return;
		}
		const running = runningCell === key;
		view.runBtn.disabled = !!runningCell;
		const icon = view.runBtn.querySelector('.codicon');
		if (icon) {
			icon.className = running ? 'codicon codicon-loading codicon-modifier-spin' : 'codicon codicon-play';
		}

		view.output.innerHTML = '';
		const result = cellResults[key];
		if (!result) {
			return;
		}
		const box = el('div', { className: 'cell-output' + (result.ok ? '' : ' cell-output-error') });
		if (result.ok) {
			const lines = result.lines || [];
			if (lines.length === 0) {
				box.appendChild(el('div', { className: 'cell-output-line cell-output-empty', text: strings.cellOutputEmpty }));
			}
			for (const line of lines) {
				box.appendChild(el('div', { className: 'cell-output-line', text: line }));
			}
		} else {
			box.appendChild(el('div', { className: 'cell-output-line', text: result.error || 'error' }));
			if (result.traceback) {
				box.appendChild(el('pre', { className: 'cell-output-traceback', text: result.traceback }));
			}
		}
		view.output.appendChild(box);
	}

	/**
	 * Dialog vor dem Zellen-Testlauf: je deklariertem Parameter ein
	 * Eingabefeld (vorbelegt mit den zuletzt verwendeten Test-Werten), für
	 * `generate` zusätzlich die Datensatzanzahl n.
	 * @param {'generate'|'parseParams'|'displayValue'|'validate'} key
	 */
	function openRunDialog(key) {
		const overlay = el('div', { className: 'dialog-overlay' });
		const dialog = el('div', { className: 'param-dialog card' });
		dialog.setAttribute('role', 'dialog');

		const close = () => {
			document.removeEventListener('keydown', onKeyDown, true);
			overlay.remove();
		};
		/** @param {KeyboardEvent} event */
		const onKeyDown = (event) => {
			if (event.key === 'Escape') {
				event.stopPropagation();
				close();
			}
		};
		document.addEventListener('keydown', onKeyDown, true);
		overlay.addEventListener('mousedown', (event) => {
			if (event.target === overlay) {
				close();
			}
		});

		const titleRow = el('div', { className: 'param-dialog-title' });
		const heading = el('h3');
		heading.appendChild(el('i', { className: 'codicon codicon-play param-dialog-icon' }));
		heading.appendChild(document.createTextNode(strings.runDialogTitle.replace('{0}', CELL_NAMES[key])));
		titleRow.appendChild(heading);
		const closeBtn = el('button', { className: 'icon-button param-dialog-close' });
		closeBtn.type = 'button';
		closeBtn.title = strings.runDialogCancelButton;
		closeBtn.setAttribute('aria-label', strings.runDialogCancelButton);
		closeBtn.appendChild(el('i', { className: 'codicon codicon-close' }));
		closeBtn.addEventListener('click', close);
		titleRow.appendChild(closeBtn);
		dialog.appendChild(titleRow);

		/** @type {{name: string, input: HTMLInputElement}[]} */
		const paramInputs = [];
		for (const parameter of state.parameters) {
			const name = (parameter.name || '').trim();
			if (!name) {
				continue;
			}
			const field = el('div', { className: 'field param-field' });
			field.appendChild(el('label', { text: `${name} (${parameter.type})` }));
			const input = /** @type {HTMLInputElement} */ (el('input', { className: 'text-input' }));
			input.type = 'text';
			input.value = lastTestParams[name] !== undefined ? lastTestParams[name] : '';
			if (parameter.description) {
				input.placeholder = parameter.description;
			}
			field.appendChild(input);
			dialog.appendChild(field);
			paramInputs.push({ name, input });
		}

		/** @type {HTMLInputElement | null} */
		let nInput = null;
		if (key === 'generate') {
			const field = el('div', { className: 'field param-field' });
			field.appendChild(el('label', { text: strings.runDialogNLabel }));
			nInput = /** @type {HTMLInputElement} */ (el('input', { className: 'text-input' }));
			nInput.type = 'text';
			nInput.inputMode = 'numeric';
			nInput.value = lastTestN;
			field.appendChild(nInput);
			dialog.appendChild(field);
		}

		const footer = el('div', { className: 'param-dialog-footer' });
		const cancelBtn = el('button', { className: 'toolbar-btn', text: strings.runDialogCancelButton });
		cancelBtn.type = 'button';
		cancelBtn.addEventListener('click', close);
		const runBtn = el('button', { className: 'button-primary', text: strings.runDialogRunButton });
		runBtn.type = 'button';
		runBtn.addEventListener('click', () => {
			/** @type {Record<string, string>} */
			const params = {};
			for (const { name, input } of paramInputs) {
				lastTestParams[name] = input.value;
				if (input.value.trim() !== '') {
					params[name] = input.value;
				}
			}
			let n = 10;
			if (nInput) {
				lastTestN = nInput.value;
				const parsed = parseInt(nInput.value, 10);
				n = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 1000) : 10;
			}
			close();
			runningCell = key;
			delete cellResults[key];
			for (const cellKey of Object.keys(cellViews)) {
				refreshCellView(cellKey);
			}
			vscode.postMessage({ type: 'runCell', cell: CELL_NAMES[key], params, n });
		});
		footer.appendChild(cancelBtn);
		footer.appendChild(runBtn);
		dialog.appendChild(footer);

		overlay.appendChild(dialog);
		document.body.appendChild(overlay);
		const firstControl = dialog.querySelector('input');
		if (firstControl instanceof HTMLElement) {
			firstControl.focus();
		}
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
			case 'cellResult': {
				// Ergebnis eines Zellen-Testlaufs: gezielt nur Run-Knopf und
				// Ausgabe-Bereich auffrischen (kein Voll-Neuaufbau — der Fokus
				// bleibt z. B. in einer gerade bearbeiteten Code-Zelle).
				runningCell = null;
				const key = Object.keys(CELL_NAMES).find((k) => CELL_NAMES[k] === message.cell);
				if (key) {
					cellResults[key] = {
						ok: message.ok === true,
						lines: Array.isArray(message.lines) ? message.lines : undefined,
						error: typeof message.error === 'string' ? message.error : undefined,
						traceback: typeof message.traceback === 'string' ? message.traceback : undefined,
					};
				}
				for (const cellKey of Object.keys(cellViews)) {
					refreshCellView(cellKey);
				}
				break;
			}
		}
	});

	vscode.postMessage({ type: 'ready' });
})();
