/**
 * Data model of the ER diagram tab in the project editor: the project's tables
 * with their columns, the FK relationships between them and the (estimated)
 * record counts. The diagram itself is drawn read-only in the webview (see
 * media/diagram.js — automatic layout and SVG); the model is built here in the
 * extension host from the existing pieces: the project model, the parsed `.td`
 * entries and the rows of the output files overview (whose estimated min/max
 * counts along the FK chain are reused here instead of being recomputed).
 * Deliberately free of any vscode dependency — the inputs are described
 * structurally so that e.g. TableEntry (vscode.Uri) fits without being
 * imported.
 */

import { Project } from './model';
import { Table, logicalTableName } from '../table/model';

/**
 * A column inside a diagram box — only the fields needed for drawing. Only key
 * columns are shown: every PK and every FK column plus target columns
 * referenced by an edge — not every column of the table (see
 * buildProjectDiagram).
 */
export interface DiagramColumn {
	name: string;
	type: string;
	pk: boolean;
	fk: boolean;
	/** Hidden column (generated but not written) — rendered dimmed in the diagram. */
	hidden: boolean;
}

/** One table box of the diagram — a selected, readable table of the project. */
export interface DiagramTable {
	/** Workspace-relative path of the `.td` file — powers "click opens the definition". */
	path: string;
	/** Logical identity (`schema.name`), the anchor for edges. */
	label: string;
	schema: string;
	name: string;
	columns: DiagramColumn[];
	/** Configured record count ("100", or "5"/"1..3" per referenced record). */
	records?: string;
	/** Estimated count along the FK chain (see buildOutputFiles in project/editorProvider.ts). */
	estimatedMin?: number;
	estimatedMax?: number;
	/** `true` for a referenced (secondary) table — `records` then applies per record of `referencedTable`. */
	secondary: boolean;
	referencedTable?: string;
	/**
	 * Real record count from the last generator run (see project/runResults.ts)
	 * — with cardinality ranges the actual count is only known after the run.
	 * Absent when the project has never run or the table took no part in it; the
	 * diagram then shows the estimated min/max count.
	 */
	lastRunRecords?: number;
}

/** An FK edge: from the referencing column (child) to the referenced table/column (parent). */
export interface DiagramEdge {
	/** Logical identity of the referencing (child) table. */
	fromTable: string;
	fromColumn: string;
	/** Logical identity of the referenced (parent) table. */
	toTable: string;
	/** Referenced column — empty if none is configured (the edge then ends at the table header). */
	toColumn: string;
	/**
	 * Cardinality of the *driving* FK column (the first outgoing one, see
	 * project/run.ts): the child table's `records` value ("5" or "1..3"), used
	 * as the edge label. Further FK columns merely draw random values and stay
	 * unlabeled.
	 */
	cardinality?: string;
}

/** The complete diagram model handed to the webview. */
export interface ProjectDiagram {
	tables: DiagramTable[];
	edges: DiagramEdge[];
	/** Time of the last generator run (epoch milliseconds), if any `lastRunRecords` are set. */
	lastRunAt?: number;
}

/** Structural subset of a RunResult (see project/runResults.ts) — without its vscode dependency. */
interface DiagramRunResult {
	finishedAt: number;
	counts: Record<string, number>;
}

/** Structural subset of a TableEntry (see table/repository.ts) — without its vscode dependency. */
interface DiagramSourceEntry {
	relativePath: string;
	table: Table | null;
}

/** Structural subset of an OutputFileRow (see project/editorProvider.ts) carrying the record info. */
interface DiagramRecordsRow {
	path: string;
	records?: string;
	estimatedMin?: number;
	estimatedMax?: number;
	secondary: boolean;
	referencedTable?: string;
}

/**
 * Builds the ER diagram model: only the project's selected tables (unreadable
 * files are dropped — without columns there is nothing to draw; the tables tab
 * shows the corresponding warning), plus every FK edge whose both ends are in
 * the diagram. Self-references are skipped as everywhere else (FK validation
 * already reports those).
 *
 * Each box shows only the key columns — every PK and every FK column plus every
 * target column referenced by an edge — instead of all columns of the table:
 * this keeps the boxes compact while every edge remains anchored to the exact
 * column. Tables without any key render as a bare header box.
 */
export function buildProjectDiagram(
	project: Project,
	entries: DiagramSourceEntry[],
	recordRows: DiagramRecordsRow[],
	lastRun: DiagramRunResult | null = null,
): ProjectDiagram {
	const byPath = new Map(entries.map((entry) => [entry.relativePath, entry] as const));
	const rowByPath = new Map(recordRows.map((row) => [row.path, row] as const));

	/** Selected, readable tables together with their parsed definition — the basis for boxes and edges. */
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
		// The driving FK column (the first outgoing one) carries the cardinality
		// — the same rule the generator run uses (see project/run.ts).
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

	// Per table, the set of columns involved in an edge — only those appear as
	// rows inside the box.
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

	// The timestamp only belongs in the diagram if it actually explains
	// something there (at least one box shows a real count from that run).
	if (lastRun && tables.some((table) => table.lastRunRecords !== undefined)) {
		return { tables, edges, lastRunAt: lastRun.finishedAt };
	}
	return { tables, edges };
}
