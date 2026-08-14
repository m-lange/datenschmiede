import * as vscode from 'vscode';
import { Table, logicalTableName } from './model';
import { parseTableText } from './toml';
import { ParseError } from '../tomlUtil';
import { decodeUtf8 } from '../encoding';
import { GeneratorBase } from '../generator/base';

/**
 * A `.td` file in the workspace, read raw and parsed — the shared basis for
 * everything that scans the workspace for tables: the FK "referenced
 * table"/"referenced column" pickers in the table editor (see
 * TableOption/toTableOptions below), the project table tree (project/tree.ts,
 * grouped by schema) and the FK dependency resolution there (which needs the
 * full columns including `fk`/`fk_table`, not just their names).
 */
export interface TableEntry {
	/** Absolute URI of the file — for opening it (e.g. from the project table tree) or re-reading it. */
	uri: vscode.Uri;
	/** Workspace-relative path (POSIX separators), via `vscode.workspace.asRelativePath`. */
	relativePath: string;
	/** Raw text at the time it was read — lets diagnostics compute line positions without reading/parsing again. */
	text: string;
	/** The parsed table, or `null` if the file is not valid TOML (or could not be read). */
	table: Table | null;
	/** The parse error including its position if the TOML is broken (unset for read errors). */
	error: ParseError | null;
	/** Logical identity (`schema.name`), falling back to `relativePath` when no name is set or on a parse error. */
	label: string;
}

/** A table in the workspace, for the FK "referenced table"/"referenced column" pickers. */
export interface TableOption {
	/** Logical identity (`schema.name`, or the file path as a fallback when no name is set). */
	label: string;
	/** Names of its columns, for the "referenced column" picker. */
	columns: string[];
}

/**
 * Reads a file's contents — preferring an already open, possibly unsaved
 * editor buffer over the copy on disk. Files on disk are decoded as UTF-8 (see
 * src/encoding.ts); for open documents VS Code has decoded them already, which
 * the `files.encoding` default contributed for the project languages pins to
 * UTF-8 as well (see package.json → configurationDefaults).
 */
export async function readFileText(uri: vscode.Uri): Promise<string> {
	const openDocument = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === uri.toString());
	if (openDocument) {
		return openDocument.getText();
	}
	const bytes = await vscode.workspace.fs.readFile(uri);
	return decodeUtf8(bytes);
}

/**
 * Builds the entry for a `.td` file from its raw text — `text: null` stands for
 * an unreadable file (which stays visible in the list rather than silently
 * disappearing). Shared basis for listTables and the workspace index
 * (src/workspaceIndex.ts).
 */
export function buildTableEntry(uri: vscode.Uri, relativePath: string, text: string | null): TableEntry {
	if (text === null) {
		return { uri, relativePath, text: '', table: null, error: null, label: relativePath };
	}
	try {
		const table = parseTableText(text);
		return { uri, relativePath, text, table, error: null, label: tableLabel(table, relativePath) };
	} catch (err) {
		const error = err instanceof ParseError ? err : new ParseError(err instanceof Error ? err.message : String(err));
		return { uri, relativePath, text, table: null, error, label: relativePath };
	}
}

/**
 * Reads and parses every `.td` file in the workspace. For open, unsaved files
 * the current editor contents are read instead of the version on disk (see
 * readFileText). Files with broken TOML still end up in the list (with
 * `table: null`) so they stay visible, e.g. in the project table tree, instead
 * of silently disappearing.
 *
 * For the lists needed continuously (diagnostics, editor webviews) the
 * workspace index (src/workspaceIndex.ts) keeps a shared cache — this function
 * remains for one-off commands (generator run, preview).
 */
export async function listTables(): Promise<TableEntry[]> {
	const uris = await vscode.workspace.findFiles('**/*.td', '**/node_modules/**');
	return Promise.all(
		uris.map(async (uri): Promise<TableEntry> => {
			const relativePath = vscode.workspace.asRelativePath(uri, false);
			const text = await readFileText(uri).catch(() => null);
			return buildTableEntry(uri, relativePath, text);
		}),
	);
}

/**
 * Condenses table entries into the `TableOption`s of the table editor's FK
 * pickers: one row per logical identity (duplicates — two files with the same
 * `schema.name` — collapse to the first match), sorted by label.
 */
export function toTableOptions(entries: TableEntry[]): TableOption[] {
	const byLabel = new Map<string, TableOption>();
	for (const entry of entries) {
		if (byLabel.has(entry.label)) {
			continue;
		}
		const columns = entry.table
			? entry.table.columns.map((column) => column.name.trim()).filter((name) => name.length > 0)
			: [];
		byLabel.set(entry.label, { label: entry.label, columns });
	}
	return Array.from(byLabel.values()).sort((a, b) => a.label.localeCompare(b.label));
}

/** Logical table identity (see `logicalTableName`); falls back to `fallbackPath` while no name is set. */
export function tableLabel(table: Table, fallbackPath: string): string {
	return logicalTableName(table) || fallbackPath;
}

/**
 * The table labels referenced by a table (self-references excluded): taken from
 * FK columns and from the `table` references of the configured generators.
 * Shared building block of buildTableRefEdges and buildRequiredEdges.
 */
function collectRefLabels(table: Table, ownLabel: string, generatorsById: Map<string, GeneratorBase>): Set<string> {
	const ownColumns = table.columns.map((c) => c.name.trim()).filter((c) => c.length > 0);
	const targets = new Set<string>();
	for (const column of table.columns) {
		if (column.fk) {
			const fkTable = column.fkTable.trim();
			if (fkTable && fkTable !== ownLabel) {
				targets.add(fkTable);
			}
		}
		if (column.generator?.id.trim()) {
			const generator = generatorsById.get(column.generator.id);
			if (generator) {
				const refs = generator.requiredRefs(column.generator, {
					ownColumnName: column.name.trim(),
					ownColumns,
					fkTable: column.fkTable,
					fkColumn: column.fkColumn,
					tables: [],
					lookups: [],
				});
				for (const label of refs.tables) {
					const trimmed = label.trim();
					if (trimmed && trimmed !== ownLabel) {
						targets.add(trimmed);
					}
				}
			}
		}
	}
	return targets;
}

/** Generators keyed by their `id`, so reference resolution avoids a linear search per column. */
export function generatorsById(generators: GeneratorBase[]): Map<string, GeneratorBase> {
	return new Map(generators.map((generator) => [generator.id, generator] as const));
}

/**
 * Reference edges between the workspace's tables (logical identity →
 * referenced identities), derived from FK columns and the `table` references of
 * the configured generators. Self-references are skipped (FK validation already
 * reports those). Basis of the cycle detection (findTableCycle in
 * table/validation.ts).
 */
export function buildTableRefEdges(entries: TableEntry[], generators: GeneratorBase[]): Map<string, string[]> {
	const byId = generatorsById(generators);
	const edges = new Map<string, string[]>();
	for (const entry of entries) {
		if (!entry.table) {
			continue;
		}
		const ownLabel = tableLabel(entry.table, entry.relativePath);
		const targets = collectRefLabels(entry.table, ownLabel, byId);
		if (targets.size > 0 && !edges.has(ownLabel)) {
			edges.set(ownLabel, [...targets]);
		}
	}
	return edges;
}

/**
 * Reference edges at the *path* level (workspace-relative path → required
 * paths): the same derivation as buildTableRefEdges, except the referenced
 * labels are already resolved to the (first) file carrying that logical
 * identity. Once built, every closure computation (closureOf) is pure graph
 * traversal — which matters for the project editor's tables tab, where the
 * locked state of each selected table is determined via its own closure (see
 * buildPickerTree in project/editorProvider.ts).
 */
export function buildRequiredEdges(entries: TableEntry[], generators: GeneratorBase[]): Map<string, string[]> {
	const byId = generatorsById(generators);
	const byLabel = new Map<string, TableEntry>();
	for (const entry of entries) {
		if (entry.table && !byLabel.has(entry.label)) {
			byLabel.set(entry.label, entry);
		}
	}

	const edges = new Map<string, string[]>();
	for (const entry of entries) {
		if (!entry.table) {
			continue;
		}
		const ownLabel = tableLabel(entry.table, entry.relativePath);
		const targets: string[] = [];
		for (const label of collectRefLabels(entry.table, ownLabel, byId)) {
			const target = byLabel.get(label);
			if (target) {
				targets.push(target.relativePath);
			}
		}
		if (targets.length > 0) {
			edges.set(entry.relativePath, targets);
		}
	}
	return edges;
}

/**
 * Transitive closure over precomputed path edges (buildRequiredEdges): every
 * path referenced (recursively) from `selected` — including members of
 * `selected` that are referenced by others.
 */
export function closureOf(selected: ReadonlySet<string>, edges: Map<string, string[]>): Set<string> {
	const required = new Set<string>();
	const visited = new Set<string>(selected);
	const queue = [...selected];
	while (queue.length > 0) {
		const path = queue.shift();
		const targets = path ? edges.get(path) : undefined;
		if (!targets) {
			continue;
		}
		for (const target of targets) {
			required.add(target);
			if (!visited.has(target)) {
				visited.add(target);
				queue.push(target);
			}
		}
	}
	return required;
}

/**
 * Resolves the transitive closure of referenced tables: starting from
 * `selected` (workspace-relative paths), every valid `fk_table` reference of
 * every table is resolved and followed recursively — plus every table required
 * by a configured column generator (parameters of type `table`, see
 * GeneratorBase.requiredRefs). Empty and self-references (see validation.ts) are
 * skipped, as are references to tables that no longer exist.
 *
 * Basis for the project table tree: tables in the returned set must stay
 * selected so that every selected foreign key column and every generator has a
 * valid target.
 *
 * Convenience wrapper around buildRequiredEdges + closureOf — code that needs
 * several closures over the same entries should build the edges once itself.
 *
 * @param generators All available generators (built-in plus custom) used to resolve
 * generator references; when omitted only FK references count.
 * @returns The paths of the (recursively) required tables — it does not include
 * `selected` itself, even if a table references itself indirectly (which the
 * self-reference check rules out anyway).
 */
export function computeRequiredClosure(
	selected: ReadonlySet<string>,
	entries: TableEntry[],
	generators: GeneratorBase[] = [],
): Set<string> {
	return closureOf(selected, buildRequiredEdges(entries, generators));
}
