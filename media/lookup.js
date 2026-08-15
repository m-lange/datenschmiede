// @ts-check
// Webview script for the lookup list editor (.lkp). Deliberately kept as a
// standalone, uncompiled script (no bundling needed, no dependencies) — the
// same mechanism as table.js.
//
// Its structure mirrors the table editor: an "Overview" tab (name/description
// plus the distribution chart) and a "Values" tab (the grid). In the grid each
// value column can be renamed directly through its header cell; the phantom
// header cell "+ New column" creates a new column as soon as you type. The
// weight column is always the last column; the weights are free to choose (they
// may even sum to more than 100 %) — the total row below the grid shows the
// current sum for information only, without validating it. Only an individual
// empty or invalid weight is marked red (and reported in the Problems view).
(function () {
	'use strict';

	/** @type {{ postMessage: (msg: any) => void }} */
	// eslint-disable-next-line no-undef
	const vscode = acquireVsCodeApi();

	// Shared, stateless building blocks from common.js (loaded before this
	// script, see getHtml in lookup/editorProvider.ts).
	// eslint-disable-next-line no-undef
	const {
		el,
		bindText,
		debounce,
		renderTextField: renderTextFieldCommon,
		renderLabeledMarkdownField,
		renderErrorState,
		updateFieldError,
		renderAutoSizeColumnsButton,
		buildColGroup,
		attachColumnResizeHandle,
		fixColumnWidths,
	} = window.DatenschmiedeCommon;

	/** @typedef {{values:string[],weight:string}} LookupRow */
	/** @typedef {{name:string,description:string,columns:string[],rows:LookupRow[]}} LookupList */
	/** @typedef {import('../src/lookup/webviewStrings').LookupWebviewStrings} LookupWebviewStrings */

	/** @type {LookupWebviewStrings | null} the strings arrive once via the 'init' message from the extension host */
	let strings = null;
	/** @type {LookupList} */
	let state = { name: '', description: '', columns: [], rows: [] };
	/** @type {string | null} */
	let parseError = null;
	/** @type {'overview' | 'values'} */
	let activeTab = 'values';
	/** @type {Record<string, number>} manually dragged column widths, remembered per machine (see table.js for details) */
	let columnWidths = {};
	/** @type {(() => void) | null} set by renderValuesTab: computes the final column widths once the table is in the DOM (see render()). */
	let pendingColumnSizing = null;

	const VALUE_COLUMN_MIN_WIDTH = 140;
	const WEIGHT_COLUMN_MIN_WIDTH = 110;

	const app = document.getElementById('app');

	function postEdit() {
		vscode.postMessage({ type: 'edit', lookup: state });
	}

	const postEditDebounced = debounce(postEdit, 250);

	// ---------------------------------------------------------------------
	// Weights: a copy of the vscode-free helpers from src/lookup/model.ts — the
	// webview works without module bundling and cannot import them.
	// ---------------------------------------------------------------------

	/** Parses a weight; `null` for empty or invalid input. @param {string} raw @returns {number | null} */
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

	/** Rounded to 2 decimal places, without trailing zeros. @param {number} value */
	function formatWeight(value) {
		return String(Math.round(value * 100) / 100);
	}

	/** Small {0} placeholder substitution for the webview strings. @param {string} template @param {...(string|number)} args */
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
		// Tab bar and content are separate: the bar stays at the top, only the
		// content area scrolls (.tab-content, see main.css).
		const content = el('div', { className: 'tab-content' });
		if (parseError) {
			content.appendChild(renderErrorState(strings, parseError));
			app.appendChild(content);
			return;
		}
		app.appendChild(renderTabs());
		content.appendChild(activeTab === 'overview' ? renderOverviewTab() : renderValuesTab());
		app.appendChild(content);

		// Only now (with the table in the real DOM) can the width actually
		// needed per column be measured — see renderValuesTab.
		if (pendingColumnSizing) {
			pendingColumnSizing();
		}
	}

	// ---------------------------------------------------------------------
	// Header area: tabs
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
	// "Overview" tab: name / description + distribution chart
	// ---------------------------------------------------------------------

	function renderOverviewTab() {
		const wrap = el('section', { className: 'tab-panel overview-stack' });

		const fields = el('div', { className: 'field-group card' });
		fields.appendChild(
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
		fields.appendChild(renderDescriptionField());
		wrap.appendChild(fields);

		wrap.appendChild(renderChartCard());
		return wrap;
	}

	/** Thin wrapper around the shared text field (common.js), using this editor's commit functions. */
	function renderTextField(id, labelText, value, placeholder, onChange, extraClass) {
		return renderTextFieldCommon(id, labelText, value, placeholder, onChange, postEditDebounced, postEdit, extraClass);
	}

	function renderDescriptionField() {
		return renderLabeledMarkdownField(
			strings.fieldDescriptionLabel,
			strings.fieldDescriptionPlaceholder,
			state.description,
			(v) => {
				state.description = v;
			},
			postEditDebounced,
			postEdit,
		);
	}

	/**
	 * Distribution chart: one horizontal bar per value row (in row order, so
	 * chart and grid map onto each other directly), labelled with the first
	 * column's value and the weight at the end of the bar. One series -> one
	 * colour (list green, with a variant per theme brightness, see main.css)
	 * and no legend; bar length is scaled relative to the largest weight, with
	 * the exact values printed next to it.
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
	// "Values" tab: toolbar + grid
	// ---------------------------------------------------------------------

	function renderValuesTab() {
		const section = el('section', { className: 'tab-panel columns-section' });

		const toolbar = el('div', { className: 'toolbar' });
		toolbar.appendChild(renderToolbarButton('codicon-add', strings.addRowButton, addRow));
		toolbar.appendChild(renderToolbarButton('codicon-split-horizontal', strings.addColumnButton, () => addColumn('')));
		const evenButton = renderToolbarButton(
			'codicon-law',
			strings.distributeEvenlyButton,
			distributeWeightsEvenly,
			strings.distributeEvenlyTooltip,
		);
		evenButton.disabled = state.rows.length === 0;
		toolbar.appendChild(evenButton);
		// Starts disabled; once the total row exists (rows > 0), updateTotalRow
		// sets the state according to the current sum.
		normalizeButton = renderToolbarButton(
			'codicon-percentage',
			strings.normalizeWeightsButton,
			normalizeWeights,
			strings.normalizeWeightsTooltip,
		);
		normalizeButton.disabled = true;
		toolbar.appendChild(normalizeButton);
		toolbar.appendChild(
			renderAutoSizeColumnsButton({
				label: strings.autoSizeColumnsLabel,
				widths: columnWidths,
				onReset: (widths) => {
					vscode.postMessage({ type: 'columnWidths', columnWidths: widths });
					render();
				},
			}),
		);
		section.appendChild(toolbar);

		const wrap = el('div', { className: 'columns-table-wrap' });
		const table = el('table', { className: 'columns-table lookup-table' });

		// Fixed column order for buildColGroup: value columns dynamically
		// (v0..vn), followed by the phantom column, weight column and actions.
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

		// See renderColumnsTab in table.js: measure in the real DOM first, then
		// switch to table-layout: fixed.
		pendingColumnSizing = () => fixColumnWidths(table, resizable, resizableHeaders, cols, columnWidths);

		return section;
	}

	/** Toolbar button with a codicon and a label. @param {string} icon @param {string} label @param {() => void} onClick @param {string} [title] */
	function renderToolbarButton(icon, label, onClick, title) {
		const btn = /** @type {HTMLButtonElement} */ (el('button', { className: 'toolbar-btn' }));
		btn.type = 'button';
		if (title) {
			btn.title = title;
		}
		btn.appendChild(el('i', { className: `codicon ${icon}` }));
		btn.appendChild(document.createTextNode(label));
		btn.addEventListener('click', onClick);
		return btn;
	}

	/** Header cell of a value column: rename input plus "remove column". @param {number} index */
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
	 * Phantom header cell "+ New column": the first keystroke creates a real
	 * column with the typed text and moves focus into that (new) header cell, so
	 * typing continues seamlessly.
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
	 * One value row of the grid: row number, value cells, weight and actions.
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

		// Empty cell below the "+ New column" phantom column.
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
		// The input is never modified (no balancing, no clamping) — whatever is
		// entered here is the truth; only the total row does any arithmetic.
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

	/** @type {HTMLElement | null} Weight cell of the total row, updated live by updateTotalRow. */
	let totalValueEl = null;
	/** @type {HTMLButtonElement | null} The "scale to 100 %" button — enabled/disabled by updateTotalRow depending on the current sum. */
	let normalizeButton = null;

	/** Total row below the grid: all weights together are meant to add up to 100 %. @param {number} columnCount Column count excluding the filler column. */
	function renderTotalRow(columnCount) {
		const tfoot = el('tfoot');
		const tr = el('tr', { className: 'total-row' });

		// The label spans the row number, value and phantom columns, right
		// aligned directly before the weight column (columnCount contains
		// num + value columns + phantom + weight + actions).
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
	 * Updates the total row while typing, without rebuilding the grid — purely
	 * informational, without any validation: the weights may deviate from 100 %
	 * by any amount. renderTotalRow itself also calls this (before the row is
	 * attached to the DOM) for the initial fill — hence deliberately no
	 * isConnected check.
	 */
	function updateTotalRow() {
		const total = weightTotal();
		// Scaling is only possible with a positive sum — the button follows the
		// sum live while typing (like the total row itself).
		if (normalizeButton) {
			normalizeButton.disabled = state.rows.length === 0 || total <= 0;
		}
		if (!totalValueEl) {
			return;
		}
		totalValueEl.textContent = `${formatWeight(total)} %`;
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

	/** Deletes one value row. @param {number} index */
	function removeRow(index) {
		state.rows.splice(index, 1);
		postEdit();
		render();
	}

	/**
	 * Creates a new value column (toolbar button with an empty name, or phantom
	 * header cell with the text already typed) and focuses its header cell with
	 * the cursor at the end.
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

	/** Deletes one value column, including its cells in every row. @param {number} index */
	function removeColumn(index) {
		state.columns.splice(index, 1);
		for (const row of state.rows) {
			row.values.splice(index, 1);
		}
		postEdit();
		render();
	}

	// ---------------------------------------------------------------------
	// Weight commands of the toolbar
	// ---------------------------------------------------------------------

	/**
	 * Distributes 100 % evenly across all rows. The rounding difference at 2
	 * decimal places (e.g. 3 × 33.33 = 99.99) is absorbed by the last row so
	 * the sum is exactly 100.
	 */
	function distributeWeightsEvenly() {
		const count = state.rows.length;
		if (count === 0) {
			return;
		}
		const share = Math.round((100 / count) * 100) / 100;
		state.rows.forEach((row, index) => {
			const value = index === count - 1 ? 100 - share * (count - 1) : share;
			row.weight = formatWeight(value);
		});
		postEdit();
		render();
	}

	/**
	 * Scales the existing weights proportionally so the sum is exactly 100 —
	 * the distribution is preserved. Empty or invalid weights count as 0. The
	 * rounding difference is absorbed by the row with the largest weight: it can
	 * take the (tiny) correction without going negative.
	 */
	function normalizeWeights() {
		const total = weightTotal();
		if (state.rows.length === 0 || total <= 0) {
			return;
		}
		const weights = state.rows.map((row) => parseWeight(row.weight) || 0);
		const scaled = weights.map((weight) => Math.round((weight / total) * 100 * 100) / 100);
		const diff = 100 - scaled.reduce((sum, value) => sum + value, 0);
		if (diff !== 0) {
			const maxIndex = weights.indexOf(Math.max(...weights));
			scaled[maxIndex] += diff;
		}
		state.rows.forEach((row, index) => {
			row.weight = formatWeight(scaled[index]);
		});
		postEdit();
		render();
	}

	// ---------------------------------------------------------------------
	// Messages from the extension host
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
