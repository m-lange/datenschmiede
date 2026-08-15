import * as vscode from 'vscode';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { FileGeneratorFile, createEmptyFileGeneratorFile } from './model';
import { parseFileGeneratorText, serializeFileGenerator } from './toml';
import { FileGenCellRole, FileGenCellSpec, cellsToFileGen, fileGenToCells } from './notebookCells';
import { resolveAnyInterpreter } from '../project/python';
import { createStreamDecoder, decodeUtf8, encodeUtf8, pythonEnv } from '../encoding';
import { log } from '../outputChannel';

/** Notebook type of the file generator editor (see `contributes.notebooks` in package.json). */
export const FILEGEN_NOTEBOOK_TYPE = 'datenschmiede-filegen';

/**
 * The file generator notebook: `.filegen` files open as a native VS Code
 * notebook (markdown header, settings cell, scratch cell, the write cell — for
 * the mapping see filegen/notebookCells.ts). Like the generator notebook it
 * executes cells in a **persistent Python process per notebook**
 * (python/notebook_kernel.py), so a test frame built in the scratch cell is
 * still there when the write cell runs.
 */
export class FileGeneratorNotebook {
	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		const serializer = new FileGeneratorNotebookSerializer();
		const controller = new FileGeneratorNotebookController(context);
		return vscode.Disposable.from(
			vscode.workspace.registerNotebookSerializer(FILEGEN_NOTEBOOK_TYPE, serializer, {
				transientOutputs: true,
			}),
			controller,
		);
	}
}

/** Key of the cell role inside the cell metadata. */
const ROLE_KEY = 'datenschmiedeRole';

/** Translates between the `.filegen` TOML on disk and the notebook's cells. */
class FileGeneratorNotebookSerializer implements vscode.NotebookSerializer {
	public deserializeNotebook(content: Uint8Array): vscode.NotebookData {
		const text = decodeUtf8(content);
		// Broken TOML throws — VS Code surfaces the error, and the file can be
		// repaired via "Reopen Editor With… > Text Editor".
		const file = parseFileGeneratorText(text);

		const locale = vscode.env.language.toLowerCase().startsWith('de') ? 'de' : 'en';
		const cells = fileGenToCells(file, locale).map((cell) => {
			const data = new vscode.NotebookCellData(
				cell.kind === 'markdown' ? vscode.NotebookCellKind.Markup : vscode.NotebookCellKind.Code,
				cell.value,
				cell.language,
			);
			data.metadata = { [ROLE_KEY]: cell.role };
			return data;
		});

		const notebook = new vscode.NotebookData(cells);
		// Fallback state for saving (e.g. the name when the heading is missing).
		notebook.metadata = { previous: file };
		return notebook;
	}

	public serializeNotebook(data: vscode.NotebookData): Uint8Array {
		const previous = (data.metadata?.previous as FileGeneratorFile | undefined) ?? createEmptyFileGeneratorFile();
		const cells: FileGenCellSpec[] = data.cells.map((cell) => ({
			kind: cell.kind === vscode.NotebookCellKind.Markup ? 'markdown' : 'code',
			language: cell.languageId,
			value: cell.value,
			role: ((cell.metadata?.[ROLE_KEY] as FileGenCellRole | undefined) ?? 'extra') as FileGenCellRole,
		}));
		return encodeUtf8(serializeFileGenerator(cellsToFileGen(cells, previous)));
	}
}

/** A running kernel process together with its outstanding replies. */
interface Kernel {
	child: ChildProcessWithoutNullStreams;
	pending: Map<number, (reply: KernelReply) => void>;
	nextId: number;
	buffer: string;
	/** Cells executed in this kernel so far — the counter behind the `[n]` badge next to a cell. */
	executions: number;
}

/** One reply line of the kernel protocol (see python/notebook_kernel.py). */
interface KernelReply {
	ok: boolean;
	outputs?: string[];
	error?: string;
	ename?: string;
	traceback?: string;
}

/**
 * Runs notebook cells in a persistent Python process and streams their output
 * back — the same mechanism as the generator notebook, with its own controller
 * so the two notebook types stay independent.
 */
class FileGeneratorNotebookController implements vscode.Disposable {
	private readonly controller: vscode.NotebookController;
	/** One persistent kernel per open notebook. */
	private readonly kernels = new Map<string, Kernel>();
	private readonly closeSub: vscode.Disposable;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.controller = vscode.notebooks.createNotebookController(
			'datenschmiede-filegen-kernel',
			FILEGEN_NOTEBOOK_TYPE,
			'Datenschmiede Python',
		);
		this.controller.supportedLanguages = ['python'];
		this.controller.supportsExecutionOrder = true;
		this.controller.description = vscode.l10n.t('Persistent Python process with the generator ctx');
		this.controller.executeHandler = (cells, notebook) => this.execute(cells, notebook);
		this.controller.interruptHandler = (notebook) => this.restartKernel(notebook.uri.toString());

		this.closeSub = vscode.workspace.onDidCloseNotebookDocument((notebook) => {
			if (notebook.notebookType === FILEGEN_NOTEBOOK_TYPE) {
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

	/** Terminates the kernel of one notebook, if it is running. */
	private killKernel(key: string): void {
		const kernel = this.kernels.get(key);
		if (kernel) {
			kernel.child.kill();
			this.kernels.delete(key);
		}
	}

	/** Interrupt = restart the kernel; the next execution starts a fresh process. */
	private restartKernel(key: string): void {
		this.killKernel(key);
		log('File generator notebook kernel restarted.');
	}

	/** Returns the notebook's kernel, starting one if none is running; `null` without a usable interpreter. */
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
		const child = spawn(interpreter.path, [scriptPath], { env: pythonEnv() });
		const kernel: Kernel = { child, pending: new Map(), nextId: 1, buffer: '', executions: 0 };
		const decodeStdout = createStreamDecoder();

		child.stdout.on('data', (chunk: Buffer) => {
			kernel.buffer += decodeStdout(chunk);
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
					// Not a protocol line -> ignore it.
				}
			}
		});
		child.on('close', () => {
			for (const resolve of kernel.pending.values()) {
				resolve({ ok: false, ename: 'KernelDied', error: vscode.l10n.t('The Python kernel exited.') });
			}
			kernel.pending.clear();
		});

		child.stdin.write(`${JSON.stringify({ type: 'init', lookups: [] })}\n`);

		this.kernels.set(key, kernel);
		log(`File generator notebook kernel started — ${interpreter.path}`);
		return kernel;
	}

	/** Executes the selected cells one after another in the notebook's kernel. */
	private async execute(cells: vscode.NotebookCell[], notebook: vscode.NotebookDocument): Promise<void> {
		for (const cell of cells) {
			const execution = this.controller.createNotebookCellExecution(cell);
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

			// Counted per kernel, as in Jupyter: the badge next to the cell says
			// in which order the cells ran, and a restarted kernel starts at 1
			// again (its Python state is gone with it).
			execution.executionOrder = ++kernel.executions;

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
