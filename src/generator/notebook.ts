import * as vscode from 'vscode';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { GeneratorFile, createEmptyGeneratorFile } from './model';
import { parseGeneratorText, serializeGenerator } from './toml';
import { CellRole, CellSpec, cellsToFile, fileToCells } from './notebookCells';
import { resolveAnyInterpreter } from '../project/python';
import { toPlanLookups } from '../project/run';
import { listLookups } from '../lookup/repository';
import { createStreamDecoder, decodeUtf8, encodeUtf8, pythonEnv } from '../encoding';
import { log } from '../outputChannel';

/** Notebook type of the generator editor (see `contributes.notebooks` in package.json). */
export const GENERATOR_NOTEBOOK_TYPE = 'datenschmiede-generator';

/**
 * The generator notebook: `.tdgen` files open as a native VS Code notebook
 * (markdown header, parameters() cell, scratch cell with test values, the four
 * method cells — for the mapping see generator/notebookCells.ts). Execution
 * happens in a **persistent Python process per notebook**
 * (python/notebook_kernel.py): variables, imports and functions survive between
 * cell executions — full Python as in a Jupyter kernel, with real Monaco
 * editors and Python syntax per cell. Replaces the former webview editor.
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

/** Key of the cell role inside the cell metadata. */
const ROLE_KEY = 'datenschmiedeRole';

/** Translates between the `.tdgen` TOML on disk and the notebook's cells. */
class GeneratorNotebookSerializer implements vscode.NotebookSerializer {
	public deserializeNotebook(content: Uint8Array): vscode.NotebookData {
		const text = decodeUtf8(content);
		// Broken TOML throws — VS Code surfaces the error, and the file can be
		// repaired via "Reopen Editor With… > Text Editor"; the exact position
		// is additionally reported in the Problems view.
		const file = parseGeneratorText(text);

		const locale = vscode.env.language.toLowerCase().startsWith('de') ? 'de' : 'en';
		const cells = fileToCells(file, locale).map((cell) => {
			const data = new vscode.NotebookCellData(
				cell.kind === 'markdown' ? vscode.NotebookCellKind.Markup : vscode.NotebookCellKind.Code,
				cell.value,
				cell.language,
			);
			data.metadata = { [ROLE_KEY]: cell.role };
			return data;
		});

		const notebook = new vscode.NotebookData(cells);
		// Fallback state for saving: name and parameter list are preserved when
		// the heading is missing or parameters() does not (yet) return a
		// literal.
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
		return encodeUtf8(serializeGenerator(file));
	}
}

/** A running kernel process together with its outstanding replies. */
interface Kernel {
	child: ChildProcessWithoutNullStreams;
	pending: Map<number, (reply: KernelReply) => void>;
	nextId: number;
	buffer: string;
}

/** One reply line of the kernel protocol (see python/notebook_kernel.py). */
interface KernelReply {
	ok: boolean;
	outputs?: string[];
	error?: string;
	ename?: string;
	traceback?: string;
}

/** Runs notebook cells in a persistent Python process and streams their output back. */
class GeneratorNotebookController implements vscode.Disposable {
	private readonly controller: vscode.NotebookController;
	/** One persistent kernel per open notebook (full Python state between cell executions). */
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
		// Interrupting means restarting the kernel (like "Restart Kernel" in
		// Jupyter): this reliably terminates endlessly running cells too.
		this.killKernel(key);
		log('Generator notebook kernel restarted.');
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
		const kernel: Kernel = { child, pending: new Map(), nextId: 1, buffer: '' };
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
					// Not a protocol line (e.g. a print to stdout outside the
					// redirection) -> ignore it.
				}
			}
		});
		child.on('close', () => {
			// Answer every pending execution as aborted.
			for (const resolve of kernel.pending.values()) {
				resolve({ ok: false, ename: 'KernelDied', error: vscode.l10n.t('The Python kernel exited.') });
			}
			kernel.pending.clear();
		});

		// Hand the workspace's lookup lists over for ctx.lookup(...).
		const lookups = toPlanLookups(await listLookups());
		child.stdin.write(`${JSON.stringify({ type: 'init', lookups })}\n`);

		this.kernels.set(key, kernel);
		log(`Generator notebook kernel started — ${interpreter.path}`);
		return kernel;
	}

	/** Executes the selected cells one after another in the notebook's kernel. */
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
