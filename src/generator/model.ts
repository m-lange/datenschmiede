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
	/**
	 * Rumpf der `parameters()`-Zelle: gibt die Parameterdefinitionen als
	 * Literal-Liste von dicts zurück (siehe PARAMETERS_SIGNATURE). Der Code
	 * wird verbatim gespeichert; beim Speichern des Notebooks leitet der
	 * Serializer daraus die deklarativen `[[parameters]]`-Blöcke ab, mit
	 * denen Table Editor, Validierung und Plan arbeiten (siehe
	 * generator/pyliteral.ts). Leer -> die Zelle wird aus den
	 * `[[parameters]]`-Blöcken erzeugt.
	 */
	parameters: string;
	/** Pflicht: erzeugt die Werte der Spalte (siehe GENERATE_SIGNATURE). */
	generate: string;
	/** Optional: wandelt die String-Parameterwerte in typisierte Werte um, bevor generate läuft. */
	parseParams: string;
	/** Optional: kompakter Anzeige-Text der Konfiguration für Lauf-Protokoll und Vorschau. */
	displayValue: string;
	/**
	 * Optional: eigene Prüfung der Parameterwerte — liefert eine Liste von
	 * Warnungs-Texten (leer = alles in Ordnung). Wird von der Workspace-
	 * Hintergrund-Prüfung für jede Spalte ausgeführt, die diesen Generator
	 * verwendet, und erscheint an der Spalte in der Problems-Ansicht
	 * (siehe src/diagnostics.ts).
	 */
	validate: string;
	/**
	 * Freie Notebook-Zelle für Testwerte und Experimente (z. B.
	 * `params = {...}` und `n = 10` für die Ausführung der Methoden-Zellen)
	 * — wird gespeichert, aber vom Generator-Lauf ignoriert.
	 */
	scratch: string;
}

/** Feste Python-Signaturen der Code-Zellen (im Notebook die jeweils erste Zeile der Zelle). */
export const PARAMETERS_SIGNATURE = 'def parameters() -> "list[dict]":';
export const GENERATE_SIGNATURE = 'def generate(params: dict, n: int, ctx) -> "pandas.Series":';
export const PARSE_PARAMS_SIGNATURE = 'def parse_params(params: dict[str, str]) -> dict:';
export const DISPLAY_VALUE_SIGNATURE = 'def display_value(params: dict) -> str:';
export const VALIDATE_SIGNATURE = 'def validate(params: dict[str, str]) -> "list[str]":';

/**
 * Standard-Rümpfe für eine frisch angelegte .tdgen-Datei — bewusst mit
 * Beispiel-Kommentaren, damit der Notebook-Editor die wichtigsten
 * Möglichkeiten (ctx-API, typische Muster) direkt in den Code-Zellen zeigt.
 */
export const DEFAULT_GENERATE_BODY = [
	'# params: parameter values (see parse_params), n: number of records to generate',
	'# ctx.rng: numpy Generator, ctx.pd/ctx.np: pandas/numpy, ctx.faker(locale): Faker',
	'# Examples:',
	'#   return ctx.pd.Series([f"X-{v:06d}" for v in ctx.rng.integers(0, 10**6, size=n)])',
	'#   return ctx.pd.Series([ctx.faker("de_DE").first_name() for _ in range(n)])',
	'#   prices = ctx.column("price")                    # own column, same records',
	'#   cities = ctx.lookup_value("cities", "name")     # row-consistent lookup draw',
	'#   skus = ctx.table("shop.products", "sku")        # values of another table',
	'return ctx.pd.Series(ctx.rng.integers(0, 100, size=n))',
].join('\n');

export const DEFAULT_PARSE_PARAMS_BODY = [
	'# All parameter values arrive as strings — convert them here if needed.',
	'# Example:',
	'#   return {**params, "digits": int(params.get("digits", "") or 6)}',
	'return params',
].join('\n');

export const DEFAULT_DISPLAY_VALUE_BODY = [
	'# One-line summary of a configuration for the table editor, run log and preview.',
	'# Example:',
	'#   return f"{params.get(\'prefix\', \'?\')}-000001…"',
	'return ", ".join(f"{k}: {v}" for k, v in params.items() if v)',
].join('\n');

export const DEFAULT_VALIDATE_BODY = [
	'# Return a list of warning texts for the current parameter values (empty = ok).',
	'# Example:',
	'#   if not (params.get("prefix") or "").strip():',
	'#       return ["prefix must not be empty"]',
	'return []',
].join('\n');

export function createEmptyGeneratorFile(name = ''): GeneratorFile {
	return {
		name,
		description: '',
		parameters: [],
		code: {
			parameters: '',
			generate: DEFAULT_GENERATE_BODY,
			parseParams: DEFAULT_PARSE_PARAMS_BODY,
			displayValue: DEFAULT_DISPLAY_VALUE_BODY,
			validate: DEFAULT_VALIDATE_BODY,
			scratch: '',
		},
	};
}

export function createEmptyParameter(): GeneratorParameter {
	return { name: '', type: 'string', description: '' };
}
