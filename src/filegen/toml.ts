import { parse, TomlError } from 'smol-toml';
import { FILEGEN_STRUCTURES, FileGeneratorFile, FileGeneratorStructure, createEmptyFileGeneratorFile } from './model';
import { ParseError, tomlString } from '../tomlUtil';

/** Parses the TOML text of a .filegen file into our file generator model. */
export function parseFileGeneratorText(text: string): FileGeneratorFile {
	if (!text.trim()) {
		return createEmptyFileGeneratorFile();
	}

	let data: Record<string, unknown>;
	try {
		data = parse(text);
	} catch (err) {
		if (err instanceof TomlError) {
			throw new ParseError(err.message, { line: err.line, column: err.column });
		}
		throw new ParseError(err instanceof Error ? err.message : String(err));
	}

	const code = (data.code && typeof data.code === 'object' ? data.code : {}) as Record<string, unknown>;
	const structure = toStr(data.structure).toLowerCase() as FileGeneratorStructure;

	return {
		name: toStr(data.name),
		description: toStr(data.description),
		// Written without the dot; a leading one is tolerated and stripped.
		extension: toStr(data.extension).replace(/^\./, '').trim(),
		structure: FILEGEN_STRUCTURES.includes(structure) ? structure : 'none',
		code: {
			write: toStr(code.write),
			scratch: toStr(code.scratch),
		},
	};
}

/** Coerces an unknown TOML value to a string, treating anything else as empty. */
function toStr(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

/**
 * Writes our file generator model as TOML text — like generator/toml.ts a lean,
 * fixed format with the Python body as a multi-line TOML string under `[code]`.
 */
export function serializeFileGenerator(file: FileGeneratorFile): string {
	const lines: string[] = [];
	lines.push('# Datenschmiede Dateigenerator');
	lines.push(`name = ${tomlString(file.name)}`);
	lines.push(`description = ${tomlString(file.description)}`);
	lines.push(`extension = ${tomlString(file.extension || 'txt')}`);
	lines.push(`structure = ${tomlString(file.structure || 'none')}`);

	lines.push('');
	lines.push('[code]');
	lines.push(`write = ${tomlString(ensureMultiline(file.code.write))}`);
	if (file.code.scratch.trim()) {
		lines.push(`scratch = ${tomlString(ensureMultiline(file.code.scratch))}`);
	}

	lines.push('');
	return lines.join('\n');
}

/**
 * Forces the multi-line TOML string form for code bodies (even for a single
 * line), so the file stays readable as raw text and a save round-trip does not
 * flip between the single-line and multi-line forms.
 */
function ensureMultiline(code: string): string {
	const text = code ?? '';
	return text.includes('\n') ? text : `${text}\n`;
}
