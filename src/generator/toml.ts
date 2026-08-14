import { parse, TomlError } from 'smol-toml';
import { GeneratorFile, createEmptyGeneratorFile } from './model';
import { GeneratorParameter, PARAMETER_TYPES } from './types';
import { ParseError, tomlString } from '../tomlUtil';

/** Parses the TOML text of a .tdgen file into our generator model. */
export function parseGeneratorText(text: string): GeneratorFile {
	if (!text.trim()) {
		return createEmptyGeneratorFile();
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

	const rawParameters = Array.isArray(data.parameters) ? data.parameters : [];
	const parameters: GeneratorParameter[] = rawParameters.map((raw) => toParameter(raw));

	const code = (data.code && typeof data.code === 'object' ? data.code : {}) as Record<string, unknown>;

	return {
		name: toStr(data.name),
		description: toStr(data.description),
		parameters,
		code: {
			parameters: toStr(code.parameters),
			generate: toStr(code.generate),
			parseParams: toStr(code.parse_params),
			displayValue: toStr(code.display_value),
			validate: toStr(code.validate),
			scratch: toStr(code.scratch),
		},
	};
}

/** Reads one `[[parameters]]` block; unknown or missing values fall back to defaults. */
function toParameter(raw: unknown): GeneratorParameter {
	const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const type = toStr(p.type);
	const parameter: GeneratorParameter = {
		name: toStr(p.name),
		// Unknown types are preserved (rather than silently replaced) — the
		// webview displays them and validation reports them.
		type: type || 'string',
		description: toStr(p.description),
	};
	if (Array.isArray(p.choices)) {
		const choices = p.choices.filter((c): c is string => typeof c === 'string');
		if (choices.length > 0) {
			parameter.choices = choices;
		}
	}
	if (p.required === true) {
		parameter.required = true;
	}
	return parameter;
}

/** Coerces an unknown TOML value to a string, treating anything else as empty. */
function toStr(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

/** `true` when the parameter type is one of the known ones (see PARAMETER_TYPES). */
export function isKnownParameterType(type: string): boolean {
	return (PARAMETER_TYPES as readonly string[]).includes(type);
}

/**
 * Writes our generator model as TOML text — like table/toml.ts#serializeTable a
 * lean, fixed format. The Python bodies are stored as multi-line TOML strings
 * under `[code]`.
 */
export function serializeGenerator(generator: GeneratorFile): string {
	const lines: string[] = [];
	lines.push('# Datenschmiede Generator');
	lines.push(`name = ${tomlString(generator.name)}`);
	lines.push(`description = ${tomlString(generator.description)}`);

	for (const parameter of generator.parameters) {
		lines.push('');
		lines.push('[[parameters]]');
		lines.push(`name = ${tomlString(parameter.name)}`);
		lines.push(`type = ${tomlString(parameter.type || 'string')}`);
		lines.push(`description = ${tomlString(parameter.description)}`);
		if (parameter.choices && parameter.choices.length > 0) {
			lines.push(`choices = [${parameter.choices.map((c) => tomlString(c)).join(', ')}]`);
		}
		if (parameter.required) {
			lines.push('required = true');
		}
	}

	lines.push('');
	lines.push('[code]');
	if (generator.code.parameters.trim()) {
		// The verbatim body of the parameters() cell (the [[parameters]] blocks
		// above are the form derived from it).
		lines.push(`parameters = ${tomlString(ensureMultiline(generator.code.parameters))}`);
	}
	lines.push(`generate = ${tomlString(ensureMultiline(generator.code.generate))}`);
	lines.push(`parse_params = ${tomlString(ensureMultiline(generator.code.parseParams))}`);
	lines.push(`display_value = ${tomlString(ensureMultiline(generator.code.displayValue))}`);
	lines.push(`validate = ${tomlString(ensureMultiline(generator.code.validate))}`);
	if (generator.code.scratch.trim()) {
		lines.push(`scratch = ${tomlString(ensureMultiline(generator.code.scratch))}`);
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

/** Line position of a `[[parameters]]` block in the raw text, for diagnostics (counterpart to findColumnLineInfo in table/toml.ts). */
export interface ParameterLineInfo {
	/** 0-based line of the `[[parameters]]` marker itself. */
	parametersLine: number;
	/** 0-based line of the `name` entry inside that block, if present. */
	nameLine: number | null;
}

/** Determines the line position of every `[[parameters]]` block, in document order. */
export function findParameterLineInfo(text: string): ParameterLineInfo[] {
	const lines = text.split('\n');
	const result: ParameterLineInfo[] = [];
	let current: ParameterLineInfo | null = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (/^\s*\[\[parameters\]\]/.test(line)) {
			current = { parametersLine: i, nameLine: null };
			result.push(current);
			continue;
		}
		if (/^\s*\[/.test(line)) {
			// Next block (e.g. [code]) — the parameter section has ended.
			current = null;
			continue;
		}
		if (current && current.nameLine === null && /^\s*name\s*=/.test(line)) {
			current.nameLine = i;
		}
	}

	return result;
}
