import { parse, TomlError } from 'smol-toml';
import { GeneratorFile, createEmptyGeneratorFile } from './model';
import { GeneratorParameter, PARAMETER_TYPES } from './types';
import { ParseError, tomlString } from '../tomlUtil';

/** Liest den TOML-Text einer .tdgen-Datei in unser Generator-Modell ein. */
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

function toParameter(raw: unknown): GeneratorParameter {
	const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const type = toStr(p.type);
	const parameter: GeneratorParameter = {
		name: toStr(p.name),
		// Unbekannte Typen bleiben erhalten (statt sie stillschweigend zu
		// ersetzen) — die Webview zeigt sie mit an, die Validierung meldet sie.
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

function toStr(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

/** `true`, wenn der Parametertyp einer der bekannten ist (siehe PARAMETER_TYPES). */
export function isKnownParameterType(type: string): boolean {
	return (PARAMETER_TYPES as readonly string[]).includes(type);
}

/**
 * Schreibt unser Generator-Modell als TOML-Text — analog zu
 * table/toml.ts#serializeTable ein schlankes, festes Format. Die
 * Python-Rümpfe stehen als mehrzeilige TOML-Strings unter `[code]`.
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
		// Verbatim gespeicherter Rumpf der parameters()-Zelle (die
		// [[parameters]]-Blöcke oben sind die daraus abgeleitete Form).
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
 * Erzwingt für Code-Rümpfe die mehrzeilige TOML-String-Form (auch bei nur
 * einer Zeile), damit die Datei als Rohtext lesbar bleibt und ein
 * Speichern-Zyklus keine Formwechsel zwischen ein- und mehrzeilig erzeugt.
 */
function ensureMultiline(code: string): string {
	const text = code ?? '';
	return text.includes('\n') ? text : `${text}\n`;
}

/** Zeilenposition eines `[[parameters]]`-Blocks im Rohtext, für Diagnostics (Gegenstück zu findColumnLineInfo in table/toml.ts). */
export interface ParameterLineInfo {
	/** 0-basierte Zeile der `[[parameters]]`-Markierung selbst. */
	parametersLine: number;
	/** 0-basierte Zeile des `name`-Eintrags innerhalb dieses Blocks, falls vorhanden. */
	nameLine: number | null;
}

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
			// Nächster Block (z. B. [code]) — Parameter-Bereich zu Ende.
			current = null;
			continue;
		}
		if (current && current.nameLine === null && /^\s*name\s*=/.test(line)) {
			current.nameLine = i;
		}
	}

	return result;
}
