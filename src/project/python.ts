import * as vscode from 'vscode';
import { PythonExtension, type Environment } from '@vscode/python-extension';
import { PythonLink } from './model';

/**
 * Verbindung zwischen einem Testdatenprojekt und einem Python-Interpreter
 * (`ms-python.python`, siehe `package.json` `extensionDependencies` — wird
 * zusammen mit dieser Extension installiert/aktiviert). Nutzt bewusst die
 * offizielle, typisierte `@vscode/python-extension`-API statt selbst
 * `python`/`python3` aufzurufen oder Interpreter-Pfade zu raten.
 */

/** Von dieser Extension vorausgesetzte Mindestversion (siehe README-Begründung). */
const MIN_PYTHON = { major: 3, minor: 10 };

let cachedApi: Promise<PythonExtension | undefined> | undefined;

/**
 * Holt die API der Python-Extension. Defensiv gehalten: liefert `undefined`
 * statt zu werfen, falls die Extension (noch) nicht aktiviert werden konnte —
 * Aufrufer zeigen in dem Fall selbst eine passende Meldung.
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

function versionAtLeast(version: Environment['version'], min: { major: number; minor: number }): boolean {
	if (!version || version.major === undefined || version.minor === undefined) {
		return false;
	}
	return version.major > min.major || (version.major === min.major && version.minor >= min.minor);
}

function formatVersion(version: Environment['version']): string {
	if (!version || version.major === undefined) {
		return vscode.l10n.t('unknown version');
	}
	return `${version.major}.${version.minor ?? '?'}.${version.micro ?? '?'}`;
}

function environmentLabel(env: Environment): string {
	const name = env.environment?.name?.trim();
	return `${name || env.environment?.type || vscode.l10n.t('Interpreter')} — ${formatVersion(env.version)}`;
}

/**
 * Öffnet eine QuickPick-Auswahl über alle von der Python-Extension bekannten
 * Umgebungen — Erkennung/Auflösung übernimmt vollständig sie selbst, hier
 * wird nur eine eigene, kompakte Liste gebaut (statt z. B. den eingebauten
 * Befehl `python.setInterpreter` zu delegieren), weil das Ergebnis in die
 * `.tdproject`-Datei geschrieben wird, nicht in die Workspace-weite
 * Interpreter-Einstellung. Gültige (>= Python 3.10) Umgebungen erscheinen
 * zuerst.
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
 * Fragt beim Öffnen eines Projekts nach einem Python-Interpreter, falls noch
 * keiner verknüpft ist. `applyLink` übernimmt das eigentliche Schreiben in
 * die `.tdproject`-Datei (WorkspaceEdit liegt bei project/editorProvider.ts).
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

/** Anzeige-taugliche Auflösung eines gespeicherten `PythonLink`, für die Übersicht der Projekt-Webview. */
export interface ResolvedPythonStatus {
	path: string;
	/** Anzeigename inkl. Version, oder — falls nicht auflösbar — einfach der gespeicherte Pfad. */
	label: string;
	/** `true`, wenn die Python-Extension den gespeicherten Pfad einer bekannten Umgebung zuordnen konnte. */
	resolved: boolean;
	/** `true`, wenn aufgelöst UND mindestens Python 3.10. */
	ok: boolean;
}

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
 * Best-effort-Prüfung beim Aktivieren der Extension: warnt (einmal pro
 * Sitzung), falls keine Python-3.10+-Installation gefunden werden konnte. Sie
 * selbst zu installieren gibt es keine VS-Code-API dafür — stattdessen wird
 * auf python.org verwiesen ("if possible" aus der Anforderung).
 */
export async function checkPython310Available(): Promise<void> {
	const api = await getPythonApi();
	if (!api) {
		return;
	}
	try {
		await api.environments.refreshEnvironments();
	} catch {
		// Scan konnte nicht abgeschlossen werden -> mit dem bereits bekannten Stand weiterarbeiten.
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
