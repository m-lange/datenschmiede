/**
 * Registry der eingebauten Generatoren — je einer pro Datei in diesem
 * Ordner. Die Reihenfolge bestimmt die Anzeige-Reihenfolge in der
 * Generator-Auswahl des Table Editors. Bewusst vscode-frei, damit auch
 * table/toml.ts (Parsen/Schreiben der `.td`-Dateien) darauf zugreifen kann.
 */

import { GeneratorBase } from '../base';
import { randomIntGenerator } from './randomInt';
import { randomFloatGenerator } from './randomFloat';
import { fakerGenerator } from './faker';
import { lookupGenerator } from './lookup';
import { combineGenerator } from './combine';
import { foreignKeyGenerator } from './foreignKey';

export const BUILTIN_GENERATORS: readonly GeneratorBase[] = [
	foreignKeyGenerator,
	randomIntGenerator,
	randomFloatGenerator,
	fakerGenerator,
	lookupGenerator,
	combineGenerator,
];

export function findBuiltinGenerator(id: string): GeneratorBase | undefined {
	return BUILTIN_GENERATORS.find((generator) => generator.id === id);
}

export { foreignKeyGenerator };
