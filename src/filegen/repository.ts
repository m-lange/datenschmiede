import * as vscode from 'vscode';
import { FileGeneratorFile } from './model';
import { parseFileGeneratorText } from './toml';
import { readFileText } from '../table/repository';
import { ParseError } from '../tomlUtil';

/** A `.filegen` file in the workspace (counterpart to GeneratorEntry in generator/repository.ts). */
export interface FileGeneratorEntry {
	uri: vscode.Uri;
	/** Workspace-relative path (POSIX separators), via `vscode.workspace.asRelativePath`. */
	relativePath: string;
	/** Raw text at the time it was read. */
	text: string;
	/** The parsed file generator, or `null` if the file is not valid TOML (or could not be read). */
	file: FileGeneratorFile | null;
	/** The parse error including its position if the TOML is broken (unset for read errors). */
	error: ParseError | null;
}

/** Parses one `.filegen` file into a {@link FileGeneratorEntry}, capturing parse errors instead of throwing. */
export function buildFileGeneratorEntry(
	uri: vscode.Uri,
	relativePath: string,
	text: string | null,
): FileGeneratorEntry {
	if (text === null) {
		return { uri, relativePath, text: '', file: null, error: null };
	}
	try {
		return { uri, relativePath, text, file: parseFileGeneratorText(text), error: null };
	} catch (err) {
		const error = err instanceof ParseError ? err : new ParseError(err instanceof Error ? err.message : String(err));
		return { uri, relativePath, text, file: null, error };
	}
}

/** Reads all `.filegen` files of the workspace (used by the generator run and the preview). */
export async function listFileGenerators(): Promise<FileGeneratorEntry[]> {
	const uris = await vscode.workspace.findFiles('**/*.filegen', '**/node_modules/**');
	return Promise.all(
		uris.map(async (uri): Promise<FileGeneratorEntry> => {
			const relativePath = vscode.workspace.asRelativePath(uri, false);
			const text = await readFileText(uri).catch(() => null);
			return buildFileGeneratorEntry(uri, relativePath, text);
		}),
	);
}

/**
 * The readable file generators in plan format — the runner compiles the `write`
 * body and calls it once per table that points at the generator.
 */
export function toPlanFileGenerators(
	entries: FileGeneratorEntry[],
): { name: string; extension: string; structure: string; write: string }[] {
	const result: { name: string; extension: string; structure: string; write: string }[] = [];
	const seen = new Set<string>();
	for (const entry of entries) {
		const file = entry.file;
		const name = file?.name.trim();
		if (!file || !name || seen.has(name)) {
			continue;
		}
		seen.add(name);
		result.push({
			name,
			extension: (file.extension || 'txt').trim().replace(/^\./, '') || 'txt',
			structure: file.structure || 'none',
			write: file.code.write,
		});
	}
	return result;
}

/**
 * A file generator as the table editor needs it (a serializable description):
 * the file type picker lists these next to the built-in formats.
 */
export interface FileGeneratorOption {
	/** Logical name, as referenced by a table's `format = "custom:<name>"`. */
	name: string;
	description: string;
	/** Extension it writes, without the dot. */
	extension: string;
	/** Which structure tab tables using it get: "none" | "json" | "xml". */
	structure: string;
}

/**
 * Condenses the readable `.filegen` files into the picker list. Duplicate names
 * are deduplicated "first match wins" on the index's stable path order — the
 * same rule the other logical-name lookups use.
 */
export function toFileGeneratorOptions(entries: FileGeneratorEntry[]): FileGeneratorOption[] {
	const options: FileGeneratorOption[] = [];
	const seen = new Set<string>();
	for (const entry of entries) {
		const name = entry.file?.name.trim();
		if (!name || seen.has(name)) {
			continue;
		}
		seen.add(name);
		options.push({
			name,
			description: entry.file?.description ?? '',
			extension: (entry.file?.extension || 'txt').trim() || 'txt',
			structure: entry.file?.structure || 'none',
		});
	}
	return options;
}
