import { GeneratorBase } from '../base';

/**
 * Built-in generator: a deliberately chosen default per data type — the same
 * values a run produces for columns without any generator (a sequence for
 * integers, UUID4, random dates, …; see default_by_type in
 * python/generate.py). Unlike "— none —" this makes the choice explicit and
 * therefore raises no warning in the Problems view.
 */
class DefaultByTypeGenerator extends GeneratorBase {
	constructor() {
		super({
			id: 'default',
			name: 'Default by Type',
			description:
				"Sensible default values based on the column's data type: sequence for integers, UUID4, random dates, generic strings, …",
			parameters: [],
		});
	}
}

export const defaultByTypeGenerator = new DefaultByTypeGenerator();
