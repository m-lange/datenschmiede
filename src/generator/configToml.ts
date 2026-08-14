/**
 * Reading/writing the generator part of a `[[columns]]` table in the `.td`
 * TOML. Every generator is responsible for its own part
 * (parseParams/encodeParams in GeneratorBase or the builtins/) — this file only
 * finds the matching generator and delegates.
 *
 * Format inside a `[[columns]]` table:
 *
 *   generator = "random-int"
 *   [columns.generator_params]
 *   min = "1"
 *   max = "100"
 *
 * Deliberately vscode-free (used by table/toml.ts). Custom generators
 * (`custom:<name>`) and unknown ids are parsed/written generically (the
 * GeneratorBase default) so a configuration round-trips losslessly even when
 * the `.tdgen` file currently cannot be resolved — validation reports that
 * separately.
 */

import { GeneratorBase } from './base';
import { findBuiltinGenerator } from './builtins';
import { GeneratorConfig } from './types';

/** Generic fallback generator for unknown/unresolvable ids (lossless round-tripping). */
class FallbackGenerator extends GeneratorBase {
	constructor(id: string) {
		super({ id, name: id, description: '', parameters: [] });
	}
}

/**
 * Resolves a generator `id` to its generator: built-in ones directly, everything
 * else (custom and unknown) to a generic fallback — the *resolved* custom
 * generators are known only to the extension host (see
 * generator/repository.ts), which passes them wherever more than generic
 * behaviour is required.
 */
export function resolveGeneratorForToml(id: string): GeneratorBase {
	return findBuiltinGenerator(id) ?? new FallbackGenerator(id);
}

/** Reads `generator`/`generator_params` of a raw `[[columns]]` table. */
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
 * Writes the TOML lines of a column's generator part (an empty array when no
 * generator is configured) — appended by table/toml.ts#serializeTable at the end
 * of the respective `[[columns]]` block, because `[columns.generator_params]`
 * would, as a sub-table, swallow everything that follows.
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
