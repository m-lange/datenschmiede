/**
 * Data model of a .tdgen file (a custom generator).
 *
 * As in table/model.ts this model is the "truth" the generator editor webview
 * works with; the extension host builds it from the TOML text (see
 * generator/toml.ts) and serializes it back to TOML after every change.
 *
 * The actual generation code lives in `code` as Python method bodies: the
 * signatures are fixed (see the *_SIGNATURE constants) and are shown in the
 * editor as a read-only header above the editable body — like the fixed cells
 * of a Jupyter notebook.
 */

import { GeneratorParameter } from './types';

/** A custom generator as stored in a .tdgen file. */
export interface GeneratorFile {
	name: string;
	description: string;
	parameters: GeneratorParameter[];
	code: GeneratorCode;
}

/** The Python method bodies of the code cells (body only, without the fixed signature). */
export interface GeneratorCode {
	/**
	 * Body of the `parameters()` cell: returns the parameter definitions as a
	 * literal list of dicts (see PARAMETERS_SIGNATURE). The code is stored
	 * verbatim; when the notebook is saved the serializer derives the
	 * declarative `[[parameters]]` blocks from it, which the table editor,
	 * validation and plan work with (see generator/pyliteral.ts). Empty -> the
	 * cell is generated from the `[[parameters]]` blocks.
	 */
	parameters: string;
	/** Required: produces the column's values (see GENERATE_SIGNATURE). */
	generate: string;
	/** Optional: converts the string parameter values into typed values before generate runs. */
	parseParams: string;
	/** Optional: compact display text of a configuration for the run log and the preview. */
	displayValue: string;
	/**
	 * Optional: custom validation of the parameter values — returns a list of
	 * warning texts (empty = everything fine). The workspace background
	 * validation executes it for every column using this generator, and the
	 * results appear on that column in the Problems view (see
	 * src/diagnostics.ts).
	 */
	validate: string;
	/**
	 * Free-form notebook cell for test values and experiments (e.g.
	 * `params = {...}` and `n = 10` to execute the method cells) — it is saved
	 * but ignored by the generator run.
	 */
	scratch: string;
}

/** Fixed Python signatures of the code cells (the first line of the respective notebook cell). */
export const PARAMETERS_SIGNATURE = 'def parameters() -> "list[dict]":';
export const GENERATE_SIGNATURE = 'def generate(params: dict, n: int, ctx) -> "pandas.Series":';
export const PARSE_PARAMS_SIGNATURE = 'def parse_params(params: dict[str, str]) -> dict:';
export const DISPLAY_VALUE_SIGNATURE = 'def display_value(params: dict) -> str:';
export const VALIDATE_SIGNATURE = 'def validate(params: dict[str, str]) -> "list[str]":';

/**
 * Default bodies for a freshly created .tdgen file — deliberately with example
 * comments so the notebook editor surfaces the most important capabilities (the
 * ctx API, typical patterns) right inside the code cells.
 */
export const DEFAULT_GENERATE_BODY = [
	'# params: parameter values (see parse_params), n: number of records to generate',
	'# ctx.rng: numpy Generator, ctx.pd/ctx.np: pandas/numpy, ctx.faker(locale): Faker',
	'# Examples:',
	'#   return ctx.pd.Series([f"X-{v:06d}" for v in ctx.rng.integers(0, 10**6, size=n)])',
	'#   return ctx.pd.Series([ctx.faker("de_DE").first_name() for _ in range(n)])',
	'#   prices = ctx.column("price")                    # own column, same records',
	'#   cities = ctx.lookup_value("cities", "name")     # row-consistent lookup draw',
	'#   skus = ctx.table("shop.products", "sku")        # values of another table',
	'return ctx.pd.Series(ctx.rng.integers(0, 100, size=n))',
].join('\n');

export const DEFAULT_PARSE_PARAMS_BODY = [
	'# All parameter values arrive as strings — convert them here if needed.',
	'# Example:',
	'#   return {**params, "digits": int(params.get("digits", "") or 6)}',
	'return params',
].join('\n');

export const DEFAULT_DISPLAY_VALUE_BODY = [
	'# One-line summary of a configuration for the table editor, run log and preview.',
	'# Example:',
	'#   return f"{params.get(\'prefix\', \'?\')}-000001…"',
	'return ", ".join(f"{k}: {v}" for k, v in params.items() if v)',
].join('\n');

export const DEFAULT_VALIDATE_BODY = [
	'# Return a list of warning texts for the current parameter values (empty = ok).',
	'# Example:',
	'#   if not (params.get("prefix") or "").strip():',
	'#       return ["prefix must not be empty"]',
	'return []',
].join('\n');

/** Creates a blank custom generator prefilled with the default code bodies. */
export function createEmptyGeneratorFile(name = ''): GeneratorFile {
	return {
		name,
		description: '',
		parameters: [],
		code: {
			parameters: '',
			generate: DEFAULT_GENERATE_BODY,
			parseParams: DEFAULT_PARSE_PARAMS_BODY,
			displayValue: DEFAULT_DISPLAY_VALUE_BODY,
			validate: DEFAULT_VALIDATE_BODY,
			scratch: '',
		},
	};
}

/** Creates a blank parameter with the default data type. */
export function createEmptyParameter(): GeneratorParameter {
	return { name: '', type: 'string', description: '' };
}
