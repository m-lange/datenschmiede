/**
 * Basisklasse aller Generatoren (eingebaut wie benutzerdefiniert).
 *
 * Jeder Generator ist selbst verantwortlich für:
 * - das Lesen/Schreiben seines Teils im `.td`-TOML (parseParams/encodeParams),
 * - seinen Anzeige-Text im Table Editor (displayString),
 * - die Prüfung der aktuellen Konfiguration (validate → Warnungen für die
 *   Problems-Ansicht),
 * - die Liste der benötigten Tabellen/Spalten/Nachschlagelisten
 *   (requiredRefs → Generier-Reihenfolge und Tabellen-Mitnahme im Projekt).
 *
 * Die Standard-Implementierungen arbeiten generisch über die deklarative
 * Parameterliste; einzelne Generatoren überschreiben nur, was bei ihnen
 * abweicht (siehe src/generator/builtins/). Bewusst frei von jeder
 * vscode-Abhängigkeit.
 */

import {
	GeneratorConfig,
	GeneratorContext,
	GeneratorIssue,
	GeneratorParameter,
	RequiredRefs,
	emptyRequiredRefs,
	fillDisplayTemplate,
} from './types';

/** Deklarative Beschreibung eines Generators, aus der die Basisklasse alles Weitere ableitet. */
export interface GeneratorSpec {
	/** Stabile Kennung, wie sie als `generator = "..."` im `.td`-TOML steht (bei benutzerdefinierten `custom:<name>`). */
	id: string;
	name: string;
	description: string;
	parameters: GeneratorParameter[];
	/**
	 * Anzeige-Vorlage mit `{param}`-Platzhaltern (siehe fillDisplayTemplate);
	 * ohne Vorlage wird generisch `Name (param: wert, …)` angezeigt.
	 */
	displayTemplate?: string;
}

export class GeneratorBase {
	public readonly id: string;
	public readonly name: string;
	public readonly description: string;
	public readonly parameters: GeneratorParameter[];
	public readonly displayTemplate: string | undefined;

	constructor(spec: GeneratorSpec) {
		this.id = spec.id;
		this.name = spec.name;
		this.description = spec.description;
		this.parameters = spec.parameters;
		this.displayTemplate = spec.displayTemplate;
	}

	/**
	 * Liest die Parameterwerte dieses Generators aus dem rohen
	 * `generator_params`-Objekt einer `[[columns]]`-Tabelle. Standard: alle
	 * deklarierten Parameter als String übernehmen; unbekannte Schlüssel
	 * bleiben erhalten (z. B. nach Umbenennen eines Parameters in einer
	 * `.tdgen`-Datei), damit nichts stillschweigend verloren geht.
	 */
	public parseParams(raw: Record<string, unknown>): Record<string, string> {
		const params: Record<string, string> = {};
		for (const [key, value] of Object.entries(raw)) {
			if (typeof value === 'string') {
				params[key] = value;
			} else if (typeof value === 'number' || typeof value === 'boolean') {
				params[key] = String(value);
			}
		}
		return params;
	}

	/**
	 * Schreibt die Parameterwerte für das `.td`-TOML — Gegenstück zu
	 * parseParams. Standard: nur nicht-leere Werte, in der deklarierten
	 * Parameter-Reihenfolge (stabil, git-diff-freundlich), unbekannte
	 * Schlüssel dahinter.
	 */
	public encodeParams(params: Record<string, string>): Record<string, string> {
		const encoded: Record<string, string> = {};
		const declared = this.parameters.map((p) => p.name);
		for (const name of declared) {
			const value = (params[name] ?? '').trim();
			if (value !== '') {
				encoded[name] = params[name];
			}
		}
		for (const [key, value] of Object.entries(params)) {
			if (!declared.includes(key) && (value ?? '').trim() !== '') {
				encoded[key] = value;
			}
		}
		return encoded;
	}

	/** Anzeige-Text für den Table Editor (statt des bloßen Generator-Namens). */
	public displayString(config: GeneratorConfig, _ctx: GeneratorContext): string {
		if (this.displayTemplate) {
			return `${this.name}: ${fillDisplayTemplate(this.displayTemplate, config.params)}`;
		}
		const parts = this.parameters
			.map((p) => {
				const value = (config.params[p.name] ?? '').trim();
				return value ? `${p.name}: ${value}` : '';
			})
			.filter((part) => part !== '');
		return parts.length > 0 ? `${this.name} (${parts.join(', ')})` : this.name;
	}

	/**
	 * Prüft die aktuelle Konfiguration und liefert Warnungen für die
	 * Problems-Ansicht. Standard: Pflichtparameter müssen gesetzt sein,
	 * Zahlen-Parameter müssen lesbare Zahlen sein, Referenz-Parameter
	 * (`table`/`column`/`lookup`) müssen auf (noch) Vorhandenes zeigen —
	 * auch wenn das Ziel erst nach der Konfiguration umbenannt/gelöscht wurde.
	 */
	public validate(config: GeneratorConfig, ctx: GeneratorContext): GeneratorIssue[] {
		const issues: GeneratorIssue[] = [];
		for (const parameter of this.parameters) {
			const value = (config.params[parameter.name] ?? '').trim();
			if (value === '') {
				if (parameter.required) {
					issues.push({ kind: 'gen-param-missing', paramName: parameter.name });
				}
				continue;
			}
			issues.push(...this.validateParamValue(parameter, value, config, ctx));
		}
		return issues;
	}

	/** Prüft einen einzelnen, nicht-leeren Parameterwert (Baustein von validate). */
	protected validateParamValue(
		parameter: GeneratorParameter,
		value: string,
		config: GeneratorConfig,
		ctx: GeneratorContext,
	): GeneratorIssue[] {
		switch (parameter.type) {
			case 'integer':
				if (!/^-?\d+$/.test(value)) {
					return [{ kind: 'gen-param-invalid', paramName: parameter.name, detail: value }];
				}
				return [];
			case 'float':
			case 'decimal':
				if (!/^-?\d+([.,]\d+)?$/.test(value)) {
					return [{ kind: 'gen-param-invalid', paramName: parameter.name, detail: value }];
				}
				return [];
			case 'boolean':
				if (value !== 'true' && value !== 'false') {
					return [{ kind: 'gen-param-invalid', paramName: parameter.name, detail: value }];
				}
				return [];
			case 'table':
				if (!ctx.tables.some((t) => t.label === value)) {
					return [{ kind: 'gen-table-not-found', paramName: parameter.name, detail: value }];
				}
				return [];
			case 'column': {
				const target = this.boundReferenceValue(parameter, config);
				if (!target) {
					// Ohne gewählte Tabelle/Liste wäre das nur eine Folgemeldung.
					return [];
				}
				if (target.kind === 'table') {
					const table = ctx.tables.find((t) => t.label === target.value);
					if (table && !table.columns.includes(value)) {
						return [{ kind: 'gen-column-not-found', paramName: parameter.name, detail: value }];
					}
					return [];
				}
				const lookup = ctx.lookups.find((l) => l.name === target.value);
				if (lookup && !lookup.columns.includes(value)) {
					return [{ kind: 'gen-lookup-column-not-found', paramName: parameter.name, detail: value }];
				}
				return [];
			}
			case 'lookup':
				if (!ctx.lookups.some((l) => l.name === value)) {
					return [{ kind: 'gen-lookup-not-found', paramName: parameter.name, detail: value }];
				}
				return [];
			case 'own_column':
				// Eine Spalte der eigenen Tabelle: muss existieren und darf nicht
				// die generierte Spalte selbst sein.
				if (value === ctx.ownColumnName || !ctx.ownColumns.includes(value)) {
					return [{ kind: 'gen-own-column-not-found', paramName: parameter.name, detail: value }];
				}
				return [];
			default:
				if (parameter.choices && parameter.choices.length > 0 && !parameter.choices.includes(value)) {
					return [{ kind: 'gen-param-invalid', paramName: parameter.name, detail: value }];
				}
				return [];
		}
	}

	/**
	 * Benötigte Referenzen der aktuellen Konfiguration. Standard: jeder
	 * gesetzte `table`-Parameter benötigt seine Tabelle, jedes
	 * `table`+`column`-Paar die konkrete Spalte, jeder `lookup`-Parameter
	 * seine Nachschlageliste, jeder `own_column`-Parameter die Spalte der
	 * eigenen Tabelle (sie wird dadurch garantiert *vor* dieser generiert).
	 */
	public requiredRefs(config: GeneratorConfig, ctx: GeneratorContext): RequiredRefs {
		const refs = emptyRequiredRefs();
		for (const parameter of this.parameters) {
			const value = (config.params[parameter.name] ?? '').trim();
			if (value === '') {
				continue;
			}
			if (parameter.type === 'table') {
				refs.tables.push(value);
			} else if (parameter.type === 'lookup') {
				refs.lookups.push(value);
			} else if (parameter.type === 'column') {
				const target = this.boundReferenceValue(parameter, config);
				if (target?.kind === 'table') {
					refs.columns.push({ table: target.value, column: value });
				}
			} else if (parameter.type === 'own_column') {
				if (value !== ctx.ownColumnName && ctx.ownColumns.includes(value)) {
					refs.ownColumns.push(value);
				}
			}
		}
		return refs;
	}

	/**
	 * Ermittelt, worauf sich ein `column`-Parameter bezieht: der Wert des
	 * nächsten davorstehenden `table`- bzw. `lookup`-Parameters (analog zum
	 * Paar fk_table/fk_column). `null`, solange dort (noch) nichts gewählt ist.
	 */
	protected boundReferenceValue(
		columnParameter: GeneratorParameter,
		config: GeneratorConfig,
	): { kind: 'table' | 'lookup'; value: string } | null {
		const index = this.parameters.indexOf(columnParameter);
		for (let i = index - 1; i >= 0; i--) {
			const candidate = this.parameters[i];
			if (candidate.type === 'table' || candidate.type === 'lookup') {
				const value = (config.params[candidate.name] ?? '').trim();
				return value ? { kind: candidate.type, value } : null;
			}
		}
		return null;
	}
}
