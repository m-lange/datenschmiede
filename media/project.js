// @ts-check
// Webview script for the project editor (.tdproject). The counterpart to
// table.js: same structure (tabs, cards, markdown description field) but for
// the project model instead of a table. It shares the stateless building blocks
// with table.js via common.js (loaded before this script, see getHtml in
// project/editorProvider.ts).
//
// The tables tab hosts the complete table picker right here as a tree table
// (grouped by schema namespaces, with checkboxes) — unlike before, no separate
// view in the explorer sidebar.
(function () {
	'use strict';

	/** @type {{ postMessage: (msg: any) => void }} */
	// eslint-disable-next-line no-undef
	const vscode = acquireVsCodeApi();

	// eslint-disable-next-line no-undef
	const {
		el,
		bindText,
		formatDateTime,
		renderSearchField,
		renderAutoSizeColumnsButton,
		debounce,
		renderTextField: renderTextFieldCommon,
		renderLabeledMarkdownField,
		renderErrorState,
		variableLabel: variableLabelCommon,
		createDeferredRenderer,
		updateFieldError,
		buildColGroup,
		attachColumnResizeHandle,
		fixColumnWidths,
		showFloatingMenu,
		renderTagField,
	} = window.DatenschmiedeCommon;

	/** @typedef {{path:string,records?:string}} ProjectTable */
	/** @typedef {{path:string,id?:string}} PythonLink */
	/** @typedef {{name:string,description:string,python:PythonLink|null,outputPath:string,tables:ProjectTable[]}} Project */
	/** @typedef {{kind:'group',segment:string,children:ProjectPickerNode[]}} ProjectPickerGroupNode */
	/** @typedef {{kind:'table',path:string,label:string,found:boolean,checked:boolean,locked:boolean,secondary:boolean,referencedTable?:string,records?:string}} ProjectPickerTableNode */
	/** @typedef {ProjectPickerGroupNode | ProjectPickerTableNode} ProjectPickerNode */
	/** @typedef {{path:string,label:string,resolved:boolean,ok:boolean}} PythonStatus */
	/** @typedef {{path:string,label:string,fileName:string,ext:string,records?:string,estimatedMin?:number,estimatedMax?:number,lastRunRecords?:number,found:boolean,secondary:boolean,referencedTable?:string}} OutputFileRow */
	/** @typedef {import('../src/project/diagram').ProjectDiagram} ProjectDiagram */
	/** @typedef {import('../src/project/webviewStrings').ProjectWebviewStrings} ProjectWebviewStrings */

	/** @type {ProjectWebviewStrings | null} the strings arrive once via the 'init' message from the extension host */
	let strings = null;
	/** @type {Project} */
	let project = { name: '', description: '', python: null, outputPath: '', tables: [] };
	/** @type {string | null} */
	let parseError = null;
	/** @type {'overview' | 'tables' | 'diagram'} */
	let activeTab = 'overview';
	/** @type {ProjectPickerNode[]} */
	let pickerTree = [];
	/** @type {OutputFileRow[]} Output files overview (one row per selected table), supplied by the extension host. */
	let outputFiles = [];
	/** Time of the last generator run (epoch ms), or undefined if there was none. */
	let lastRunAt;
	/** @type {ProjectDiagram | null} ER diagram of the selected tables (see src/project/diagram.ts), supplied by the extension host. */
	let diagram = null;
	/** @type {PythonStatus | null} */
	let pythonStatus = null;
	/** Current search text of the tables tab (purely client-side, no extension host round trip needed). */
	let tablesFilterText = '';
	/**
	 * Manually dragged column widths in the picker tree (px), per column key —
	 * the same pattern as columnWidths in table.js, but remembered per machine
	 * under its own key (see project/editorProvider.ts).
	 * @type {Record<string, number>}
	 */
	let columnWidths = {};
	/** @type {(() => void) | null} set by renderTablesTree: computes the final column widths once the table is in the DOM (see render()). */
	let pendingColumnSizing = null;
	/**
	 * Namespace icon plus the three row icon variants (normal/locked/invalid) as
	 * webview URI pairs (light/dark) — they arrive once via the 'init' message
	 * from the extension host (see project/editorProvider.ts, the same SVGs as
	 * the file icon in the explorer).
	 * @type {{normal:{dark:string,light:string},required:{dark:string,light:string},invalid:{dark:string,light:string},namespace:{dark:string,light:string}} | null}
	 */
	let treeIcons = null;
	/** Collapsed namespace groups (path made of the dot-separated schema segments, e.g. "ag.cor") — purely client-side, not persisted. @type {Set<string>} */
	const collapsedGroups = new Set();

	/** Resizable columns of the picker tree with their minimum width (px). */
	const RESIZABLE_COLUMNS = [
		{ key: 'name', minWidth: 220 },
		{ key: 'path', minWidth: 200 },
		{ key: 'records', minWidth: 200 },
	];
	/** Fixed column order of the picker tree, for buildColGroup (see common.js). The checkbox lives inside the name column of the tree row itself (see renderTableRow), not in a column of its own. */
	const COLUMN_ORDER = ['name', 'path', 'records', 'actions'];
	/** Indentation per tree level (px) — room for a twistie (16px) plus spacing (4px), see renderGroupRow/renderTableRow. */
	const INDENT_UNIT = 20;

	/** Thousands separator for the records column, matching the webview language (see <html lang> in project/editorProvider.ts#getHtml). */
	const recordsNumberFormat = new Intl.NumberFormat(document.documentElement.lang === 'de' ? 'de-DE' : 'en-US');

	/** Formats a number with the webview language's thousands separator. @param {number} n */
	function formatRecordsNumber(n) {
		return recordsNumberFormat.format(n);
	}

	/** Strips everything except digits — robust against any language's thousands separator (dot, comma, narrow space, …). @param {string} value */
	function digitsOnly(value) {
		return value.replace(/[^0-9]/g, '');
	}

	/** Number of non-digit characters before `pos` in `str` — used to adjust the cursor while cleaning the input live. @param {string} str @param {number} pos */
	function countNonDigitsBefore(str, pos) {
		let count = 0;
		for (let i = 0; i < pos && i < str.length; i++) {
			if (!/[0-9]/.test(str[i])) {
				count++;
			}
		}
		return count;
	}

	// Cardinality for referenced tables ("5" or "1..3") — a small counterpart to
	// src/table/cardinality.ts for immediate input feedback.
	/** Parses a cardinality; `null` for malformed input. @param {string} raw */
	function parseCardinality(raw) {
		const match = /^\s*(\d+)\s*(?:\.\.\s*(\d+)\s*)?$/.exec(raw || '');
		if (!match) {
			return null;
		}
		const min = Number(match[1]);
		const max = match[2] !== undefined ? Number(match[2]) : min;
		if (min > max) {
			return null;
		}
		return { min, max };
	}

	/**
	 * Display text of a stored `records` value: a plain number with thousands
	 * separators, everything else (a range "1..3", invalid input) unchanged.
	 * @param {string} raw
	 */
	function formatRecordsDisplay(raw) {
		return /^\d+$/.test(raw) ? formatRecordsNumber(Number(raw)) : raw;
	}

	const app = document.getElementById('app');

	function postEdit() {
		vscode.postMessage({ type: 'edit', project });
	}

	const postEditDebounced = debounce(postEdit, 250);

	// ---------------------------------------------------------------------
	// Anti-flicker: tree/overview broadcasts from the extension host (after file
	// changes in the workspace) no longer trigger an immediate re-render —
	// unchanged payloads are ignored, and for real changes the re-render is
	// deferred while an input has focus. For the mechanism see
	// createDeferredRenderer in common.js.
	// ---------------------------------------------------------------------

	/** Last processed tree/overview state (JSON), used to ignore unchanged broadcasts. */
	let lastBroadcastJson = '';

	const deferredRender = createDeferredRenderer(() => render());

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
		content.appendChild(
			activeTab === 'overview' ? renderOverviewTab() : activeTab === 'tables' ? renderTablesTab() : renderDiagramTab(),
		);
		app.appendChild(content);

		// Only now (with the tree table in the real DOM) can the width actually
		// needed per column be measured — see renderTablesTree.
		if (pendingColumnSizing) {
			pendingColumnSizing();
		}
	}

	// ---------------------------------------------------------------------
	// Header area: tabs (as in table.js)
	// ---------------------------------------------------------------------

	function renderTabs() {
		const bar = el('div', { className: 'tabbar' });
		bar.setAttribute('role', 'tablist');
		bar.appendChild(renderTabButton('overview', strings.tabOverview));
		bar.appendChild(renderTabButton('tables', `${strings.tabTables} (${countCheckedTables(pickerTree)})`));
		bar.appendChild(renderTabButton('diagram', strings.tabDiagram));
		return bar;
	}

	/** Switches to the given tab and re-renders. @param {'overview'|'tables'|'diagram'} tab */
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
	// "Overview" tab: name / description / Python interpreter
	// ---------------------------------------------------------------------

	function renderOverviewTab() {
		const stack = el('div', { className: 'tab-panel overview-stack' });

		const section = el('section', { className: 'field-group card' });
		section.appendChild(
			renderTextField(
				'f-name',
				strings.fieldNameLabel,
				project.name,
				strings.fieldNamePlaceholder,
				(v) => {
					project.name = v;
				},
				// Large title font as in the generator editor.
				'title-input',
			),
		);
		section.appendChild(renderDescriptionField());
		stack.appendChild(section);

		stack.appendChild(renderEnvironmentCard());
		stack.appendChild(renderGenerateCard());
		stack.appendChild(renderOutputFilesCard());

		return stack;
	}

	// ---------------------------------------------------------------------
	// Overview: output files + output folder + the generator run's start button
	// ---------------------------------------------------------------------

	/**
	 * Display name of a `{…}` variable — labels shared with the table editor's
	 * tag field (see variableLabel in common.js), so tags are named identically
	 * in both editors.
	 * @param {string} token
	 */
	function variableLabel(token) {
		return variableLabelCommon(strings, token);
	}

	/** Variables available for the project's output folder (no table/column context). */
	const OUTPUT_PATH_VARIABLES = ['date', 'time', 'datetime', 'timestamp', 'project'];

	/**
	 * Renders a table's file name template read-only: `{…}` parts as tags (the
	 * same look as the editable tag field in the table editor), with the
	 * constant text in between unchanged.
	 * @param {string} template
	 * @param {string} ext
	 */
	function renderFileNamePreview(template, ext) {
		const wrap = el('span', { className: 'filename-preview' });
		const pattern = /\{([^{}]+)\}/g;
		let lastIndex = 0;
		let match;
		while ((match = pattern.exec(template)) !== null) {
			if (match.index > lastIndex) {
				wrap.appendChild(el('span', { text: template.slice(lastIndex, match.index) }));
			}
			const token = match[1];
			const chip = el('span', { className: 'filename-tag' });
			chip.title = `{${token}}`;
			const inner = el('span', { className: 'filename-tag-inner' });
			inner.appendChild(
				el('i', {
					className: `codicon ${token.startsWith('column:') ? 'codicon-symbol-field' : 'codicon-symbol-variable'}`,
				}),
			);
			inner.appendChild(el('span', { text: variableLabel(token) }));
			chip.appendChild(inner);
			wrap.appendChild(chip);
			lastIndex = match.index + match[0].length;
		}
		if (lastIndex < template.length) {
			wrap.appendChild(el('span', { text: template.slice(lastIndex) }));
		}
		wrap.appendChild(el('span', { className: 'filename-ext', text: ext }));
		return wrap;
	}

	/**
	 * The "output folder" field: a tag field like the file name in the table
	 * editor — constant text plus dynamic variables (date, timestamp, project
	 * name, …). Relative to the project file; empty -> "output".
	 */
	/**
	 * "Additional Python packages": path to a requirements.txt listing what this
	 * project's custom generators import beyond the built-ins. The run checks
	 * the linked interpreter against it and offers to install what is missing
	 * (see project/requirements.ts) — nothing is installed silently.
	 */
	function renderRequirementsField() {
		const field = el('div', { className: 'field' });
		field.appendChild(el('label', { text: strings.requirementsLabel }));

		const row = el('div', { className: 'filename-row' });
		const input = /** @type {HTMLInputElement} */ (el('input', { className: 'text-input' }));
		input.type = 'text';
		input.placeholder = strings.requirementsPlaceholder;
		input.value = project.requirements || '';
		input.setAttribute('aria-label', strings.requirementsLabel);
		bindText(
			input,
			(value) => {
				project.requirements = value;
			},
			postEditDebounced,
			postEdit,
		);
		row.appendChild(input);

		// File picker (native VS Code), mirroring the output folder's browse button.
		const browseBtn = el('button', { className: 'icon-button' });
		browseBtn.type = 'button';
		browseBtn.title = strings.requirementsBrowseLabel;
		browseBtn.setAttribute('aria-label', strings.requirementsBrowseLabel);
		browseBtn.appendChild(el('i', { className: 'codicon codicon-file-code' }));
		browseBtn.addEventListener('click', () => {
			vscode.postMessage({ type: 'pickRequirementsFile' });
		});
		row.appendChild(browseBtn);

		if ((project.requirements || '').trim()) {
			const clearBtn = el('button', { className: 'icon-button icon-button-danger' });
			clearBtn.type = 'button';
			clearBtn.title = strings.requirementsClearLabel;
			clearBtn.setAttribute('aria-label', strings.requirementsClearLabel);
			clearBtn.appendChild(el('i', { className: 'codicon codicon-close' }));
			clearBtn.addEventListener('click', () => {
				project.requirements = '';
				postEdit();
				render();
			});
			row.appendChild(clearBtn);
		}

		field.appendChild(row);
		field.appendChild(el('p', { className: 'hint', text: strings.requirementsHint }));
		return field;
	}

	function renderOutputPathField() {
		const field = el('div', { className: 'field' });
		field.appendChild(el('label', { text: strings.outputPathLabel }));

		const row = el('div', { className: 'filename-row' });
		const tagField = renderTagField({
			value: project.outputPath || '',
			placeholder: strings.outputPathPlaceholder,
			ariaLabel: strings.outputPathLabel,
			labelFor: variableLabel,
			iconFor: () => 'symbol-variable',
			onChange: (value, immediate) => {
				project.outputPath = value;
				if (immediate) {
					postEdit();
				} else {
					postEditDebounced();
				}
			},
		});
		row.appendChild(tagField.element);

		// Folder picker (native VS Code) — the result lands in the tag field as
		// constant text; variables can still be added afterwards.
		const browseBtn = el('button', { className: 'icon-button' });
		browseBtn.type = 'button';
		browseBtn.title = strings.outputPathBrowseLabel;
		browseBtn.setAttribute('aria-label', strings.outputPathBrowseLabel);
		browseBtn.appendChild(el('i', { className: 'codicon codicon-folder-opened' }));
		browseBtn.addEventListener('click', () => {
			vscode.postMessage({ type: 'pickOutputFolder' });
		});
		row.appendChild(browseBtn);

		field.appendChild(row);

		// "Insert dynamic value" on its own line below the field.
		const actionsRow = el('div', { className: 'filename-actions' });
		const addBtn = el('button', { className: 'toolbar-btn' });
		addBtn.type = 'button';
		addBtn.appendChild(el('i', { className: 'codicon codicon-add' }));
		addBtn.appendChild(document.createTextNode(strings.outputAddVariableButton));
		addBtn.addEventListener('click', (event) => {
			event.stopPropagation();
			const rect = addBtn.getBoundingClientRect();
			/** @type {any[]} */
			const entries = [{ kind: 'label', text: strings.outputVariableGroupLabel }];
			for (const variable of OUTPUT_PATH_VARIABLES) {
				entries.push({
					kind: 'item',
					text: variableLabel(variable),
					icon: 'symbol-variable',
					onPick: () => tagField.insertVariable(variable),
				});
			}
			showFloatingMenu(rect.left, rect.bottom + 2, entries);
		});
		actionsRow.appendChild(addBtn);
		field.appendChild(actionsRow);

		field.appendChild(el('p', { className: 'hint', text: strings.outputPathHint }));
		return field;
	}

	/**
	 * The "generated files" card: the generator run's start button plus a
	 * read-only overview of which file the run will produce for each selected
	 * table (td file, name, file name, record count) — editing happens in the
	 * table editor or on the tables tab.
	 */
	/**
	 * "Generate test data": the start button and where the files land. Next to
	 * the button stands the time of the last run, so it is visible without
	 * switching to the diagram whether what one sees below is fresh.
	 */
	function renderGenerateCard() {
		const card = el('section', { className: 'field-group card' });

		const toolbar = el('div', { className: 'run-toolbar' });
		const runBtn = el('button', { className: 'run-button' });
		runBtn.type = 'button';
		runBtn.appendChild(el('i', { className: 'codicon codicon-play' }));
		runBtn.appendChild(document.createTextNode(strings.runButtonLabel));
		runBtn.addEventListener('click', () => {
			vscode.postMessage({ type: 'runGeneration' });
		});
		toolbar.appendChild(runBtn);
		const lastRun = formatDateTime(lastRunAt);
		if (lastRun) {
			toolbar.appendChild(
				el('span', { className: 'run-last-time', text: strings.generateLastRunText.replace('{0}', lastRun) }),
			);
		}
		card.appendChild(toolbar);

		card.appendChild(renderOutputPathField());
		return card;
	}

	function renderOutputFilesCard() {
		const card = el('section', { className: 'field-group card' });
		card.appendChild(el('h3', { className: 'card-title', text: strings.outputFilesTitle }));
		card.appendChild(el('p', { className: 'hint', text: strings.outputFilesHint }));

		if (outputFiles.length === 0) {
			card.appendChild(el('p', { className: 'hint', text: strings.outputFilesEmptyText }));
			return card;
		}

		const wrap = el('div', { className: 'columns-table-wrap' });
		const table = el('table', { className: 'columns-table output-files-table' });

		const thead = el('thead');
		const headRow = el('tr');
		headRow.appendChild(el('th', { className: 'col-name', text: strings.outputFilesColTable }));
		headRow.appendChild(el('th', { className: 'col-desc', text: strings.outputFilesColFile }));
		headRow.appendChild(el('th', { className: 'col-desc', text: strings.outputFilesColFileName }));
		headRow.appendChild(el('th', { className: 'col-records-wide', text: strings.outputFilesColRecords }));
		headRow.appendChild(el('th', { className: 'col-records-wide', text: strings.outputFilesColLastRun }));
		headRow.appendChild(el('th', { className: 'col-spacer' }));
		thead.appendChild(headRow);
		table.appendChild(thead);

		const tbody = el('tbody');
		for (const row of outputFiles) {
			const tr = el('tr');

			const nameTd = el('td', { className: 'tree-name-cell' });
			const nameRow = el('span', { className: 'tree-row' });
			if (treeIcons) {
				nameRow.appendChild(renderThemedIcon(row.found ? treeIcons.normal : treeIcons.invalid, 'tree-file-icon'));
			}
			nameRow.appendChild(el('span', { className: 'tree-table-label', text: row.label }));
			if (!row.found) {
				nameRow.appendChild(el('i', { className: 'codicon codicon-warning row-warning-icon' }));
			}
			nameTd.appendChild(nameRow);
			tr.appendChild(nameTd);

			tr.appendChild(el('td', { className: 'col-desc path-cell', text: row.path }));

			const fileNameTd = el('td', { className: 'col-desc' });
			if (row.found) {
				fileNameTd.appendChild(renderFileNamePreview(row.fileName, row.ext));
			} else {
				fileNameTd.appendChild(el('span', { className: 'missing-file-note', text: strings.tablesMissingFileText }));
			}
			tr.appendChild(fileNameTd);

			const recordsTd = el('td', { className: 'col-records-wide' });
			// A leading lookup list sets the count without any configured value,
			// so the estimate alone is reason enough to fill the cell.
			if (row.records || row.estimatedMin !== undefined) {
				const recordsWrap = el('span', { className: 'records-cell-row' });
				recordsWrap.appendChild(
					el('i', {
						className: `codicon ${row.secondary ? 'codicon-references' : 'codicon-table'} records-type-icon`,
					}),
				);
				// The count estimated from the configuration (for referenced
				// tables the cardinality multiplied along the FK chain) rather
				// than just the configured range; ranges use the same "min..max"
				// notation as the cardinality input (100 records × 1..3 →
				// "100..300"). The configuration itself is in the tooltip. If the
				// chain is not computable, the configured value stays.
				let text;
				if (row.estimatedMin !== undefined && row.estimatedMax !== undefined) {
					text =
						row.estimatedMin === row.estimatedMax
							? formatRecordsNumber(row.estimatedMin)
							: `${formatRecordsNumber(row.estimatedMin)}..${formatRecordsNumber(row.estimatedMax)}`;
				} else if (row.secondary) {
					text = `${row.records} ${strings.outputFilesPerRecordSuffix.replace('{0}', row.referencedTable || '')}`;
				} else {
					text = formatRecordsDisplay(row.records);
				}
				const textEl = el('span', { text });
				if (row.secondary) {
					textEl.title = `${row.records} ${strings.outputFilesPerRecordSuffix.replace('{0}', row.referencedTable || '')}`;
				}
				recordsWrap.appendChild(textEl);
				recordsTd.appendChild(recordsWrap);
			}
			tr.appendChild(recordsTd);

			// What the last run really wrote - next to the estimate, so a
			// configuration changed since then is visible as a difference.
			const lastRunTd = el('td', { className: 'col-records-wide' });
			if (row.lastRunRecords !== undefined) {
				const lastRunWrap = el('span', { className: 'records-cell-row' });
				lastRunWrap.appendChild(el('i', { className: 'codicon codicon-history records-type-icon' }));
				const value = el('span', { text: formatRecordsNumber(row.lastRunRecords) });
				const time = formatDateTime(lastRunAt);
				if (time) {
					value.title = strings.outputFilesLastRunTitle
						.replace('{0}', formatRecordsNumber(row.lastRunRecords))
						.replace('{1}', time);
				}
				lastRunWrap.appendChild(value);
				lastRunTd.appendChild(lastRunWrap);
			}
			tr.appendChild(lastRunTd);

			tr.appendChild(el('td', { className: 'col-spacer' }));
			tbody.appendChild(tr);
		}
		table.appendChild(tbody);

		wrap.appendChild(table);
		card.appendChild(wrap);
		return card;
	}

	/** Thin wrapper around the shared text field (common.js), using this editor's commit functions. */
	function renderTextField(id, labelText, value, placeholder, onChange, extraClass) {
		return renderTextFieldCommon(id, labelText, value, placeholder, onChange, postEditDebounced, postEdit, extraClass);
	}

	function renderDescriptionField() {
		return renderLabeledMarkdownField(
			strings.fieldDescriptionLabel,
			strings.fieldDescriptionPlaceholder,
			project.description,
			(v) => {
				project.description = v;
			},
			postEditDebounced,
			postEdit,
		);
	}

	/** Linked Python interpreter: status text + icon, plus a button to (re-)link it (see project/python.ts). */
	/**
	 * "Python environment": the linked interpreter and the requirements.txt that
	 * says what it has to provide. Both describe the same thing — where the run
	 * executes — so they sit in one card rather than among the project's
	 * description fields.
	 */
	function renderEnvironmentCard() {
		const card = el('section', { className: 'field-group card' });
		card.appendChild(el('h3', { className: 'card-title', text: strings.environmentSectionTitle }));
		card.appendChild(renderPythonField());
		card.appendChild(renderRequirementsField());
		return card;
	}

	function renderPythonField() {
		const field = el('div', { className: 'field' });
		field.appendChild(el('label', { text: strings.pythonSectionLabel }));

		const row = el('div', { className: 'python-row' });

		const status = el('span', { className: 'python-status' });
		if (!pythonStatus) {
			status.appendChild(el('i', { className: 'codicon codicon-plug' }));
			status.appendChild(el('span', { text: strings.pythonNotLinkedText }));
		} else if (!pythonStatus.resolved) {
			status.classList.add('python-status-warn');
			status.appendChild(el('i', { className: 'codicon codicon-warning' }));
			status.appendChild(el('span', { text: strings.pythonUnresolvedText }));
		} else if (!pythonStatus.ok) {
			status.classList.add('python-status-warn');
			status.appendChild(el('i', { className: 'codicon codicon-warning' }));
			status.appendChild(el('span', { text: `${pythonStatus.label} — ${strings.pythonBelowMinVersionText}` }));
		} else {
			status.classList.add('python-status-ok');
			status.appendChild(el('i', { className: 'codicon codicon-check' }));
			status.appendChild(el('span', { text: pythonStatus.label }));
		}
		row.appendChild(status);

		const button = el('button', { className: 'toolbar-btn' });
		button.type = 'button';
		button.appendChild(document.createTextNode(pythonStatus ? strings.pythonChangeButton : strings.pythonLinkButton));
		button.addEventListener('click', () => {
			vscode.postMessage({ type: 'changePython' });
		});
		row.appendChild(button);

		field.appendChild(row);
		return field;
	}

	// ---------------------------------------------------------------------
	// "Tables" tab: picker tree (namespaces + checkboxes) + record counts
	// ---------------------------------------------------------------------

	/** Whether the tree contains any table node at all. @param {ProjectPickerNode[]} nodes */
	function countCheckedTables(nodes) {
		let count = 0;
		for (const node of nodes) {
			count += node.kind === 'table' ? (node.checked ? 1 : 0) : countCheckedTables(node.children);
		}
		return count;
	}

	/**
	 * Whether a table matches the search text (by label or path).
	 * @param {ProjectPickerTableNode} node
	 * @param {string} filterLower
	 */
	function tableMatchesFilter(node, filterLower) {
		return node.label.toLowerCase().includes(filterLower) || node.path.toLowerCase().includes(filterLower);
	}

	/**
	 * Filters the tree to matching tables, keeping the groups that still contain
	 * at least one match.
	 * @param {ProjectPickerNode[]} nodes
	 * @param {string} filterLower
	 * @returns {ProjectPickerNode[]}
	 */
	function filterNodes(nodes, filterLower) {
		if (!filterLower) {
			return nodes;
		}
		/** @type {ProjectPickerNode[]} */
		const result = [];
		for (const node of nodes) {
			if (node.kind === 'table') {
				if (tableMatchesFilter(node, filterLower)) {
					result.push(node);
				}
			} else {
				const children = filterNodes(node.children, filterLower);
				if (children.length > 0) {
					result.push({ kind: 'group', segment: node.segment, children });
				}
			}
		}
		return result;
	}

	function renderTablesTab() {
		const section = el('section', { className: 'tab-panel tables-section' });

		const treeContainer = el('div');

		const search = renderSearchField({
			value: tablesFilterText,
			placeholder: strings.tablesSearchPlaceholder,
			clearLabel: strings.searchClearLabel,
			extraClass: 'tables-search',
			onChange: (value) => {
				tablesFilterText = value;
				renderTablesTree(treeContainer);
			},
		});
		// Search and the (secondary) column-fit control share one row — the tables
		// tab has no toolbar of its own.
		const searchRow = el('div', { className: 'tables-search-row' });
		searchRow.appendChild(search.element);
		searchRow.appendChild(
			renderAutoSizeColumnsButton({
				label: strings.autoSizeColumnsLabel,
				widths: columnWidths,
				onReset: (widths) => {
					vscode.postMessage({ type: 'columnWidths', columnWidths: widths });
					render();
				},
			}),
		);
		section.appendChild(searchRow);

		section.appendChild(treeContainer);
		renderTablesTree(treeContainer);

		return section;
	}

	/**
	 * Rebuilds the tables tab's tree table from scratch (after every
	 * search/expand/collapse change and on the first render). On the very first
	 * call `container` may still be detached from the real DOM (see render()) —
	 * the final column widths are then only applied once it is really in the
	 * document.
	 * @param {HTMLElement} container
	 */
	function renderTablesTree(container) {
		// A context menu that may still be open refers to the old tree state
		// (e.g. from before an update by the extension host) — close it instead
		// of continuing to work with stale nodes.
		dismissContextMenu();
		container.innerHTML = '';
		pendingColumnSizing = null;

		const filterLower = tablesFilterText.trim().toLowerCase();
		const filterActive = filterLower.length > 0;
		const nodes = filterNodes(pickerTree, filterLower);

		if (nodes.length === 0) {
			const empty = el('div', { className: 'empty-state' });
			empty.appendChild(el('i', { className: 'codicon codicon-table' }));
			if (filterLower) {
				empty.appendChild(el('p', { text: strings.tablesNoMatchesText }));
			} else {
				empty.appendChild(el('p', { text: strings.tablesEmptyStateText }));
				empty.appendChild(el('p', { className: 'hint', text: strings.tablesEmptyStateHint }));
			}
			container.appendChild(empty);
			return;
		}

		const wrap = el('div', { className: 'columns-table-wrap' });
		const table = el('table', { className: 'columns-table project-tables-table' });

		const { colgroup, cols } = buildColGroup(COLUMN_ORDER, columnWidths);
		table.appendChild(colgroup);

		const thead = el('thead');
		const headRow = el('tr');
		const thName = el('th', { className: 'col-name', text: strings.tablesColHeaderTable });
		const thPath = el('th', { className: 'col-desc', text: strings.tablesColHeaderPath });
		const thRecords = el('th', { className: 'col-records-wide', text: strings.tablesColHeaderRecords });
		headRow.appendChild(thName);
		headRow.appendChild(thPath);
		headRow.appendChild(thRecords);
		headRow.appendChild(el('th', { className: 'col-actions' }));
		headRow.appendChild(el('th', { className: 'col-spacer' }));
		thead.appendChild(headRow);
		table.appendChild(thead);

		const resizableHeaders = { name: thName, path: thPath, records: thRecords };
		for (const { key, minWidth } of RESIZABLE_COLUMNS) {
			attachColumnResizeHandle(resizableHeaders[key], cols[key], key, minWidth, columnWidths, (widths) =>
				vscode.postMessage({ type: 'columnWidths', columnWidths: widths }),
			);
		}

		const tbody = el('tbody');
		const refresh = () => renderTablesTree(container);
		appendPickerRows(tbody, nodes, 0, '', filterActive, refresh);
		table.appendChild(tbody);

		wrap.appendChild(table);
		container.appendChild(wrap);

		const sizeColumns = () => fixColumnWidths(table, RESIZABLE_COLUMNS, resizableHeaders, cols, columnWidths);
		if (container.isConnected) {
			// Subsequent re-render (search, expand/collapse): the container is
			// already in the real DOM, so the width can be measured right away.
			sizeColumns();
		} else {
			// First render: the container is not in the DOM yet (see render()).
			pendingColumnSizing = sizeColumns;
		}
	}

	/**
	 * Appends the rows of one tree level (recursively for groups).
	 * @param {HTMLElement} tbody
	 * @param {ProjectPickerNode[]} nodes
	 * @param {number} depth
	 * @param {string} parentPath Dot-separated path of the parent group (for collapsedGroups), empty at the root level.
	 * @param {boolean} filterActive While a search is active every (already match-filtered) group stays expanded — like VS Code's own tree search.
	 * @param {() => void} refresh Re-renders the tree table (after a group was expanded or collapsed).
	 */
	function appendPickerRows(tbody, nodes, depth, parentPath, filterActive, refresh) {
		for (const node of nodes) {
			if (node.kind === 'group') {
				const groupPath = parentPath ? `${parentPath}.${node.segment}` : node.segment;
				const collapsed = !filterActive && collapsedGroups.has(groupPath);
				tbody.appendChild(renderGroupRow(node, depth, groupPath, collapsed, refresh));
				if (!collapsed) {
					appendPickerRows(tbody, node.children, depth + 1, groupPath, filterActive, refresh);
				}
			} else {
				tbody.appendChild(renderTableRow(node, depth));
			}
		}
	}

	/**
	 * Builds a row's indentation/twistie area: indentation by tree depth, then a
	 * 16px twistie (groups) or an equally wide placeholder (tables) — only this
	 * way do the icon and text of group and table rows at the same depth line up
	 * exactly, regardless of whether the row itself is expandable.
	 * @param {number} depth
	 * @param {boolean} [collapsed]
	 */
	function renderTreePrefix(depth, collapsed) {
		const indent = el('span', { className: 'tree-indent' });
		indent.style.width = `${depth * INDENT_UNIT}px`;
		const twistie =
			collapsed === undefined
				? el('span', { className: 'tree-twistie-spacer' })
				: el('span', { className: 'tree-twistie' });
		if (collapsed !== undefined) {
			twistie.appendChild(el('i', { className: `codicon ${collapsed ? 'codicon-chevron-right' : 'codicon-chevron-down'}` }));
		}
		return [indent, twistie];
	}

	/**
	 * @param {{dark:string,light:string}} pair
	 * @param {string} wrapClassName
	 */
	function renderThemedIcon(pair, wrapClassName) {
		const wrap = el('span', { className: wrapClassName });
		const dark = /** @type {HTMLImageElement} */ (el('img', { className: 'icon-dark' }));
		dark.src = pair.dark;
		dark.alt = '';
		const light = /** @type {HTMLImageElement} */ (el('img', { className: 'icon-light' }));
		light.src = pair.light;
		light.alt = '';
		wrap.appendChild(dark);
		wrap.appendChild(light);
		return wrap;
	}

	/** @param {ProjectPickerTableNode} node */
	function renderTableIcon(node) {
		if (!treeIcons) {
			return el('span', { className: 'tree-file-icon' });
		}
		const pair = !node.found ? treeIcons.invalid : node.locked ? treeIcons.required : treeIcons.normal;
		return renderThemedIcon(pair, 'tree-file-icon');
	}

	// ---------------------------------------------------------------------
	// Context menu of the namespace rows: webviews have no native VS Code
	// context menu, so this is a custom one styled via the menu theme variables
	// (see .context-menu in main.css).
	// ---------------------------------------------------------------------

	/** Tears down the currently open context menu (at most one at a time). @type {(() => void) | null} */
	let closeContextMenu = null;

	/** Closes the open context menu, if any. */
	function dismissContextMenu() {
		if (closeContextMenu) {
			closeContextMenu();
		}
	}

	/**
	 * Collects every group path of a subtree — for "collapse all".
	 * @param {ProjectPickerNode[]} nodes
	 * @param {string} parentPath
	 * @param {string[]} out
	 */
	function collectGroupPaths(nodes, parentPath, out) {
		for (const node of nodes) {
			if (node.kind === 'group') {
				const groupPath = parentPath ? `${parentPath}.${node.segment}` : node.segment;
				out.push(groupPath);
				collectGroupPaths(node.children, groupPath, out);
			}
		}
	}

	/**
	 * Collects every selectable table below a node that is not selected yet —
	 * for "select all". While a search is active `nodes` is already the filtered
	 * subtree, so exactly what is currently visible gets selected.
	 * @param {ProjectPickerNode[]} nodes
	 * @param {string[]} out
	 */
	function collectSelectableTablePaths(nodes, out) {
		for (const node of nodes) {
			if (node.kind === 'group') {
				collectSelectableTablePaths(node.children, out);
			} else if (node.found && !node.checked) {
				out.push(node.path);
			}
		}
	}

	/**
	 * Collects every selected table below a node — for "deselect all".
	 * Deliberately including the locked (automatically included) ones: whether a
	 * table may really be deselected is decided by the extension host — if it is
	 * still needed by a *remaining* table it stays silently selected, whereas
	 * the removed ones may freely reference each other (see removeTables in
	 * project/editorProvider.ts).
	 * @param {ProjectPickerNode[]} nodes
	 * @param {string[]} out
	 */
	function collectCheckedTablePaths(nodes, out) {
		for (const node of nodes) {
			if (node.kind === 'group') {
				collectCheckedTablePaths(node.children, out);
			} else if (node.found && node.checked) {
				out.push(node.path);
			}
		}
	}

	/**
	 * Opens the context menu of a namespace row at position (x, y). Every entry
	 * acts exclusively on the subtree of the clicked node (including the node
	 * itself), never on the whole tree. It is closed by a click outside, Escape,
	 * the window losing focus, or by picking an entry.
	 * @param {number} x
	 * @param {number} y
	 * @param {ProjectPickerGroupNode} node
	 * @param {string} groupPath Dot-separated path of the node (see appendPickerRows).
	 * @param {() => void} refresh
	 */
	function showGroupContextMenu(x, y, node, groupPath, refresh) {
		dismissContextMenu();

		const menu = el('div', { className: 'context-menu' });
		menu.setAttribute('role', 'menu');
		menu.tabIndex = -1;

		/**
		 * @param {string} label
		 * @param {boolean} enabled
		 * @param {() => void} action
		 */
		const addItem = (label, enabled, action) => {
			const item = /** @type {HTMLButtonElement} */ (el('button', { className: 'context-menu-item', text: label }));
			item.type = 'button';
			item.setAttribute('role', 'menuitem');
			item.disabled = !enabled;
			item.addEventListener('click', () => {
				dismissContextMenu();
				action();
			});
			menu.appendChild(item);
		};

		/** @type {string[]} */
		const selectablePaths = [];
		collectSelectableTablePaths(node.children, selectablePaths);
		addItem(strings.tablesMenuSelectAll, selectablePaths.length > 0, () => {
			vscode.postMessage({ type: 'selectTables', paths: selectablePaths });
		});

		/** @type {string[]} */
		const checkedPaths = [];
		collectCheckedTablePaths(node.children, checkedPaths);
		addItem(strings.tablesMenuDeselectAll, checkedPaths.length > 0, () => {
			vscode.postMessage({ type: 'deselectTables', paths: checkedPaths });
		});

		menu.appendChild(el('div', { className: 'context-menu-separator' }));

		// The node itself plus every subgroup of its subtree — the two entries
		// never expand or collapse more than that.
		/** @type {string[]} */
		const subtreeGroupPaths = [groupPath];
		collectGroupPaths(node.children, groupPath, subtreeGroupPaths);

		addItem(strings.tablesMenuExpandAll, true, () => {
			for (const path of subtreeGroupPaths) {
				collapsedGroups.delete(path);
			}
			refresh();
		});
		addItem(strings.tablesMenuCollapseAll, true, () => {
			for (const path of subtreeGroupPaths) {
				collapsedGroups.add(path);
			}
			refresh();
		});

		// Arrow keys move through the enabled entries (Enter activates the
		// focused button as usual).
		menu.addEventListener('keydown', (event) => {
			if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
				return;
			}
			event.preventDefault();
			const items = /** @type {HTMLButtonElement[]} */ ([
				...menu.querySelectorAll('.context-menu-item:not(:disabled)'),
			]);
			if (items.length === 0) {
				return;
			}
			const index = items.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement));
			const step = event.key === 'ArrowDown' ? 1 : -1;
			const next = index === -1 ? (step === 1 ? 0 : items.length - 1) : (index + step + items.length) % items.length;
			items[next].focus();
		});

		document.body.appendChild(menu);
		// Measure only after appending, so the menu can shift left/up if needed
		// instead of extending past the viewport.
		const rect = menu.getBoundingClientRect();
		menu.style.left = `${Math.max(0, Math.min(x, window.innerWidth - rect.width - 4))}px`;
		menu.style.top = `${Math.max(0, Math.min(y, window.innerHeight - rect.height - 4))}px`;
		menu.focus();

		/** @param {MouseEvent} event */
		const onGlobalPointerDown = (event) => {
			if (!(event.target instanceof Node) || !menu.contains(event.target)) {
				dismissContextMenu();
			}
		};
		/** @param {KeyboardEvent} event */
		const onGlobalKeyDown = (event) => {
			if (event.key === 'Escape') {
				event.stopPropagation();
				dismissContextMenu();
			}
		};
		const onWindowBlur = () => dismissContextMenu();
		document.addEventListener('mousedown', onGlobalPointerDown, true);
		document.addEventListener('keydown', onGlobalKeyDown, true);
		window.addEventListener('blur', onWindowBlur);

		closeContextMenu = () => {
			closeContextMenu = null;
			document.removeEventListener('mousedown', onGlobalPointerDown, true);
			document.removeEventListener('keydown', onGlobalKeyDown, true);
			window.removeEventListener('blur', onWindowBlur);
			menu.remove();
		};
	}

	/**
	 * @param {ProjectPickerGroupNode} node
	 * @param {number} depth
	 * @param {string} groupPath
	 * @param {boolean} collapsed
	 * @param {() => void} refresh
	 */
	function renderGroupRow(node, depth, groupPath, collapsed, refresh) {
		const tr = el('tr', { className: 'tree-group-row' });
		const td = el('td', { className: 'tree-group-cell' });
		// +1 for the filler column (see buildColGroup) — otherwise the namespace
		// background would visibly stop short of the content columns on the right.
		td.colSpan = COLUMN_ORDER.length + 1;

		const row = el('span', { className: 'tree-row' });
		for (const part of renderTreePrefix(depth, collapsed)) {
			row.appendChild(part);
		}
		if (treeIcons) {
			row.appendChild(renderThemedIcon(treeIcons.namespace, 'tree-namespace-icon'));
		}
		row.appendChild(el('span', { className: 'tree-group-text', text: node.segment }));
		td.appendChild(row);
		tr.appendChild(td);

		tr.tabIndex = 0;
		tr.setAttribute('role', 'treeitem');
		tr.setAttribute('aria-expanded', String(!collapsed));
		tr.title = collapsed ? strings.tablesExpandGroupTitle : strings.tablesCollapseGroupTitle;
		const toggle = () => {
			if (collapsedGroups.has(groupPath)) {
				collapsedGroups.delete(groupPath);
			} else {
				collapsedGroups.add(groupPath);
			}
			refresh();
		};
		tr.addEventListener('click', toggle);
		tr.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				toggle();
			}
		});
		tr.addEventListener('contextmenu', (event) => {
			event.preventDefault();
			// Invocation via the context menu key/Shift+F10 reports (0,0) as
			// coordinates — align to the row itself in that case.
			const rowRect = tr.getBoundingClientRect();
			const hasPointer = event.clientX || event.clientY;
			showGroupContextMenu(
				hasPointer ? event.clientX : rowRect.left + 8,
				hasPointer ? event.clientY : rowRect.bottom,
				node,
				groupPath,
				refresh,
			);
		});

		return tr;
	}

	/**
	 * @param {ProjectPickerTableNode} node
	 * @param {number} depth
	 */
	function renderTableRow(node, depth) {
		const tr = el('tr');

		const nameTd = el('td', { className: 'tree-name-cell' });
		const row = el('span', { className: 'tree-row' });
		for (const part of renderTreePrefix(depth)) {
			row.appendChild(part);
		}
		// As in VS Code's own tree views, the checkbox sits indented inside the
		// row itself (after the indentation and twistie placeholder, before the
		// icon) rather than in its own unindented column on the far left.
		const checkbox = /** @type {HTMLInputElement} */ (el('input', { className: 'tree-checkbox' }));
		checkbox.type = 'checkbox';
		checkbox.checked = node.checked;
		checkbox.disabled = !node.found || node.locked;
		checkbox.setAttribute('aria-label', node.label);
		if (!node.found) {
			checkbox.title = strings.tablesInvalidTitle;
		} else if (node.locked) {
			checkbox.title = strings.tablesLockedTooltip;
		}
		checkbox.addEventListener('change', () => {
			vscode.postMessage({ type: 'toggleTable', path: node.path, checked: checkbox.checked });
		});
		row.appendChild(checkbox);
		row.appendChild(renderTableIcon(node));
		row.appendChild(el('span', { className: 'tree-table-label', text: node.label }));
		if (!node.found) {
			row.appendChild(el('i', { className: 'codicon codicon-warning row-warning-icon' }));
		}
		nameTd.appendChild(row);
		tr.appendChild(nameTd);

		tr.appendChild(el('td', { className: 'col-desc path-cell', text: node.path }));

		const recordsTd = el('td', { className: 'col-records-wide' });
		if (!node.found) {
			recordsTd.appendChild(el('span', { className: 'missing-file-note', text: strings.tablesMissingFileText }));
		} else if (!node.checked) {
			// Noch nicht Teil des Projekts -> keine Datensatzanzahl relevant.
		} else {
			// The icon in front of the input marks the kind of table: primary (a
			// fixed total) vs. referenced/secondary (a count per record of the
			// referenced table, possibly a range — see renderRecordsInput).
			const iconTitle = node.secondary
				? strings.tablesReferencedIconTooltip.replace('{0}', node.referencedTable || '')
				: strings.tablesPrimaryIconTooltip;
			const icon = el('i', {
				className: `codicon ${node.secondary ? 'codicon-references' : 'codicon-table'} records-type-icon`,
			});
			icon.title = iconTitle;
			icon.setAttribute('role', 'img');
			icon.setAttribute('aria-label', iconTitle);
			const wrap = el('span', { className: 'records-cell-row' });
			wrap.appendChild(icon);
			wrap.appendChild(renderRecordsInput(node));
			recordsTd.appendChild(wrap);
		}
		tr.appendChild(recordsTd);

		const actionsTd = el('td', { className: 'col-actions' });
		const openBtn = el('button', { className: 'icon-button' });
		openBtn.type = 'button';
		openBtn.title = strings.tablesOpenFileLabel;
		openBtn.setAttribute('aria-label', strings.tablesOpenFileLabel);
		openBtn.appendChild(el('i', { className: 'codicon codicon-go-to-file' }));
		openBtn.addEventListener('click', () => {
			vscode.postMessage({ type: 'openTable', path: node.path });
		});
		actionsTd.appendChild(openBtn);
		tr.appendChild(actionsTd);

		// Empty filler cell matching the filler column in the header (see buildColGroup).
		tr.appendChild(el('td', { className: 'col-spacer' }));

		return tr;
	}

	/**
	 * Input for the record count — the same field for both kinds of table, only
	 * placeholder and validation rule differ:
	 *
	 * - Primary table: a fixed total, digits only. At rest it shows thousands
	 *   separators (e.g. "12,500"), on focus the bare digits for easier editing
	 *   — similar to how the description field switches between preview and raw
	 *   text. `type="text"` rather than `type="number"`, because a native number
	 *   field cannot display a separator without invalidating the value itself.
	 * - Referenced (secondary) table: the count per record of the referenced
	 *   table, as a number ("5") or a range ("1..3") — without thousands
	 *   separators, since their dot would collide with the range syntax.
	 *
	 * Empty is an error in both cases (mandatory value) — the same rule that
	 * produces the Problems diagnostics in the extension host (see
	 * buildRecordsDiagnostics in project/editorProvider.ts).
	 * @param {ProjectPickerTableNode} node
	 */
	function renderRecordsInput(node) {
		const input = /** @type {HTMLInputElement} */ (el('input', { className: 'text-input cell-input records-input' }));
		input.type = 'text';
		const raw = node.records !== undefined ? node.records : '';

		if (node.secondary) {
			input.placeholder = strings.tablesRecordsRangePlaceholder;
			input.value = raw;

			const refreshError = () => {
				const value = input.value.trim();
				updateFieldError(
					input,
					value === '' ? strings.tablesRecordsRequiredError : strings.tablesRecordsInvalidError,
					value === '' || !parseCardinality(value),
				);
			};
			const commit = () => {
				const entry = project.tables.find((t) => t.path === node.path);
				if (entry) {
					const value = input.value.trim();
					entry.records = value === '' ? undefined : value;
				}
			};
			input.addEventListener('input', () => {
				commit();
				postEditDebounced();
				refreshError();
			});
			input.addEventListener('blur', () => {
				commit();
				postEdit();
				refreshError();
				const entry = project.tables.find((t) => t.path === node.path);
				input.value = entry && entry.records !== undefined ? entry.records : '';
			});
			refreshError();
			return input;
		}

		input.inputMode = 'numeric';
		input.placeholder = strings.tablesRecordsPlaceholder;
		input.value = formatRecordsDisplay(raw);

		const refreshError = () => updateFieldError(input, strings.tablesRecordsRequiredError, digitsOnly(input.value) === '');
		const commit = () => {
			const entry = project.tables.find((t) => t.path === node.path);
			if (entry) {
				const digits = digitsOnly(input.value);
				entry.records = digits === '' ? undefined : digits;
			}
		};

		input.addEventListener('focus', () => {
			// Show the bare digits for editing — a separator mid-edit would only
			// confuse the cursor.
			input.value = digitsOnly(input.value);
		});
		input.addEventListener('input', () => {
			const cursor = input.selectionStart;
			const before = input.value;
			const sanitized = digitsOnly(before);
			if (sanitized !== before) {
				const removedBeforeCursor = countNonDigitsBefore(before, cursor === null ? before.length : cursor);
				input.value = sanitized;
				const newPos = Math.max(0, (cursor === null ? sanitized.length : cursor) - removedBeforeCursor);
				input.setSelectionRange(newPos, newPos);
			}
			commit();
			postEditDebounced();
			refreshError();
		});
		input.addEventListener('blur', () => {
			commit();
			postEdit();
			refreshError();
			// Back to the formatted display now that editing has finished.
			const entry = project.tables.find((t) => t.path === node.path);
			input.value = entry && entry.records !== undefined ? formatRecordsDisplay(entry.records) : '';
		});

		refreshError();
		return input;
	}

	// ---------------------------------------------------------------------
	// "ER Diagram" tab: read-only ER diagram of the selected tables (automatic
	// layout and SVG rendering live in media/diagram.js)
	// ---------------------------------------------------------------------

	function renderDiagramTab() {
		const section = el('section', { className: 'tab-panel diagram-section' });

		if (!diagram || diagram.tables.length === 0) {
			const empty = el('div', { className: 'empty-state' });
			empty.appendChild(el('i', { className: 'codicon codicon-type-hierarchy-sub' }));
			empty.appendChild(el('p', { text: strings.diagramEmptyText }));
			section.appendChild(empty);
			return section;
		}

		// eslint-disable-next-line no-undef
		section.appendChild(
			window.DatenschmiedeDiagram.renderErDiagram(diagram, {
				strings,
				formatNumber: formatRecordsNumber,
				formatDateTime,
				onOpenTable: (path) => vscode.postMessage({ type: 'openTable', path }),
			}),
		);
		return section;
	}

	// ---------------------------------------------------------------------
	// Nachrichten vom Extension-Host
	// ---------------------------------------------------------------------

	window.addEventListener('message', (event) => {
		const message = event.data;
		switch (message.type) {
			case 'init':
				strings = message.strings;
				pickerTree = Array.isArray(message.pickerTree) ? message.pickerTree : [];
				outputFiles = Array.isArray(message.outputFiles) ? message.outputFiles : [];
				lastRunAt = message.lastRunAt;
				diagram = message.diagram || null;
				lastBroadcastJson = JSON.stringify([message.pickerTree, message.outputFiles, message.diagram]);
				pythonStatus = message.pythonStatus || null;
				treeIcons = message.icons || null;
				columnWidths = message.columnWidths && typeof message.columnWidths === 'object' ? message.columnWidths : {};
				parseError = 'parseError' in message ? message.parseError : null;
				if ('project' in message) {
					project = message.project;
				}
				render();
				break;
			case 'update':
				parseError = null;
				project = message.project;
				pickerTree = Array.isArray(message.pickerTree) ? message.pickerTree : [];
				outputFiles = Array.isArray(message.outputFiles) ? message.outputFiles : [];
				lastRunAt = message.lastRunAt;
				diagram = message.diagram || null;
				lastBroadcastJson = JSON.stringify([message.pickerTree, message.outputFiles, message.diagram]);
				pythonStatus = message.pythonStatus || null;
				render();
				break;
			case 'parseError':
				parseError = message.message;
				render();
				break;
			case 'pickerTree': {
				// Tree/overview broadcast after file changes in the workspace:
				// unchanged -> ignore, changed -> re-render deferred (see
				// renderSoon) — otherwise the records field, for example, would
				// lose focus and cursor while typing.
				const broadcastJson = JSON.stringify([message.pickerTree, message.outputFiles, message.diagram]);
				pickerTree = Array.isArray(message.pickerTree) ? message.pickerTree : [];
				if (Array.isArray(message.outputFiles)) {
					outputFiles = message.outputFiles;
					lastRunAt = message.lastRunAt;
				}
				if (message.diagram) {
					diagram = message.diagram;
				}
				if (broadcastJson === lastBroadcastJson) {
					break;
				}
				lastBroadcastJson = broadcastJson;
				if (!parseError) {
					deferredRender.renderSoon();
				}
				break;
			}
		}
	});

	vscode.postMessage({ type: 'ready' });
})();
