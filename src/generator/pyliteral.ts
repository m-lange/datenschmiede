/**
 * Kleiner Parser für Python-*Literale* — das TypeScript-Gegenstück zu
 * `ast.literal_eval`: versteht dicts, Listen, Tupel, Strings (einfach/
 * doppelt, auch triple-quoted), Zahlen, True/False/None, Kommentare und
 * hängende Kommata. Bewusst NICHT mehr (keine Ausdrücke, Aufrufe,
 * Variablen) — genutzt vom Notebook-Serializer, um aus dem `return [...]`
 * der `parameters()`-Zelle die deklarativen `[[parameters]]`-Blöcke der
 * `.tdgen`-Datei abzuleiten (siehe generator/notebookCells.ts). Gibt der
 * Code kein Literal zurück, bleibt die zuletzt abgeleitete Liste erhalten
 * und die Hintergrund-Prüfung meldet es.
 *
 * Bewusst frei von jeder vscode-Abhängigkeit (einfach testbar).
 */

export type PyValue = string | number | boolean | null | PyValue[] | { [key: string]: PyValue };

class PyLiteralError extends Error {}

/**
 * Extrahiert den Ausdruck des ersten `return` auf oberster Zeilenebene
 * eines Methodenrumpfs und parst ihn als Literal. `null`, wenn kein
 * `return` gefunden wird oder der Ausdruck kein reines Literal ist.
 */
export function parseReturnLiteral(body: string): PyValue | null {
	const match = /(^|\n)[ \t]*return\b/.exec(body ?? '');
	if (!match) {
		return null;
	}
	const expression = body.slice(match.index + match[0].length);
	try {
		const parser = new Parser(expression);
		const value = parser.parseValue();
		// Nachfolgender Rest (weitere Anweisungen) ist erlaubt und wird ignoriert.
		return value;
	} catch (err) {
		if (err instanceof PyLiteralError) {
			return null;
		}
		throw err;
	}
}

class Parser {
	private pos = 0;

	constructor(private readonly text: string) {}

	public parseValue(): PyValue {
		this.skipWhitespace();
		const c = this.peek();
		if (c === '{') {
			return this.parseDict();
		}
		if (c === '[') {
			return this.parseList(']');
		}
		if (c === '(') {
			return this.parseList(')');
		}
		if (c === '"' || c === "'") {
			return this.parseString();
		}
		if (c === '-' || c === '+' || (c >= '0' && c <= '9') || c === '.') {
			return this.parseNumber();
		}
		if (this.text.startsWith('True', this.pos)) {
			this.pos += 4;
			return true;
		}
		if (this.text.startsWith('False', this.pos)) {
			this.pos += 5;
			return false;
		}
		if (this.text.startsWith('None', this.pos)) {
			this.pos += 4;
			return null;
		}
		throw new PyLiteralError(`unexpected character at ${this.pos}`);
	}

	private parseDict(): { [key: string]: PyValue } {
		this.expect('{');
		const result: { [key: string]: PyValue } = {};
		this.skipWhitespace();
		if (this.peek() === '}') {
			this.pos++;
			return result;
		}
		for (;;) {
			this.skipWhitespace();
			const key = this.parseValue();
			if (typeof key !== 'string') {
				throw new PyLiteralError('dict keys must be strings');
			}
			this.skipWhitespace();
			this.expect(':');
			const value = this.parseValue();
			result[key] = value;
			this.skipWhitespace();
			if (this.peek() === ',') {
				this.pos++;
				this.skipWhitespace();
				if (this.peek() === '}') {
					this.pos++;
					return result;
				}
				continue;
			}
			this.expect('}');
			return result;
		}
	}

	private parseList(close: string): PyValue[] {
		this.pos++; // öffnende Klammer
		const result: PyValue[] = [];
		this.skipWhitespace();
		if (this.peek() === close) {
			this.pos++;
			return result;
		}
		for (;;) {
			result.push(this.parseValue());
			this.skipWhitespace();
			if (this.peek() === ',') {
				this.pos++;
				this.skipWhitespace();
				if (this.peek() === close) {
					this.pos++;
					return result;
				}
				continue;
			}
			this.expect(close);
			return result;
		}
	}

	private parseString(): string {
		const quote = this.peek();
		const triple = this.text.startsWith(quote.repeat(3), this.pos);
		const delimiter = triple ? quote.repeat(3) : quote;
		this.pos += delimiter.length;
		let result = '';
		while (this.pos < this.text.length) {
			if (this.text.startsWith(delimiter, this.pos)) {
				this.pos += delimiter.length;
				return result;
			}
			const c = this.text[this.pos];
			if (c === '\\') {
				const next = this.text[this.pos + 1];
				const escapes: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', '0': '\0' };
				if (next in escapes) {
					result += escapes[next];
					this.pos += 2;
					continue;
				}
				if (next === 'u') {
					const hex = this.text.slice(this.pos + 2, this.pos + 6);
					result += String.fromCharCode(parseInt(hex, 16));
					this.pos += 6;
					continue;
				}
				result += c + (next ?? '');
				this.pos += 2;
				continue;
			}
			if (!triple && c === '\n') {
				throw new PyLiteralError('unterminated string');
			}
			result += c;
			this.pos++;
		}
		throw new PyLiteralError('unterminated string');
	}

	private parseNumber(): number {
		const match = /^[+-]?(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?/.exec(this.text.slice(this.pos));
		if (!match) {
			throw new PyLiteralError(`invalid number at ${this.pos}`);
		}
		this.pos += match[0].length;
		return Number(match[0].replace(/_/g, ''));
	}

	private skipWhitespace(): void {
		for (;;) {
			const c = this.peek();
			if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
				this.pos++;
				continue;
			}
			if (c === '#') {
				while (this.pos < this.text.length && this.text[this.pos] !== '\n') {
					this.pos++;
				}
				continue;
			}
			return;
		}
	}

	private peek(): string {
		if (this.pos >= this.text.length) {
			throw new PyLiteralError('unexpected end of input');
		}
		return this.text[this.pos];
	}

	private expect(c: string): void {
		if (this.peek() !== c) {
			throw new PyLiteralError(`expected "${c}" at ${this.pos}`);
		}
		this.pos++;
	}
}
