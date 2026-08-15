import { GeneratorBase } from '../base';
import { GeneratorConfig, GeneratorContext } from '../types';

/**
 * Built-in generator: combines the values of other columns of the same table
 * (as produced by their own generators) into a string — `{column_name}`
 * placeholders in the template are replaced per record by that column's value
 * (e.g. `"{first_name}.{last_name}@example.com"`).
 *
 * The placeholders need no special handling here: `{column}` works in EVERY
 * free-text parameter of every generator (see paramTemplateColumns), so the
 * base class already validates the referenced columns and requires them to be
 * generated first. What is special about this generator is only that it does
 * nothing else — its whole output is the resolved template — and that the
 * runner resolves it vectorized in one pass instead of grouping by the
 * resolved value (see Runner.generate_column in python/generate.py).
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
}

export const combineGenerator = new CombineGenerator();
