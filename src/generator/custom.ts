import { GeneratorBase } from './base';
import { GeneratorFile } from './model';
import { CUSTOM_GENERATOR_PREFIX } from './types';

/**
 * Benutzerdefinierter Generator aus einer .tdgen-Datei des Workspace.
 *
 * Referenziert wird er — wie Tabellen über ihre logische Identität — über
 * seinen `name` (mit Präfix `custom:` in der `id`), nicht über den
 * Dateinamen: die Referenz bleibt gültig, wenn die Datei umbenannt oder
 * verschoben wird; wird der *Name* geändert oder die Datei gelöscht, meldet
 * die Validierung im Table Editor die Referenz als nicht (mehr) gefunden.
 *
 * Anzeige, TOML-Teil, Prüfung und benötigte Referenzen kommen komplett aus
 * den generischen Implementierungen der Basisklasse — gesteuert über die in
 * der .tdgen-Datei deklarierte Parameterliste. Der Python-Code der Datei
 * (generate/parse_params/display_value) läuft erst beim Generator-Lauf
 * (siehe python/generate.py), nie im Extension-Host.
 */
export class CustomGenerator extends GeneratorBase {
	public readonly file: GeneratorFile;

	constructor(file: GeneratorFile) {
		super({
			id: customGeneratorId(file.name),
			name: file.name,
			description: file.description,
			parameters: file.parameters,
		});
		this.file = file;
	}
}

/** `id` eines benutzerdefinierten Generators aus seinem Namen (`custom:<name>`). */
export function customGeneratorId(name: string): string {
	return `${CUSTOM_GENERATOR_PREFIX}${name.trim()}`;
}

export function isCustomGeneratorId(id: string): boolean {
	return id.startsWith(CUSTOM_GENERATOR_PREFIX);
}

/** Name eines benutzerdefinierten Generators aus seiner `id` (`custom:<name>` → `<name>`). */
export function customGeneratorName(id: string): string {
	return id.slice(CUSTOM_GENERATOR_PREFIX.length);
}
