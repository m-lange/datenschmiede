import { GeneratorBase } from '../base';

/**
 * Eingebauter Generator: zieht Werte aus einer Nachschlageliste (.lkp) des
 * Workspace, gewichtet nach deren Gewichtsspalte. Je Datensatz wird EINE
 * Listen-Zeile gezogen: alle Spalten, die aus derselben Liste ziehen —
 * auch in per Fremdschlüssel verbundenen Tabellen — lesen dieselbe Zeile
 * (z. B. `code` „DE“ beim Kunden und `currency` „EUR“ derselben Zeile in
 * seiner Bestellung). Python-Gegenstück: `lookup_indices` in
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
