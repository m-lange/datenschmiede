import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { Table } from '../table/model';
import type { Plan, PlanTable } from './run';
import { getOutputChannel, log, showErrorWithDetails } from '../outputChannel';

/**
 * Gemeinsame Bausteine für die beiden Aufrufer des Python-Läufers
 * (python/generate.py): der volle Generator-Lauf (project/run.ts) und die
 * Tabellen-Vorschau (table/preview.ts). Hier liegt alles, was beide gleich
 * machen — Plan-Datei schreiben, Prozess starten, JSON-Zeilen-Protokoll
 * lesen, `log`-/`error`-Events behandeln, aufräumen — damit es nicht in
 * beiden Dateien doppelt gepflegt werden muss.
 */

/** Ausgabe-Konfiguration einer Tabelle im Plan-Format (Gegenstück zu Table.output, snake_case für Python). */
export function toPlanOutput(table: Table): PlanTable['output'] {
	return {
		file_name: table.output.fileName,
		format: table.output.format || 'csv',
		csv: {
			delimiter: table.output.csv.delimiter,
			quote_all: table.output.csv.quoteAll,
			decimal: table.output.csv.decimal,
			date_format: table.output.csv.dateFormat,
			datetime_format: table.output.csv.datetimeFormat,
			include_header: table.output.csv.includeHeader,
			encoding: table.output.csv.encoding,
		},
	};
}

/** Schreibt den Plan als JSON in den globalen Extension-Speicher (kein Teil des Workspace); gelöscht wird er von runPlanProcess. */
export async function writePlanFile(
	context: vscode.ExtensionContext,
	plan: Plan,
	prefix: string,
): Promise<vscode.Uri> {
	await vscode.workspace.fs.createDirectory(context.globalStorageUri);
	const planUri = vscode.Uri.joinPath(context.globalStorageUri, `${prefix}-${Date.now()}.json`);
	await vscode.workspace.fs.writeFile(planUri, Buffer.from(JSON.stringify(plan), 'utf8'));
	return planUri;
}

export interface PlanProcessOptions {
	/** Interpreter, mit dem python/generate.py gestartet wird. */
	pythonPath: string;
	context: vscode.ExtensionContext;
	/** Die von writePlanFile geschriebene Plan-Datei — wird nach dem Lauf gelöscht. */
	planUri: vscode.Uri;
	/** Arbeitsverzeichnis des Läufers (Ordner der Projekt-/Tabellendatei). */
	cwd: string;
	/** Abbruch über die VS-Code-Fortschrittsanzeige (nur beim vollen Lauf). */
	token?: vscode.CancellationToken;
	/** Zusätzliches Protokoll beim Abbruch (z. B. „Run … cancelled“). */
	onCancel?: () => void;
	/** Formatiert die Notification eines `error`-Events (Details stehen im Output-Channel). */
	errorMessage: (message: string) => string;
	/** Alle übrigen Events (table_start, table_done, done, preview, …) — `log` und `error` behandelt der Läufer selbst. */
	onEvent: (event: Record<string, unknown>) => void;
}

export interface PlanProcessResult {
	code: number | null;
	cancelled: boolean;
	/** `true`, wenn bereits eine Fehlermeldung angezeigt wurde (error-Event oder Startfehler) — dann keine zweite zeigen. */
	reportedError: boolean;
	stderrText: string;
}

/**
 * Startet python/generate.py mit einer Plan-Datei und übersetzt sein
 * JSON-Zeilen-Protokoll (stdout):
 *
 * - `log`-Events (ctx.log(...) aus benutzerdefinierten Generatoren) landen
 *   im Output-Channel „Datenschmiede“, ebenso der komplette stderr.
 * - `error`-Events werden als Notification gemeldet (Wortlaut über
 *   `errorMessage`), inklusive Traceback im Output-Channel; fehlen
 *   Python-Pakete (`missing-packages`), bietet die Notification an, sie
 *   sichtbar in einem Terminal mit genau diesem Interpreter zu installieren.
 * - alles andere geht an `onEvent`.
 *
 * Die Plan-Datei wird am Ende gelöscht; ob danach noch eine „ohne Ergebnis
 * beendet“-Meldung nötig ist, entscheidet der Aufrufer anhand des Ergebnisses.
 */
export function runPlanProcess(options: PlanProcessOptions): Promise<PlanProcessResult> {
	const channel = getOutputChannel();
	const scriptPath = vscode.Uri.joinPath(options.context.extensionUri, 'python', 'generate.py').fsPath;

	return new Promise<PlanProcessResult>((resolve) => {
		const child = spawn(options.pythonPath, [scriptPath, options.planUri.fsPath], { cwd: options.cwd });
		options.token?.onCancellationRequested(() => {
			if (options.onCancel) {
				options.onCancel();
			}
			child.kill();
		});

		let stdoutRest = '';
		let stderrText = '';
		let reportedError = false;

		const handleEvent = (line: string) => {
			const trimmed = line.trim();
			if (!trimmed) {
				return;
			}
			let event: Record<string, unknown>;
			try {
				event = JSON.parse(trimmed);
			} catch {
				return;
			}
			switch (event.event) {
				case 'log': {
					// ctx.log(...) aus (benutzerdefinierten) Generatoren.
					channel.appendLine(`    » ${String(event.message ?? '')}`);
					break;
				}
				case 'error': {
					reportedError = true;
					// Vollständige Details (inkl. Python-Traceback) in den
					// Output-Channel — die Notification bietet dafür
					// „Details anzeigen“ an.
					log(`ERROR: ${String(event.message ?? '')}`);
					if (typeof event.traceback === 'string' && event.traceback.trim()) {
						channel.appendLine(event.traceback);
					}
					if (event.code === 'missing-packages') {
						const packages = Array.isArray(event.packages) ? event.packages.join(' ') : 'pandas numpy';
						const installLabel = vscode.l10n.t('Install packages');
						void showErrorWithDetails(
							vscode.l10n.t('Python packages are missing for test data generation: {0}', packages),
							installLabel,
						).then((choice) => {
							if (choice === installLabel) {
								// Installation bewusst sichtbar in einem Terminal statt
								// versteckt im Hintergrund — der verwendete Interpreter
								// wird direkt angesprochen.
								const terminal = vscode.window.createTerminal(vscode.l10n.t('Datenschmiede: Install packages'));
								terminal.show();
								terminal.sendText(`& "${options.pythonPath}" -m pip install ${packages}`);
							}
						});
					} else {
						void showErrorWithDetails(options.errorMessage(String(event.message ?? '')));
					}
					break;
				}
				default:
					options.onEvent(event);
					break;
			}
		};

		child.stdout.on('data', (chunk: Buffer) => {
			stdoutRest += chunk.toString('utf8');
			const lines = stdoutRest.split('\n');
			stdoutRest = lines.pop() ?? '';
			for (const line of lines) {
				handleEvent(line);
			}
		});
		child.stderr.on('data', (chunk: Buffer) => {
			const text = chunk.toString('utf8');
			stderrText += text;
			// Python-stderr (Warnungen, unerwartete Ausgaben) landet
			// vollständig im Output-Channel „Datenschmiede“.
			channel.append(text);
		});

		child.on('error', (err) => {
			reportedError = true;
			log(`ERROR: unable to start python: ${String(err.message)}`);
			void showErrorWithDetails(vscode.l10n.t('Unable to start Python: {0}', String(err.message)));
		});
		child.on('close', (code) => {
			handleEvent(stdoutRest);
			void vscode.workspace.fs.delete(options.planUri).then(undefined, () => undefined);
			resolve({
				code,
				cancelled: options.token?.isCancellationRequested ?? false,
				reportedError,
				stderrText,
			});
		});
	});
}
