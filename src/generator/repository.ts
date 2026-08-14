import * as vscode from 'vscode';
import { GeneratorBase } from './base';
import { BUILTIN_GENERATORS } from './builtins';
import { CustomGenerator } from './custom';
import { GeneratorFile } from './model';
import { parseGeneratorText } from './toml';
import { readFileText } from '../table/repository';
import { ParseError } from '../tomlUtil';

/**
 * A `.tdgen` file in the workspace, read raw and parsed — the custom generator
 * counterpart to TableEntry in table/repository.ts.
 */
export interface GeneratorEntry {
	uri: vscode.Uri;
	/** Workspace-relative path (POSIX separators), via `vscode.workspace.asRelativePath`. */
	relativePath: string;
	/** Raw text at the time it was read — lets diagnostics work without reading/parsing again. */
	text: string;
	/** The parsed generator, or `null` if the file is not valid TOML (or could not be read). */
	file: GeneratorFile | null;
	/** The parse error including its position if the TOML is broken (unset for read errors). */
	error: ParseError | null;
	/** The resolved generator (only when `file` is readable and has a name). */
	generator: CustomGenerator | null;
}

/** Builds the entry for a `.tdgen` file from its raw text (`text: null` = unreadable) — see buildTableEntry. */
export function buildGeneratorEntry(uri: vscode.Uri, relativePath: string, text: string | null): GeneratorEntry {
	if (text === null) {
		return { uri, relativePath, text: '', file: null, error: null, generator: null };
	}
	try {
		const file = parseGeneratorText(text);
		const generator = file.name.trim() ? new CustomGenerator(file) : null;
		return { uri, relativePath, text, file, error: null, generator };
	} catch (err) {
		const error = err instanceof ParseError ? err : new ParseError(err instanceof Error ? err.message : String(err));
		return { uri, relativePath, text, file: null, error, generator: null };
	}
}

/**
 * Reads and parses every `.tdgen` file in the workspace — like
 * table/repository.ts#listTables including the unsaved contents of open
 * editors; files with broken TOML stay in the list (with `file: null`). For the
 * lists needed continuously, the workspace index (src/workspaceIndex.ts) keeps
 * a shared cache.
 */
export async function listGenerators(): Promise<GeneratorEntry[]> {
	const uris = await vscode.workspace.findFiles('**/*.tdgen', '**/node_modules/**');
	return Promise.all(
		uris.map(async (uri): Promise<GeneratorEntry> => {
			const relativePath = vscode.workspace.asRelativePath(uri, false);
			const text = await readFileText(uri).catch(() => null);
			return buildGeneratorEntry(uri, relativePath, text);
		}),
	);
}

/**
 * Condenses workspace entries into the complete generator list (built-in ones
 * first, then the custom ones sorted by name; duplicates — two files with the
 * same name — collapse to the first match). Basis for the generator picker and
 * validation in the table editor as well as for building the generator run's
 * plan.
 */
export function toGeneratorList(entries: GeneratorEntry[]): GeneratorBase[] {
	const customs = new Map<string, CustomGenerator>();
	for (const entry of entries) {
		if (entry.generator && !customs.has(entry.generator.id)) {
			customs.set(entry.generator.id, entry.generator);
		}
	}
	const sorted = [...customs.values()].sort((a, b) => a.name.localeCompare(b.name));
	return [...BUILTIN_GENERATORS, ...sorted];
}
