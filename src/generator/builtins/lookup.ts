import { GeneratorBase } from '../base';

/**
 * Built-in generator: draws values from a lookup list (.lkp) of the workspace,
 * weighted by its weight column. ONE list row is drawn per record: every column
 * drawing from the same list — including in tables related via foreign keys —
 * reads the same row (e.g. `code` "DE" on the customer and `currency` "EUR"
 * from that same row on their order). Python counterpart: `lookup_indices` in
 * python/generate.py.
 */
class LookupGenerator extends GeneratorBase {
	constructor() {
		super({
			id: 'lookup',
			name: 'Lookup List',
			description:
				'Draws values from a lookup list (.lkp), weighted by its weight column. One row is drawn per record: columns drawing from the same list — also in tables related via foreign keys — read the same row.',
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
