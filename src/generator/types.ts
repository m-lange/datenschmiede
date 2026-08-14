/**
 * Core types of the generator system: every column of a table can be assigned a
 * generator that produces its values during a generator run. There are built-in
 * generators (src/generator/builtins/, one per file) and custom generators as
 * `.tdgen` files in the workspace (see generator/model.ts,
 * generator/custom.ts).
 *
 * Deliberately free of any vscode dependency (easy to test) — like
 * table/model.ts, everything here is used both by the extension host and by the
 * vscode-free checks.
 */

import { COLUMN_TYPES } from '../table/model';

/**
 * Data types of a generator parameter: the same as for columns in the table
 * editor, extended by lookup list (`lookup`), referenced table (`table`),
 * referenced column (`column`) and a column of the *own* table (`own_column`).
 * A `column` parameter draws its choices from the nearest preceding `table` or
 * `lookup` parameter (mirroring the fk_table/fk_column pair of table columns);
 * an `own_column` parameter offers the columns of the table the generated
 * column belongs to — `ctx.column(...)` then yields their values for **the same
 * records**, and the referenced column is guaranteed to be generated *before*
 * this one.
 */
export const PARAMETER_TYPES = [...COLUMN_TYPES, 'lookup', 'table', 'column', 'own_column'] as const;

export type ParameterType = (typeof PARAMETER_TYPES)[number];

/** One parameter of a generator (name, data type, description — its value is set per column in the table editor). */
export interface GeneratorParameter {
	name: string;
	type: string;
	description: string;
	/**
	 * Predefined list of values: when set (non-empty) the table editor offers a
	 * picker instead of free input — so every parameter accepts either free
	 * input or values from this list.
	 */
	choices?: string[];
	/** Mandatory parameter: if the value is missing, validation reports a warning. */
	required?: boolean;
	/** Placeholder/example text for the input field in the table editor. */
	placeholder?: string;
}

/**
 * The generator configuration stored per column: which generator (`id`, prefixed
 * with `custom:` for custom ones) with which parameter values. All values
 * deliberately stay strings (as `records` does in project/model.ts) so that
 * invalid input is preserved and can be reported by validation instead of being
 * silently dropped.
 */
export interface GeneratorConfig {
	id: string;
	params: Record<string, string>;
}

/** Prefix of the `id` of custom generators (`custom:<name>`, see generator/custom.ts). */
export const CUSTOM_GENERATOR_PREFIX = 'custom:';

/** A table of the workspace, used to cross-check references (counterpart to KnownTable in table/validation.ts). */
export interface KnownTableRef {
	/** Logical identity (`schema.name`), as stored in parameters of type `table`. */
	label: string;
	columns: string[];
}

/** A lookup list (.lkp) of the workspace, used to cross-check references. */
export interface KnownLookupRef {
	/** Name of the list (from its `# name:` metadata line). */
	name: string;
	columns: string[];
}

/**
 * The environment a generator configuration is validated in: the own
 * column/table plus everything referenceable in the workspace.
 */
export interface GeneratorContext {
	/** Name of the column the configuration belongs to. */
	ownColumnName: string;
	/** Names of all columns of the own table (e.g. for the combine generator). */
	ownColumns: string[];
	/** The column's `fk_table` (only relevant for the foreign key generator). */
	fkTable: string;
	/** The column's `fk_column` (only relevant for the foreign key generator). */
	fkColumn: string;
	tables: KnownTableRef[];
	lookups: KnownLookupRef[];
}

/** Kinds of validation result for a generator configuration — the caller (table/editorProvider.ts) translates them via vscode.l10n. */
export type GeneratorIssueKind =
	| 'gen-param-missing'
	| 'gen-param-invalid'
	| 'gen-table-not-found'
	| 'gen-column-not-found'
	| 'gen-lookup-not-found'
	| 'gen-lookup-column-not-found'
	| 'gen-own-column-not-found';

/** A warning about a column's current generator configuration (surfaces in VS Code's Problems view). */
export interface GeneratorIssue {
	kind: GeneratorIssueKind;
	/** Name of the affected parameter. */
	paramName: string;
	/** Extra detail for the message, e.g. the value that could not be found. */
	detail?: string;
}

/**
 * References required by a generator configuration — the basis for the
 * generation order (column by column) and for automatic table inclusion in the
 * project editor (see computeRequiredClosure in table/repository.ts).
 */
export interface RequiredRefs {
	/** Logical identities (`schema.name`) of required tables. */
	tables: string[];
	/** Required columns of foreign tables (`{ table, column }`). */
	columns: { table: string; column: string }[];
	/** Required columns of the own table (e.g. the combine generator's placeholders). */
	ownColumns: string[];
	/** Names of required lookup lists (.lkp). */
	lookups: string[];
}

/** An empty {@link RequiredRefs} set — the default for generators without references. */
export function emptyRequiredRefs(): RequiredRefs {
	return { tables: [], columns: [], ownColumns: [], lookups: [] };
}

/**
 * Display text of a generator configuration built from a template with
 * `{param}` placeholders (e.g. `"{min} … {max}"`). Empty parameters render as
 * `?`. Used by GeneratorBase.displayString and duplicated as a small, standalone
 * counterpart in media/table.js (webviews work without module bundling).
 */
export function fillDisplayTemplate(template: string, params: Record<string, string>): string {
	return template.replace(/\{([^}]+)\}/g, (_m, name: string) => {
		const value = (params[name] ?? '').trim();
		return value === '' ? '?' : value;
	});
}
