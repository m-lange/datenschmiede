import * as vscode from 'vscode';
import { IndexedFileKind, WorkspaceIndex, WorkspaceSnapshot } from '../workspaceIndex';
import { tableLabel } from '../table/repository';

/**
 * The Datenschmiede sidebar (own container in the activity bar): four read-only
 * tree views over the workspace index — projects, lookup lists, generators and
 * the schema tree of all tables.
 *
 * Everything here is a VIEW of the index, never a second source of truth: the
 * lists come from `index.snapshot()`, and every view refreshes on
 * `index.onDidChange` — but only for the file kinds it actually shows, so
 * typing in a `.td` file does not rebuild the project list.
 *
 * Items carry the file's name from ITS CONTENT (project name, list name,
 * generator name, `schema.table`) rather than the file name, with the
 * workspace-relative path as the greyed-out description. A file whose TOML is
 * broken is not silently dropped — it appears with a warning icon and its path
 * as the label, so it can be opened and repaired.
 */

/** Opens a file in its custom editor (the default for `.td`/`.tdproject`/`.lkp`, a notebook for the generators). */
function openCommand(uri: vscode.Uri): vscode.Command {
	return { command: 'vscode.open', title: vscode.l10n.t('Open'), arguments: [uri] };
}

/** Icon pair from `icons/` (the same files the file explorer uses for these extensions). */
function fileIcon(context: vscode.ExtensionContext, name: string): { light: vscode.Uri; dark: vscode.Uri } {
	return {
		light: vscode.Uri.joinPath(context.extensionUri, 'icons', `${name}-light.svg`),
		dark: vscode.Uri.joinPath(context.extensionUri, 'icons', `${name}-dark.svg`),
	};
}

/**
 * Base class of the four views: holds the refresh wiring (index event filtered
 * by file kind) and the `message` shown while a view is empty, so each subclass
 * only has to say what its items are.
 */
abstract class IndexView<T> implements vscode.TreeDataProvider<T> {
	private readonly emitter = new vscode.EventEmitter<T | undefined>();
	public readonly onDidChangeTreeData = this.emitter.event;
	private view: vscode.TreeView<T> | undefined;

	constructor(
		protected readonly context: vscode.ExtensionContext,
		protected readonly index: WorkspaceIndex,
		/** File kinds whose changes affect this view. */
		private readonly kinds: IndexedFileKind[],
	) {}

	/** `true` for the views that actually nest — a "collapse all" button on a flat list would do nothing. */
	protected nested = false;

	/** Registers the view and keeps it in sync; returns the disposable to hand to the extension context. */
	public register(viewId: string): vscode.Disposable[] {
		const view = vscode.window.createTreeView<T>(viewId, {
			treeDataProvider: this,
			showCollapseAll: this.nested,
		});
		this.view = view;
		void this.updateMessage();
		const sub = this.index.onDidChange((changed) => {
			if (this.kinds.some((kind) => changed.has(kind))) {
				this.emitter.fire(undefined);
				void this.updateMessage();
			}
		});
		return [view, sub, this.emitter];
	}

	/**
	 * Empty state: an explanatory line instead of a blank pane. Set on the view
	 * itself rather than as welcome content, because the condition ("the
	 * workspace contains no such file") is exactly what the index already knows
	 * and would otherwise have to be mirrored into a context key.
	 */
	private async updateMessage(): Promise<void> {
		if (!this.view) {
			return;
		}
		const snapshot = await this.index.snapshot();
		this.view.message = this.isEmpty(snapshot) ? this.emptyMessage() : undefined;
	}

	protected abstract isEmpty(snapshot: WorkspaceSnapshot): boolean;
	protected abstract emptyMessage(): string;

	public abstract getTreeItem(element: T): vscode.TreeItem;
	public abstract getChildren(element?: T): Promise<T[]>;
}

// ---------------------------------------------------------------------------
// Projects: flat list, project name instead of file name
// ---------------------------------------------------------------------------

interface FileNode {
	uri: vscode.Uri;
	label: string;
	description: string;
	/** Hover text; the description is used when unset. */
	tooltip?: string;
	/** `false` when the file could not be parsed — shown with a warning icon. */
	valid: boolean;
}

class ProjectsView extends IndexView<FileNode> {
	constructor(context: vscode.ExtensionContext, index: WorkspaceIndex) {
		super(context, index, ['tdproject']);
	}

	protected isEmpty(snapshot: WorkspaceSnapshot): boolean {
		return snapshot.projects.length === 0;
	}

	protected emptyMessage(): string {
		return vscode.l10n.t('No test data projects in this workspace.');
	}

	public getTreeItem(element: FileNode): vscode.TreeItem {
		const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
		item.description = element.description;
		item.resourceUri = element.uri;
		item.tooltip = element.description;
		item.command = openCommand(element.uri);
		item.contextValue = 'datenschmiede.project';
		item.iconPath = element.valid
			? fileIcon(this.context, 'tdproject')
			: new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
		return item;
	}

	public async getChildren(element?: FileNode): Promise<FileNode[]> {
		if (element) {
			return [];
		}
		const snapshot = await this.index.snapshot();
		return snapshot.projects
			.map((entry): FileNode => ({
				uri: entry.uri,
				label: entry.project?.name.trim() || entry.relativePath,
				description: entry.relativePath,
				valid: !!entry.project,
			}))
			.sort((a, b) => a.label.localeCompare(b.label));
	}
}

// ---------------------------------------------------------------------------
// Lookup lists: flat list, list name instead of file name
// ---------------------------------------------------------------------------

class LookupsView extends IndexView<FileNode> {
	constructor(context: vscode.ExtensionContext, index: WorkspaceIndex) {
		super(context, index, ['lkp']);
	}

	protected isEmpty(snapshot: WorkspaceSnapshot): boolean {
		return snapshot.lookups.length === 0;
	}

	protected emptyMessage(): string {
		return vscode.l10n.t('No lookup lists in this workspace.');
	}

	public getTreeItem(element: FileNode): vscode.TreeItem {
		const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
		item.description = element.description;
		item.resourceUri = element.uri;
		item.tooltip = element.description;
		item.command = openCommand(element.uri);
		item.contextValue = 'datenschmiede.lookup';
		item.iconPath = element.valid
			? fileIcon(this.context, 'lookup')
			: new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
		return item;
	}

	public async getChildren(element?: FileNode): Promise<FileNode[]> {
		if (element) {
			return [];
		}
		const snapshot = await this.index.snapshot();
		return snapshot.lookups
			.map((entry): FileNode => ({
				// entry.name is the `# name:` metadata, falling back to the file name.
				uri: entry.uri,
				label: entry.lookup ? entry.name : entry.relativePath,
				description: entry.relativePath,
				valid: !!entry.lookup,
			}))
			.sort((a, b) => a.label.localeCompare(b.label));
	}
}

// ---------------------------------------------------------------------------
// Generators: two groups - data generators (.tdgen) and file generators (.filegen)
// ---------------------------------------------------------------------------

type GeneratorNode = { kind: 'group'; group: 'data' | 'file'; label: string } | ({ kind: 'file' } & FileNode);

class GeneratorsView extends IndexView<GeneratorNode> {
	constructor(context: vscode.ExtensionContext, index: WorkspaceIndex) {
		super(context, index, ['tdgen', 'filegen']);
		this.nested = true;
	}

	protected isEmpty(snapshot: WorkspaceSnapshot): boolean {
		return snapshot.generators.length === 0 && snapshot.fileGenerators.length === 0;
	}

	protected emptyMessage(): string {
		return vscode.l10n.t('No custom generators in this workspace.');
	}

	public getTreeItem(element: GeneratorNode): vscode.TreeItem {
		if (element.kind === 'group') {
			// The two groups stay expanded: with a handful of generators each,
			// collapsing them would hide everything the view is there for.
			const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
			item.iconPath = new vscode.ThemeIcon(element.group === 'data' ? 'symbol-method' : 'file-binary');
			item.contextValue = `datenschmiede.generatorGroup.${element.group}`;
			return item;
		}
		const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
		item.description = element.description;
		item.resourceUri = element.uri;
		item.tooltip = element.description;
		item.command = openCommand(element.uri);
		item.contextValue = 'datenschmiede.generator';
		item.iconPath = element.valid
			? fileIcon(this.context, element.uri.path.endsWith('.filegen') ? 'filegen' : 'tdgen')
			: new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
		return item;
	}

	public async getChildren(element?: GeneratorNode): Promise<GeneratorNode[]> {
		const snapshot = await this.index.snapshot();
		if (!element) {
			// Both groups always exist, even while empty - otherwise the view
			// would silently change shape depending on what happens to be there.
			return [
				{ kind: 'group', group: 'data', label: vscode.l10n.t('Data') },
				{ kind: 'group', group: 'file', label: vscode.l10n.t('File') },
			];
		}
		if (element.kind !== 'group') {
			return [];
		}
		const files: GeneratorNode[] =
			element.group === 'data'
				? snapshot.generators.map((entry) => ({
						kind: 'file',
						uri: entry.uri,
						label: entry.generator?.name.trim() || entry.file?.name.trim() || entry.relativePath,
						description: entry.relativePath,
						valid: !!entry.file,
					}))
				: snapshot.fileGenerators.map((entry) => ({
						kind: 'file',
						uri: entry.uri,
						label: entry.file?.name.trim() || entry.relativePath,
						description: entry.relativePath,
						valid: !!entry.file,
					}));
		return files.sort((a, b) => a.label.localeCompare(b.label));
	}
}

// ---------------------------------------------------------------------------
// Schema: namespace tree with the tables underneath
// ---------------------------------------------------------------------------

type SchemaNode =
	| { kind: 'schema'; id: string; segment: string; children: SchemaNode[] }
	| ({ kind: 'table' } & FileNode);

class SchemaView extends IndexView<SchemaNode> {
	constructor(context: vscode.ExtensionContext, index: WorkspaceIndex) {
		super(context, index, ['td']);
		this.nested = true;
	}

	protected isEmpty(snapshot: WorkspaceSnapshot): boolean {
		return snapshot.tables.length === 0;
	}

	protected emptyMessage(): string {
		return vscode.l10n.t('No table definitions in this workspace.');
	}

	public getTreeItem(element: SchemaNode): vscode.TreeItem {
		if (element.kind === 'schema') {
			const item = new vscode.TreeItem(element.segment, vscode.TreeItemCollapsibleState.Expanded);
			item.iconPath = fileIcon(this.context, 'schema');
			item.contextValue = 'datenschmiede.schema';
			item.id = element.id;
			return item;
		}
		const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
		item.description = element.description;
		item.resourceUri = element.uri;
		item.tooltip = element.tooltip ?? element.description;
		item.command = openCommand(element.uri);
		item.contextValue = 'datenschmiede.table';
		item.iconPath = element.valid
			? fileIcon(this.context, 'td')
			: new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
		return item;
	}

	public async getChildren(element?: SchemaNode): Promise<SchemaNode[]> {
		if (element) {
			return element.kind === 'schema' ? element.children : [];
		}
		const snapshot = await this.index.snapshot();

		// Same grouping as the project editor's table picker: the schema is split
		// on dots, so "shop.master" nests "master" under "shop"; tables without a
		// schema sit at the top level.
		interface Group {
			segment: string;
			children: Map<string, Group>;
			tables: SchemaNode[];
		}
		const root: Group = { segment: '', children: new Map(), tables: [] };
		for (const entry of snapshot.tables) {
			const segments = (entry.table?.schema.trim() ?? '')
				.split('.')
				.map((segment) => segment.trim())
				.filter((segment) => segment.length > 0);
			let node = root;
			for (const segment of segments) {
				let child = node.children.get(segment);
				if (!child) {
					child = { segment, children: new Map(), tables: [] };
					node.children.set(segment, child);
				}
				node = child;
			}
			node.tables.push({
				kind: 'table',
				uri: entry.uri,
				// Only the table name here - the schema is already the path to it,
				// so the file path is the more useful second piece of information.
				label: entry.table ? entry.table.name.trim() || entry.relativePath : entry.relativePath,
				description: entry.relativePath,
				tooltip: entry.table ? `${tableLabel(entry.table, entry.relativePath)}
${entry.relativePath}` : entry.relativePath,
				valid: !!entry.table,
			});
		}

		const toNodes = (group: Group, path: string): SchemaNode[] => {
			const schemas = [...group.children.values()]
				.sort((a, b) => a.segment.localeCompare(b.segment))
				.map((child): SchemaNode => {
					const id = path ? `${path}.${child.segment}` : child.segment;
					return { kind: 'schema', id, segment: child.segment, children: toNodes(child, id) };
				});
			const tables = [...group.tables].sort((a, b) =>
				a.kind === 'table' && b.kind === 'table' ? a.label.localeCompare(b.label) : 0,
			);
			return [...schemas, ...tables];
		};
		return toNodes(root, '');
	}
}

/** Registers all four sidebar views; call once during activation. */
export function registerSidebar(context: vscode.ExtensionContext, index: WorkspaceIndex): void {
	context.subscriptions.push(
		...new ProjectsView(context, index).register('datenschmiede.projectsView'),
		...new LookupsView(context, index).register('datenschmiede.lookupsView'),
		...new GeneratorsView(context, index).register('datenschmiede.generatorsView'),
		...new SchemaView(context, index).register('datenschmiede.schemaView'),
	);
}
