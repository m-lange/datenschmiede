import { GeneratorBase } from '../base';
import { GeneratorConfig, GeneratorContext, GeneratorIssue, RequiredRefs, emptyRequiredRefs } from '../types';

/**
 * Der Standard-Generator zum Auflösen der Fremdschlüssel-Beziehung einer
 * FK-Spalte: zieht Werte aus der referenzierten Spalte der referenzierten
 * Tabelle (fk_table/fk_column der Spalte selbst — deshalb ohne eigene
 * Parameter). Die *treibende* FK-Spalte einer Tabelle bestimmt zusätzlich
 * über die Datensatz-Kardinalität des Projekts, wie viele Datensätze je
 * referenziertem Datensatz entstehen (siehe python/generate.py).
 *
 * Wird beim Anhaken der FK-Checkbox automatisch zugewiesen und ist nur für
 * FK-Spalten wählbar (siehe media/table.js).
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
		// Referenzierte Tabelle/Spalte prüft bereits die FK-Validierung der
		// Spalte selbst (table/validation.ts) — hier keine Doppelmeldung.
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
