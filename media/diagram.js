// @ts-check
// ER-Diagramm des Projekt-Editors (Tab „Diagramm“): zeichnet die ausgewählten
// Tabellen des Projekts mit ihren Beziehungs-Spalten und FK-Kanten als rein
// lesendes SVG — keine Bearbeitung, kein Ziehen. Das Layout ist
// vollautomatisch (Sugiyama-Ansatz wie das Lineage-Diagramm des MLA-Projekts):
// Längster-Pfad-Schichtung (referenzierte Tabellen links, referenzierende
// rechts), Barycenter-Sweeps zur Kreuzungsminimierung und eine vertikale
// Relaxation, die Kästen in die Nähe ihrer Nachbarn zieht. Alle Farben kommen
// ausschließlich aus VS-Code-Theme-Variablen (siehe .er-* in main.css), damit
// helle, dunkle und High-Contrast-Themes gleichermaßen passen. Eingebunden
// vor project.js (siehe getHtml in project/editorProvider.ts).
(function () {
	'use strict';

	/** @typedef {{name:string,type:string,pk:boolean,fk:boolean,hidden:boolean}} DiagramColumn */
	/** @typedef {{path:string,label:string,schema:string,name:string,columns:DiagramColumn[],records?:string,estimatedMin?:number,estimatedMax?:number,secondary:boolean,referencedTable?:string,lastRunRecords?:number}} DiagramTable */
	/** @typedef {{fromTable:string,fromColumn:string,toTable:string,toColumn:string,cardinality?:string}} DiagramEdge */
	/** @typedef {{tables:DiagramTable[],edges:DiagramEdge[],lastRunAt?:number}} ProjectDiagram */
	/**
	 * @typedef {Object} DiagramOptions
	 * @property {any} strings Übersetzte Texte (siehe project/webviewStrings.ts).
	 * @property {(n: number) => string} formatNumber Zahl mit Tausendertrennzeichen der Webview-Sprache.
	 * @property {(path: string) => void} onOpenTable Öffnet die `.td`-Datei eines Kastens.
	 */

	const SVG_NS = 'http://www.w3.org/2000/svg';

	// ---------------------------------------------------------------------
	// Geometrie — Zeilenhöhe/Kopfhöhe müssen zu den Schriftgrößen der
	// .er-*-Klassen in main.css passen (siehe FONT_* unten).
	// ---------------------------------------------------------------------

	const ROW_H = 22;
	const HEAD_H = 46;
	const PAD = 28;
	const GAP_X = 110;
	const GAP_Y = 32;
	const MIN_BOX_W = 200;
	const MAX_BOX_W = 320;
	const PILL_H = 20;
	/** X-Position der Spaltennamen — lässt links Platz für das PK-/FK-Icon. */
	const COL_TEXT_X = 30;

	// ---------------------------------------------------------------------
	// Textbreiten: einmalig über ein Canvas gemessen, mit denselben
	// Schriftgrößen wie die .er-*-Klassen in main.css — nur so stimmen
	// Kastenbreite und Abschneiden mit dem tatsächlichen Rendering überein.
	// ---------------------------------------------------------------------

	const measureCtx = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d'));

	/** Schrift-Strings für measure() — Familie kommt vom Editor-Body (VS-Code-Theme). */
	function fontSet() {
		const family = getComputedStyle(document.body).fontFamily || 'sans-serif';
		return {
			schema: `600 10px ${family}`,
			name: `600 13px ${family}`,
			col: `12px ${family}`,
			colPk: `600 12px ${family}`,
			type: `11px ${family}`,
			pill: `600 11px ${family}`,
		};
	}

	/**
	 * @param {string} text
	 * @param {string} font
	 */
	function measure(text, font) {
		measureCtx.font = font;
		return measureCtx.measureText(text).width;
	}

	/**
	 * Kürzt `text` mit „…“ auf `maxWidth` Pixel (in `font`).
	 * @param {string} text
	 * @param {string} font
	 * @param {number} maxWidth
	 */
	function truncate(text, font, maxWidth) {
		if (measure(text, font) <= maxWidth) {
			return text;
		}
		let result = text;
		while (result.length > 1 && measure(result + '…', font) > maxWidth) {
			result = result.slice(0, -1);
		}
		return result + '…';
	}

	/**
	 * Das Schriftzeichen eines Codicons (z. B. "key"), zur Anzeige in SVG-Text
	 * mit `font-family: codicon`. Aus dem ::before-Inhalt der geladenen
	 * codicon.css gelesen statt hart kodiert — so bleiben die Codepoints auch
	 * nach einem Codicon-Update korrekt.
	 * @param {string} name
	 */
	function codiconChar(name) {
		const probe = document.createElement('i');
		probe.className = `codicon codicon-${name}`;
		probe.style.position = 'absolute';
		probe.style.visibility = 'hidden';
		document.body.appendChild(probe);
		const content = getComputedStyle(probe, '::before').content;
		probe.remove();
		// content hat die Form '"…"' — das Zeichen selbst steht in der Mitte.
		return content && content.length >= 3 ? content.slice(1, -1) : '';
	}

	/**
	 * @param {string} tag
	 * @param {Record<string, string | number>} [attrs]
	 */
	function svgEl(tag, attrs) {
		const element = document.createElementNS(SVG_NS, tag);
		if (attrs) {
			for (const key of Object.keys(attrs)) {
				element.setAttribute(key, String(attrs[key]));
			}
		}
		return element;
	}

	/**
	 * @param {SVGElement} parent
	 * @param {string} text
	 */
	function appendTitle(parent, text) {
		const title = svgEl('title');
		title.textContent = text;
		parent.appendChild(title);
	}

	// ---------------------------------------------------------------------
	// Automatisches Layout (Sugiyama-Ansatz) — Portierung des Layouts aus dem
	// MLA-Lineage-Diagramm (lineage_svg.py): Schichtung, Barycenter-Ordnung,
	// vertikale Relaxation.
	// ---------------------------------------------------------------------

	/**
	 * Längster-Pfad-Schichtung: referenzierte (Eltern-)Tabellen links,
	 * referenzierende (Kind-)Tabellen rechts. `layoutEdges` zeigen dafür von
	 * der Eltern- zur Kind-Tabelle. Zyklen (über von Hand gebaute TOML
	 * möglich) brechen auf Schicht 0 ab.
	 * @param {{src:string,tgt:string}[]} layoutEdges
	 * @param {string[]} tables
	 * @returns {Map<string, number>}
	 */
	function layerTables(layoutEdges, tables) {
		/** @type {Map<string, Set<string>>} */
		const sources = new Map();
		for (const { src, tgt } of layoutEdges) {
			if (src !== tgt) {
				let set = sources.get(tgt);
				if (!set) {
					set = new Set();
					sources.set(tgt, set);
				}
				set.add(src);
			}
		}
		/** @type {Map<string, number>} */
		const layers = new Map();
		/**
		 * @param {string} table
		 * @param {Set<string>} path
		 * @returns {number}
		 */
		function layerOf(table, path) {
			const known = layers.get(table);
			if (known !== undefined) {
				return known;
			}
			if (path.has(table)) {
				return 0; // Zyklus
			}
			const deps = sources.get(table);
			let value = -1;
			if (deps) {
				const next = new Set(path);
				next.add(table);
				for (const source of deps) {
					value = Math.max(value, layerOf(source, next));
				}
			}
			value += 1;
			layers.set(table, value);
			return value;
		}
		for (const table of tables) {
			layerOf(table, new Set());
		}
		return layers;
	}

	/**
	 * Positionen aller Kästen: Schichten von links nach rechts, innerhalb
	 * jeder Schicht per Barycenter-Sweeps sortiert (weniger Kreuzungen) und
	 * anschließend vertikal in Richtung der Nachbarn relaxiert.
	 * @param {{src:string,tgt:string}[]} layoutEdges
	 * @param {string[]} tables
	 * @param {Map<string, number>} heights
	 * @param {number} boxW
	 * @returns {{pos: Map<string, {x:number,y:number}>, width: number, height: number}}
	 */
	function layout(layoutEdges, tables, heights, boxW) {
		const layers = layerTables(layoutEdges, tables);
		/** @type {Map<number, string[]>} */
		const byLayer = new Map();
		for (const table of [...tables].sort()) {
			const layer = /** @type {number} */ (layers.get(table));
			let list = byLayer.get(layer);
			if (!list) {
				list = [];
				byLayer.set(layer, list);
			}
			list.push(table);
		}
		const levels = [...byLayer.keys()].sort((a, b) => a - b);

		// Gewichtete Nachbarschaft: Anzahl Spalten-Kanten zwischen zwei Tabellen.
		/** @type {Map<string, Map<string, number>>} */
		const neighbors = new Map();
		/**
		 * @param {string} a
		 * @param {string} b
		 */
		const addNeighbor = (a, b) => {
			let map = neighbors.get(a);
			if (!map) {
				map = new Map();
				neighbors.set(a, map);
			}
			map.set(b, (map.get(b) || 0) + 1);
		};
		for (const { src, tgt } of layoutEdges) {
			if (src !== tgt && heights.has(src) && heights.has(tgt)) {
				addNeighbor(src, tgt);
				addNeighbor(tgt, src);
			}
		}

		// Kreuzungsminimierung: abwechselnde Barycenter-Sweeps.
		/** @type {Map<string, number>} */
		const order = new Map();
		for (const level of levels) {
			const list = /** @type {string[]} */ (byLayer.get(level));
			list.forEach((table, index) => order.set(table, index));
		}
		for (let sweep = 0; sweep < 4; sweep++) {
			const sweepLevels = sweep % 2 ? [...levels].reverse() : levels;
			for (const level of sweepLevels) {
				const list = /** @type {string[]} */ (byLayer.get(level));
				/** @param {string} table */
				const barycenter = (table) => {
					const map = neighbors.get(table);
					let weighted = 0;
					let total = 0;
					if (map) {
						for (const [other, weight] of map) {
							if (layers.get(other) !== level) {
								weighted += /** @type {number} */ (order.get(other)) * weight;
								total += weight;
							}
						}
					}
					return total > 0 ? weighted / total : /** @type {number} */ (order.get(table));
				};
				list.sort((a, b) => {
					const diff = barycenter(a) - barycenter(b);
					return diff !== 0 ? diff : a < b ? -1 : a > b ? 1 : 0;
				});
				list.forEach((table, index) => order.set(table, index));
			}
		}

		// Vertikale Startpositionen: einfache Stapelung in Sweep-Reihenfolge.
		/** @type {Map<string, number>} */
		const y = new Map();
		for (const level of levels) {
			let cursor = PAD;
			for (const table of /** @type {string[]} */ (byLayer.get(level))) {
				y.set(table, cursor);
				cursor += /** @type {number} */ (heights.get(table)) + GAP_Y;
			}
		}

		// Relaxation: jeden Kasten Richtung Mittelwert seiner Nachbarn ziehen,
		// Reihenfolge und Mindestabstand innerhalb der Schicht erhalten.
		for (let iteration = 0; iteration < 8; iteration++) {
			for (const level of levels) {
				const list = /** @type {string[]} */ (byLayer.get(level));
				const desired = list.map((table) => {
					const map = neighbors.get(table);
					let weighted = 0;
					let total = 0;
					if (map) {
						for (const [other, weight] of map) {
							if (layers.get(other) !== level) {
								const center = /** @type {number} */ (y.get(other)) + /** @type {number} */ (heights.get(other)) / 2;
								weighted += center * weight;
								total += weight;
							}
						}
					}
					if (total === 0) {
						return /** @type {number} */ (y.get(table));
					}
					return weighted / total - /** @type {number} */ (heights.get(table)) / 2;
				});
				let cursor = PAD;
				list.forEach((table, index) => {
					const next = Math.max(desired[index], cursor);
					y.set(table, next);
					cursor = next + /** @type {number} */ (heights.get(table)) + GAP_Y;
				});
			}
			// Gemeinsames Abdriften nach unten wieder ausgleichen.
			const shift = Math.min(...y.values()) - PAD;
			if (shift > 0) {
				for (const table of y.keys()) {
					y.set(table, /** @type {number} */ (y.get(table)) - shift);
				}
			}
		}

		const layerCount = levels.length > 0 ? levels[levels.length - 1] + 1 : 1;
		/** @type {Map<string, {x:number,y:number}>} */
		const pos = new Map();
		for (const table of tables) {
			pos.set(table, {
				x: PAD + /** @type {number} */ (layers.get(table)) * (boxW + GAP_X),
				y: /** @type {number} */ (y.get(table)),
			});
		}
		let height = PAD;
		for (const table of tables) {
			height = Math.max(height, /** @type {number} */ (y.get(table)) + /** @type {number} */ (heights.get(table)));
		}
		return {
			pos,
			width: 2 * PAD + layerCount * boxW + (layerCount - 1) * GAP_X,
			height: height + PAD,
		};
	}

	// ---------------------------------------------------------------------
	// Zeichnen
	// ---------------------------------------------------------------------

	/**
	 * Kubische Bézier-Kante zwischen zwei Ankern; `dir` gibt je Seite an, in
	 * welche Richtung die Kurve aus dem Kasten austritt (+1 rechts, -1 links).
	 * @param {number} x1 @param {number} y1 @param {number} dir1
	 * @param {number} x2 @param {number} y2 @param {number} dir2
	 */
	function edgePath(x1, y1, dir1, x2, y2, dir2) {
		const dx = Math.max(40, Math.abs(x2 - x1) * 0.45);
		return `M${x1},${y1} C${x1 + dir1 * dx},${y1} ${x2 + dir2 * dx},${y2} ${x2},${y2}`;
	}

	/**
	 * Punkt der kubischen Bézier-Kurve bei t=0,5 — Position der Kanten-Beschriftung.
	 * @param {number} x1 @param {number} y1 @param {number} dir1
	 * @param {number} x2 @param {number} y2 @param {number} dir2
	 */
	function edgeMidpoint(x1, y1, dir1, x2, y2, dir2) {
		const dx = Math.max(40, Math.abs(x2 - x1) * 0.45);
		const c1x = x1 + dir1 * dx;
		const c2x = x2 + dir2 * dx;
		return {
			x: (x1 + 3 * c1x + 3 * c2x + x2) / 8,
			y: (y1 + 3 * y1 + 3 * y2 + y2) / 8,
		};
	}

	/** Pfeilspitzen-Marker (normal + hervorgehoben) — Farben über CSS (siehe main.css). */
	function buildDefs() {
		const defs = svgEl('defs');
		for (const id of ['er-arrow', 'er-arrow-hot']) {
			const marker = svgEl('marker', {
				id,
				viewBox: '0 0 10 10',
				refX: 9,
				refY: 5,
				markerWidth: 7,
				markerHeight: 7,
				orient: 'auto-start-reverse',
			});
			marker.appendChild(svgEl('path', { d: 'M0,0 L10,5 L0,10 z' }));
			defs.appendChild(marker);
		}
		return defs;
	}

	/**
	 * Zeichnet das komplette Diagramm und liefert das fertige Element für den
	 * Tab-Inhalt: Legende plus horizontal scrollbares SVG.
	 * @param {ProjectDiagram} diagram
	 * @param {DiagramOptions} options
	 */
	function renderErDiagram(diagram, options) {
		const { strings, formatNumber, onOpenTable } = options;
		const fonts = fontSet();
		const iconChars = { key: codiconChar('key'), references: codiconChar('references') };

		/**
		 * Anzeige-Text der Datensatzanzahl eines Kastens: bevorzugt die echte
		 * Anzahl aus dem letzten Generator-Lauf ("812"), sonst die berechnete
		 * Von/Bis-Anzahl ("100..300") bzw. der konfigurierte Wert; leer ohne
		 * Angabe. @param {DiagramTable} table
		 */
		function recordsText(table) {
			if (table.lastRunRecords !== undefined) {
				return formatNumber(table.lastRunRecords);
			}
			if (table.estimatedMin !== undefined && table.estimatedMax !== undefined) {
				return table.estimatedMin === table.estimatedMax
					? formatNumber(table.estimatedMin)
					: `${formatNumber(table.estimatedMin)}..${formatNumber(table.estimatedMax)}`;
			}
			const raw = (table.records || '').trim();
			return /^\d+$/.test(raw) ? formatNumber(Number(raw)) : raw;
		}

		// Zeitpunkt des letzten Laufs, formatiert in der Webview-Sprache — für
		// die Tooltips der Zähler mit echten Anzahlen.
		const lastRunText = diagram.lastRunAt
			? new Intl.DateTimeFormat(document.documentElement.lang === 'de' ? 'de-DE' : 'en-US', {
					dateStyle: 'short',
					timeStyle: 'short',
				}).format(new Date(diagram.lastRunAt))
			: '';

		// --- Kastenbreite aus den Inhalten ableiten (einheitlich für alle) ---
		let needed = MIN_BOX_W;
		for (const table of diagram.tables) {
			const pillW = recordsText(table) ? measure(recordsText(table), fonts.pill) + 16 : 0;
			needed = Math.max(needed, 12 + measure(table.name, fonts.name) + 8 + pillW + 12);
			if (table.schema) {
				needed = Math.max(needed, 12 + measure(table.schema.toUpperCase(), fonts.schema) + table.schema.length * 0.6 + 8 + pillW + 12);
			}
			for (const column of table.columns) {
				const typeW = Math.min(measure(column.type, fonts.type), 80);
				needed = Math.max(needed, COL_TEXT_X + measure(column.name, column.pk ? fonts.colPk : fonts.col) + 10 + typeW + 12);
			}
		}
		const boxW = Math.min(MAX_BOX_W, Math.ceil(needed));

		// --- Layout: Kanten für die Schichtung zeigen Eltern -> Kind ---
		const labels = diagram.tables.map((table) => table.label);
		const layoutEdges = diagram.edges.map((edge) => ({ src: edge.toTable, tgt: edge.fromTable }));
		/** @type {Map<string, number>} */
		const heights = new Map();
		for (const table of diagram.tables) {
			heights.set(table.label, HEAD_H + table.columns.length * ROW_H + (table.columns.length > 0 ? 6 : 0));
		}
		const { pos, width, height } = layout(layoutEdges, labels, heights, boxW);

		// --- Zeilen-Anker der Spalten (für spaltengenaue Kanten) ---
		/** @type {Map<string, number>} `label|spalte` -> Zeilen-Index */
		const rowIndex = new Map();
		/** @type {Map<string, DiagramTable>} */
		const byLabel = new Map();
		for (const table of diagram.tables) {
			byLabel.set(table.label, table);
			table.columns.forEach((column, index) => rowIndex.set(`${table.label}|${column.name}`, index));
		}
		/**
		 * Y-Anker einer Spalte (Zeilenmitte) — ohne (gefundene) Spalte die Kopfmitte.
		 * @param {string} label
		 * @param {string} column
		 */
		function anchorY(label, column) {
			const position = /** @type {{x:number,y:number}} */ (pos.get(label));
			const index = column ? rowIndex.get(`${label}|${column}`) : undefined;
			return index !== undefined ? position.y + HEAD_H + index * ROW_H + ROW_H / 2 : position.y + HEAD_H / 2;
		}

		const svg = svgEl('svg', {
			class: 'er-svg',
			width,
			height,
			viewBox: `0 0 ${width} ${height}`,
			role: 'img',
		});
		svg.appendChild(buildDefs());

		// --- Kanten (unter den Kästen) ---
		const edgeLayer = svgEl('g');
		svg.appendChild(edgeLayer);
		/** @type {{group: SVGElement, path: SVGElement, from: string, to: string}[]} */
		const edgeItems = [];
		for (const edge of diagram.edges) {
			const childPos = pos.get(edge.fromTable);
			const parentPos = pos.get(edge.toTable);
			if (!childPos || !parentPos) {
				continue;
			}
			// Anker auf den einander zugewandten Seiten; bei gleicher Schicht
			// (Zyklus-Notfall) beide rechts als Schleife.
			let x1;
			let dir1;
			let x2;
			let dir2;
			if (childPos.x > parentPos.x) {
				// Normalfall: Eltern-Tabelle liegt links — Kante verlässt das
				// Kind links und trifft die Eltern-Tabelle rechts.
				x1 = childPos.x;
				dir1 = -1;
				x2 = parentPos.x + boxW;
				dir2 = 1;
			} else if (childPos.x < parentPos.x) {
				x1 = childPos.x + boxW;
				dir1 = 1;
				x2 = parentPos.x;
				dir2 = -1;
			} else {
				x1 = childPos.x + boxW;
				dir1 = 1;
				x2 = parentPos.x + boxW;
				dir2 = 1;
			}
			const y1 = anchorY(edge.fromTable, edge.fromColumn);
			const y2 = anchorY(edge.toTable, edge.toColumn);

			const group = svgEl('g', { class: 'er-edge-group' });
			const d = edgePath(x1, y1, dir1, x2, y2, dir2);
			// Unsichtbarer breiter Zwilling als Hover-Fläche — die sichtbare
			// Kante selbst wäre mit 1,6px kaum zu treffen.
			group.appendChild(svgEl('path', { class: 'er-edge-hit', d }));
			const path = svgEl('path', { class: 'er-edge', d, 'marker-end': 'url(#er-arrow)' });
			group.appendChild(path);

			const target = edge.toColumn ? `${edge.toTable}.${edge.toColumn}` : edge.toTable;
			let tooltip = `${edge.fromTable}.${edge.fromColumn} → ${target}`;
			if (edge.cardinality) {
				tooltip += `\n${edge.cardinality} ${strings.outputFilesPerRecordSuffix.replace('{0}', edge.toTable)}`;
				const mid = edgeMidpoint(x1, y1, dir1, x2, y2, dir2);
				const label = svgEl('text', { class: 'er-edge-label', x: mid.x, y: mid.y - 6, 'text-anchor': 'middle' });
				label.textContent = edge.cardinality;
				group.appendChild(label);
			}
			appendTitle(group, tooltip);

			edgeLayer.appendChild(group);
			edgeItems.push({ group, path, from: edge.fromTable, to: edge.toTable });
		}

		// --- Hervorheben: Kasten-Hover zeigt seine Kanten, dimmt den Rest ---
		/** @type {Map<string, SVGElement>} */
		const tableGroups = new Map();
		/** @param {string | null} label */
		function highlight(label) {
			/** @type {Set<string>} */
			const connected = new Set();
			for (const item of edgeItems) {
				const hot = label !== null && (item.from === label || item.to === label);
				item.group.classList.toggle('er-hot', hot);
				item.group.classList.toggle('er-dim', label !== null && !hot);
				item.path.setAttribute('marker-end', hot ? 'url(#er-arrow-hot)' : 'url(#er-arrow)');
				if (hot) {
					connected.add(item.from);
					connected.add(item.to);
				}
			}
			if (label !== null) {
				connected.add(label);
			}
			for (const [tableLabel, group] of tableGroups) {
				group.classList.toggle('er-dim', label !== null && !connected.has(tableLabel));
			}
		}

		// --- Kästen ---
		const accentByPrefix = new Map();
		for (const table of diagram.tables) {
			const position = /** @type {{x:number,y:number}} */ (pos.get(table.label));
			const boxH = /** @type {number} */ (heights.get(table.label));

			// Akzentfarbe je oberstem Schema-Segment (stabil über die Kästen hinweg).
			const prefix = table.schema ? table.schema.split('.')[0] : '';
			if (!accentByPrefix.has(prefix)) {
				accentByPrefix.set(prefix, accentByPrefix.size % 6);
			}
			const accent = accentByPrefix.get(prefix);

			const group = svgEl('g', {
				class: 'er-table',
				transform: `translate(${position.x}, ${position.y})`,
				tabindex: 0,
				role: 'button',
			});
			group.setAttribute('aria-label', table.label);
			appendTitle(group, `${table.label}\n${table.path}\n${strings.diagramOpenHint}`);

			group.appendChild(svgEl('rect', { class: 'er-box', width: boxW, height: boxH, rx: 8 }));
			group.appendChild(svgEl('rect', { class: 'er-head', width: boxW, height: HEAD_H, rx: 8 }));
			if (table.columns.length > 0) {
				// Untere Rundung des Kopf-Rechtecks wieder eckig machen — nur der
				// Kasten selbst hat unten runde Ecken.
				group.appendChild(svgEl('rect', { class: 'er-head', y: HEAD_H - 10, width: boxW, height: 10 }));
			}
			group.appendChild(svgEl('rect', { class: `er-stripe er-accent-${accent}`, y: HEAD_H - 2, width: boxW, height: 2 }));

			const pillText = recordsText(table);
			const pillW = pillText ? measure(pillText, fonts.pill) + 16 : 0;

			if (table.schema) {
				const schema = svgEl('text', { class: `er-schema er-accent-text-${accent}`, x: 12, y: 18 });
				schema.textContent = truncate(table.schema.toUpperCase(), fonts.schema, boxW - 24 - pillW);
				group.appendChild(schema);
			}
			const name = svgEl('text', { class: 'er-name', x: 12, y: table.schema ? 36 : HEAD_H / 2 + 5 });
			name.textContent = truncate(table.name, fonts.name, boxW - 24 - pillW - (pillW ? 8 : 0));
			group.appendChild(name);

			if (pillText) {
				const pillGroup = svgEl('g', { class: 'er-pill-group' });
				// Konfigurierter Wert als Text — bei referenzierten Tabellen samt
				// „je Datensatz von …“, sonst die feste Anzahl.
				const configured = table.records
					? table.secondary
						? `${table.records} ${strings.outputFilesPerRecordSuffix.replace('{0}', table.referencedTable || '')}`
						: table.records
					: '';
				let pillTitle;
				if (table.lastRunRecords !== undefined) {
					pillTitle = strings.diagramRecordsLastRun
						.replace('{0}', formatNumber(table.lastRunRecords))
						.replace('{1}', lastRunText);
					if (configured) {
						pillTitle += `\n${strings.diagramRecordsConfigured.replace('{0}', configured)}`;
					}
				} else {
					pillTitle = strings.diagramRecordsTitle;
					if (table.secondary && configured) {
						pillTitle += `\n${configured}`;
					}
				}
				appendTitle(pillGroup, pillTitle);
				pillGroup.appendChild(
					svgEl('rect', {
						class: 'er-pill',
						x: boxW - 12 - pillW,
						y: (HEAD_H - PILL_H) / 2,
						width: pillW,
						height: PILL_H,
						rx: PILL_H / 2,
					}),
				);
				const pillLabel = svgEl('text', {
					class: 'er-pill-text',
					x: boxW - 12 - pillW / 2,
					y: HEAD_H / 2 + 4,
					'text-anchor': 'middle',
				});
				pillLabel.textContent = pillText;
				pillGroup.appendChild(pillLabel);
				group.appendChild(pillGroup);
			}

			table.columns.forEach((column, index) => {
				const rowY = HEAD_H + index * ROW_H;
				if (index % 2 === 1) {
					group.appendChild(svgEl('rect', { class: 'er-row-alt', x: 1, y: rowY, width: boxW - 2, height: ROW_H }));
				}
				const row = svgEl('g', { class: 'er-col' + (column.hidden ? ' er-col-hidden' : '') });

				// Tooltip der Zeile: Name (Typ) plus PK-/FK-Erklärung.
				const lines = [`${column.name}${column.type ? ` (${column.type})` : ''}`];
				if (column.pk) {
					lines.push(strings.diagramLegendPk);
				}
				if (column.fk) {
					const outgoing = diagram.edges.find((edge) => edge.fromTable === table.label && edge.fromColumn === column.name);
					lines.push(
						outgoing
							? `${strings.diagramLegendFk} → ${outgoing.toColumn ? `${outgoing.toTable}.${outgoing.toColumn}` : outgoing.toTable}`
							: strings.diagramLegendFk,
					);
				}
				appendTitle(row, lines.join('\n'));

				// PK-/FK-Icon (dieselben Codicons wie die Legende); PK gewinnt bei
				// Brücken-Spalten, die beides sind.
				const iconChar = column.pk ? iconChars.key : column.fk ? iconChars.references : '';
				if (iconChar) {
					const icon = svgEl('text', {
						class: `er-col-icon ${column.pk ? 'er-icon-pk' : 'er-icon-fk'}`,
						x: 11,
						y: rowY + 16,
					});
					icon.textContent = iconChar;
					row.appendChild(icon);
				}

				const typeText = truncate(column.type, fonts.type, 80);
				const typeW = column.type ? measure(typeText, fonts.type) : 0;
				const nameEl = svgEl('text', {
					class: 'er-col-name' + (column.pk ? ' er-col-pk' : ''),
					x: COL_TEXT_X,
					y: rowY + 15,
				});
				nameEl.textContent = truncate(column.name, column.pk ? fonts.colPk : fonts.col, boxW - COL_TEXT_X - 12 - typeW - 10);
				row.appendChild(nameEl);

				if (column.type) {
					const typeEl = svgEl('text', { class: 'er-col-type', x: boxW - 12, y: rowY + 15, 'text-anchor': 'end' });
					typeEl.textContent = typeText;
					row.appendChild(typeEl);
				}
				group.appendChild(row);
			});

			group.addEventListener('click', () => onOpenTable(table.path));
			group.addEventListener('keydown', (event) => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					onOpenTable(table.path);
				}
			});
			group.addEventListener('mouseenter', () => highlight(table.label));
			group.addEventListener('mouseleave', () => highlight(null));

			tableGroups.set(table.label, group);
			svg.appendChild(group);
		}

		// Einzelne Kante unterm Zeiger ebenfalls hervorheben.
		for (const item of edgeItems) {
			item.group.addEventListener('mouseenter', () => {
				item.group.classList.add('er-hot');
				item.path.setAttribute('marker-end', 'url(#er-arrow-hot)');
			});
			item.group.addEventListener('mouseleave', () => {
				item.group.classList.remove('er-hot');
				item.path.setAttribute('marker-end', 'url(#er-arrow)');
			});
		}

		// --- Legende + scrollbarer Diagramm-Bereich ---
		const wrap = document.createElement('div');
		wrap.className = 'er-wrap';

		const legend = document.createElement('div');
		legend.className = 'er-legend';
		/**
		 * @param {string} icon
		 * @param {string} text
		 * @param {string} iconClass
		 */
		const legendItem = (icon, text, iconClass) => {
			const item = document.createElement('span');
			item.className = 'er-legend-item';
			const i = document.createElement('i');
			i.className = `codicon codicon-${icon} ${iconClass}`;
			item.appendChild(i);
			const label = document.createElement('span');
			label.textContent = text;
			item.appendChild(label);
			return item;
		};
		legend.appendChild(legendItem('key', strings.diagramLegendPk, 'er-legend-pk'));
		legend.appendChild(legendItem('references', strings.diagramLegendFk, 'er-legend-fk'));
		const hint = document.createElement('span');
		hint.className = 'er-legend-hint';
		const hintIcon = document.createElement('i');
		hintIcon.className = 'codicon codicon-go-to-file';
		hint.appendChild(hintIcon);
		const hintText = document.createElement('span');
		hintText.textContent = strings.diagramOpenHint;
		hint.appendChild(hintText);
		legend.appendChild(hint);
		wrap.appendChild(legend);

		const scroll = document.createElement('div');
		scroll.className = 'er-scroll';
		scroll.appendChild(svg);
		wrap.appendChild(scroll);

		return wrap;
	}

	// @ts-ignore — bewusst als globales Modul für project.js (Webviews sind ungebündelt).
	window.DatenschmiedeDiagram = { renderErDiagram };
})();
