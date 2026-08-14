/**
 * Datenmodell des ER-Diagramm-Tabs im Projekt-Editor: die zum Projekt
 * gehörenden Tabellen mit ihren Spalten, die FK-Beziehungen zwischen ihnen
 * und die (berechneten) Datensatzanzahlen. Gezeichnet wird das Diagramm rein
 * lesend in der Webview (siehe media/diagram.js — automatisches Layout und
 * SVG); gebaut wird das Modell hier im Extension-Host aus den vorhandenen
 * Bausteinen: dem Projekt-Modell, den geparsten `.td`-Einträgen und den
 * Zeilen der Ausgabedateien-Übersicht (deren berechnete Von/Bis-Anzahl
 * entlang der FK-Kette hier wiederverwendet wird, statt sie erneut zu
 * berechnen). Bewusst frei von jeder vscode-Abhängigkeit — die Eingaben sind
 * strukturell beschrieben, damit z. B. TableEntry (vscode.Uri) passt, ohne
 * importiert zu werden.
 */

import { Project } from './model';
import { Table, logicalTableName } from '../table/model';

/**
 * Eine Spalte im Diagramm-Kasten — nur die fürs Zeichnen nötigen Felder.
 * Gezeigt werden ausschließlich Schlüssel-Spalten: jede PK- und jede
 * FK-Spalte sowie von einer Kante referenzierte Ziel-Spalten — nicht alle
 * Spalten der Tabelle (siehe buildProjectDiagram).
 */
export interface DiagramColumn {
	name: string;
	type: string;
	pk: boolean;
	fk: boolean;
	/** Ausgeblendete Spalte (wird generiert, aber nicht geschrieben) — im Diagramm gedimmt dargestellt. */
	hidden: boolean;
}

/** Ein Tabellen-Kasten des Diagramms — eine ausgewählte, lesbare Tabelle des Projekts. */
export interface DiagramTable {
	/** Workspace-relativer Pfad der `.td`-Datei — für „Klick öffnet die Definition“. */
	path: string;
	/** Logische Identität (`schema.name`), Anker der Kanten. */
	label: string;
	schema: string;
	name: string;
	columns: DiagramColumn[];
	/** Konfigurierte Datensatzanzahl ("100" bzw. "5"/"1..3" je referenziertem Datensatz). */
	records?: string;
	/** Berechnete Anzahl entlang der FK-Kette (siehe buildOutputFiles in project/editorProvider.ts). */
	estimatedMin?: number;
	estimatedMax?: number;
	/** `true` bei einer referenzierten (sekundären) Tabelle — `records` gilt je Datensatz von `referencedTable`. */
	secondary: boolean;
	referencedTable?: string;
	/**
	 * Echte Datensatzanzahl aus dem letzten Generator-Lauf (siehe
	 * project/runResults.ts) — bei Kardinalitäts-Bereichen steht die
	 * tatsächliche Anzahl erst nach dem Lauf fest. Fehlt ohne bisherigen Lauf
	 * oder wenn die Tabelle daran nicht beteiligt war; dann zeigt das Diagramm
	 * die berechnete Von/Bis-Anzahl.
	 */
	lastRunRecords?: number;
}

/** Eine FK-Kante: von der referenzierenden Spalte (Kind) zur referenzierten Tabelle/Spalte (Eltern). */
export interface DiagramEdge {
	/** Logische Identität der referenzierenden (Kind-)Tabelle. */
	fromTable: string;
	fromColumn: string;
	/** Logische Identität der referenzierten (Eltern-)Tabelle. */
	toTable: string;
	/** Referenzierte Spalte — leer, wenn keine konfiguriert ist (die Kante endet dann am Tabellenkopf). */
	toColumn: string;
	/**
	 * Kardinalität der *treibenden* FK-Spalte (die erste ausgehende, siehe
	 * project/run.ts): der `records`-Wert der Kind-Tabelle ("5" oder "1..3"),
	 * als Beschriftung an der Kante. Weitere FK-Spalten ziehen nur zufällige
	 * Werte und bleiben unbeschriftet.
	 */
	cardinality?: string;
}

export interface ProjectDiagram {
	tables: DiagramTable[];
	edges: DiagramEdge[];
	/** Zeitpunkt des letzten Generator-Laufs (Epoch-Millisekunden), falls `lastRunRecords` gesetzt sind. */
	lastRunAt?: number;
}

/** Struktureller Ausschnitt eines RunResult (siehe project/runResults.ts) — ohne dessen vscode-Abhängigkeit. */
interface DiagramRunResult {
	finishedAt: number;
	counts: Record<string, number>;
}

/** Struktureller Ausschnitt eines TableEntry (siehe table/repository.ts) — ohne dessen vscode-Abhängigkeit. */
interface DiagramSourceEntry {
	relativePath: string;
	table: Table | null;
}

/** Struktureller Ausschnitt einer OutputFileRow (siehe project/editorProvider.ts) mit den Datensatz-Infos. */
interface DiagramRecordsRow {
	path: string;
	records?: string;
	estimatedMin?: number;
	estimatedMax?: number;
	secondary: boolean;
	referencedTable?: string;
}

/**
 * Baut das ER-Diagramm-Modell: ausschließlich die ausgewählten Tabellen des
 * Projekts (nicht lesbare Dateien entfallen — ohne Spalten gibt es nichts zu
 * zeichnen; der Tabellen-Tab zeigt die Warnung dazu), dazu alle FK-Kanten,
 * deren beide Enden im Diagramm liegen. Selbst-Referenzen werden wie überall
 * übersprungen (die meldet bereits die FK-Validierung).
 *
 * Je Kasten erscheinen nur die Schlüssel-Spalten — jede PK- und jede
 * FK-Spalte sowie jede von einer Kante referenzierte Ziel-Spalte — statt
 * aller Spalten der Tabelle: das hält die Kästen kompakt, und jede Kante
 * bleibt trotzdem spaltengenau verankert. Tabellen ganz ohne Schlüssel
 * erscheinen als reiner Kopf-Kasten.
 */
export function buildProjectDiagram(
	project: Project,
	entries: DiagramSourceEntry[],
	recordRows: DiagramRecordsRow[],
	lastRun: DiagramRunResult | null = null,
): ProjectDiagram {
	const byPath = new Map(entries.map((entry) => [entry.relativePath, entry] as const));
	const rowByPath = new Map(recordRows.map((row) => [row.path, row] as const));

	/** Ausgewählte, lesbare Tabellen samt geparster Definition — Grundlage für Kästen und Kanten. */
	const selected: { path: string; label: string; table: Table; row: DiagramRecordsRow | undefined }[] = [];
	for (const projectTable of project.tables) {
		const entry = byPath.get(projectTable.path);
		if (!entry?.table) {
			continue;
		}
		selected.push({
			path: projectTable.path,
			label: logicalTableName(entry.table) || entry.relativePath,
			table: entry.table,
			row: rowByPath.get(projectTable.path),
		});
	}

	const labels = new Set(selected.map((item) => item.label));
	const edges: DiagramEdge[] = [];
	const seen = new Set<string>();
	for (const item of selected) {
		// Die treibende FK-Spalte (erste ausgehende) trägt die Kardinalität —
		// dieselbe Regel wie der Generator-Lauf (siehe project/run.ts).
		let driving = true;
		for (const column of item.table.columns) {
			if (!column.fk) {
				continue;
			}
			const target = column.fkTable.trim();
			if (!target || target === item.label) {
				continue;
			}
			const isDriving = driving;
			driving = false;
			if (!labels.has(target) || column.name.trim().length === 0) {
				continue;
			}
			const edge: DiagramEdge = {
				fromTable: item.label,
				fromColumn: column.name.trim(),
				toTable: target,
				toColumn: column.fkColumn.trim(),
			};
			if (isDriving && item.row?.secondary && item.row.records) {
				edge.cardinality = item.row.records;
			}
			const key = `${edge.fromTable}|${edge.fromColumn}|${edge.toTable}|${edge.toColumn}`;
			if (!seen.has(key)) {
				seen.add(key);
				edges.push(edge);
			}
		}
	}

	// Je Tabelle die Menge der an einer Kante beteiligten Spalten — nur diese
	// erscheinen als Zeilen im Kasten.
	const usedColumns = new Map<string, Set<string>>();
	const markUsed = (label: string, column: string) => {
		if (!column) {
			return;
		}
		let set = usedColumns.get(label);
		if (!set) {
			set = new Set();
			usedColumns.set(label, set);
		}
		set.add(column);
	};
	for (const edge of edges) {
		markUsed(edge.fromTable, edge.fromColumn);
		markUsed(edge.toTable, edge.toColumn);
	}

	const tables: DiagramTable[] = selected.map((item) => {
		const used = usedColumns.get(item.label);
		const lastRunRecords = lastRun?.counts[item.label];
		return {
			path: item.path,
			label: item.label,
			schema: item.table.schema.trim(),
			name: item.table.name.trim() || item.path,
			columns: item.table.columns
				.filter((column) => {
					const name = column.name.trim();
					return name.length > 0 && (column.pk || column.fk || (used?.has(name) ?? false));
				})
				.map((column) => ({
					name: column.name.trim(),
					type: column.type.trim(),
					pk: column.pk,
					fk: column.fk,
					hidden: column.hidden,
				})),
			records: item.row?.records,
			estimatedMin: item.row?.estimatedMin,
			estimatedMax: item.row?.estimatedMax,
			secondary: item.row?.secondary ?? false,
			referencedTable: item.row?.referencedTable,
			...(lastRunRecords !== undefined ? { lastRunRecords } : {}),
		};
	});

	// Der Zeitstempel gehört nur ins Diagramm, wenn er dort auch etwas erklärt
	// (mindestens ein Kasten zeigt eine echte Anzahl aus diesem Lauf).
	if (lastRun && tables.some((table) => table.lastRunRecords !== undefined)) {
		return { tables, edges, lastRunAt: lastRun.finishedAt };
	}
	return { tables, edges };
}
