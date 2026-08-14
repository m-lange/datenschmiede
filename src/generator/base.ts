/**
 * Base class of all generators (built-in and custom alike).
 *
 * Every generator is itself responsible for:
 * - reading/writing its part of the `.td` TOML (parseParams/encodeParams),
 * - its display text in the table editor (displayString),
 * - validating the current configuration (validate → warnings for the Problems
 *   view),
 * - the list of required tables/columns/lookup lists (requiredRefs →
 *   generation order and automatic table inclusion in the project).
 *
 * The default implementations work generically off the declarative parameter
 * list; individual generators only override what differs for them (see
 * src/generator/builtins/). Deliberately free of any vscode dependency.
 */

import {
	GeneratorConfig,
	GeneratorContext,
	GeneratorIssue,
	GeneratorParameter,
	RequiredRefs,
	emptyRequiredRefs,
	fillDisplayTemplate,
} from './types';

/** Declarative description of a generator, from which the base class derives everything else. */
export interface GeneratorSpec {
	/** Stable identifier as written as `generator = "..."` in the `.td` TOML (`custom:<name>` for custom ones). */
	id: string;
	name: string;
	description: string;
	parameters: GeneratorParameter[];
	/**
	 * Display template with `{param}` placeholders (see fillDisplayTemplate);
	 * without a template a generic `Name (param: value, …)` is shown.
	 */
	displayTemplate?: string;
}

/** Default behaviour shared by every generator; subclasses override only what differs. */
export class GeneratorBase {
	public readonly id: string;
	public readonly name: string;
	public readonly description: string;
	public readonly parameters: GeneratorParameter[];
	public readonly displayTemplate: string | undefined;

	constructor(spec: GeneratorSpec) {
		this.id = spec.id;
		this.name = spec.name;
		this.description = spec.description;
		this.parameters = spec.parameters;
		this.displayTemplate = spec.displayTemplate;
	}

	/**
	 * Reads this generator's parameter values from the raw `generator_params`
	 * object of a `[[columns]]` table. Default: take over every declared
	 * parameter as a string; unknown keys are preserved (e.g. after a parameter
	 * was renamed in a `.tdgen` file) so nothing is silently lost.
	 */
	public parseParams(raw: Record<string, unknown>): Record<string, string> {
		const params: Record<string, string> = {};
		for (const [key, value] of Object.entries(raw)) {
			if (typeof value === 'string') {
				params[key] = value;
			} else if (typeof value === 'number' || typeof value === 'boolean') {
				params[key] = String(value);
			}
		}
		return params;
	}

	/**
	 * Writes the parameter values for the `.td` TOML — the counterpart to
	 * parseParams. Default: only non-empty values, in the declared parameter
	 * order (stable, git-diff-friendly), with unknown keys appended.
	 */
	public encodeParams(params: Record<string, string>): Record<string, string> {
		const encoded: Record<string, string> = {};
		const declared = this.parameters.map((p) => p.name);
		for (const name of declared) {
			const value = (params[name] ?? '').trim();
			if (value !== '') {
				encoded[name] = params[name];
			}
		}
		for (const [key, value] of Object.entries(params)) {
			if (!declared.includes(key) && (value ?? '').trim() !== '') {
				encoded[key] = value;
			}
		}
		return encoded;
	}

	/** Display text for the table editor (instead of the bare generator name). */
	public displayString(config: GeneratorConfig, _ctx: GeneratorContext): string {
		if (this.displayTemplate) {
			return `${this.name}: ${fillDisplayTemplate(this.displayTemplate, config.params)}`;
		}
		const parts = this.parameters
			.map((p) => {
				const value = (config.params[p.name] ?? '').trim();
				return value ? `${p.name}: ${value}` : '';
			})
			.filter((part) => part !== '');
		return parts.length > 0 ? `${this.name} (${parts.join(', ')})` : this.name;
	}

	/**
	 * Validates the current configuration and returns warnings for the Problems
	 * view. Default: mandatory parameters must be set, numeric parameters must
	 * parse as numbers, and reference parameters (`table`/`column`/`lookup`)
	 * must point at something that still exists — including when the target was
	 * renamed or deleted after being configured.
	 */
	public validate(config: GeneratorConfig, ctx: GeneratorContext): GeneratorIssue[] {
		const issues: GeneratorIssue[] = [];
		for (const parameter of this.parameters) {
			const value = (config.params[parameter.name] ?? '').trim();
			if (value === '') {
				if (parameter.required) {
					issues.push({ kind: 'gen-param-missing', paramName: parameter.name });
				}
				continue;
			}
			issues.push(...this.validateParamValue(parameter, value, config, ctx));
		}
		return issues;
	}

	/** Validates a single, non-empty parameter value (building block of validate). */
	protected validateParamValue(
		parameter: GeneratorParameter,
		value: string,
		config: GeneratorConfig,
		ctx: GeneratorContext,
	): GeneratorIssue[] {
		switch (parameter.type) {
			case 'integer':
				if (!/^-?\d+$/.test(value)) {
					return [{ kind: 'gen-param-invalid', paramName: parameter.name, detail: value }];
				}
				return [];
			case 'float':
			case 'decimal':
				if (!/^-?\d+([.,]\d+)?$/.test(value)) {
					return [{ kind: 'gen-param-invalid', paramName: parameter.name, detail: value }];
				}
				return [];
			case 'boolean':
				if (value !== 'true' && value !== 'false') {
					return [{ kind: 'gen-param-invalid', paramName: parameter.name, detail: value }];
				}
				return [];
			case 'table':
				if (!ctx.tables.some((t) => t.label === value)) {
					return [{ kind: 'gen-table-not-found', paramName: parameter.name, detail: value }];
				}
				return [];
			case 'column': {
				const target = this.boundReferenceValue(parameter, config);
				if (!target) {
					// Without a chosen table/list this would only be a follow-up message.
					return [];
				}
				if (target.kind === 'table') {
					const table = ctx.tables.find((t) => t.label === target.value);
					if (table && !table.columns.includes(value)) {
						return [{ kind: 'gen-column-not-found', paramName: parameter.name, detail: value }];
					}
					return [];
				}
				const lookup = ctx.lookups.find((l) => l.name === target.value);
				if (lookup && !lookup.columns.includes(value)) {
					return [{ kind: 'gen-lookup-column-not-found', paramName: parameter.name, detail: value }];
				}
				return [];
			}
			case 'lookup':
				if (!ctx.lookups.some((l) => l.name === value)) {
					return [{ kind: 'gen-lookup-not-found', paramName: parameter.name, detail: value }];
				}
				return [];
			case 'own_column':
				// A column of the own table: must exist and must not be the
				// generated column itself.
				if (value === ctx.ownColumnName || !ctx.ownColumns.includes(value)) {
					return [{ kind: 'gen-own-column-not-found', paramName: parameter.name, detail: value }];
				}
				return [];
			default:
				if (parameter.choices && parameter.choices.length > 0 && !parameter.choices.includes(value)) {
					return [{ kind: 'gen-param-invalid', paramName: parameter.name, detail: value }];
				}
				return [];
		}
	}

	/**
	 * References required by the current configuration. Default: every set
	 * `table` parameter requires its table, every `table`+`column` pair the
	 * specific column, every `lookup` parameter its lookup list, and every
	 * `own_column` parameter the column of the own table (which is thereby
	 * guaranteed to be generated *before* this one).
	 */
	public requiredRefs(config: GeneratorConfig, ctx: GeneratorContext): RequiredRefs {
		const refs = emptyRequiredRefs();
		for (const parameter of this.parameters) {
			const value = (config.params[parameter.name] ?? '').trim();
			if (value === '') {
				continue;
			}
			if (parameter.type === 'table') {
				refs.tables.push(value);
			} else if (parameter.type === 'lookup') {
				refs.lookups.push(value);
			} else if (parameter.type === 'column') {
				const target = this.boundReferenceValue(parameter, config);
				if (target?.kind === 'table') {
					refs.columns.push({ table: target.value, column: value });
				}
			} else if (parameter.type === 'own_column') {
				if (value !== ctx.ownColumnName && ctx.ownColumns.includes(value)) {
					refs.ownColumns.push(value);
				}
			}
		}
		return refs;
	}

	/**
	 * Determines what a `column` parameter refers to: the value of the nearest
	 * preceding `table` or `lookup` parameter (mirroring the fk_table/fk_column
	 * pair). `null` while nothing has been selected there yet.
	 */
	protected boundReferenceValue(
		columnParameter: GeneratorParameter,
		config: GeneratorConfig,
	): { kind: 'table' | 'lookup'; value: string } | null {
		const index = this.parameters.indexOf(columnParameter);
		for (let i = index - 1; i >= 0; i--) {
			const candidate = this.parameters[i];
			if (candidate.type === 'table' || candidate.type === 'lookup') {
				const value = (config.params[candidate.name] ?? '').trim();
				return value ? { kind: candidate.type, value } : null;
			}
		}
		return null;
	}
}
