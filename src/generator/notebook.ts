import * as vscode from 'vscode';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { GeneratorFile, createEmptyGeneratorFile } from './model';
import { parseGeneratorText, serializeGenerator } from './toml';
import { CellRole, CellSpec, cellsToFile, fileToCells } from './notebookCells';
import { resolveAnyInterpreter } from '../project/python';
import { toPlanLookups } from '../project/run';
import { listLookups } from '../lookup/repository';
import { log } from '../outputChannel';

/** Notebook-Typ des Generator-Editors (siehe `contributes.notebooks` in package.json). */
export const GENERATOR_NOTEBOOK_TYPE = 'datenschmiede-generator';

/**
 * Das Generator-Notebook: `.tdgen`-Dateien öffnen als natives VS-Code-
 * Notebook (Markdown-Kopf, parameters()-Zelle, Scratch-Zelle mit
 * Testwerten, die vier Methoden-Zellen — Abbildung siehe
 * generator/notebookCells.ts). Ausgeführt wird über einen **persistenten
 * Python-Prozess je Notebook** (python/notebook_kernel.py): Variablen,
 * Importe und Funktionen bleiben zwischen Zell-Ausführungen erhalten —
 * volles Python wie in einem Jupyter-Kernel, mit echten Monaco-Editoren
 * samt Python-Syntax je Zelle. Ersetzt den früheren Webview-Editor.
 */
export class GeneratorNotebook {
	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		const serializer = new GeneratorNotebookSerializer();
		const controller = new GeneratorNotebookController(context);
		return vscode.Disposable.from(
			vscode.workspace.registerNotebookSerializer(GENERATOR_NOTEBOOK_TYPE, serializer, {
				transientOutputs: true,
			}),
			controller,
		);
	}
}

/** Schlüssel der Zellen-Rolle in den Zell-Metadaten. */
const ROLE_KEY = 'datenschmiedeRole';

class GeneratorNotebookSerializer implements vscode.NotebookSerializer {
	public deserializeNotebook(content: Uint8Array): vscode.NotebookData {
		const text = Buffer.from(content).toString('utf8');
		// Kaputtes TOML wirft — VS Code zeigt den Fehler an, die Datei lässt
		// sich über „Reopen Editor With… > Text Editor“ reparieren; die
		// genaue Position steht zusätzlich in der Problems-Ansicht.
		const file = parseGeneratorText(text);

		const cells = fileToCells(file).map((cell) => {
			const data = new vscode.NotebookCellData(
				cell.kind === 'markdown' ? vscode.NotebookCellKind.Markup : vscode.NotebookCellKind.Code,
				cell.value,
				cell.language,
			);
			data.metadata = { [ROLE_KEY]: cell.role };
			return data;
		});

		const notebook = new vscode.NotebookData(cells);
		// Rückfall-Stand fürs Speichern: Name und Parameterliste bleiben
		// erhalten, wenn die Überschrift fehlt bzw. parameters() (noch) kein
		// Literal zurückgibt.
		notebook.metadata = { previous: file };
		return notebook;
	}

	public serializeNotebook(data: vscode.NotebookData): Uint8Array {
		const previous = (data.metadata?.previous as GeneratorFile | undefined) ?? createEmptyGeneratorFile();
		const cells: CellSpec[] = data.cells.map((cell) => ({
			kind: cell.kind === vscode.NotebookCellKind.Markup ? 'markdown' : 'code',
			language: cell.languageId,
			value: cell.value,
			role: ((cell.metadata?.[ROLE_KEY] as CellRole | undefined) ?? 'extra') as CellRole,
		}));
		const file = cellsToFile(cells, previous);
		return Buffer.from(serializeGenerator(file), 'utf8');
	}
}

/** Ein laufender Kernel-Prozess samt wartender Antworten. */
interface Kernel {
	child: ChildProcessWithoutNullStreams;
	pending: Map<number, (reply: KernelReply) => void>;
	nextId: number;
	buffer: string;
}

interface KernelReply {
	ok: boolean;
	outputs?: string[];
	error?: string;
	ename?: string;
	traceback?: string;
}

class GeneratorNotebookController implements vscode.Disposable {
	private readonly controller: vscode.NotebookController;
	/** Ein persistenter Kernel je geöffnetem Notebook (voller Python-Zustand zwischen Zell-Ausführungen). */
	private readonly kernels = new Map<string, Kernel>();
	private readonly closeSub: vscode.Disposable;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.controller = vscode.notebooks.createNotebookController(
			'datenschmiede-generator-kernel',
			GENERATOR_NOTEBOOK_TYPE,
			'Datenschmiede Python',
		);
		this.controller.supportedLanguages = ['python'];
		this.controller.supportsExecutionOrder = true;
		this.controller.description = vscode.l10n.t('Persistent Python process with the generator ctx');
		this.controller.executeHandler = (cells, notebook) => this.execute(cells, notebook);
		this.controller.interruptHandler = (notebook) => this.restartKernel(notebook.uri.toString());

		this.closeSub = vscode.workspace.onDidCloseNotebookDocument((notebook) => {
			if (notebook.notebookType === GENERATOR_NOTEBOOK_TYPE) {
				this.killKernel(notebook.uri.toString());
			}
		});
	}

	public dispose(): void {
		for (const key of [...this.kernels.keys()]) {
			this.killKernel(key);
		}
		this.controller.dispose();
		this.closeSub.dispose();
	}

	private killKernel(key: string): void {
		const kernel = this.kernels.get(key);
		if (kernel) {
			kernel.child.kill();
			this.kernels.delete(key);
		}
	}

	private restartKernel(key: string): void {
		// Abbrechen = Kernel neu starten (wie „Restart Kernel“ in Jupyter):
		// beendet auch endlos laufende Zellen zuverlässig.
		this.killKernel(key);
		log('Generator notebook kernel restarted.');
	}

	private async getKernel(key: string): Promise<Kernel | null> {
		const existing = this.kernels.get(key);
		if (existing && existing.child.exitCode === null) {
			return existing;
		}
		this.kernels.delete(key);

		const interpreter = await resolveAnyInterpreter();
		if (!interpreter) {
			return null;
		}
		const scriptPath = vscode.Uri.joinPath(this.context.extensionUri, 'python', 'notebook_kernel.py').fsPath;
		const child = spawn(interpreter.path, [scriptPath]);
		const kernel: Kernel = { child, pending: new Map(), nextId: 1, buffer: '' };

		child.stdout.on('data', (chunk: Buffer) => {
			kernel.buffer += chunk.toString('utf8');
			const lines = kernel.buffer.split('\n');
			kernel.buffer = lines.pop() ?? '';
			for (const line of lines) {
				if (!line.trim()) {
					continue;
				}
				try {
					const reply = JSON.parse(line);
					const resolve = kernel.pending.get(reply.id);
					if (resolve) {
						kernel.pending.delete(reply.id);
						resolve(reply);
					}
				} catch {
					// Keine Protokoll-Zeile (z. B. print auf stdout außerhalb der
					// Umleitung) -> ignorieren.
				}
			}
		});
		child.on('close', () => {
			// Alle wartenden Ausführungen als abgebrochen beantworten.
			for (const resolve of kernel.pending.values()) {
				resolve({ ok: false, ename: 'KernelDied', error: vscode.l10n.t('The Python kernel exited.') });
			}
			kernel.pending.clear();
		});

		// Nachschlagelisten des Workspace für ctx.lookup(...) mitgeben.
		const lookups = toPlanLookups(await listLookups());
		child.stdin.write(`${JSON.stringify({ type: 'init', lookups })}\n`);

		this.kernels.set(key, kernel);
		log(`Generator notebook kernel started — ${interpreter.path}`);
		return kernel;
	}

	private async execute(cells: vscode.NotebookCell[], notebook: vscode.NotebookDocument): Promise<void> {
		for (const cell of cells) {
			const execution = this.controller.createNotebookCellExecution(cell);
			execution.executionOrder = Date.now() % 100000;
			execution.start(Date.now());
			void execution.clearOutput();

			const kernel = await this.getKernel(notebook.uri.toString());
			if (!kernel) {
				void execution.appendOutput(
					new vscode.NotebookCellOutput([
						vscode.NotebookCellOutputItem.error({
							name: 'NoInterpreter',
							message: vscode.l10n.t('No Python 3.10+ interpreter available. Install one, then try again.'),
						}),
					]),
				);
				execution.end(false, Date.now());
				continue;
			}

			const role = (cell.metadata?.[ROLE_KEY] as string | undefined) ?? 'extra';
			const reply = await new Promise<KernelReply>((resolve) => {
				const id = kernel.nextId++;
				kernel.pending.set(id, resolve);
				kernel.child.stdin.write(`${JSON.stringify({ type: 'exec', id, role, code: cell.document.getText() })}\n`);
			});

			if (reply.ok) {
				const text = (reply.outputs ?? []).join('\n');
				if (text.trim()) {
					void execution.appendOutput(
						new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.text(text, 'text/plain')]),
					);
				}
				execution.end(true, Date.now());
			} else {
				const error = new Error(reply.error ?? 'error');
				error.name = reply.ename ?? 'Error';
				error.stack = reply.traceback;
				void execution.appendOutput(new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.error(error)]));
				execution.end(false, Date.now());
			}
		}
	}
}
