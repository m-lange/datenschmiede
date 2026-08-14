import { GeneratorBase } from '../base';
import { GeneratorConfig, GeneratorContext, GeneratorIssue, RequiredRefs, emptyRequiredRefs } from '../types';

/**
 * The default generator for resolving an FK column's foreign key relationship:
 * draws values from the referenced column of the referenced table (the column's
 * own fk_table/fk_column — hence no parameters of its own). A table's *driving*
 * FK column additionally determines, together with the project's cardinality,
 * how many records are created per referenced record (see python/generate.py).
 *
 * It is assigned automatically when the FK checkbox is ticked and is selectable
 * on FK columns only (see media/table.js).
 */
class ForeignKeyGenerator extends GeneratorBase {
	constructor() {
		super({
			id: 'foreign-key',
			name: 'Foreign Key',
			description: 'Resolves the foreign key relationship: draws values from the referenced column of the referenced table.',
			parameters: [],
		});
	}

	public override displayString(_config: GeneratorConfig, ctx: GeneratorContext): string {
		const table = ctx.fkTable.trim();
		const column = ctx.fkColumn.trim();
		return `FK → ${table || '?'}.${column || '?'}`;
	}

	public override validate(_config: GeneratorConfig, _ctx: GeneratorContext): GeneratorIssue[] {
		// The referenced table/column is already checked by the column's own FK
		// validation (table/validation.ts) — no duplicate message here.
		return [];
	}

	public override requiredRefs(_config: GeneratorConfig, ctx: GeneratorContext): RequiredRefs {
		const refs = emptyRequiredRefs();
		const table = ctx.fkTable.trim();
		if (table) {
			refs.tables.push(table);
			const column = ctx.fkColumn.trim();
			if (column) {
				refs.columns.push({ table, column });
			}
		}
		return refs;
	}
}

export const foreignKeyGenerator = new ForeignKeyGenerator();
