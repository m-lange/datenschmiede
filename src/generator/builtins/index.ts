/**
 * Registry of the built-in generators — one per file in this folder. The order
 * determines the display order in the table editor's generator picker.
 * Deliberately vscode-free so that table/toml.ts (parsing/writing the `.td`
 * files) can use it too.
 */

import { GeneratorBase } from '../base';
import { defaultByTypeGenerator } from './defaultByType';
import { randomIntGenerator } from './randomInt';
import { randomFloatGenerator } from './randomFloat';
import { fakerGenerator } from './faker';
import { lookupGenerator } from './lookup';
import { combineGenerator } from './combine';
import { foreignKeyGenerator } from './foreignKey';

export const BUILTIN_GENERATORS: readonly GeneratorBase[] = [
	foreignKeyGenerator,
	defaultByTypeGenerator,
	randomIntGenerator,
	randomFloatGenerator,
	fakerGenerator,
	lookupGenerator,
	combineGenerator,
];

/** Looks up a built-in generator by its `id`; `undefined` for custom or unknown ids. */
export function findBuiltinGenerator(id: string): GeneratorBase | undefined {
	return BUILTIN_GENERATORS.find((generator) => generator.id === id);
}

export { foreignKeyGenerator };
