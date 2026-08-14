import { GeneratorBase } from '../base';
import { GeneratorConfig, GeneratorContext, GeneratorIssue } from '../types';

/**
 * Built-in generator: uniformly distributed floating point numbers in
 * [min, max), rounded to `decimals` decimal places. Python counterpart:
 * `rng.uniform` in python/generate.py.
 */
class RandomFloatGenerator extends GeneratorBase {
	constructor() {
		super({
			id: 'random-float',
			name: 'Random Float',
			description: 'Uniformly distributed floating point numbers between min and max, rounded to a number of decimals.',
			displayTemplate: '{min} … {max} ({decimals})',
			parameters: [
				{ name: 'min', type: 'float', description: 'Smallest possible value.', required: true, placeholder: '0' },
				{ name: 'max', type: 'float', description: 'Largest possible value.', required: true, placeholder: '1000' },
				{
					name: 'decimals',
					type: 'integer',
					description: 'Number of decimal places to round to.',
					placeholder: '2',
				},
			],
		});
	}

	public override validate(config: GeneratorConfig, ctx: GeneratorContext): GeneratorIssue[] {
		const issues = super.validate(config, ctx);
		const min = Number((config.params.min ?? '').replace(',', '.'));
		const max = Number((config.params.max ?? '').replace(',', '.'));
		if (issues.length === 0 && Number.isFinite(min) && Number.isFinite(max) && min > max) {
			issues.push({ kind: 'gen-param-invalid', paramName: 'min', detail: `${min} > ${max}` });
		}
		return issues;
	}
}

export const randomFloatGenerator = new RandomFloatGenerator();
