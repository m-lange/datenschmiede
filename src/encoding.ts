/**
 * Encoding rules for the whole extension, in one place.
 *
 * Every file that belongs to a project (`.td`, `.tdproject`, `.lkp`, `.tdgen`,
 * the plan handed to Python) is read and written as UTF-8 without a byte order
 * mark, and the JSON protocol between the extension host and the Python runner
 * is UTF-8 in both directions. The single exception is the generated CSV: it
 * is written with the encoding configured for the table
 * (`Table.output.csv.encoding`, see python/generate.py → write_csv).
 */

/**
 * Decodes file contents as UTF-8. A leading byte order mark is dropped by
 * TextDecoder itself, so a file saved as "UTF-8 with BOM" does not put a stray
 * U+FEFF in front of the first TOML key.
 */
export function decodeUtf8(bytes: Uint8Array): string {
	return new TextDecoder('utf-8').decode(bytes);
}

/** Encodes text as UTF-8 without a byte order mark — for `vscode.workspace.fs.writeFile`. */
export function encodeUtf8(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

/**
 * Decoder for one stream of a child process (stdout or stderr).
 *
 * A chunk boundary can fall in the middle of a multi-byte UTF-8 sequence — an
 * "ä" split across two `data` events — which `chunk.toString('utf8')` would
 * turn into replacement characters. That is why every chunk goes through the
 * same streaming TextDecoder: it holds on to the incomplete bytes until the
 * rest of the character arrives.
 */
export function createStreamDecoder(): (chunk: Buffer) => string {
	const decoder = new TextDecoder('utf-8');
	return (chunk) => decoder.decode(chunk, { stream: true });
}

/**
 * Environment for the Python child processes.
 *
 * `PYTHONIOENCODING` makes the interpreter use UTF-8 for stdin/stdout/stderr
 * instead of the Windows console code page (cp1252 in a German locale), which
 * is what turns umlauts in the event protocol — the table preview, log lines,
 * tracebacks — into garbage. Only the standard streams are affected; the
 * encoding a CSV is written with remains the configured one. The Python side
 * additionally reconfigures its streams itself, so an interpreter started
 * without this environment behaves the same way.
 */
export function pythonEnv(): NodeJS.ProcessEnv {
	return { ...process.env, PYTHONIOENCODING: 'utf-8' };
}
