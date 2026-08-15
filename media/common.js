// @ts-check
// Shared, stateless webview building blocks for the table editor (table.js) and
// the project editor (project.js): generic DOM helpers, the markdown
// preview/editor field and the custom select chevron. Deliberately kept as a
// standalone, uncompiled script (like table.js/project.js themselves) and
// loaded before them (see getHtml in
// table/editorProvider.ts/project/editorProvider.ts) — it exports its functions
// on `window.DatenschmiedeCommon`, since the webviews here work without module
// bundling.
(function () {
	'use strict';

	/**
	 * Creates an element with an optional class name and text content.
	 * @param {string} tag
	 * @param {{ className?: string, text?: string }} [opts]
	 */
	function el(tag, opts) {
		const e = document.createElement(tag);
		if (opts && opts.className) {
			e.className = opts.className;
		}
		if (opts && opts.text !== undefined) {
			e.textContent = opts.text;
		}
		return e;
	}

	/**
	 * Binds a text input (input/textarea) to a setter function: typing updates
	 * the local state immediately and reports the change via `commitDebounced`,
	 * while blurring (leaving the field) reports it right away via `commit`.
	 * @param {HTMLInputElement | HTMLTextAreaElement} field
	 * @param {(value: string) => void} onChange
	 * @param {() => void} commitDebounced
	 * @param {() => void} commit
	 */
	function bindText(field, onChange, commitDebounced, commit) {
		field.addEventListener('input', () => {
			onChange(field.value);
			commitDebounced();
		});
		field.addEventListener('blur', () => {
			onChange(field.value);
			commit();
		});
	}

	/**
	 * Delays a call until no further one arrived for `delayMs` — e.g. for the
	 * debounced write-back into the document while typing (postEdit).
	 * @param {() => void} fn
	 * @param {number} delayMs
	 */
	function debounce(fn, delayMs) {
		/** @type {number | undefined} */
		let handle;
		return () => {
			if (handle !== undefined) {
				window.clearTimeout(handle);
			}
			handle = window.setTimeout(() => {
				handle = undefined;
				fn();
			}, delayMs);
		};
	}

	/**
	 * Labelled text input (name, schema, …) — the shared basis of the overview
	 * tabs of the table, project and lookup editors.
	 * @param {string} id
	 * @param {string} labelText
	 * @param {string} value
	 * @param {string} placeholder
	 * @param {(value: string) => void} onChange
	 * @param {() => void} commitDebounced
	 * @param {() => void} commit
	 * @param {string} [extraClass]
	 */
	function renderTextField(id, labelText, value, placeholder, onChange, commitDebounced, commit, extraClass) {
		const field = el('div', { className: 'field' });
		const label = el('label', { text: labelText });
		label.htmlFor = id;
		const input = /** @type {HTMLInputElement} */ (
			el('input', { className: extraClass ? `text-input ${extraClass}` : 'text-input' })
		);
		input.type = 'text';
		input.id = id;
		input.placeholder = placeholder;
		input.value = value || '';
		bindText(input, onChange, commitDebounced, commit);
		field.appendChild(label);
		field.appendChild(input);
		return field;
	}

	/**
	 * Labelled markdown description field (see renderMarkdownField) — the shared
	 * basis of the overview tabs of all three editors.
	 * @param {string} labelText
	 * @param {string} placeholder
	 * @param {string} value
	 * @param {(value: string) => void} onChange
	 * @param {() => void} commitDebounced
	 * @param {() => void} commit
	 */
	function renderLabeledMarkdownField(labelText, placeholder, value, onChange, commitDebounced, commit) {
		const field = el('div', { className: 'field' });
		field.appendChild(el('label', { text: labelText }));
		field.appendChild(
			renderMarkdownField(value, placeholder, onChange, commitDebounced, commit, {
				autoGrow: true,
				rows: 5,
				ariaLabel: labelText,
			}),
		);
		return field;
	}

	/**
	 * Display name of a `{…}` variable (the token without braces) — the same
	 * labels in the table editor's file name tag field and in the project
	 * editor's output folder field. `strings` is the respective webview string
	 * catalog (the outputVar… keys; `project` only exists in the project
	 * editor).
	 * @param {any} strings
	 * @param {string} token
	 */
	function variableLabel(strings, token) {
		if (token.startsWith('column:')) {
			return token.slice('column:'.length);
		}
		switch (token) {
			case 'date':
				return strings.outputVarDate;
			case 'time':
				return strings.outputVarTime;
			case 'datetime':
				return strings.outputVarDatetime;
			case 'timestamp':
				return strings.outputVarTimestamp;
			case 'schema':
				return strings.outputVarSchema;
			case 'table':
				return strings.outputVarTable;
			case 'records':
				return strings.outputVarRecords;
			case 'project':
				return strings.outputVarProject || token;
			default:
				return token;
		}
	}

	/**
	 * Error state for broken TOML/CSV (a full-page message instead of the form)
	 * — identical in all three editors; the texts come from the respective
	 * string catalog (errorTitle/errorBody/errorHint).
	 * @param {any} strings
	 * @param {string} message
	 */
	function renderErrorState(strings, message) {
		const wrap = el('div', { className: 'error-state' });
		wrap.appendChild(el('i', { className: 'codicon codicon-warning error-icon' }));
		wrap.appendChild(el('h2', { text: strings.errorTitle }));
		wrap.appendChild(el('p', { text: strings.errorBody }));
		wrap.appendChild(el('pre', { className: 'error-detail', text: message }));
		wrap.appendChild(el('p', { className: 'hint', text: strings.errorHint }));
		return wrap;
	}

	/** `true` while an input (input/textarea/select/contenteditable) has focus. */
	function isEditing() {
		const active = document.activeElement;
		return !!(
			active &&
			active !== document.body &&
			(active.tagName === 'INPUT' ||
				active.tagName === 'TEXTAREA' ||
				active.tagName === 'SELECT' ||
				/** @type {HTMLElement} */ (active).isContentEditable)
		);
	}

	/**
	 * Anti-flicker building block: broadcasts from the extension host (after
	 * every file change in the workspace) must not trigger an immediate
	 * re-render while an input has focus — otherwise the field would lose focus
	 * and cursor on every broadcast. `renderSoon` either re-renders right away
	 * or defers it; a focusout listener performs the deferred render as soon as
	 * no field is focused any more.
	 * @param {() => void} doRender The actual (full) re-render.
	 * @param {(() => boolean)} [isBlockedExtra] Additional block (e.g. an open dialog).
	 */
	function createDeferredRenderer(doRender, isBlockedExtra) {
		let pending = false;
		const blocked = () => isEditing() || (isBlockedExtra ? isBlockedExtra() : false);
		const renderNow = () => {
			pending = false;
			doRender();
		};
		document.addEventListener('focusout', () => {
			if (!pending) {
				return;
			}
			// Wait briefly: when focus moves between two fields, another field is
			// focused immediately after focusout — keep deferring in that case.
			window.setTimeout(() => {
				if (pending && !blocked()) {
					renderNow();
				}
			}, 100);
		});
		return {
			/** Re-renders immediately — or once no input is focused any more. */
			renderSoon() {
				if (blocked()) {
					pending = true;
					return;
				}
				renderNow();
			},
			/** Performs a deferred re-render if nothing blocks any more (e.g. after a dialog closed). */
			flushIfIdle() {
				if (pending && !blocked()) {
					renderNow();
				}
			},
			/** Discards a deferred render (a re-render has just happened anyway). */
			clearPending() {
				pending = false;
			},
		};
	}

	/**
	 * Lets a textarea grow and shrink automatically with its content instead of
	 * showing a fixed height with an internal scrollbar.
	 * @param {HTMLTextAreaElement} textarea
	 */
	function autoGrowCellTextarea(textarea) {
		textarea.style.height = 'auto';
		textarea.style.height = `${textarea.scrollHeight}px`;
	}

	// ---------------------------------------------------------------------
	// Markdown: a very small, deliberately restricted renderer for the
	// description fields. It first escapes every piece of HTML in the raw text
	// consistently and only then applies a small, safe subset of markdown
	// syntax (bold, italic, code, links, lists, paragraphs) — raw HTML is never
	// let through.
	// ---------------------------------------------------------------------

	/**
	 * Escapes every HTML-significant character; applied before any markdown.
	 * @param {string} text
	 */
	function escapeHtml(text) {
		return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}

	/**
	 * Inline markdown of one line: code, bold, italic and http(s)/mailto links.
	 * @param {string} line
	 */
	function renderMarkdownInline(line) {
		let html = escapeHtml(line);
		html = html.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);
		html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
		html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
		html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
		html = html.replace(/(^|[^\w])_([^_]+)_(?!\w)/g, '$1<em>$2</em>');
		html = html.replace(
			/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g,
			'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
		);
		return html;
	}

	/**
	 * One paragraph-level block: a bullet list, a numbered list or a paragraph.
	 * @param {string} block
	 */
	function renderMarkdownBlock(block) {
		const lines = block
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
		if (lines.length === 0) {
			return '';
		}

		if (lines.every((line) => /^[-*]\s+/.test(line))) {
			const items = lines.map((line) => `<li>${renderMarkdownInline(line.replace(/^[-*]\s+/, ''))}</li>`).join('');
			return `<ul>${items}</ul>`;
		}
		if (lines.every((line) => /^\d+[.)]\s+/.test(line))) {
			const items = lines.map((line) => `<li>${renderMarkdownInline(line.replace(/^\d+[.)]\s+/, ''))}</li>`).join('');
			return `<ol>${items}</ol>`;
		}

		return `<p>${lines.map((line) => renderMarkdownInline(line)).join('<br>')}</p>`;
	}

	/**
	 * Renders the supported markdown subset to HTML (blocks separated by blank lines).
	 * @param {string} source
	 */
	function renderMarkdown(source) {
		const normalized = (source || '').replace(/\r\n?/g, '\n').trim();
		if (!normalized) {
			return '';
		}
		return normalized
			.split(/\n{2,}/)
			.map((block) => renderMarkdownBlock(block))
			.join('');
	}

	/**
	 * Description field with markdown support: shown as rendered markdown by
	 * default; a click (or Enter/Space) reveals a raw markdown textarea for
	 * editing that disappears again on leaving (blur or Escape). With
	 * `gridCell: true` the preview stays single-line via CSS, with an ellipsis
	 * when too long (see `.columns-table .md-preview` in main.css) — this only
	 * works because the preview is a <div>; text-overflow: ellipsis is not
	 * supported on <textarea>, hence not a single textarea element for both
	 * states.
	 * @param {string} initialValue
	 * @param {string} placeholder
	 * @param {(value: string) => void} onChange
	 * @param {() => void} commitDebounced
	 * @param {() => void} commit
	 * @param {{ autoGrow?: boolean, rows?: number, ariaLabel?: string, gridCell?: boolean }} [options]
	 */
	function renderMarkdownField(initialValue, placeholder, onChange, commitDebounced, commit, options) {
		const opts = options || {};
		let currentValue = initialValue || '';

		const wrap = el('div', { className: 'md-field' });

		const preview = el('div', {
			className: opts.gridCell ? 'text-input cell-input md-preview' : 'text-input md-preview',
		});
		preview.tabIndex = 0;
		preview.setAttribute('role', 'button');
		preview.setAttribute('aria-label', opts.ariaLabel || placeholder);

		const textarea = /** @type {HTMLTextAreaElement} */ (
			el('textarea', {
				className: opts.gridCell ? 'text-input cell-input md-editor textarea' : 'text-input md-editor textarea',
			})
		);
		textarea.value = currentValue;
		textarea.placeholder = placeholder;
		if (opts.rows) {
			textarea.rows = opts.rows;
		}
		textarea.hidden = true;

		function updatePreview() {
			const trimmed = currentValue.trim();
			preview.classList.toggle('md-preview-empty', !trimmed);
			if (trimmed) {
				preview.innerHTML = renderMarkdown(currentValue);
			} else {
				preview.textContent = placeholder;
			}
		}

		function enterEditMode() {
			preview.hidden = true;
			textarea.hidden = false;
			textarea.focus();
			if (opts.autoGrow) {
				autoGrowCellTextarea(textarea);
			}
		}

		function leaveEditMode() {
			textarea.hidden = true;
			preview.hidden = false;
			updatePreview();
		}

		preview.addEventListener('click', enterEditMode);
		preview.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				enterEditMode();
			}
		});

		textarea.addEventListener('input', () => {
			currentValue = textarea.value;
			onChange(currentValue);
			commitDebounced();
			if (opts.autoGrow) {
				autoGrowCellTextarea(textarea);
			}
		});
		textarea.addEventListener('blur', () => {
			currentValue = textarea.value;
			onChange(currentValue);
			commit();
			leaveEditMode();
		});
		textarea.addEventListener('keydown', (event) => {
			if (event.key === 'Escape') {
				textarea.blur();
			}
		});

		updatePreview();
		wrap.appendChild(preview);
		wrap.appendChild(textarea);
		return wrap;
	}

	/**
	 * Marks an input with a validation problem by colour only (a red border)
	 * rather than with additional error text — the full message lives in VS
	 * Code's Problems view; it is still attached to the field as a tooltip.
	 * @param {HTMLElement} inputEl
	 * @param {string} errorText
	 * @param {boolean} hasError
	 */
	function updateFieldError(inputEl, errorText, hasError) {
		inputEl.classList.toggle('has-error', hasError);
		if (hasError) {
			inputEl.title = errorText;
		} else {
			inputEl.removeAttribute('title');
		}
	}

	// ---------------------------------------------------------------------
	// Grid column widths: shared resize logic for table.js (the column grid)
	// and project.js (the table picker tree) — both grids start with
	// table-layout: auto so that columns without a manually set width settle on
	// a content-based width during the first render; only once the table is
	// really in the DOM can the width actually needed be measured (see
	// fixColumnWidths) and the table switched to table-layout: fixed — only
	// then does a manually dragged <col> width reliably take effect.
	// ---------------------------------------------------------------------

	/**
	 * Builds the <colgroup> for a grid: one <col> per column in `order`, plus an
	 * empty filler column at the end (which absorbs any remaining space so the
	 * grid still spans the full width without stretching the content columns).
	 * Columns with a manually dragged width (from `widths`) get it applied
	 * immediately as a fixed width.
	 * @param {string[]} order
	 * @param {Record<string, number>} widths
	 */
	function buildColGroup(order, widths) {
		const colgroup = el('colgroup');
		/** @type {Record<string, HTMLTableColElement>} */
		const cols = {};
		for (const key of order) {
			const col = /** @type {HTMLTableColElement} */ (el('col'));
			if (widths[key]) {
				col.style.width = `${widths[key]}px`;
			}
			cols[key] = col;
			colgroup.appendChild(col);
		}
		colgroup.appendChild(el('col', { className: 'col-spacer' }));
		return { colgroup, cols };
	}

	/**
	 * Makes a grid header cell resizable via a drag handle on its right edge:
	 * the fixed width is applied directly to the corresponding <col> element.
	 * On release the new width is reported via `onResized` (usually to the
	 * extension host, which remembers it per machine).
	 * @param {HTMLElement} th
	 * @param {HTMLTableColElement} col
	 * @param {string} key
	 * @param {number} minWidth
	 * @param {Record<string, number>} widths
	 * @param {(widths: Record<string, number>) => void} onResized
	 */
	function attachColumnResizeHandle(th, col, key, minWidth, widths, onResized) {
		const handle = el('span', { className: 'col-resize-handle' });
		handle.addEventListener('mousedown', (event) => {
			event.preventDefault();
			const startX = event.clientX;
			const startWidth = th.getBoundingClientRect().width;
			let changed = false;

			const onMouseMove = (moveEvent) => {
				const newWidth = Math.max(minWidth, Math.round(startWidth + (moveEvent.clientX - startX)));
				widths[key] = newWidth;
				col.style.width = `${newWidth}px`;
				changed = true;
			};
			const onMouseUp = () => {
				document.removeEventListener('mousemove', onMouseMove);
				document.removeEventListener('mouseup', onMouseUp);
				document.body.classList.remove('col-resizing');
				if (changed) {
					onResized(widths);
				}
			};

			document.addEventListener('mousemove', onMouseMove);
			document.addEventListener('mouseup', onMouseUp);
			document.body.classList.add('col-resizing');
		});
		th.appendChild(handle);
	}

	/**
	 * Applies each resizable column's final fixed width (manually dragged, or
	 * otherwise the content-based measured width of its header cell) and then
	 * switches the table to table-layout: fixed.
	 *
	 * Measuring happens briefly under width: max-content: under the regular
	 * width: 100% the columns would, with little content, already be stretched
	 * to the full panel width and the measurement would yield exactly those
	 * stretched widths — leaving no free space for the filler column on the
	 * right (see buildColGroup). Only when the content is wider than the panel
	 * anyway is it measured in the stretched state as before: the filler column
	 * would get nothing regardless, and a pure max-content measurement would
	 * make e.g. a long description arbitrarily wide instead of truncating it
	 * with an ellipsis as intended.
	 *
	 * Must not be called before the table is really in the DOM (otherwise
	 * getBoundingClientRect() returns no meaningful width).
	 * @param {HTMLTableElement} table
	 * @param {{key:string,minWidth:number}[]} resizable
	 * @param {Record<string, HTMLElement>} headers
	 * @param {Record<string, HTMLTableColElement>} cols
	 * @param {Record<string, number>} widths
	 */
	function fixColumnWidths(table, resizable, headers, cols, widths) {
		const container = table.parentElement;
		table.style.width = 'max-content';
		const fitsInContainer = !container || table.getBoundingClientRect().width <= container.clientWidth;
		if (!fitsInContainer) {
			table.style.width = '';
		}
		/** @type {Record<string, number>} */
		const finalWidths = {};
		for (const { key, minWidth } of resizable) {
			const th = headers[key];
			finalWidths[key] = widths[key] || Math.max(minWidth, Math.ceil(th.getBoundingClientRect().width));
		}
		table.style.width = '';
		for (const { key } of resizable) {
			cols[key].style.width = `${finalWidths[key]}px`;
		}
		table.style.tableLayout = 'fixed';
	}

	/**
	 * "Fit column widths to the content": a small, secondary icon control (not a
	 * full button) for the grid toolbars. It discards the widths dragged by hand
	 * for that grid, so every column measures itself against its content again
	 * on the next render — the state a fresh grid starts in.
	 * @param {{
	 *   label: string,
	 *   widths: Record<string, number>,
	 *   onReset: (widths: Record<string, number>) => void,
	 * }} config
	 */
	function renderAutoSizeColumnsButton(config) {
		const button = /** @type {HTMLButtonElement} */ (
			el('button', { className: 'icon-button toolbar-icon-button' })
		);
		button.type = 'button';
		button.title = config.label;
		button.setAttribute('aria-label', config.label);
		button.appendChild(el('i', { className: 'codicon codicon-arrow-both' }));
		// Deliberately never disabled: dragging a column does not re-render, so a
		// state computed here would go stale the moment a width is changed. With
		// nothing dragged the click is simply a no-op.
		button.addEventListener('click', () => {
			for (const key of Object.keys(config.widths)) {
				delete config.widths[key];
			}
			config.onReset(config.widths);
		});
		return button;
	}

	/**
	 * Search field with a magnifier and a clear button — the same shape in every
	 * place that filters a list (the project editor's table tree, the foreign
	 * key picker). The × only appears while there is text, and Escape clears the
	 * field as well.
	 *
	 * Returns the wrapper to place plus the input itself, so callers can focus
	 * it or read its value.
	 * @param {{
	 *   value?: string,
	 *   placeholder: string,
	 *   ariaLabel?: string,
	 *   clearLabel: string,
	 *   extraClass?: string,
	 *   onChange: (value: string) => void,
	 * }} config
	 */
	function renderSearchField(config) {
		const wrap = el('div', { className: config.extraClass ? `search-field ${config.extraClass}` : 'search-field' });
		wrap.appendChild(el('i', { className: 'codicon codicon-search search-field-icon' }));

		const input = /** @type {HTMLInputElement} */ (el('input', { className: 'text-input' }));
		input.type = 'text';
		input.placeholder = config.placeholder;
		input.setAttribute('aria-label', config.ariaLabel || config.placeholder);
		input.value = config.value || '';
		wrap.appendChild(input);

		const clear = /** @type {HTMLButtonElement} */ (el('button', { className: 'icon-button search-field-clear' }));
		clear.type = 'button';
		clear.title = config.clearLabel;
		clear.setAttribute('aria-label', config.clearLabel);
		clear.appendChild(el('i', { className: 'codicon codicon-close' }));
		// Keeps focus in the field, so typing can continue right after clearing.
		clear.addEventListener('mousedown', (event) => event.preventDefault());
		wrap.appendChild(clear);

		const refreshClear = () => {
			clear.hidden = input.value === '';
		};

		const commit = () => {
			refreshClear();
			config.onChange(input.value);
		};

		const clearValue = () => {
			if (input.value === '') {
				return;
			}
			input.value = '';
			input.focus();
			commit();
		};

		input.addEventListener('input', commit);
		input.addEventListener('keydown', (event) => {
			if (event.key === 'Escape' && input.value) {
				// Swallowed on purpose: clearing the search must not also close the
				// surrounding dialog.
				event.stopPropagation();
				clearValue();
			}
		});
		clear.addEventListener('click', clearValue);
		refreshClear();

		return { element: wrap, input, clear: clearValue };
	}

	/**
	 * Replaces a <select>'s native browser arrow with a custom chevron icon
	 * inside a wrapper element: in very narrow columns (e.g. after resizing) the
	 * native arrow can otherwise scroll out of view, because the browser does
	 * not treat it as a separate, guaranteed-visible element. Returns the
	 * wrapper that should be placed in the cell instead of the bare <select>.
	 * @param {HTMLSelectElement} select
	 */
	function wrapSelectWithChevron(select) {
		select.classList.add('has-chevron');
		const wrap = el('div', { className: 'select-wrap' });
		wrap.appendChild(select);
		wrap.appendChild(el('i', { className: 'codicon codicon-chevron-down select-chevron' }));
		return wrap;
	}

	/**
	 * Fills a <select> with a list of values plus an empty placeholder option.
	 * A value that is currently set but no longer part of the list is still
	 * shown (e.g. after the referenced file/column was deleted or renamed)
	 * instead of being silently dropped.
	 * @param {HTMLSelectElement} select
	 * @param {string[]} values
	 * @param {string} currentValue
	 * @param {string} emptyOptionText
	 * @param {string} notFoundSuffix
	 */
	function populateSelectOptions(select, values, currentValue, emptyOptionText, notFoundSuffix) {
		select.innerHTML = '';

		const emptyOption = document.createElement('option');
		emptyOption.value = '';
		emptyOption.textContent = emptyOptionText;
		select.appendChild(emptyOption);

		const allValues = currentValue && !values.includes(currentValue) ? [currentValue, ...values] : values;
		for (const value of allValues) {
			const option = document.createElement('option');
			option.value = value;
			option.textContent = values.includes(value) ? value : `${value}${notFoundSuffix}`;
			if (value === currentValue) {
				option.selected = true;
			}
			select.appendChild(option);
		}
	}

	// ---------------------------------------------------------------------
	// Floating menu: shared basis for "insert dynamic value" (file name/output
	// folder in table.js/project.js). Webviews have no native VS Code menu, so
	// this is a custom one styled via the menu theme variables (see
	// .context-menu in main.css) — at most one open at a time.
	// ---------------------------------------------------------------------

	/** @type {(() => void) | null} */
	let closeFloatingMenu = null;

	function dismissFloatingMenu() {
		if (closeFloatingMenu) {
			closeFloatingMenu();
		}
	}

	/**
	 * Opens a floating menu at the given viewport position, closing any menu
	 * that is already open.
	 * @typedef {{kind:'label',text:string}|{kind:'separator'}|{kind:'item',text:string,icon?:string,onPick:()=>void}} FloatingMenuEntry
	 * @param {number} x
	 * @param {number} y
	 * @param {FloatingMenuEntry[]} entries
	 */
	function showFloatingMenu(x, y, entries) {
		dismissFloatingMenu();

		const menu = el('div', { className: 'context-menu variable-menu' });
		menu.setAttribute('role', 'menu');
		menu.tabIndex = -1;

		for (const entry of entries) {
			if (entry.kind === 'label') {
				menu.appendChild(el('div', { className: 'context-menu-label', text: entry.text }));
			} else if (entry.kind === 'separator') {
				menu.appendChild(el('div', { className: 'context-menu-separator' }));
			} else {
				const item = /** @type {HTMLButtonElement} */ (el('button', { className: 'context-menu-item' }));
				item.type = 'button';
				item.setAttribute('role', 'menuitem');
				if (entry.icon) {
					item.appendChild(el('i', { className: `codicon codicon-${entry.icon} menu-item-icon` }));
				}
				item.appendChild(el('span', { text: entry.text }));
				item.addEventListener('click', () => {
					dismissFloatingMenu();
					entry.onPick();
				});
				menu.appendChild(item);
			}
		}

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
				dismissFloatingMenu();
			}
		};
		/** @param {KeyboardEvent} event */
		const onGlobalKeyDown = (event) => {
			if (event.key === 'Escape') {
				event.stopPropagation();
				dismissFloatingMenu();
			}
		};
		const onWindowBlur = () => dismissFloatingMenu();
		document.addEventListener('mousedown', onGlobalPointerDown, true);
		document.addEventListener('keydown', onGlobalKeyDown, true);
		window.addEventListener('blur', onWindowBlur);

		closeFloatingMenu = () => {
			closeFloatingMenu = null;
			document.removeEventListener('mousedown', onGlobalPointerDown, true);
			document.removeEventListener('keydown', onGlobalKeyDown, true);
			window.removeEventListener('blur', onWindowBlur);
			menu.remove();
		};
	}

	// ---------------------------------------------------------------------
	// Tag field (Power-Automate style): constant text is directly editable,
	// while dynamic `{…}` variables appear as atomic tags — deletable with
	// Backspace/Delete like a single character, and a click on a tag removes
	// it. Used for the per-table file name (table.js) and the per-project
	// output folder (project.js).
	// ---------------------------------------------------------------------

	/**
	 * Builds the tag field; `labelFor`/`iconFor` supply the display of a `{…}`
	 * token, and `onChange` receives the template text on every change.
	 * @param {{
	 *   value: string,
	 *   placeholder: string,
	 *   ariaLabel: string,
	 *   labelFor: (token: string) => string,
	 *   iconFor: (token: string) => string,
	 *   onChange: (value: string, immediate: boolean) => void,
	 * }} config
	 */
	function renderTagField(config) {
		const field = el('div', { className: 'text-input tag-field' });
		field.contentEditable = 'true';
		field.spellcheck = false;
		field.setAttribute('role', 'textbox');
		field.setAttribute('aria-label', config.ariaLabel);
		field.setAttribute('data-placeholder', config.placeholder);

		/**
		 * Builds one atomic tag element for a `{…}` token.
		 * @param {string} token
		 */
		function createChip(token) {
			// The outer element is deliberately inline-block with an inline-flex
			// child (.filename-tag-inner): an atomic inline building block with
			// display:inline-flex applied directly is rendered unreliably by
			// Chromium inside contenteditable (baseline/caret).
			const chip = el('span', { className: 'filename-tag' });
			chip.contentEditable = 'false';
			chip.setAttribute('data-var', token);
			chip.title = `{${token}}`;
			const inner = el('span', { className: 'filename-tag-inner' });
			inner.appendChild(el('i', { className: `codicon codicon-${config.iconFor(token)}` }));
			inner.appendChild(el('span', { text: config.labelFor(token) }));
			chip.appendChild(inner);
			chip.addEventListener('click', () => {
				// Clicking removes the tag.
				chip.remove();
				commit(true);
			});
			return chip;
		}

		/** Builds the field content from the stored template. @param {string} template */
		function build(template) {
			field.innerHTML = '';
			const pattern = /\{([^{}]+)\}/g;
			let lastIndex = 0;
			let match;
			while ((match = pattern.exec(template)) !== null) {
				if (match.index > lastIndex) {
					field.appendChild(document.createTextNode(template.slice(lastIndex, match.index)));
				}
				field.appendChild(createChip(match[1]));
				lastIndex = match.index + match[0].length;
			}
			if (lastIndex < template.length) {
				field.appendChild(document.createTextNode(template.slice(lastIndex)));
			}
			refreshEmptyState();
		}

		/** Reads the field content back into the template syntax. */
		function serialize() {
			// Line breaks and curly braces have no business in the *text* (braces
			// would collide with the template syntax) — clean each text part
			// individually, NOT the combined result: that would also strip the
			// braces of the {…} tags themselves, and the tags would decay into
			// plain text the next time the field is rebuilt.
			const cleanText = (text) => (text || '').replace(/[\r\n{}]/g, '');
			let result = '';
			field.childNodes.forEach((node) => {
				if (node.nodeType === Node.TEXT_NODE) {
					result += cleanText(node.textContent);
				} else if (node instanceof HTMLElement && node.dataset.var) {
					result += `{${node.dataset.var}}`;
				} else if (node instanceof HTMLElement) {
					// E.g. elements originating from a paste: only the text counts.
					result += cleanText(node.textContent);
				}
			});
			return result;
		}

		function refreshEmptyState() {
			// An emptied contenteditable often keeps a <br> behind — the field
			// still counts as empty then (show the placeholder).
			const empty = (field.textContent || '') === '' && !field.querySelector('[data-var]');
			if (empty && field.childNodes.length > 0) {
				field.innerHTML = '';
			}
			field.classList.toggle('tag-field-empty', empty);
		}

		/** @param {boolean} immediate */
		function commit(immediate) {
			refreshEmptyState();
			config.onChange(serialize(), immediate);
		}

		field.addEventListener('input', () => commit(false));
		field.addEventListener('blur', () => commit(true));
		field.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				field.blur();
			}
		});
		field.addEventListener('paste', (event) => {
			// Only take over plain text (without formatting or line breaks).
			event.preventDefault();
			const text = (event.clipboardData ? event.clipboardData.getData('text/plain') : '').replace(/[\r\n{}]/g, '');
			document.execCommand('insertText', false, text);
		});

		/** Inserts a variable at the current cursor position (at the end otherwise). @param {string} token */
		function insertVariable(token) {
			const chip = createChip(token);
			const selection = window.getSelection();
			if (selection && selection.rangeCount > 0 && field.contains(selection.anchorNode)) {
				const range = selection.getRangeAt(0);
				range.deleteContents();
				range.insertNode(chip);
				range.setStartAfter(chip);
				range.collapse(true);
				selection.removeAllRanges();
				selection.addRange(range);
			} else {
				field.appendChild(chip);
			}
			commit(true);
		}

		build(config.value || '');
		return { element: field, insertVariable };
	}

	/**
	 * Formats a point in time as `yyyy-MM-dd HH:mm:ss` in local time — the one
	 * date format the UI uses, in every editor and every tooltip, so a
	 * timestamp reads the same everywhere and never depends on the display
	 * language.
	 * @param {number|string|Date|null|undefined} value epoch ms, ISO string or Date
	 * @returns {string} the formatted time, or '' when there is nothing to format
	 */
	function formatDateTime(value) {
		if (value === null || value === undefined || value === '') {
			return '';
		}
		const date = value instanceof Date ? value : new Date(value);
		if (Number.isNaN(date.getTime())) {
			return '';
		}
		const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
		return (
			`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
			`${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
		);
	}

	window.DatenschmiedeCommon = {
		el,
		bindText,
		debounce,
		autoGrowCellTextarea,
		renderMarkdown,
		renderMarkdownField,
		renderTextField,
		renderLabeledMarkdownField,
		renderErrorState,
		variableLabel,
		isEditing,
		createDeferredRenderer,
		updateFieldError,
		formatDateTime,
		renderSearchField,
		renderAutoSizeColumnsButton,
		wrapSelectWithChevron,
		populateSelectOptions,
		buildColGroup,
		attachColumnResizeHandle,
		fixColumnWidths,
		showFloatingMenu,
		dismissFloatingMenu,
		renderTagField,
	};
})();
