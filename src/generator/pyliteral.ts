/**
 * A small parser for Python *literals* — the TypeScript counterpart to
 * `ast.literal_eval`: it understands dicts, lists, tuples, strings (single and
 * double quoted, including triple-quoted), numbers, True/False/None, comments
 * and trailing commas. Deliberately NOT more (no expressions, calls or
 * variables) — used by the notebook serializer to derive the declarative
 * `[[parameters]]` blocks of the `.tdgen` file from the `return [...]` of the
 * `parameters()` cell (see generator/notebookCells.ts). If the code does not
 * return a literal, the last derived list is kept and the background validation
 * reports it.
 *
 * Deliberately free of any vscode dependency (easy to test).
 */

/** Any value a Python literal can evaluate to. */
export type PyValue = string | number | boolean | null | PyValue[] | { [key: string]: PyValue };

/** Internal signal that the input is not a pure literal; never escapes this module. */
class PyLiteralError extends Error {}

/**
 * Extracts the expression of the first top-level `return` in a method body and
 * parses it as a literal. `null` if no `return` is found or the expression is
 * not a pure literal.
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
		// Trailing content (further statements) is allowed and ignored.
		return value;
	} catch (err) {
		if (err instanceof PyLiteralError) {
			return null;
		}
		throw err;
	}
}

/** Recursive-descent parser over the literal grammar; `pos` is the read cursor. */
class Parser {
	private pos = 0;

	constructor(private readonly text: string) {}

	/** Parses one value, dispatching on the next character. */
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

	/** `{ "key": value, … }` — keys must be strings, a trailing comma is allowed. */
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

	/** `[…]` or `(…)` — `close` is the expected closing bracket; a trailing comma is allowed. */
	private parseList(close: string): PyValue[] {
		this.pos++; // opening bracket
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

	/** Single- or double-quoted string, optionally triple-quoted, with the usual escapes. */
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

	/** Integer or float, including Python's `_` digit separators and exponents. */
	private parseNumber(): number {
		const match = /^[+-]?(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?/.exec(this.text.slice(this.pos));
		if (!match) {
			throw new PyLiteralError(`invalid number at ${this.pos}`);
		}
		this.pos += match[0].length;
		return Number(match[0].replace(/_/g, ''));
	}

	/** Advances past whitespace and `#` comments. */
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

	/** Current character; throws at end of input. */
	private peek(): string {
		if (this.pos >= this.text.length) {
			throw new PyLiteralError('unexpected end of input');
		}
		return this.text[this.pos];
	}

	/** Consumes the expected character or fails. */
	private expect(c: string): void {
		if (this.peek() !== c) {
			throw new PyLiteralError(`expected "${c}" at ${this.pos}`);
		}
		this.pos++;
	}
}
