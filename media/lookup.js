// @ts-check
// Webview-Skript für den Lookup-Listen-Editor (.lkp). Bewusst als
// eigenständiges, unkompiliertes Skript gehalten (kein Bundling nötig, keine
// Abhängigkeiten) — gleiche Mechanik wie table.js.
//
// Aufbau analog zum Table Editor: Tabs "Übersicht" (Name/Beschreibung plus
// Verteilungs-Diagramm) und "Werte" (Grid). Im Grid ist jede Wertespalte über
// ihre Kopfzelle direkt umbenennbar; die Phantom-Kopfzelle "+ Neue Spalte"
// legt beim Tippen eine neue Spalte an. Die Gewichtsspalte ist fest immer die
// letzte Spalte; die Gewichte sind frei wählbar (auch über 100 % in Summe) —
// die Summenzeile unter dem Grid zeigt den aktuellen Gesamtwert rein
// informativ an, ohne Prüfung. Nur ein einzelnes leeres/ungültiges Gewicht
// wird rot markiert (und in der Problems-Ansicht gemeldet).
(function () {
	'use strict';

	/** @type {{ postMessage: (msg: any) => void }} */
	// eslint-disable-next-line no-undef
	const vscode = acquireVsCodeApi();

	// Gemeinsame, zustandslose Bausteine aus common.js (vor diesem Skript
	// eingebunden, siehe getHtml in lookup/editorProvider.ts).
	// eslint-disable-next-line no-undef
	const {
		el,
		bindText,
		renderMarkdownField,
		updateFieldError,
		buildColGroup,
		attachColumnResizeHandle,
		fixColumnWidths,
	} = window.DatenschmiedeCommon;

	/** @typedef {{values:string[],weight:string}} LookupRow */
	/** @typedef {{name:string,description:string,columns:string[],rows:LookupRow[]}} LookupList */
	/** @typedef {import('../src/lookup/webviewStrings').LookupWebviewStrings} LookupWebviewStrings */

	/** @type {LookupWebviewStrings | null} strings kommen einmalig per 'init'-Message vom Extension-Host */
	let strings = null;
	/** @type {LookupList} */
	let state = { name: '', description: '', columns: [], rows: [] };
	/** @type {string | null} */
	let parseError = null;
	/** @type {'overview' | 'values'} */
	let activeTab = 'values';
	/** @type {Record<string, number>} von Hand gezogene Spaltenbreiten, geräteweit gemerkt (siehe table.js für Details) */
	let columnWidths = {};
	/** @type {(() => void) | null} von renderValuesTab gesetzt: berechnet die finalen Spaltenbreiten, sobald die Tabelle im DOM hängt (siehe render()). */
	let pendingColumnSizing = null;

	const VALUE_COLUMN_MIN_WIDTH = 140;
	const WEIGHT_COLUMN_MIN_WIDTH = 110;

	const app = document.getElementById('app');

	function postEdit() {
		vscode.postMessage({ type: 'edit', lookup: state });
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

	// ---------------------------------------------------------------------
	// Gewichte: Kopie der vscode-freien Helfer aus src/lookup/model.ts —
	// die Webview kommt ohne Modul-Bundling aus und kann sie nicht importieren.
	// ---------------------------------------------------------------------

	/** @param {string} raw @returns {number | null} */
	function parseWeight(raw) {
		const text = (raw || '').trim().replace(',', '.');
		if (!/^\d+(\.\d+)?$/.test(text)) {
			return null;
		}
		const value = Number(text);
		return Number.isFinite(value) ? value : null;
	}

	function weightTotal() {
		return state.rows.reduce((sum, row) => sum + (parseWeight(row.weight) || 0), 0);
	}

	/** Auf 2 Nachkommastellen gerundet, ohne überflüssige Nullen. @param {number} value */
	function formatWeight(value) {
		return String(Math.round(value * 100) / 100);
	}

	/** Kleiner {0}-Platzhalter-Ersatz für die Webview-Strings. @param {string} template @param {...(string|number)} args */
	function format(template, ...args) {
		return template.replace(/\{(\d+)\}/g, (match, index) => {
			const value = args[Number(index)];
			return value === undefined ? match : String(value);
		});
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
		app.appendChild(activeTab === 'overview' ? renderOverviewTab() : renderValuesTab());

		// Erst jetzt (Tabelle hängt im echten DOM) lässt sich die tatsächlich
		// benötigte Breite je Spalte messen — siehe renderValuesTab.
		if (pendingColumnSizing) {
			pendingColumnSizing();
		}
	}

	// ---------------------------------------------------------------------
	// Kopfbereich: Tabs
	// ---------------------------------------------------------------------

	function renderTabs() {
		const bar = el('div', { className: 'tabbar' });
		bar.setAttribute('role', 'tablist');
		bar.appendChild(renderTabButton('overview', strings.tabOverview));
		bar.appendChild(renderTabButton('values', `${strings.tabValues} (${state.rows.length})`));
		return bar;
	}

	/** @param {'overview'|'values'} tab @param {string} label */
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
	// Tab "Übersicht": Name / Beschreibung + Verteilungs-Diagramm
	// ---------------------------------------------------------------------

	function renderOverviewTab() {
		const wrap = el('section', { className: 'tab-panel overview-stack' });

		const fields = el('div', { className: 'field-group card' });
		fields.appendChild(
			renderTextField('f-name', strings.fieldNameLabel, state.name, strings.fieldNamePlaceholder, (v) => {
				state.name = v;
			}),
		);
		fields.appendChild(renderDescriptionField());
		wrap.appendChild(fields);

		wrap.appendChild(renderChartCard());
		return wrap;
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

	/**
	 * Verteilungs-Diagramm: ein horizontaler Balken je Wertezeile (in
	 * Zeilen-Reihenfolge, damit sich Diagramm und Grid direkt zuordnen
	 * lassen), beschriftet mit dem Wert der ersten Spalte und dem Gewicht am
	 * Balkenende. Eine Serie -> eine Farbe (Listen-Grün, je Theme-Helligkeit
	 * eine Variante, siehe main.css) und keine Legende; die Balkenlänge ist
	 * relativ zum größten Gewicht skaliert, die exakten Werte stehen daneben.
	 */
	function renderChartCard() {
		const card = el('div', { className: 'card chart-card' });
		card.appendChild(el('h3', { className: 'chart-title', text: strings.chartTitle }));

		if (state.rows.length === 0) {
			card.appendChild(el('p', { className: 'chart-empty', text: strings.chartEmpty }));
			return card;
		}

		const maxWeight = Math.max(...state.rows.map((row) => parseWeight(row.weight) || 0));
		const chart = el('div', { className: 'lookup-chart' });
		chart.setAttribute('role', 'img');
		chart.setAttribute('aria-label', strings.chartTitle);

		state.rows.forEach((row, index) => {
			const weight = parseWeight(row.weight);
			const label = (row.values[0] || '').trim() || format(strings.chartRowFallback, index + 1);
			const valueText = weight === null ? '–' : `${formatWeight(weight)} %`;

			const rowEl = el('div', { className: 'chart-row' });
			rowEl.title = `${label}: ${valueText}`;

			const labelEl = el('span', { className: 'chart-label', text: label });
			rowEl.appendChild(labelEl);

			const track = el('div', { className: 'chart-track' });
			const bar = el('div', { className: 'chart-bar' });
			const percent = weight !== null && maxWeight > 0 ? (weight / maxWeight) * 100 : 0;
			bar.style.width = `${percent}%`;
			track.appendChild(bar);
			rowEl.appendChild(track);

			rowEl.appendChild(el('span', { className: 'chart-value', text: valueText }));
			chart.appendChild(rowEl);
		});
		card.appendChild(chart);

		return card;
	}

	// ---------------------------------------------------------------------
	// Tab "Werte": Toolbar + Grid
	// ---------------------------------------------------------------------

	function renderValuesTab() {
		const section = el('section', { className: 'tab-panel columns-section' });

		const toolbar = el('div', { className: 'toolbar' });
		toolbar.appendChild(renderToolbarButton('codicon-add', strings.addRowButton, addRow));
		toolbar.appendChild(renderToolbarButton('codicon-split-horizontal', strings.addColumnButton, () => addColumn('')));
		section.appendChild(toolbar);

		const wrap = el('div', { className: 'columns-table-wrap' });
		const table = el('table', { className: 'columns-table lookup-table' });

		// Feste Spaltenreihenfolge für buildColGroup: Wertespalten dynamisch
		// (v0..vn), dahinter Phantom-Spalte, Gewichtsspalte, Aktionen.
		const valueKeys = state.columns.map((_, index) => `v${index}`);
		const order = ['num', ...valueKeys, 'newcol', 'weight', 'actions'];
		const { colgroup, cols } = buildColGroup(order, columnWidths);
		table.appendChild(colgroup);

		const thead = el('thead');
		const headRow = el('tr');
		headRow.appendChild(el('th', { className: 'col-num' }));

		/** @type {Record<string, HTMLElement>} */
		const resizableHeaders = {};
		state.columns.forEach((_, index) => {
			const th = renderColumnHeader(index);
			resizableHeaders[`v${index}`] = th;
			headRow.appendChild(th);
		});

		headRow.appendChild(renderNewColumnHeader());

		const thWeight = el('th', { className: 'col-weight', text: strings.colHeaderWeight });
		resizableHeaders.weight = thWeight;
		headRow.appendChild(thWeight);

		headRow.appendChild(el('th', { className: 'col-actions' }));
		headRow.appendChild(el('th', { className: 'col-spacer' }));
		thead.appendChild(headRow);
		table.appendChild(thead);

		const resizable = [
			...valueKeys.map((key) => ({ key, minWidth: VALUE_COLUMN_MIN_WIDTH })),
			{ key: 'weight', minWidth: WEIGHT_COLUMN_MIN_WIDTH },
		];
		for (const { key, minWidth } of resizable) {
			attachColumnResizeHandle(resizableHeaders[key], cols[key], key, minWidth, columnWidths, (widths) =>
				vscode.postMessage({ type: 'columnWidths', columnWidths: widths }),
			);
		}

		const tbody = el('tbody');
		if (state.rows.length === 0) {
			const emptyRow = el('tr');
			const td = el('td', { className: 'empty-grid-cell' });
			td.colSpan = order.length + 1;
			td.appendChild(el('span', { text: strings.emptyStateText }));
			const link = el('button', { className: 'link-button', text: strings.emptyStateAction });
			link.type = 'button';
			link.addEventListener('click', addRow);
			td.appendChild(link);
			emptyRow.appendChild(td);
			tbody.appendChild(emptyRow);
		} else {
			state.rows.forEach((row, index) => {
				tbody.appendChild(renderValueRow(row, index));
			});
		}
		table.appendChild(tbody);

		if (state.rows.length > 0) {
			table.appendChild(renderTotalRow(order.length));
		}

		wrap.appendChild(table);
		section.appendChild(wrap);

		// Siehe renderColumnsTab in table.js: erst im echten DOM messen, dann
		// auf table-layout: fixed umschalten.
		pendingColumnSizing = () => fixColumnWidths(table, resizable, resizableHeaders, cols, columnWidths);

		return section;
	}

	/** @param {string} icon @param {string} label @param {() => void} onClick */
	function renderToolbarButton(icon, label, onClick) {
		const btn = el('button', { className: 'toolbar-btn' });
		btn.type = 'button';
		btn.appendChild(el('i', { className: `codicon ${icon}` }));
		btn.appendChild(document.createTextNode(label));
		btn.addEventListener('click', onClick);
		return btn;
	}

	/** Kopfzelle einer Wertespalte: Eingabefeld zum Umbenennen plus „Spalte entfernen“. @param {number} index */
	function renderColumnHeader(index) {
		const th = el('th', { className: 'col-value-header' });
		const cell = el('div', { className: 'header-cell' });

		const input = /** @type {HTMLInputElement} */ (el('input', { className: 'text-input cell-input header-name-input' }));
		input.type = 'text';
		input.placeholder = strings.columnNamePlaceholder;
		input.value = state.columns[index] || '';
		input.setAttribute('data-role', 'column-header');
		input.setAttribute('aria-label', strings.columnNamePlaceholder);
		bindText(
			input,
			(v) => {
				state.columns[index] = v;
			},
			postEditDebounced,
			postEdit,
		);
		cell.appendChild(input);

		const removeBtn = el('button', { className: 'icon-button icon-button-danger' });
		removeBtn.type = 'button';
		removeBtn.title = strings.removeColumnLabel;
		removeBtn.setAttribute('aria-label', strings.removeColumnLabel);
		removeBtn.appendChild(el('i', { className: 'codicon codicon-trash' }));
		removeBtn.addEventListener('click', () => removeColumn(index));
		cell.appendChild(removeBtn);

		th.appendChild(cell);
		return th;
	}

	/**
	 * Phantom-Kopfzelle „+ Neue Spalte“: der erste Tastendruck legt eine echte
	 * Spalte mit dem getippten Text an und setzt den Fokus in deren (neue)
	 * Kopfzelle, sodass sich das Tippen nahtlos fortsetzt.
	 */
	function renderNewColumnHeader() {
		const th = el('th', { className: 'col-new-column' });
		const input = /** @type {HTMLInputElement} */ (
			el('input', { className: 'text-input cell-input header-name-input new-column-input' })
		);
		input.type = 'text';
		input.placeholder = strings.newColumnPlaceholder;
		input.setAttribute('aria-label', strings.newColumnPlaceholder);
		input.addEventListener('input', () => {
			if (input.value !== '') {
				addColumn(input.value);
			}
		});
		th.appendChild(input);
		return th;
	}

	/**
	 * @param {LookupRow} row
	 * @param {number} index
	 */
	function renderValueRow(row, index) {
		const tr = el('tr');

		tr.appendChild(el('td', { className: 'col-num', text: String(index + 1) }));

		state.columns.forEach((_, columnIndex) => {
			const td = el('td');
			const input = /** @type {HTMLInputElement} */ (el('input', { className: 'text-input cell-input' }));
			input.type = 'text';
			input.placeholder = strings.valuePlaceholder;
			input.value = row.values[columnIndex] || '';
			input.setAttribute('data-role', `row-value-${columnIndex}`);
			bindText(
				input,
				(v) => {
					row.values[columnIndex] = v;
				},
				postEditDebounced,
				postEdit,
			);
			td.appendChild(input);
			tr.appendChild(td);
		});

		// Leere Zelle unter der Phantom-Spalte „+ Neue Spalte“.
		tr.appendChild(el('td', { className: 'col-new-column' }));

		const weightTd = el('td', { className: 'col-weight' });
		const weightCell = el('div', { className: 'weight-cell-row' });
		const weightInput = /** @type {HTMLInputElement} */ (
			el('input', { className: 'text-input cell-input weight-input' })
		);
		weightInput.type = 'text';
		weightInput.inputMode = 'decimal';
		weightInput.value = row.weight || '';
		weightInput.setAttribute('data-role', 'row-weight');
		weightInput.setAttribute('aria-label', strings.colHeaderWeight);
		const refreshWeightError = () => {
			const missing = (row.weight || '').trim() === '';
			updateFieldError(
				weightInput,
				missing ? strings.weightRequiredError : strings.weightInvalidError,
				parseWeight(row.weight) === null,
			);
		};
		// Die Eingabe wird nie verändert (kein Ausgleich, kein Begrenzen) —
		// was hier steht, ist die Wahrheit; nur die Summenzeile rechnet mit.
		bindText(
			weightInput,
			(v) => {
				row.weight = v;
				refreshWeightError();
				updateTotalRow();
			},
			postEditDebounced,
			postEdit,
		);
		refreshWeightError();
		weightCell.appendChild(weightInput);
		weightCell.appendChild(el('span', { className: 'weight-suffix', text: '%' }));
		weightTd.appendChild(weightCell);
		tr.appendChild(weightTd);

		const actionsTd = el('td', { className: 'col-actions' });
		const removeBtn = el('button', { className: 'icon-button icon-button-danger' });
		removeBtn.type = 'button';
		removeBtn.title = strings.removeRowLabel;
		removeBtn.setAttribute('aria-label', strings.removeRowLabel);
		removeBtn.appendChild(el('i', { className: 'codicon codicon-trash' }));
		removeBtn.addEventListener('click', () => removeRow(index));
		actionsTd.appendChild(removeBtn);
		tr.appendChild(actionsTd);

		tr.appendChild(el('td', { className: 'col-spacer' }));

		return tr;
	}

	/** @type {HTMLElement | null} Gewichtszelle der Summenzeile, von updateTotalRow live aktualisiert. */
	let totalValueEl = null;

	/** Summenzeile unter dem Grid: alle Gewichte zusammen sollen 100 % ergeben. @param {number} columnCount Spaltenzahl ohne Füll-Spalte. */
	function renderTotalRow(columnCount) {
		const tfoot = el('tfoot');
		const tr = el('tr', { className: 'total-row' });

		// Beschriftung über Zeilennummern-, Werte- und Phantom-Spalte hinweg,
		// rechtsbündig direkt vor der Gewichtsspalte (columnCount enthält
		// num + Wertespalten + Phantom + Gewicht + Aktionen).
		const labelTd = el('td', { className: 'total-label', text: strings.totalLabel });
		labelTd.colSpan = columnCount - 2;
		tr.appendChild(labelTd);

		totalValueEl = el('td', { className: 'total-value' });
		tr.appendChild(totalValueEl);

		tr.appendChild(el('td', { className: 'col-actions' }));
		tr.appendChild(el('td', { className: 'col-spacer' }));
		tfoot.appendChild(tr);
		updateTotalRow();
		return tfoot;
	}

	/**
	 * Aktualisiert die Summenzeile direkt beim Tippen, ohne das Grid neu zu
	 * bauen — rein informativ, ohne jede Prüfung: die Gewichte dürfen in
	 * Summe beliebig von 100 % abweichen. Wird auch von renderTotalRow selbst
	 * (noch vor dem Einhängen ins DOM) für die Erstbefüllung aufgerufen —
	 * daher bewusst keine isConnected-Prüfung.
	 */
	function updateTotalRow() {
		if (!totalValueEl) {
			return;
		}
		totalValueEl.textContent = `${formatWeight(weightTotal())} %`;
	}

	function addRow() {
		state.rows.push({ values: state.columns.map(() => ''), weight: '' });
		postEdit();
		render();
		const lastRow = app.querySelector('.lookup-table tbody tr:last-child');
		const firstInput = lastRow && lastRow.querySelector('input[data-role="row-value-0"], input[data-role="row-weight"]');
		if (firstInput instanceof HTMLInputElement) {
			firstInput.focus();
		}
	}

	/** @param {number} index */
	function removeRow(index) {
		state.rows.splice(index, 1);
		postEdit();
		render();
	}

	/**
	 * Legt eine neue Wertespalte an (Toolbar-Knopf mit leerem Namen bzw.
	 * Phantom-Kopfzelle mit dem bereits getippten Text) und fokussiert ihre
	 * Kopfzelle, Cursor ans Ende.
	 * @param {string} initialName
	 */
	function addColumn(initialName) {
		state.columns.push(initialName);
		for (const row of state.rows) {
			row.values.push('');
		}
		postEdit();
		render();
		const headerInputs = app.querySelectorAll('.lookup-table thead input[data-role="column-header"]');
		const lastHeader = headerInputs[headerInputs.length - 1];
		if (lastHeader instanceof HTMLInputElement) {
			lastHeader.focus();
			lastHeader.setSelectionRange(lastHeader.value.length, lastHeader.value.length);
		}
	}

	/** @param {number} index */
	function removeColumn(index) {
		state.columns.splice(index, 1);
		for (const row of state.rows) {
			row.values.splice(index, 1);
		}
		postEdit();
		render();
	}

	// ---------------------------------------------------------------------
	// Fehlerzustand (kaputtes CSV)
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
				columnWidths = message.columnWidths && typeof message.columnWidths === 'object' ? message.columnWidths : {};
				parseError = 'parseError' in message ? message.parseError : null;
				if ('lookup' in message) {
					state = message.lookup;
				}
				render();
				break;
			case 'update':
				parseError = null;
				state = message.lookup;
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
