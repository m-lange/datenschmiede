import { GeneratorBase } from '../base';
import { GeneratorConfig, GeneratorContext, GeneratorIssue, RequiredRefs, emptyRequiredRefs } from '../types';

/** Placeholder `{column_name}` in the combine template. */
const PLACEHOLDER_PATTERN = /\{([^{}]+)\}/g;

/** Extracts the referenced column names from a combine template. */
export function combineTemplateColumns(template: string): string[] {
	const names: string[] = [];
	for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
		const name = match[1].trim();
		if (name && !names.includes(name)) {
			names.push(name);
		}
	}
	return names;
}

/**
 * Built-in generator: combines the values of other columns of the same table
 * (as produced by their own generators) into a string — `{column_name}`
 * placeholders in the template are replaced per record by that column's value
 * (e.g. `"{first_name}.{last_name}@example.com"`). The referenced columns must
 * therefore be generated before this one (see requiredRefs → generation order).
 */
class CombineGenerator extends GeneratorBase {
	constructor() {
		super({
			id: 'combine',
			name: 'Combine',
			description:
				'Combines the generated values of other columns of this table into one value. Use {column_name} placeholders in the template.',
			parameters: [
				{
					name: 'template',
					type: 'string',
					description: 'Template with {column_name} placeholders, e.g. "{first_name}.{last_name}@example.com".',
					required: true,
					placeholder: '{first_name}.{last_name}@example.com',
				},
			],
		});
	}

	public override displayString(config: GeneratorConfig, _ctx: GeneratorContext): string {
		const template = (config.params.template ?? '').trim();
		return template ? `${this.name}: ${template}` : this.name;
	}

	public override validate(config: GeneratorConfig, ctx: GeneratorContext): GeneratorIssue[] {
		const issues = super.validate(config, ctx);
		const template = (config.params.template ?? '').trim();
		if (template === '') {
			return issues;
		}
		for (const column of combineTemplateColumns(template)) {
			// A column cannot combine itself; columns that no longer exist (e.g.
			// after a rename) are reported.
			if (column === ctx.ownColumnName || !ctx.ownColumns.includes(column)) {
				issues.push({ kind: 'gen-own-column-not-found', paramName: 'template', detail: column });
			}
		}
		return issues;
	}

	public override requiredRefs(config: GeneratorConfig, ctx: GeneratorContext): RequiredRefs {
		const refs = emptyRequiredRefs();
		const template = (config.params.template ?? '').trim();
		refs.ownColumns = combineTemplateColumns(template).filter(
			(column) => column !== ctx.ownColumnName && ctx.ownColumns.includes(column),
		);
		return refs;
	}
}

export const combineGenerator = new CombineGenerator();
