import * as vscode from 'vscode';
import { PythonExtension, type Environment } from '@vscode/python-extension';
import { PythonLink } from './model';

/**
 * Link between a test data project and a Python interpreter
 * (`ms-python.python`, see `extensionDependencies` in `package.json` — it is
 * installed/activated together with this extension). Deliberately uses the
 * official, typed `@vscode/python-extension` API instead of invoking
 * `python`/`python3` directly or guessing interpreter paths.
 */

/** Minimum version required by this extension (see the rationale in the README). */
const MIN_PYTHON = { major: 3, minor: 10 };

let cachedApi: Promise<PythonExtension | undefined> | undefined;

/**
 * Fetches the Python extension's API. Kept defensive: returns `undefined`
 * instead of throwing if the extension could not be activated — callers show a
 * suitable message themselves in that case.
 */
export function getPythonApi(): Promise<PythonExtension | undefined> {
	if (!cachedApi) {
		cachedApi = PythonExtension.api()
			.then(async (api) => {
				await api.ready;
				return api;
			})
			.catch(() => undefined);
	}
	return cachedApi;
}

/** Whether an environment's version is at least `min` (unknown versions count as too old). */
function versionAtLeast(version: Environment['version'], min: { major: number; minor: number }): boolean {
	if (!version || version.major === undefined || version.minor === undefined) {
		return false;
	}
	return version.major > min.major || (version.major === min.major && version.minor >= min.minor);
}

/** "major.minor.micro" for display; unknown parts render as "?". */
function formatVersion(version: Environment['version']): string {
	if (!version || version.major === undefined) {
		return vscode.l10n.t('unknown version');
	}
	return `${version.major}.${version.minor ?? '?'}.${version.micro ?? '?'}`;
}

/** Display label of an environment: its name (or type) plus the version. */
function environmentLabel(env: Environment): string {
	const name = env.environment?.name?.trim();
	return `${name || env.environment?.type || vscode.l10n.t('Interpreter')} — ${formatVersion(env.version)}`;
}

/**
 * Opens a QuickPick over every environment the Python extension knows about —
 * discovery and resolution are entirely its job; a compact list of our own is
 * built here (rather than delegating to the built-in `python.setInterpreter`
 * command) because the result is written into the `.tdproject` file, not into
 * the workspace-wide interpreter setting. Valid (>= Python 3.10) environments
 * are listed first.
 */
export async function pickPythonInterpreter(): Promise<PythonLink | undefined> {
	const api = await getPythonApi();
	if (!api) {
		void vscode.window.showErrorMessage(
			vscode.l10n.t('The Python extension (ms-python.python) is not available. Please install/enable it and try again.'),
		);
		return undefined;
	}

	await api.environments.refreshEnvironments();
	const known = [...api.environments.known].sort((a, b) => {
		const aOk = versionAtLeast(a.version, MIN_PYTHON);
		const bOk = versionAtLeast(b.version, MIN_PYTHON);
		if (aOk !== bOk) {
			return aOk ? -1 : 1;
		}
		return environmentLabel(a).localeCompare(environmentLabel(b));
	});

	if (known.length === 0) {
		void vscode.window.showWarningMessage(
			vscode.l10n.t('No Python interpreters were found. Install Python 3.10 or newer, then try again.'),
		);
		return undefined;
	}

	const items: (vscode.QuickPickItem & { env: Environment })[] = known.map((env) => {
		const ok = versionAtLeast(env.version, MIN_PYTHON);
		return {
			env,
			label: `${ok ? '$(check)' : '$(warning)'} ${environmentLabel(env)}`,
			description: env.path,
			detail: ok ? undefined : vscode.l10n.t('Older than Python 3.10 — not recommended for this extension.'),
		};
	});

	const picked = await vscode.window.showQuickPick(items, {
		title: vscode.l10n.t('Select Python Interpreter'),
		placeHolder: vscode.l10n.t('Select the Python interpreter to use for this test data project'),
		matchOnDescription: true,
	});
	return picked ? { path: picked.env.path, id: picked.env.id } : undefined;
}

/**
 * Asks for a Python interpreter when a project is opened and none is linked
 * yet. `applyLink` performs the actual write into the `.tdproject` file (the
 * WorkspaceEdit lives in project/editorProvider.ts).
 */
export async function ensurePythonLinked(
	current: PythonLink | null,
	applyLink: (link: PythonLink) => Promise<void>,
): Promise<void> {
	if (current) {
		return;
	}
	const selectLabel = vscode.l10n.t('Select Interpreter');
	const laterLabel = vscode.l10n.t('Later');
	const choice = await vscode.window.showInformationMessage(
		vscode.l10n.t('This test data project has no linked Python interpreter yet. Select one now?'),
		selectLabel,
		laterLabel,
	);
	if (choice !== selectLabel) {
		return;
	}
	const link = await pickPythonInterpreter();
	if (link) {
		await applyLink(link);
	}
}

/** Display-ready resolution of a stored `PythonLink`, for the project webview's overview. */
export interface ResolvedPythonStatus {
	path: string;
	/** Display name including the version, or — if unresolvable — simply the stored path. */
	label: string;
	/** `true` if the Python extension could map the stored path to a known environment. */
	resolved: boolean;
	/** `true` if resolved AND at least Python 3.10. */
	ok: boolean;
}

/** Resolves a project's stored interpreter link into its display status. */
export async function resolveLinkedInterpreter(link: PythonLink): Promise<ResolvedPythonStatus> {
	const api = await getPythonApi();
	if (!api) {
		return { path: link.path, label: link.path, resolved: false, ok: false };
	}
	try {
		const resolved = await api.environments.resolveEnvironment(link.path);
		if (!resolved) {
			return { path: link.path, label: link.path, resolved: false, ok: false };
		}
		return { path: link.path, label: environmentLabel(resolved), resolved: true, ok: versionAtLeast(resolved.version, MIN_PYTHON) };
	} catch {
		return { path: link.path, label: link.path, resolved: false, ok: false };
	}
}

/**
 * Best available interpreter without a project context (for the table preview,
 * see table/preview.ts): first the environment active in VS Code, otherwise the
 * first known environment with Python 3.10+. `null` if no usable environment
 * was found.
 */
export async function resolveAnyInterpreter(): Promise<ResolvedPythonStatus | null> {
	const api = await getPythonApi();
	if (!api) {
		return null;
	}
	try {
		const active = await api.environments.resolveEnvironment(api.environments.getActiveEnvironmentPath());
		if (active && versionAtLeast(active.version, MIN_PYTHON)) {
			return { path: active.path, label: environmentLabel(active), resolved: true, ok: true };
		}
	} catch {
		// Active environment not resolvable -> fall back to the known list below.
	}
	const known = api.environments.known.find((env) => versionAtLeast(env.version, MIN_PYTHON));
	return known ? { path: known.path, label: environmentLabel(known), resolved: true, ok: true } : null;
}

/**
 * Best-effort check on extension activation: warns (once per session) if no
 * Python 3.10+ installation could be found. There is no VS Code API to install
 * one, so the user is pointed at python.org instead.
 */
export async function checkPython310Available(): Promise<void> {
	const api = await getPythonApi();
	if (!api) {
		return;
	}
	// If the Python extension already knows a modern environment (from its
	// persisted state) there is nothing to do — the full environment scan
	// (refreshEnvironments, expensive: it searches the disk) only runs in the
	// case where we would otherwise warn incorrectly.
	if (api.environments.known.some((env) => versionAtLeast(env.version, MIN_PYTHON))) {
		return;
	}
	try {
		await api.environments.refreshEnvironments();
	} catch {
		// The scan could not complete -> continue with the state already known.
	}
	const hasModernPython = api.environments.known.some((env) => versionAtLeast(env.version, MIN_PYTHON));
	if (hasModernPython) {
		return;
	}
	const openLabel = vscode.l10n.t('Open python.org');
	const choice = await vscode.window.showWarningMessage(
		vscode.l10n.t('No Python 3.10 or newer installation was found. Datenschmiede test data generation requires Python 3.10+.'),
		openLabel,
	);
	if (choice === openLabel) {
		void vscode.env.openExternal(vscode.Uri.parse('https://www.python.org/downloads/'));
	}
}
