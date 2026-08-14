import { GeneratorBase } from './base';
import { GeneratorFile } from './model';
import { CUSTOM_GENERATOR_PREFIX } from './types';

/**
 * A custom generator from a .tdgen file of the workspace.
 *
 * It is referenced — like tables via their logical identity — by its `name`
 * (prefixed with `custom:` in the `id`), not by its file name: the reference
 * survives renaming or moving the file; if the *name* is changed or the file is
 * deleted, validation in the table editor reports the reference as not found.
 *
 * Display, TOML part, validation and required references all come from the base
 * class's generic implementations — driven by the parameter list declared in
 * the .tdgen file. The file's Python code (generate/parse_params/display_value)
 * only runs during a generator run (see python/generate.py), never in the
 * extension host.
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

/** `id` of a custom generator derived from its name (`custom:<name>`). */
export function customGeneratorId(name: string): string {
	return `${CUSTOM_GENERATOR_PREFIX}${name.trim()}`;
}

/** Whether a generator `id` refers to a custom generator rather than a built-in one. */
export function isCustomGeneratorId(id: string): boolean {
	return id.startsWith(CUSTOM_GENERATOR_PREFIX);
}

/** Name of a custom generator derived from its `id` (`custom:<name>` → `<name>`). */
export function customGeneratorName(id: string): string {
	return id.slice(CUSTOM_GENERATOR_PREFIX.length);
}
