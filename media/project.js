// @ts-check
// Webview-Skript für den Projekt-Editor (.tdproject). Gegenstück zu table.js:
// gleicher Aufbau (Tabs, Karten, Markdown-Beschreibungsfeld), aber für das
// Projekt-Modell statt der Tabelle. Teilt sich die zustandslosen Bausteine
// mit table.js über common.js (vor diesem Skript eingebunden, siehe getHtml
// in project/editorProvider.ts).
//
// Der Tabellen-Tab enthält die komplette Tabellenauswahl direkt hier als
// Baum-Tabelle (nach Schema-Namensräumen gruppiert, mit Checkboxen) — anders
// als zuvor keine separate Ansicht in der Explorer-Seitenleiste mehr.
(function () {
	'use strict';

	/** @type {{ postMessage: (msg: any) => void }} */
	// eslint-disable-next-line no-undef
	const vscode = acquireVsCodeApi();

	// eslint-disable-next-line no-undef
	const {
		el,
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
	/** @typedef {{path:string,label:string,fileName:string,ext:string,records?:string,estimatedMin?:number,estimatedMax?:number,found:boolean,secondary:boolean,referencedTable?:string}} OutputFileRow */
	/** @typedef {import('../src/project/diagram').ProjectDiagram} ProjectDiagram */
	/** @typedef {import('../src/project/webviewStrings').ProjectWebviewStrings} ProjectWebviewStrings */

	/** @type {ProjectWebviewStrings | null} strings kommen einmalig per 'init'-Message vom Extension-Host */
	let strings = null;
	/** @type {Project} */
	let project = { name: '', description: '', python: null, outputPath: '', tables: [] };
	/** @type {string | null} */
	let parseError = null;
	/** @type {'overview' | 'tables' | 'diagram'} */
	let activeTab = 'overview';
	/** @type {ProjectPickerNode[]} */
	let pickerTree = [];
	/** @type {OutputFileRow[]} Ausgabedateien-Übersicht (eine Zeile je ausgewählter Tabelle), kommt vom Extension-Host. */
	let outputFiles = [];
	/** @type {ProjectDiagram | null} ER-Diagramm der ausgewählten Tabellen (siehe src/project/diagram.ts), kommt vom Extension-Host. */
	let diagram = null;
	/** @type {PythonStatus | null} */
	let pythonStatus = null;
	/** Aktueller Suchtext für den Tabellen-Tab (rein clientseitig, kein Extension-Host-Roundtrip nötig). */
	let tablesFilterText = '';
	/**
	 * Von Hand gezogene Spaltenbreiten im Auswahlbaum (px), je Spalten-Schlüssel
	 * — dasselbe Muster wie columnWidths in table.js, aber geräteweit unter
	 * einem eigenen Schlüssel gemerkt (siehe project/editorProvider.ts).
	 * @type {Record<string, number>}
	 */
	let columnWidths = {};
	/** @type {(() => void) | null} von renderTablesTree gesetzt: berechnet die finalen Spaltenbreiten, sobald die Tabelle im DOM hängt (siehe render()). */
	let pendingColumnSizing = null;
	/**
	 * Namensraum-Icon plus die drei Zeilen-Icon-Varianten (normal/gesperrt/
	 * ungültig) als Webview-URI-Paare (hell/dunkel) — kommen einmalig per
	 * 'init'-Message vom Extension-Host (siehe project/editorProvider.ts,
	 * dieselben SVGs wie das Datei-Icon im Explorer).
	 * @type {{normal:{dark:string,light:string},required:{dark:string,light:string},invalid:{dark:string,light:string},namespace:{dark:string,light:string}} | null}
	 */
	let treeIcons = null;
	/** Eingeklappte Namensraum-Gruppen (Pfad aus den Punkt-getrennten Schema-Segmenten, z. B. "ag.cor") — rein clientseitig, nicht persistiert. @type {Set<string>} */
	const collapsedGroups = new Set();

	/** Größenziehbare Spalten des Auswahlbaums mit ihrer Mindestbreite (px). */
	const RESIZABLE_COLUMNS = [
		{ key: 'name', minWidth: 220 },
		{ key: 'path', minWidth: 200 },
		{ key: 'records', minWidth: 200 },
	];
	/** Feste Spaltenreihenfolge des Auswahlbaums, für buildColGroup (siehe common.js). Die Checkbox sitzt in der Namensspalte in der Baumzeile selbst (siehe renderTableRow), nicht in einer eigenen Spalte. */
	const COLUMN_ORDER = ['name', 'path', 'records', 'actions'];
	/** Einrückung je Baumtiefe (px) — Platz für einen Klapp-Pfeil (16px) plus Abstand (4px), siehe renderGroupRow/renderTableRow. */
	const INDENT_UNIT = 20;

	/** Tausendertrennzeichen für die Datensätze-Spalte, passend zur Webview-Sprache (siehe <html lang> in project/editorProvider.ts#getHtml). */
	const recordsNumberFormat = new Intl.NumberFormat(document.documentElement.lang === 'de' ? 'de-DE' : 'en-US');

	/** @param {number} n */
	function formatRecordsNumber(n) {
		return recordsNumberFormat.format(n);
	}

	/** Entfernt alles außer Ziffern — robust gegen Tausendertrennzeichen jeder Sprache (Punkt, Komma, schmales Leerzeichen, …). @param {string} value */
	function digitsOnly(value) {
		return value.replace(/[^0-9]/g, '');
	}

	/** Anzahl Nicht-Ziffern-Zeichen vor `pos` in `str` — für den Cursor-Ausgleich beim Live-Bereinigen der Eingabe. @param {string} str @param {number} pos */
	function countNonDigitsBefore(str, pos) {
		let count = 0;
		for (let i = 0; i < pos && i < str.length; i++) {
			if (!/[0-9]/.test(str[i])) {
				count++;
			}
		}
		return count;
	}

	// Kardinalität für referenzierte Tabellen ("5" oder "1..3") — kleines
	// Gegenstück zu src/table/cardinality.ts für die sofortige Eingabe-Rückmeldung.
	/** @param {string} raw */
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
	 * Anzeige-Text eines gespeicherten `records`-Werts: eine reine Zahl mit
	 * Tausendertrennzeichen, alles andere (Bereich "1..3", ungültiger Rest)
	 * unverändert. @param {string} raw
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
	// Anti-Flacker: Baum-/Übersichts-Broadcasts vom Extension-Host (nach
	// Datei-Änderungen im Workspace) lösen kein sofortiges Neuzeichnen mehr
	// aus — unverändert wird ignoriert, bei echten Änderungen wird das
	// Neuzeichnen aufgeschoben, solange ein Eingabefeld fokussiert ist.
	// Mechanik siehe createDeferredRenderer in common.js.
	// ---------------------------------------------------------------------

	/** Zuletzt verarbeiteter Baum-/Übersichts-Stand (JSON), um unveränderte Broadcasts zu ignorieren. */
	let lastBroadcastJson = '';

	const deferredRender = createDeferredRenderer(() => render());

	function render() {
		app.innerHTML = '';
		deferredRender.clearPending();
		pendingColumnSizing = null;
		if (!strings) {
			return;
		}
		// Tab-Leiste und Inhalt getrennt: die Leiste bleibt oben stehen,
		// gescrollt wird nur der Inhaltsbereich (.tab-content, siehe main.css).
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

		// Erst jetzt (Baum-Tabelle hängt im echten DOM) lässt sich die
		// tatsächlich benötigte Breite je Spalte messen — siehe renderTablesTree.
		if (pendingColumnSizing) {
			pendingColumnSizing();
		}
	}

	// ---------------------------------------------------------------------
	// Kopfbereich: Tabs (wie table.js)
	// ---------------------------------------------------------------------

	function renderTabs() {
		const bar = el('div', { className: 'tabbar' });
		bar.setAttribute('role', 'tablist');
		bar.appendChild(renderTabButton('overview', strings.tabOverview));
		bar.appendChild(renderTabButton('tables', `${strings.tabTables} (${countCheckedTables(pickerTree)})`));
		bar.appendChild(renderTabButton('diagram', strings.tabDiagram));
		return bar;
	}

	/** @param {'overview'|'tables'|'diagram'} tab */
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
	// Tab "Übersicht": Name / Beschreibung / Python-Interpreter
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
				// Große Titel-Schrift wie im Generator-Editor.
				'title-input',
			),
		);
		section.appendChild(renderDescriptionField());
		section.appendChild(renderPythonField());
		stack.appendChild(section);

		stack.appendChild(renderOutputFilesCard());

		return stack;
	}

	// ---------------------------------------------------------------------
	// Übersicht: Ausgabedateien + Ausgabeordner + Start-Knopf des
	// Generator-Laufs
	// ---------------------------------------------------------------------

	/**
	 * Anzeigename einer `{…}`-Variable — gemeinsame Beschriftungen mit dem
	 * Tag-Feld des Table Editors (siehe variableLabel in common.js), damit
	 * Tags in beiden Editoren gleich heißen.
	 * @param {string} token
	 */
	function variableLabel(token) {
		return variableLabelCommon(strings, token);
	}

	/** Variablen für den Ausgabeordner des Projekts (kein Tabellen-/Spaltenbezug). */
	const OUTPUT_PATH_VARIABLES = ['date', 'time', 'datetime', 'timestamp', 'project'];

	/**
	 * Zeigt die Dateinamen-Vorlage einer Tabelle rein lesend an: `{…}`-Teile
	 * als Tags (dieselbe Optik wie das editierbare Tag-Feld im Table Editor),
	 * fester Text dazwischen unverändert.
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
	 * Feld „Ausgabeordner“: Tag-Feld wie der Dateiname im Table Editor —
	 * fester Text plus dynamische Variablen (Datum, Zeitstempel,
	 * Projektname, …). Relativ zur Projektdatei; leer -> „output“.
	 */
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

		// Ordner-Auswahldialog (VS-Code-nativ) — Ergebnis landet als fester
		// Text im Tag-Feld, Variablen lassen sich danach weiter ergänzen.
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

		// „Dynamischen Wert einfügen“ in einer eigenen Zeile unter dem Feld.
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
	 * Karte „Generierte Dateien“: Start-Knopf des Generator-Laufs plus eine
	 * rein lesende Übersicht, welche Datei der Lauf für jede ausgewählte
	 * Tabelle erzeugen wird (td-Datei, Name, Dateiname, Datensatzanzahl) —
	 * bearbeitet wird das im Table Editor bzw. im Tabellen-Tab.
	 */
	function renderOutputFilesCard() {
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
		card.appendChild(toolbar);

		card.appendChild(renderOutputPathField());

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
			if (row.records) {
				const recordsWrap = el('span', { className: 'records-cell-row' });
				recordsWrap.appendChild(
					el('i', {
						className: `codicon ${row.secondary ? 'codicon-references' : 'codicon-table'} records-type-icon`,
					}),
				);
				// Berechnete Anzahl aus der Konfiguration (bei referenzierten
				// Tabellen die Kardinalität entlang der FK-Kette multipliziert)
				// statt nur des konfigurierten Bereichs; Bereiche in derselben
				// „min..max“-Schreibweise wie die Kardinalitäts-Eingabe (100
				// Datensätze × 1..3 → „100..300“). Die Konfiguration selbst
				// steht im Tooltip. Ist die Kette nicht berechenbar, bleibt der
				// konfigurierte Wert stehen.
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

			tr.appendChild(el('td', { className: 'col-spacer' }));
			tbody.appendChild(tr);
		}
		table.appendChild(tbody);

		wrap.appendChild(table);
		card.appendChild(wrap);
		return card;
	}

	/** Dünner Umschlag um das gemeinsame Textfeld (common.js), mit den Commit-Funktionen dieses Editors. */
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

	/** Verknüpfter Python-Interpreter: Status-Text + Icon, plus Schalter zum (Neu-)Verknüpfen (siehe project/python.ts). */
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
	// Tab "Tabellen": Auswahlbaum (Namensräume + Checkboxen) + Datensatz-Anzahl
	// ---------------------------------------------------------------------

	/** @param {ProjectPickerNode[]} nodes */
	function countCheckedTables(nodes) {
		let count = 0;
		for (const node of nodes) {
			count += node.kind === 'table' ? (node.checked ? 1 : 0) : countCheckedTables(node.children);
		}
		return count;
	}

	/**
	 * @param {ProjectPickerTableNode} node
	 * @param {string} filterLower
	 */
	function tableMatchesFilter(node, filterLower) {
		return node.label.toLowerCase().includes(filterLower) || node.path.toLowerCase().includes(filterLower);
	}

	/**
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

		const searchWrap = el('div', { className: 'tables-search' });
		searchWrap.appendChild(el('i', { className: 'codicon codicon-search tables-search-icon' }));
		const searchInput = /** @type {HTMLInputElement} */ (el('input', { className: 'text-input' }));
		searchInput.type = 'text';
		searchInput.placeholder = strings.tablesSearchPlaceholder;
		searchInput.setAttribute('aria-label', strings.tablesSearchPlaceholder);
		searchInput.value = tablesFilterText;
		searchInput.addEventListener('input', () => {
			tablesFilterText = searchInput.value;
			renderTablesTree(treeContainer);
		});
		searchInput.addEventListener('keydown', (event) => {
			if (event.key === 'Escape' && searchInput.value) {
				searchInput.value = '';
				tablesFilterText = '';
				renderTablesTree(treeContainer);
			}
		});
		searchWrap.appendChild(searchInput);
		section.appendChild(searchWrap);

		section.appendChild(treeContainer);
		renderTablesTree(treeContainer);

		return section;
	}

	/**
	 * Baut die Baum-Tabelle des Tabellen-Tab komplett neu (nach jeder
	 * Such-/Auf-/Zuklapp-Änderung sowie beim ersten Rendern). `container`
	 * kann beim allerersten Aufruf noch losgelöst vom echten DOM sein (siehe
	 * render()) — die endgültigen Spaltenbreiten werden dann erst gesetzt,
	 * sobald er wirklich im Dokument hängt.
	 * @param {HTMLElement} container
	 */
	function renderTablesTree(container) {
		// Ein evtl. offenes Kontextmenü bezieht sich auf den alten Baum-Stand
		// (z. B. vor einem Update vom Extension-Host) — schließen statt mit
		// veralteten Knoten weiterarbeiten.
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
			// Nachträgliches Neuzeichnen (Suche, Auf-/Zuklappen): der Container
			// hängt bereits im echten DOM, die Breite lässt sich also sofort messen.
			sizeColumns();
		} else {
			// Erstes Rendern: Container hängt noch nicht im DOM (siehe render()).
			pendingColumnSizing = sizeColumns;
		}
	}

	/**
	 * @param {HTMLElement} tbody
	 * @param {ProjectPickerNode[]} nodes
	 * @param {number} depth
	 * @param {string} parentPath Punkt-getrennter Pfad der Elterngruppe (für collapsedGroups), leer auf der Wurzelebene.
	 * @param {boolean} filterActive Bei aktiver Suche bleiben alle (schon auf Treffer gefilterten) Gruppen aufgeklappt — wie VS Codes eigene Baum-Suche.
	 * @param {() => void} refresh Zeichnet die Baum-Tabelle neu (nach Auf-/Zuklappen einer Gruppe).
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
	 * Baut den Einrückungs-/Klapp-Pfeil-Bereich einer Zeile: Einrückung nach
	 * Baumtiefe, dann ein 16px breiter Klapp-Pfeil (Gruppen) oder ein
	 * gleich breiter Platzhalter (Tabellen) — nur so richten sich Icon und
	 * Text von Gruppen- und Tabellenzeilen auf derselben Tiefe exakt
	 * aneinander aus, unabhängig davon, ob die Zeile selbst aufklappbar ist.
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
	// Kontextmenü der Namensraum-Zeilen: Webviews haben kein natives
	// VS-Code-Kontextmenü, daher ein eigenes, über die Menü-Theme-Variablen
	// gestyltes (siehe .context-menu in main.css).
	// ---------------------------------------------------------------------

	/** Räumt das aktuell offene Kontextmenü ab (höchstens eines gleichzeitig). @type {(() => void) | null} */
	let closeContextMenu = null;

	function dismissContextMenu() {
		if (closeContextMenu) {
			closeContextMenu();
		}
	}

	/**
	 * Sammelt alle Gruppen-Pfade eines Teilbaums — für „Alle zuklappen“.
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
	 * Sammelt alle noch nicht ausgewählten, auswählbaren Tabellen unterhalb
	 * eines Knotens — für „Alle auswählen“. Bei aktiver Suche ist `nodes`
	 * bereits der gefilterte Teilbaum, ausgewählt wird also genau das, was
	 * gerade sichtbar ist.
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
	 * Sammelt alle ausgewählten Tabellen unterhalb eines Knotens — für „Alle
	 * abwählen“. Bewusst inklusive der gesperrten (automatisch mitgenommenen):
	 * ob eine Tabelle wirklich abgewählt werden darf, entscheidet der
	 * Extension-Host — wird sie von einer *verbleibenden* Tabelle noch
	 * benötigt, bleibt sie stillschweigend ausgewählt; untereinander dürfen
	 * die entfernten sich dagegen ruhig referenzieren (siehe removeTables in
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
	 * Öffnet das Kontextmenü einer Namensraum-Zeile an Position (x, y). Alle
	 * Einträge wirken ausschließlich auf den Teilbaum des angeklickten
	 * Knotens (ihn selbst eingeschlossen), nie auf den ganzen Baum.
	 * Geschlossen wird per Klick außerhalb, Escape, Fokusverlust des
	 * Fensters oder Auswahl eines Eintrags.
	 * @param {number} x
	 * @param {number} y
	 * @param {ProjectPickerGroupNode} node
	 * @param {string} groupPath Punkt-getrennter Pfad des Knotens (siehe appendPickerRows).
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

		// Der Knoten selbst plus alle Untergruppen seines Teilbaums — mehr
		// klappen die beiden Einträge nie auf oder zu.
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

		// Pfeiltasten wandern durch die aktiven Einträge (Enter löst den
		// fokussierten Button ganz normal aus).
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
		// Erst nach dem Anhängen messen, damit das Menü bei Bedarf nach
		// links/oben ausweicht, statt aus dem Sichtbereich zu ragen.
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
		// +1 für die Füll-Spalte (siehe buildColGroup) — sonst bliebe der
		// Namensraum-Hintergrund rechts hinter den Inhaltsspalten sichtbar kürzer.
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
			// Aufruf per Kontextmenü-Taste/Shift+F10 meldet (0,0) als
			// Koordinaten — dann stattdessen an der Zeile selbst ausrichten.
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
		// Checkbox sitzt wie in VS Codes eigenen Baum-Ansichten eingerückt in
		// der Zeile selbst (nach Einrückung und Klapp-Pfeil-Platzhalter, vor
		// dem Icon) statt in einer eigenen, uneingerückten Spalte ganz links.
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
			// Icon vor dem Eingabefeld kennzeichnet die Art der Tabelle:
			// primär (feste Gesamtanzahl) vs. referenziert/sekundär (Anzahl je
			// Datensatz der referenzierten Tabelle, auch als Bereich — siehe
			// renderRecordsInput).
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

		// Leere Füll-Zelle passend zur Füll-Spalte im Kopf (siehe buildColGroup).
		tr.appendChild(el('td', { className: 'col-spacer' }));

		return tr;
	}

	/**
	 * Eingabefeld für die Datensatzanzahl — für beide Tabellenarten dasselbe
	 * Feld, nur Platzhalter und Prüfregel unterscheiden sich:
	 *
	 * - Primäre Tabelle: feste Gesamtanzahl, nur Ziffern. Im Ruhezustand mit
	 *   Tausendertrennzeichen (z. B. "12.500"), beim Fokussieren die reinen
	 *   Ziffern zum leichteren Bearbeiten — ähnlich wie das Beschreibungsfeld
	 *   zwischen Vorschau und Rohtext umschaltet. `type="text"` statt
	 *   `type="number"`, weil ein natives Zahlenfeld kein Trennzeichen
	 *   anzeigen kann, ohne den Wert selbst ungültig zu machen.
	 * - Referenzierte (sekundäre) Tabelle: Anzahl je Datensatz der
	 *   referenzierten Tabelle, als Zahl ("5") oder Bereich ("1..3") — ohne
	 *   Tausendertrennzeichen, weil dessen Punkt mit der Bereichs-Syntax
	 *   kollidieren würde.
	 *
	 * Leer ist in beiden Fällen ein Fehler (Pflichtangabe) — dieselbe Regel,
	 * die im Extension-Host die Problems-Diagnostics erzeugt (siehe
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
			// Zum Bearbeiten die reinen Ziffern zeigen — ein Trennzeichen mitten
			// im Editieren würde nur den Cursor durcheinanderbringen.
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
			// Zurück zur formatierten Anzeige, jetzt, wo nicht mehr editiert wird.
			const entry = project.tables.find((t) => t.path === node.path);
			input.value = entry && entry.records !== undefined ? formatRecordsDisplay(entry.records) : '';
		});

		refreshError();
		return input;
	}

	// ---------------------------------------------------------------------
	// Tab "Diagramm": rein lesendes ER-Diagramm der ausgewählten Tabellen
	// (automatisches Layout und SVG-Rendering in media/diagram.js)
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
				// Baum-/Übersichts-Broadcast nach Datei-Änderungen im Workspace:
				// unverändert -> ignorieren, geändert -> aufgeschoben neu
				// zeichnen (siehe renderSoon) — sonst verlöre z. B. das
				// Datensätze-Feld beim Tippen Fokus und Cursor.
				const broadcastJson = JSON.stringify([message.pickerTree, message.outputFiles, message.diagram]);
				pickerTree = Array.isArray(message.pickerTree) ? message.pickerTree : [];
				if (Array.isArray(message.outputFiles)) {
					outputFiles = message.outputFiles;
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
