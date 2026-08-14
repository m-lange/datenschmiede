import { GeneratorBase } from '../base';
import { GeneratorConfig, GeneratorContext, GeneratorIssue } from '../types';

/**
 * Built-in generator: uniformly distributed integers in [min, max] (both ends
 * inclusive). Python counterpart: `rng.integers` in python/generate.py.
 */
class RandomIntGenerator extends GeneratorBase {
	constructor() {
		super({
			id: 'random-int',
			name: 'Random Int',
			description: 'Uniformly distributed integers between min and max (both inclusive).',
			displayTemplate: '{min} … {max}',
			parameters: [
				{ name: 'min', type: 'integer', description: 'Smallest possible value.', required: true, placeholder: '1' },
				{ name: 'max', type: 'integer', description: 'Largest possible value.', required: true, placeholder: '100' },
			],
		});
	}

	public override validate(config: GeneratorConfig, ctx: GeneratorContext): GeneratorIssue[] {
		const issues = super.validate(config, ctx);
		const min = Number(config.params.min);
		const max = Number(config.params.max);
		if (issues.length === 0 && Number.isFinite(min) && Number.isFinite(max) && min > max) {
			issues.push({ kind: 'gen-param-invalid', paramName: 'min', detail: `${min} > ${max}` });
		}
		return issues;
	}
}

export const randomIntGenerator = new RandomIntGenerator();
