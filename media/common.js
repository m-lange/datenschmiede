// @ts-check
// Gemeinsame, zustandslose Webview-Bausteine für Table Editor (table.js) und
// Projekt-Editor (project.js): generische DOM-Helfer, das Markdown-
// Vorschau-/Editor-Feld und der eigene Select-Chevron. Bewusst als
// eigenständiges, unkompiliertes Skript gehalten (wie table.js/project.js
// selbst) und vor ihnen eingebunden (siehe getHtml in
// table/editorProvider.ts/project/editorProvider.ts) — exportiert seine
// Funktionen auf `window.DatenschmiedeCommon`, da Webviews hier ohne
// Modul-Bundling auskommen.
(function () {
	'use strict';

	/**
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
	 * Bindet ein Text-Eingabefeld (input/textarea) an eine Setter-Funktion:
	 * tippen aktualisiert den lokalen Zustand sofort und meldet die Änderung
	 * über `commitDebounced`, blur/Verlassen des Felds meldet sie sofort über
	 * `commit`.
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
	 * Lässt eine Textarea automatisch mit ihrem Inhalt mitwachsen bzw.
	 * -schrumpfen, statt eine feste Höhe mit interner Scrollleiste zu zeigen.
	 * @param {HTMLTextAreaElement} textarea
	 */
	function autoGrowCellTextarea(textarea) {
		textarea.style.height = 'auto';
		textarea.style.height = `${textarea.scrollHeight}px`;
	}

	// ---------------------------------------------------------------------
	// Markdown: sehr kleiner, bewusst eingeschränkter Renderer für die
	// Beschreibungsfelder. Escaped zuerst konsequent jedes HTML im Rohtext
	// und wendet danach nur eine kleine, sichere Teilmenge an
	// Markdown-Syntax an (fett, kursiv, Code, Links, Listen, Absätze) — es
	// wird nie rohes HTML durchgelassen.
	// ---------------------------------------------------------------------

	/** @param {string} text */
	function escapeHtml(text) {
		return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}

	/** @param {string} line */
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

	/** @param {string} block */
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

	/** @param {string} source */
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
	 * Beschreibungsfeld mit Markdown-Unterstützung: standardmäßig als
	 * gerendertes Markdown angezeigt, ein Klick (oder Enter/Leertaste) blendet
	 * eine rohe Markdown-Textarea zum Bearbeiten ein, die beim Verlassen
	 * (blur bzw. Escape) wieder verschwindet. Mit `gridCell: true` bleibt die
	 * Vorschau per CSS einzeilig mit Ellipsis bei Überlänge (siehe
	 * main.css `.columns-table .md-preview`) — das funktioniert nur, weil die
	 * Vorschau ein <div> ist; text-overflow: ellipsis wird von <textarea>
	 * nicht unterstützt, deshalb kein einzelnes Textarea-Element für beide
	 * Zustände.
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
	 * Markiert ein Eingabeelement bei einem Validierungsproblem nur farblich
	 * (roter Rahmen) statt mit zusätzlichem Fehlertext — die ausführliche
	 * Meldung steht in VS Codes Problems-Ansicht; als Tooltip liegt sie
	 * trotzdem am Feld an.
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
	// Grid-Spaltenbreiten: gemeinsame Größenzieh-Logik für table.js
	// (Spalten-Grid) und project.js (Tabellen-Auswahlbaum) — beide Grids
	// starten mit table-layout: auto, damit Spalten ohne von Hand gesetzte
	// Breite sich beim ersten Rendern inhaltsbasiert einpendeln; erst wenn
	// die Tabelle wirklich im DOM hängt, lässt sich die dafür tatsächlich
	// benötigte Breite messen (siehe fixColumnWidths) und die Tabelle auf
	// table-layout: fixed umschalten — nur damit ist eine per Hand gezogene
	// <col>-Breite zuverlässig maßgeblich.
	// ---------------------------------------------------------------------

	/**
	 * Baut die <colgroup> für ein Grid: eine <col> je Spalte in `order`, plus
	 * eine leere Füll-Spalte am Ende (nimmt jeden Restplatz auf, damit das
	 * Grid weiterhin die volle Breite ausfüllt, ohne die Inhaltsspalten zu
	 * strecken). Spalten mit einer von Hand gezogenen Breite (aus `widths`)
	 * bekommen diese sofort als feste Breite.
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
	 * Macht eine Grid-Kopfzelle per Ziehgriff am rechten Rand größenziehbar:
	 * setzt die feste Breite direkt auf das zugehörige <col>-Element. Beim
	 * Loslassen wird die neue Breite über `onResized` gemeldet (üblicherweise
	 * an den Extension-Host, der sie geräteweit merkt).
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
	 * Setzt für jede größenziehbare Spalte ihre endgültige feste Breite (von
	 * Hand gezogen, sonst die inhaltsbasiert gemessene Breite ihrer
	 * Kopfzelle) und schaltet die Tabelle danach auf table-layout: fixed um.
	 *
	 * Gemessen wird kurzzeitig unter width: max-content: unter dem normalen
	 * width: 100% wären die Spalten bei wenig Inhalt bereits auf die volle
	 * Panel-Breite auseinandergezogen und die Messung ergäbe genau diese
	 * gestreckten Breiten — übrig bliebe nie freier Platz für die
	 * Füll-Spalte rechts (siehe buildColGroup). Nur wenn der Inhalt ohnehin
	 * breiter als das Panel ist, wird wie zuvor im gestreckten Zustand
	 * gemessen: die Füll-Spalte bekäme sowieso nichts, und eine reine
	 * max-content-Messung würde z. B. eine lange Beschreibung uferlos breit
	 * machen, statt sie wie gewollt per Ellipsis zu kürzen.
	 *
	 * Darf erst aufgerufen werden, wenn die Tabelle wirklich im DOM hängt
	 * (sonst liefert getBoundingClientRect() keine sinnvolle Breite).
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
	 * Ersetzt den nativen Browser-Pfeil eines <select> durch ein eigenes
	 * Chevron-Icon in einem Wrapper-Element: bei sehr schmalen Spalten (z. B.
	 * nach Größenänderung) kann der native Pfeil sonst aus dem Sichtbereich
	 * geraten, weil der Browser ihn nicht als eigenes, garantiert sichtbares
	 * Element behandelt. Gibt den Wrapper zurück, der statt des rohen
	 * <select> in die Zelle gehängt werden soll.
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
	 * Füllt ein <select> mit einer Werteliste plus leerer Platzhalter-Option.
	 * Zeigt einen aktuell gesetzten, aber nicht (mehr) in der Liste
	 * enthaltenen Wert trotzdem an (z. B. nach Löschen/Umbenennen der
	 * referenzierten Datei/Spalte), statt ihn stillschweigend zu verwerfen.
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

	window.DatenschmiedeCommon = {
		el,
		bindText,
		autoGrowCellTextarea,
		renderMarkdown,
		renderMarkdownField,
		updateFieldError,
		wrapSelectWithChevron,
		populateSelectOptions,
		buildColGroup,
		attachColumnResizeHandle,
		fixColumnWidths,
	};
})();
