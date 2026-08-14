import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { Table } from '../table/model';
import type { Plan, PlanTable } from './run';
import { getOutputChannel, log, showErrorWithDetails } from '../outputChannel';

/**
 * Shared building blocks for the two callers of the Python runner
 * (python/generate.py): the full generator run (project/run.ts) and the table
 * preview (table/preview.ts). Everything both do identically lives here —
 * writing the plan file, starting the process, reading the JSON-lines protocol,
 * handling `log`/`error` events, cleaning up — so it does not have to be
 * maintained twice.
 */

/** A table's output configuration in plan format (counterpart to Table.output, snake_case for Python). */
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

/** Writes the plan as JSON into the extension's global storage (not part of the workspace); runPlanProcess deletes it again. */
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

/** Everything runPlanProcess needs to start and supervise one runner process. */
export interface PlanProcessOptions {
	/** Interpreter used to start python/generate.py. */
	pythonPath: string;
	context: vscode.ExtensionContext;
	/** The plan file written by writePlanFile — deleted once the run finishes. */
	planUri: vscode.Uri;
	/** Working directory of the runner (folder of the project/table file). */
	cwd: string;
	/** Cancellation via the VS Code progress indicator (full run only). */
	token?: vscode.CancellationToken;
	/** Extra log output on cancellation (e.g. "Run … cancelled"). */
	onCancel?: () => void;
	/** Formats the notification for an `error` event (details go to the output channel). */
	errorMessage: (message: string) => string;
	/** All other events (table_start, table_done, done, preview, …) — `log` and `error` are handled by the runner itself. */
	onEvent: (event: Record<string, unknown>) => void;
}

/** Outcome of one runner process. */
export interface PlanProcessResult {
	code: number | null;
	cancelled: boolean;
	/** `true` if an error message was already shown (error event or spawn failure) — do not show a second one. */
	reportedError: boolean;
	stderrText: string;
}

/**
 * Starts python/generate.py with a plan file and interprets its JSON-lines
 * protocol (stdout):
 *
 * - `log` events (ctx.log(...) from custom generators) go to the
 *   "Datenschmiede" output channel, as does the complete stderr.
 * - `error` events are surfaced as a notification (wording via `errorMessage`),
 *   with the traceback in the output channel; if Python packages are missing
 *   (`missing-packages`), the notification offers to install them visibly in a
 *   terminal using exactly this interpreter.
 * - everything else is forwarded to `onEvent`.
 *
 * The plan file is deleted at the end; whether an additional "finished without
 * a result" message is needed is decided by the caller from the result.
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
					// ctx.log(...) from (custom) generators.
					channel.appendLine(`    » ${String(event.message ?? '')}`);
					break;
				}
				case 'error': {
					reportedError = true;
					// Full details (including the Python traceback) go to the
					// output channel — the notification offers "Show Details"
					// for exactly that.
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
								// Installation deliberately visible in a terminal rather
								// than hidden in the background — the interpreter in use
								// is addressed directly.
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
			// Python stderr (warnings, unexpected output) goes to the
			// "Datenschmiede" output channel in full.
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
