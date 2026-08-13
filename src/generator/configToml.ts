/**
 * Lesen/Schreiben des Generator-Teils einer `[[columns]]`-Tabelle im
 * `.td`-TOML. Jeder Generator ist für seinen Teil selbst verantwortlich
 * (parseParams/encodeParams in GeneratorBase bzw. den builtins/) — diese
 * Datei findet nur den passenden Generator und delegiert.
 *
 * Format innerhalb einer `[[columns]]`-Tabelle:
 *
 *   generator = "random-int"
 *   [columns.generator_params]
 *   min = "1"
 *   max = "100"
 *
 * Bewusst vscode-frei (wird von table/toml.ts genutzt). Benutzerdefinierte
 * Generatoren (`custom:<name>`) und unbekannte ids werden generisch
 * geparst/geschrieben (GeneratorBase-Standard), damit eine Konfiguration
 * auch dann verlustfrei erhalten bleibt, wenn die `.tdgen`-Datei gerade
 * nicht auflösbar ist — die Validierung meldet das separat.
 */

import { GeneratorBase } from './base';
import { findBuiltinGenerator } from './builtins';
import { GeneratorConfig } from './types';

/** Generischer Rückfall-Generator für unbekannte/nicht auflösbare ids (verlustfreies Round-Tripping). */
class FallbackGenerator extends GeneratorBase {
	constructor(id: string) {
		super({ id, name: id, description: '', parameters: [] });
	}
}

/**
 * Löst eine Generator-`id` in ihren Generator auf: eingebaute direkt, sonst
 * (benutzerdefinierte und unbekannte) ein generischer Rückfall — die
 * *aufgelösten* benutzerdefinierten Generatoren kennt nur der Extension-Host
 * (siehe generator/repository.ts) und reicht sie dort weiter, wo mehr als
 * generisches Verhalten gebraucht wird.
 */
export function resolveGeneratorForToml(id: string): GeneratorBase {
	return findBuiltinGenerator(id) ?? new FallbackGenerator(id);
}

/** Liest `generator`/`generator_params` einer rohen `[[columns]]`-Tabelle. */
export function parseGeneratorConfig(rawColumn: Record<string, unknown>): GeneratorConfig | undefined {
	const id = typeof rawColumn.generator === 'string' ? rawColumn.generator.trim() : '';
	if (!id) {
		return undefined;
	}
	const rawParams = (
		rawColumn.generator_params && typeof rawColumn.generator_params === 'object' ? rawColumn.generator_params : {}
	) as Record<string, unknown>;
	return { id, params: resolveGeneratorForToml(id).parseParams(rawParams) };
}

/**
 * Schreibt die TOML-Zeilen des Generator-Teils einer Spalte (leeres Array,
 * wenn kein Generator konfiguriert ist) — eingehängt von
 * table/toml.ts#serializeTable ans Ende des jeweiligen `[[columns]]`-Blocks,
 * da `[columns.generator_params]` als Untertabelle alles Nachfolgende
 * schlucken würde.
 */
export function encodeGeneratorConfigLines(config: GeneratorConfig | undefined, tomlString: (v: string) => string): string[] {
	if (!config || !config.id.trim()) {
		return [];
	}
	const lines: string[] = [];
	lines.push(`generator = ${tomlString(config.id)}`);
	const params = resolveGeneratorForToml(config.id).encodeParams(config.params);
	const entries = Object.entries(params);
	if (entries.length > 0) {
		lines.push('[columns.generator_params]');
		for (const [key, value] of entries) {
			lines.push(`${key} = ${tomlString(value)}`);
		}
	}
	return lines;
}
