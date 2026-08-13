/**
 * Generische, formatunabhängige TOML-Bausteine — gemeinsam genutzt von
 * table/toml.ts (.td) und project/toml.ts (.tdproject). Bewusst getrennt von
 * beiden, damit ein wirklich geteilter Baustein wie `ParseError` nicht in
 * einer der beiden dateiformat-spezifischen Dateien "versteckt" liegt.
 */

/**
 * Wird geworfen, wenn der TOML-Text einer .td-/.tdproject-Datei nicht
 * geparst werden kann (z. B. weil die Datei von Hand fehlerhaft bearbeitet
 * wurde).
 *
 * Bewusst frei von jeder vscode-Abhängigkeit gehalten (einfach testbar);
 * die Übersetzung/Formatierung der Meldung übernimmt der jeweilige Aufrufer
 * (table/editorProvider.ts/project/editorProvider.ts) über vscode.l10n.
 */
export class ParseError extends Error {
	/** 1-basierte Zeile, an der der Fehler auftrat (falls bekannt). */
	public readonly line?: number;
	/** 1-basierte Spalte, an der der Fehler auftrat (falls bekannt). */
	public readonly column?: number;
	/** Ursprüngliche, unübersetzte Meldung des TOML-Parsers. */
	public readonly rawMessage: string;

	constructor(rawMessage: string, position?: { line: number; column: number }) {
		super(rawMessage);
		this.rawMessage = rawMessage;
		this.line = position?.line;
		this.column = position?.column;
	}
}

/** Formatiert einen JS-String als TOML-String (einzeilig oder mehrzeilig). */
export function tomlString(value: string): string {
	const text = value ?? '';
	if (!text.includes('\n')) {
		// Einzeiliger "basic string": TOMLs Escape-Regeln (\" \\ \n \t \r \b \f \uXXXX)
		// entsprechen exakt denen von JSON, daher genügt JSON.stringify.
		return JSON.stringify(text);
	}

	// Mehrzeiliger "basic string" für z. B. Beschreibungen mit Zeilenumbrüchen.
	let body = text.replace(/\\/g, '\\\\');
	// Ein Vorkommen von """ innerhalb des Texts würde das Ende des Strings
	// vortäuschen -> ein Anführungszeichen escapen, um das zu vermeiden.
	body = body.replace(/"""/g, '""\\"');
	// Endet der Text auf ein Anführungszeichen, würde es mit den drei
	// schließenden Anführungszeichen verschmelzen -> ebenfalls escapen.
	if (body.endsWith('"')) {
		body = `${body.slice(0, -1)}\\"`;
	}
	// Der Zeilenumbruch direkt nach dem öffnenden """ wird von TOML beim
	// Parsen automatisch entfernt (praktisch für die Lesbarkeit hier).
	// Vor dem schließenden """ passiert das NICHT, daher darf dort kein
	// zusätzlicher Zeilenumbruch eingefügt werden, sonst wäre der
	// geparste Wert nach einem Speichern-Zyklus nicht mehr identisch.
	return `"""\n${body}"""`;
}
