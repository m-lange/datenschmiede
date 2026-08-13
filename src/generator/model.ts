/**
 * Datenmodell einer .tdgen-Datei (benutzerdefinierter Generator).
 *
 * Analog zu table/model.ts ist dieses Modell die "Wahrheit", mit der die
 * Generator-Editor-Webview arbeitet; es wird vom Extension-Host aus dem
 * TOML-Text erzeugt (siehe generator/toml.ts) und nach jeder Änderung wieder
 * zu TOML serialisiert.
 *
 * Der eigentliche Generier-Code steht als Python-Methodenrümpfe in `code`:
 * die Signaturen sind fest vorgegeben (siehe CODE_CELLS) und werden im
 * Editor als nicht änderbare Kopfzeile über dem editierbaren Rumpf gezeigt —
 * wie die festen Zellen eines Jupyter-Notebooks.
 */

import { GeneratorParameter } from './types';

/** Ein benutzerdefinierter Generator, wie er in einer .tdgen-Datei steht. */
export interface GeneratorFile {
	name: string;
	description: string;
	parameters: GeneratorParameter[];
	code: GeneratorCode;
}

/** Die Python-Methodenrümpfe der Code-Zellen (nur der Rumpf, ohne die feste Signatur). */
export interface GeneratorCode {
	/** Pflicht: erzeugt die Werte der Spalte (siehe GENERATE_SIGNATURE). */
	generate: string;
	/** Optional: wandelt die String-Parameterwerte in typisierte Werte um, bevor generate läuft. */
	parseParams: string;
	/** Optional: kompakter Anzeige-Text der Konfiguration für Lauf-Protokoll und Vorschau. */
	displayValue: string;
}

/** Feste, im Editor nicht änderbare Python-Signaturen der Code-Zellen. */
export const GENERATE_SIGNATURE = 'def generate(params: dict, n: int, ctx) -> "pandas.Series":';
export const PARSE_PARAMS_SIGNATURE = 'def parse_params(params: dict[str, str]) -> dict:';
export const DISPLAY_VALUE_SIGNATURE = 'def display_value(params: dict) -> str:';

/** Standard-Rümpfe für eine frisch angelegte .tdgen-Datei. */
export const DEFAULT_GENERATE_BODY = [
	'# params: parameter values (see parse_params), n: number of records to generate',
	'# ctx.rng: numpy Generator, ctx.pd/ctx.np: pandas/numpy,',
	'# ctx.column("name"): generated values of another column of this table',
	'return ctx.pd.Series(ctx.rng.integers(0, 100, size=n))',
].join('\n');

export const DEFAULT_PARSE_PARAMS_BODY = [
	'# All parameter values arrive as strings — convert them here if needed.',
	'return params',
].join('\n');

export const DEFAULT_DISPLAY_VALUE_BODY = ['return ", ".join(f"{k}: {v}" for k, v in params.items() if v)'].join('\n');

export function createEmptyGeneratorFile(name = ''): GeneratorFile {
	return {
		name,
		description: '',
		parameters: [],
		code: {
			generate: DEFAULT_GENERATE_BODY,
			parseParams: DEFAULT_PARSE_PARAMS_BODY,
			displayValue: DEFAULT_DISPLAY_VALUE_BODY,
		},
	};
}

export function createEmptyParameter(): GeneratorParameter {
	return { name: '', type: 'string', description: '' };
}
