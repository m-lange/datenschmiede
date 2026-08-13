import { GeneratorBase } from '../base';

/**
 * Eingebauter Generator: zieht Werte aus einer Nachschlageliste (.lkp) des
 * Workspace, gewichtet nach deren Gewichtsspalte. Python-Gegenstück:
 * `rng.choice(..., p=weights)` in python/generate.py.
 */
class LookupGenerator extends GeneratorBase {
	constructor() {
		super({
			id: 'lookup',
			name: 'Lookup List',
			description: 'Draws values from a lookup list (.lkp) in the workspace, weighted by its weight column.',
			displayTemplate: '{list}.{column}',
			parameters: [
				{ name: 'list', type: 'lookup', description: 'Lookup list to draw from.', required: true },
				{
					name: 'column',
					type: 'column',
					description: 'Value column of the lookup list to use.',
					required: true,
				},
			],
		});
	}
}

export const lookupGenerator = new LookupGenerator();
