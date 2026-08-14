/**
 * Generic, format-agnostic TOML building blocks — shared by table/toml.ts (.td)
 * and project/toml.ts (.tdproject). Deliberately kept separate from both so
 * that a genuinely shared piece such as `ParseError` is not "hidden" inside one
 * of the two file-format-specific modules.
 */

/**
 * Thrown when the TOML text of a .td/.tdproject file cannot be parsed (for
 * example because the file was hand-edited into an invalid state).
 *
 * Deliberately free of any vscode dependency so it stays easy to test; the
 * caller (table/editorProvider.ts, project/editorProvider.ts) is responsible
 * for translating and formatting the message via vscode.l10n.
 */
export class ParseError extends Error {
	/** 1-based line the error occurred on, if known. */
	public readonly line?: number;
	/** 1-based column the error occurred on, if known. */
	public readonly column?: number;
	/** The TOML parser's original, untranslated message. */
	public readonly rawMessage: string;

	constructor(rawMessage: string, position?: { line: number; column: number }) {
		super(rawMessage);
		this.rawMessage = rawMessage;
		this.line = position?.line;
		this.column = position?.column;
	}
}

/** Formats a JS string as a TOML string (single-line or multi-line). */
export function tomlString(value: string): string {
	const text = value ?? '';
	if (!text.includes('\n')) {
		// Single-line "basic string": TOML's escape rules (\" \\ \n \t \r \b \f
		// \uXXXX) are exactly JSON's, so JSON.stringify is sufficient.
		return JSON.stringify(text);
	}

	// Multi-line "basic string", e.g. for descriptions containing line breaks.
	let body = text.replace(/\\/g, '\\\\');
	// An occurrence of """ inside the text would fake the end of the string ->
	// escape one quote to prevent that.
	body = body.replace(/"""/g, '""\\"');
	// If the text ends with a quote it would merge with the three closing
	// quotes -> escape it as well.
	if (body.endsWith('"')) {
		body = `${body.slice(0, -1)}\\"`;
	}
	// TOML strips the newline immediately following the opening """ while
	// parsing (which is convenient for readability here). It does NOT do so
	// before the closing """, so no extra newline may be inserted there —
	// otherwise the parsed value would differ after a save round-trip.
	return `"""\n${body}"""`;
}
