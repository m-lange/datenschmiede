import { StructureNode, Table, logicalTableName, walkStructure } from './model';
import { GeneratorBase } from '../generator/base';
import { GeneratorContext, GeneratorIssueKind, KnownLookupRef } from '../generator/types';

/**
 * Semantic checks for a table definition, independent of whether the TOML is
 * syntactically valid (table/toml.ts/parseTableText already covers that).
 *
 * Deliberately free of any vscode dependency (easy to test); the caller
 * (table/editorProvider.ts) translates the messages for the Problems view via
 * vscode.l10n, while the webview surfaces the same rules inline on the field
 * (see media/table.js).
 *
 * Besides the FK checks (errors), the generator checks (warnings) run here:
 * every generator validates its own configuration (GeneratorBase.validate) —
 * including references to tables, columns, lookup lists and generators that
 * were renamed or deleted after being configured.
 */
export type IssueKind =
	| 'fk-missing-table'
	| 'fk-table-not-found'
	| 'fk-self-reference'
	| 'fk-missing-column'
	| 'fk-column-not-found'
	| 'gen-missing'
	| 'gen-not-found'
	| 'gen-fk-only'
	| 'gen-fk-mismatch'
	| OutputIssueKind
	| GeneratorIssueKind;

/**
 * Problems of the JSON/XML target structure — they belong to the `[output]`
 * block rather than to a single column, and are marked with
 * `columnIndex === OUTPUT_ISSUE_INDEX`.
 */
export type OutputIssueKind = 'output-node-unnamed' | 'output-mapping-missing' | 'output-mapping-column-not-found';

/** `Issue.columnIndex` of a problem that concerns the output configuration, not a column. */
export const OUTPUT_ISSUE_INDEX = -1;

/** A single problem found on one column of a table definition (or on its output configuration). */
export interface Issue {
	/** Index of the affected column, or {@link OUTPUT_ISSUE_INDEX} for output problems. */
	columnIndex: number;
	columnName: string;
	kind: IssueKind;
	/** Extra detail for the message, e.g. the (unresolved) `fk_table`/`fk_column` value. */
	detail?: string;
	/** Name of the affected generator parameter (generator checks only). */
	paramName?: string;
	/** Dotted path of the affected structure node (output checks only). */
	nodePath?: string;
	/** `true` for generator checks — they appear as a warning rather than an error in the Problems view. */
	warning?: boolean;
}

/** A table of the workspace, used to cross-check FK references (see TableOption in table/repository.ts). */
export interface KnownTable {
	/** Logical identity (`schema.name`, or just `name`), as stored in `fk_table`. */
	label: string;
	columns: string[];
}

/**
 * Searches for a cycle that starts at `start` and leads back to `start` along
 * the directed edges. Returns the path including start and end node
 * (`[start, …, start]`), or `null`. Nodes already searched without success are
 * remembered so the search stays linear.
 */
function findCycleFrom(start: string, edges: Map<string, string[]>): string[] | null {
	const dead = new Set<string>();

	function dfs(node: string, path: string[]): string[] | null {
		for (const target of edges.get(node) ?? []) {
			if (target === start) {
				return [...path, node, start];
			}
			if (dead.has(target) || path.includes(target) || target === node) {
				continue;
			}
			const found = dfs(target, [...path, node]);
			if (found) {
				return found;
			}
		}
		dead.add(node);
		return null;
	}

	return dfs(start, []);
}

/**
 * Cycle between tables via their FK/generator references (for the edges see
 * buildTableRefEdges in table/repository.ts): if the own table is part of a
 * cycle (A → B → A), no generation order can be resolved — the caller reports
 * this as a warning in the Problems view.
 */
export function findTableCycle(ownLabel: string, edges: Map<string, string[]>): string[] | null {
	if (!ownLabel) {
		return null;
	}
	return findCycleFrom(ownLabel, edges);
}

/**
 * Cycle between the columns of *one* table via their generator dependencies
 * (e.g. two combine templates referencing each other) — here, too, no
 * generation order can be resolved.
 */
export function findColumnCycle(table: Table, generators: GeneratorBase[]): string[] | null {
	const ownColumns = table.columns.map((c) => c.name.trim()).filter((c) => c.length > 0);
	const edges = new Map<string, string[]>();
	for (const column of table.columns) {
		const name = column.name.trim();
		if (!name || !column.generator?.id.trim()) {
			continue;
		}
		const generator = generators.find((g) => g.id === column.generator?.id);
		if (!generator) {
			continue;
		}
		const refs = generator.requiredRefs(column.generator, {
			ownColumnName: name,
			ownColumns,
			fkTable: column.fkTable,
			fkColumn: column.fkColumn,
			tables: [],
			lookups: [],
		});
		if (refs.ownColumns.length > 0) {
			edges.set(name, refs.ownColumns);
		}
	}
	for (const name of edges.keys()) {
		const cycle = findCycleFrom(name, edges);
		if (cycle) {
			return cycle;
		}
	}
	return null;
}

/**
 * Runs all content checks for one table definition.
 *
 * @param knownTables All `.td` tables currently found in the workspace. Used to detect
 * stale FK references, e.g. when the referenced file has since been deleted or the
 * column there was renamed or removed.
 * @param generators All available generators (built-in plus custom ones from `.tdgen`
 * files), used to cross-check generator configurations.
 * @param lookups All `.lkp` lookup lists of the workspace (for the lookup generator).
 */
export function validateTable(
	table: Table,
	knownTables: KnownTable[] = [],
	generators: GeneratorBase[] = [],
	lookups: KnownLookupRef[] = [],
): Issue[] {
	const issues: Issue[] = [];
	// This table's own logical identity, used to detect a self-reference (empty
	// while the table has no name yet -> fk_table cannot equal it either, so the
	// comparison below only kicks in once a name exists).
	const ownLabel = logicalTableName(table);
	const ownColumns = table.columns.map((c) => c.name.trim()).filter((c) => c.length > 0);

	table.columns.forEach((column, columnIndex) => {
		if (column.fk) {
			const fkTable = column.fkTable.trim();
			const referencedTable = fkTable ? knownTables.find((t) => t.label === fkTable) : undefined;
			if (!fkTable) {
				issues.push({ columnIndex, columnName: column.name, kind: 'fk-missing-table' });
			} else if (ownLabel && fkTable === ownLabel) {
				issues.push({ columnIndex, columnName: column.name, kind: 'fk-self-reference' });
			} else if (!referencedTable) {
				issues.push({ columnIndex, columnName: column.name, kind: 'fk-table-not-found', detail: fkTable });
			}

			const fkColumn = column.fkColumn.trim();
			if (!fkColumn) {
				issues.push({ columnIndex, columnName: column.name, kind: 'fk-missing-column' });
			} else if (referencedTable && !referencedTable.columns.includes(fkColumn)) {
				// Only checked when the referenced table itself was found — otherwise this
				// would merely follow from fk-table-not-found and duplicate the message.
				issues.push({ columnIndex, columnName: column.name, kind: 'fk-column-not-found', detail: fkColumn });
			}
		}

		if (!column.generator || !column.generator.id.trim()) {
			// Every column is expected to have a generator selected and
			// configured. FK columns are exempt — they implicitly always use
			// the foreign key generator.
			if (!column.fk) {
				issues.push({ columnIndex, columnName: column.name, kind: 'gen-missing', warning: true });
			}
			return;
		}

		const generator = generators.find((g) => g.id === column.generator?.id);
		if (!generator) {
			// The configured (usually custom) generator no longer exists — its
			// file was deleted or its name changed.
			issues.push({
				columnIndex,
				columnName: column.name,
				kind: 'gen-not-found',
				detail: column.generator.id,
				warning: true,
			});
			return;
		}

		if (generator.id === 'foreign-key' && !column.fk) {
			issues.push({ columnIndex, columnName: column.name, kind: 'gen-fk-only', warning: true });
			return;
		}

		if (column.fk && generator.id !== 'foreign-key') {
			// No longer reachable through the UI (the generator picker is locked
			// for FK columns) — this can only come from hand-edited TOML.
			issues.push({ columnIndex, columnName: column.name, kind: 'gen-fk-mismatch', warning: true });
			return;
		}

		const ctx: GeneratorContext = {
			ownColumnName: column.name.trim(),
			ownColumns,
			fkTable: column.fkTable,
			fkColumn: column.fkColumn,
			tables: knownTables,
			lookups,
		};
		for (const issue of generator.validate(column.generator, ctx)) {
			issues.push({
				columnIndex,
				columnName: column.name,
				kind: issue.kind,
				detail: issue.detail,
				paramName: issue.paramName,
				warning: true,
			});
		}
	});

	issues.push(...validateOutputStructure(table));

	return issues;
}

/**
 * Checks the JSON/XML target structure of a table (schema + mapping tabs): every
 * node needs a name, and every leaf mapped to a column needs one that actually
 * exists — a column renamed or removed after the mapping was set up would
 * otherwise silently write empty values.
 *
 * Only runs for the file type actually selected; a structure left over from a
 * different file type is not written and therefore not reported.
 */
export function validateOutputStructure(table: Table): Issue[] {
	const format = (table.output.format || 'csv').trim().toLowerCase();
	let nodes: StructureNode[];
	if (format === 'json') {
		nodes = table.output.json.nodes;
	} else if (format === 'xml') {
		nodes = table.output.xml.nodes;
	} else {
		return [];
	}

	const ownColumns = new Set(table.columns.map((c) => c.name.trim()).filter((c) => c.length > 0));
	const issues: Issue[] = [];
	walkStructure(nodes, (node, path) => {
		const nodePath = path.join('.');
		const base = { columnIndex: OUTPUT_ISSUE_INDEX, columnName: '', nodePath, warning: true } as const;
		if (!node.name.trim()) {
			issues.push({ ...base, kind: 'output-node-unnamed' });
		}
		if (node.kind !== 'value' && node.kind !== 'attribute') {
			return;
		}
		if (node.sourceKind !== 'column') {
			return;
		}
		const source = node.source.trim();
		if (!source) {
			issues.push({ ...base, kind: 'output-mapping-missing' });
		} else if (!ownColumns.has(source)) {
			issues.push({ ...base, kind: 'output-mapping-column-not-found', detail: source });
		}
	});
	return issues;
}
