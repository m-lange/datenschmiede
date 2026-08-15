import * as vscode from 'vscode';
import * as path from 'path';
import { spawn } from 'child_process';
import { Project } from './model';
import { createStreamDecoder, pythonEnv } from '../encoding';
import { log } from '../outputChannel';

/**
 * The project's `requirements.txt`: packages a run needs beyond the built-in
 * ones (pandas/numpy, plus faker/openpyxl/duckdb where used) — typically
 * whatever a custom `.tdgen` or `.filegen` imports.
 *
 * Before a run the linked interpreter is checked against the file and anything
 * missing is offered for installation in a visible terminal, exactly like the
 * missing-package prompt of the runner itself. Nothing is installed silently.
 */

/** Outcome of the pre-run check. */
export type RequirementsCheck =
	| { kind: 'ok' }
	/** The configured file does not exist (or cannot be read). */
	| { kind: 'file-missing'; file: string }
	/** Distributions the interpreter does not have. */
	| { kind: 'missing'; file: string; packages: string[] };

/** Absolute path of the configured requirements file, or `null` when none is set. */
export function requirementsFile(projectUri: vscode.Uri, project: Project): string | null {
	const configured = project.requirements.trim();
	if (!configured) {
		return null;
	}
	const projectDir = vscode.Uri.joinPath(projectUri, '..').fsPath;
	return path.isAbsolute(configured) ? configured : path.resolve(projectDir, configured);
}

/**
 * Checks the linked interpreter against the requirements file.
 *
 * The check runs offline: the file's distribution names are looked up with
 * `importlib.metadata`, so it costs one short Python start and never touches
 * the network. Version specifiers are deliberately ignored — the point is to
 * catch "the package is not installed at all", which is what makes a generator
 * fail with ModuleNotFoundError.
 */
export async function checkRequirements(
	pythonPath: string,
	projectUri: vscode.Uri,
	project: Project,
): Promise<RequirementsCheck> {
	const file = requirementsFile(projectUri, project);
	if (!file) {
		return { kind: 'ok' };
	}
	try {
		await vscode.workspace.fs.stat(vscode.Uri.file(file));
	} catch {
		return { kind: 'file-missing', file };
	}

	const script = [
		'import sys, re',
		'from importlib.metadata import distribution, PackageNotFoundError',
		'missing = []',
		'with open(sys.argv[1], encoding="utf-8") as handle:',
		'    for raw in handle:',
		'        line = raw.split("#", 1)[0].strip()',
		// Options (-r, --index-url, …), editable installs and direct URLs are
		// skipped: their name cannot be derived reliably, and a wrong guess
		// would report a package as missing that is perfectly there.
		'        if not line or line.startswith("-") or "://" in line:',
		'            continue',
		'        name = re.split(r"[<>=!~\\[;]", line, maxsplit=1)[0].strip()',
		'        if not name:',
		'            continue',
		'        try:',
		'            distribution(name)',
		'        except PackageNotFoundError:',
		'            missing.append(name)',
		'print("\\n".join(missing))',
	].join('\n');

	const missing = await new Promise<string[]>((resolve) => {
		const child = spawn(pythonPath, ['-c', script, file], { env: pythonEnv() });
		const decode = createStreamDecoder();
		let stdout = '';
		child.stdout.on('data', (chunk: Buffer) => {
			stdout += decode(chunk);
		});
		// A failing check must not block the run — generation then reports the
		// real import error itself.
		child.on('error', () => resolve([]));
		child.on('close', () => resolve(stdout.split('\n').map((n) => n.trim()).filter((n) => n.length > 0)));
	});

	return missing.length > 0 ? { kind: 'missing', file, packages: missing } : { kind: 'ok' };
}

/**
 * Reports the check to the user and says whether the run may continue.
 * Installing happens visibly in a terminal, using exactly the interpreter the
 * project is linked to.
 */
export async function reportRequirements(
	check: RequirementsCheck,
	pythonPath: string,
): Promise<boolean> {
	if (check.kind === 'ok') {
		return true;
	}
	if (check.kind === 'file-missing') {
		void vscode.window.showErrorMessage(
			vscode.l10n.t('The requirements file "{0}" was not found.', check.file),
		);
		return false;
	}

	log(`Missing packages from ${check.file}: ${check.packages.join(', ')}`);
	const installLabel = vscode.l10n.t('Install packages');
	const choice = await vscode.window.showErrorMessage(
		vscode.l10n.t('Python packages from the project requirements are missing: {0}', check.packages.join(', ')),
		installLabel,
	);
	if (choice === installLabel) {
		// Visible in a terminal rather than hidden in the background — the same
		// treatment the runner gives its own missing packages.
		const terminal = vscode.window.createTerminal(vscode.l10n.t('Datenschmiede: Install packages'));
		terminal.show();
		terminal.sendText(`& "${pythonPath}" -m pip install -r "${check.file}"`);
	}
	return false;
}
