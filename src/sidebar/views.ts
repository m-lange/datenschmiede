import * as vscode from 'vscode';
import { IndexedFileKind, WorkspaceIndex, WorkspaceSnapshot } from '../workspaceIndex';

/**
 * The Datenschmiede sidebar (own container in the activity bar): four
 * read-only tree views over the workspace index — projects, the schema tree of
 * all tables, lookup lists and generators.
 *
 * Everything here is a VIEW of the index, never a second source of truth: the
 * entries come from `index.snapshot()`, and every view refreshes on
 * `index.onDidChange` — but only for the file kinds it actually shows, so
 * typing in a `.td` file does not rebuild the project list.
 *
 * The entries are built EAGERLY, including for a collapsed or hidden view (see
 * `prime`), and `getChildren` hands out the finished array synchronously. VS
 * Code does not ask a collapsed view for its children, so nothing else can be
 * preloaded — but this way expanding one needs no round trip through the index
 * and shows its content immediately.
 *
 * Items are labelled with the name from INSIDE the file (project name, list
 * name, generator name, table name); the file name appears nowhere in the tree
 * but in the tooltip, below the file's description rendered as Markdown. A
 * file whose TOML is broken has no name to show — it appears with a warning
 * icon and its path, so it can be opened and repaired.
 */

/** Context key: the schema view is filtered — controls the "clear filter" button in its title bar. */
const SCHEMA_FILTERED_KEY = 'datenschmiede.schemaFiltered';

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
 * Hover text of an entry: the description from the file rendered as Markdown,
 * with the path below it. A MarkdownString rather than a plain string, so the
 * description reads in the tooltip exactly as it does in the editors —
 * headings, lists, `code` and emphasis included.
 *
 * Deliberately not trusted (`isTrusted` stays off) and without `supportHtml`:
 * the text comes from a workspace file, so it may render but must not act.
 */
function tooltipFor(path: string, description?: string): string | vscode.MarkdownString {
	const text = description?.trim();
	if (!text) {
		return path;
	}
	const tooltip = new vscode.MarkdownString();
	tooltip.appendMarkdown(text);
	// Horizontal rule between the description and the path, so the two do not
	// read as one text.
	tooltip.appendMarkdown('\n\n---\n\n');
	tooltip.appendMarkdown(`\`${path}\``);
	return tooltip;
}

/** The warning icon of an unreadable file — the same look in every view. */
function invalidIcon(): vscode.ThemeIcon {
	return new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
}

/** One file in a view. */
interface FileNode {
	uri: vscode.Uri;
	/** Name from inside the file; the path only when there is no name (broken TOML). */
	label: string;
	/** Workspace-relative path — tooltip only, never shown in the tree. */
	path: string;
	/** `false` when the file could not be parsed. */
	valid: boolean;
	/** Overrides the view's icon — the generator list mixes two kinds of file. */
	icon?: string;
	/** Markdown description from the file, shown rendered in the tooltip. */
	description?: string;
}

/**
 * Base class of the views: refresh wiring (index event filtered by file kind),
 * the preloaded entries and the `message` shown while a view is empty. A
 * subclass only says how its entries are built.
 */
abstract class IndexView<T> implements vscode.TreeDataProvider<T> {
	private readonly emitter = new vscode.EventEmitter<T | undefined>();
	public readonly onDidChangeTreeData = this.emitter.event;
	protected view: vscode.TreeView<T> | undefined;
	/** Preloaded top-level entries; `null` while they still have to be built. */
	private roots: T[] | null = null;

	constructor(
		protected readonly context: vscode.ExtensionContext,
		protected readonly index: WorkspaceIndex,
		/** File kinds whose changes affect this view. */
		private readonly kinds: IndexedFileKind[],
	) {}

	/** `true` for the views that actually nest — a "collapse all" button on a flat list would do nothing. */
	protected nested = false;

	/** Registers the view and keeps it in sync; returns the disposables to hand to the extension context. */
	public register(viewId: string): vscode.Disposable[] {
		this.view = vscode.window.createTreeView<T>(viewId, {
			treeDataProvider: this,
			showCollapseAll: this.nested,
		});
		// Build right away rather than on first opening: all views share the one
		// index snapshot, so this costs a single pass for the whole sidebar.
		void this.prime();
		const sub = this.index.onDidChange((changed) => {
			if (this.kinds.some((kind) => changed.has(kind))) {
				this.refresh();
			}
		});
		return [this.view, sub, this.emitter];
	}

	/**
	 * Builds the entries and updates the empty-state message — also for a view
	 * that is collapsed or on a hidden container, so opening it needs no
	 * loading step.
	 */
	public async prime(): Promise<T[]> {
		const snapshot = await this.index.snapshot();
		this.roots = this.build(snapshot);
		if (this.view) {
			this.view.message = this.roots.length === 0 ? this.emptyMessage() : undefined;
		}
		return this.roots;
	}

	/** Discards the entries, rebuilds them and only then tells the tree — which then finds them ready. */
	protected refresh(): void {
		this.roots = null;
		void this.prime().then(() => this.emitter.fire(undefined));
	}

	public getChildren(element?: T): vscode.ProviderResult<T[]> {
		if (element) {
			return this.childrenOf(element);
		}
		// Preloaded: hand it out without an await, so the tree renders in the
		// same turn instead of showing an empty pane first.
		return this.roots ?? this.prime();
	}

	/** Builds the top-level entries from a snapshot. */
	protected abstract build(snapshot: WorkspaceSnapshot): T[];
	/** Children of an already built entry — always available without the index. */
	protected abstract childrenOf(element: T): T[];
	protected abstract emptyMessage(): string;

	public abstract getTreeItem(element: T): vscode.TreeItem;
}

// ---------------------------------------------------------------------------
// Flat views: projects, lookup lists, generators
// ---------------------------------------------------------------------------

/**
 * A flat list of files. The three flat views differ only in where their
 * entries come from and what they are called, so everything else lives here
 * once.
 */
class FlatFileView extends IndexView<FileNode> {
	constructor(
		context: vscode.ExtensionContext,
		index: WorkspaceIndex,
		kinds: IndexedFileKind[],
		private readonly config: {
			/** Base name of the icon pair in `icons/`. */
			icon: string;
			contextValue: string;
			emptyText: string;
			items: (snapshot: WorkspaceSnapshot) => FileNode[];
		},
	) {
		super(context, index, kinds);
	}

	protected build(snapshot: WorkspaceSnapshot): FileNode[] {
		return this.config.items(snapshot).sort((a, b) => a.label.localeCompare(b.label));
	}

	protected childrenOf(): FileNode[] {
		return [];
	}

	protected emptyMessage(): string {
		return this.config.emptyText;
	}

	public getTreeItem(element: FileNode): vscode.TreeItem {
		const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
		item.resourceUri = element.uri;
		item.tooltip = tooltipFor(element.path, element.description);
		item.command = openCommand(element.uri);
		item.contextValue = this.config.contextValue;
		item.iconPath = element.valid ? fileIcon(this.context, element.icon ?? this.config.icon) : invalidIcon();
		return item;
	}
}

// ---------------------------------------------------------------------------
// Schema: namespace tree with the tables underneath, filterable
// ---------------------------------------------------------------------------

type SchemaNode =
	| { kind: 'schema'; id: string; segment: string; children: SchemaNode[] }
	| ({ kind: 'table'; id: string; parent: string | null } & FileNode);

class SchemaView extends IndexView<SchemaNode> {
	/** Active filter (lower case), or `''` for none. */
	private filter = '';
	/** Every node of the last build, by id — for `getParent`, which `reveal` needs. */
	private readonly nodes = new Map<string, SchemaNode>();

	constructor(context: vscode.ExtensionContext, index: WorkspaceIndex) {
		super(context, index, ['td']);
		this.nested = true;
	}

	protected emptyMessage(): string {
		return this.filter
			? vscode.l10n.t('No table matches the filter.')
			: vscode.l10n.t('No table definitions in this workspace.');
	}

	protected childrenOf(element: SchemaNode): SchemaNode[] {
		return element.kind === 'schema' ? element.children : [];
	}

	/**
	 * Asks for a filter and applies it. Empty input removes the filter, so the
	 * same command both sets and clears it.
	 */
	public async promptFilter(): Promise<void> {
		const input = await vscode.window.showInputBox({
			title: vscode.l10n.t('Filter Schema'),
			prompt: vscode.l10n.t('Show only schemas and tables containing this text.'),
			value: this.filter,
			placeHolder: vscode.l10n.t('e.g. customer'),
		});
		if (input === undefined) {
			return;
		}
		this.applyFilter(input.trim());
	}

	public clearFilter(): void {
		this.applyFilter('');
	}

	private applyFilter(filter: string): void {
		this.filter = filter.toLowerCase();
		// The active filter belongs in the title line: a view showing three of
		// thirty tables must not look like the whole workspace.
		if (this.view) {
			this.view.description = filter || undefined;
		}
		void vscode.commands.executeCommand('setContext', SCHEMA_FILTERED_KEY, this.filter.length > 0);
		this.refresh();
	}

	/**
	 * Expands every namespace. VS Code honours `collapsibleState` only the first
	 * time an item is rendered (after that it remembers what the user did), so
	 * expanding has to go through `reveal` — which is why this view implements
	 * `getParent`.
	 */
	public async expandAll(): Promise<void> {
		if (!this.view) {
			return;
		}
		if (this.nodes.size === 0) {
			await this.prime();
		}
		for (const node of [...this.nodes.values()]) {
			if (node.kind === 'schema') {
				await this.view.reveal(node, { expand: true, select: false, focus: false });
			}
		}
	}

	public getParent(element: SchemaNode): SchemaNode | undefined {
		if (element.kind === 'table') {
			return element.parent ? this.nodes.get(element.parent) : undefined;
		}
		const cut = element.id.lastIndexOf('.');
		return cut < 0 ? undefined : this.nodes.get(element.id.slice(0, cut));
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
		item.resourceUri = element.uri;
		item.tooltip = tooltipFor(element.path, element.description);
		item.command = openCommand(element.uri);
		item.contextValue = 'datenschmiede.table';
		item.id = element.id;
		item.iconPath = element.valid ? fileIcon(this.context, 'td') : invalidIcon();
		return item;
	}

	protected build(snapshot: WorkspaceSnapshot): SchemaNode[] {
		// Same grouping as the project editor's table picker: the schema is split
		// on dots, so "shop.master" nests "master" under "shop"; tables without a
		// schema sit at the top level.
		interface Group {
			segment: string;
			children: Map<string, Group>;
			tables: { entry: (typeof snapshot.tables)[number]; label: string }[];
		}
		const root: Group = { segment: '', children: new Map(), tables: [] };
		for (const entry of snapshot.tables) {
			const schema = entry.table?.schema.trim() ?? '';
			const label = entry.table ? entry.table.name.trim() || entry.relativePath : entry.relativePath;
			// The filter runs against the full logical name, so both "shop" and
			// "customer" find shop.master.customers — and a matching namespace
			// keeps everything below it, which is what one wants when filtering
			// by schema.
			if (this.filter && !`${schema}.${label}`.toLowerCase().includes(this.filter)) {
				continue;
			}
			const segments = schema
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
			node.tables.push({ entry, label });
		}

		this.nodes.clear();
		const toNodes = (group: Group, path: string): SchemaNode[] => {
			const schemas = [...group.children.values()]
				.sort((a, b) => a.segment.localeCompare(b.segment))
				.map((child): SchemaNode => {
					const id = path ? `${path}.${child.segment}` : child.segment;
					const node: SchemaNode = { kind: 'schema', id, segment: child.segment, children: toNodes(child, id) };
					this.nodes.set(id, node);
					return node;
				});
			const tables = group.tables
				.slice()
				.sort((a, b) => a.label.localeCompare(b.label))
				.map((item): SchemaNode => {
					const node: SchemaNode = {
						kind: 'table',
						// The path keeps the id unique even if two files claim the
						// same schema and name.
						id: `table:${item.entry.relativePath}`,
						parent: path || null,
						uri: item.entry.uri,
						label: item.label,
						path: item.entry.relativePath,
						valid: !!item.entry.table,
						description: item.entry.table?.description,
					};
					this.nodes.set(node.id, node);
					return node;
				});
			return [...schemas, ...tables];
		};
		return toNodes(root, '');
	}
}

// ---------------------------------------------------------------------------

/** Registers all sidebar views and their commands; call once during activation. */
export function registerSidebar(context: vscode.ExtensionContext, index: WorkspaceIndex): void {
	const projects = new FlatFileView(context, index, ['tdproject'], {
		icon: 'tdproject',
		contextValue: 'datenschmiede.project',
		emptyText: vscode.l10n.t('No test data projects in this workspace.'),
		items: (snapshot) =>
			snapshot.projects.map((entry) => ({
				uri: entry.uri,
				label: entry.project?.name.trim() || entry.relativePath,
				path: entry.relativePath,
				valid: !!entry.project,
				description: entry.project?.description,
			})),
	});

	const schema = new SchemaView(context, index);

	const lookups = new FlatFileView(context, index, ['lkp'], {
		icon: 'lookup',
		contextValue: 'datenschmiede.lookup',
		emptyText: vscode.l10n.t('No lookup lists in this workspace.'),
		items: (snapshot) =>
			snapshot.lookups.map((entry) => ({
				uri: entry.uri,
				// entry.name is the `# name:` metadata, falling back to the file name.
				label: entry.lookup ? entry.name : entry.relativePath,
				path: entry.relativePath,
				valid: !!entry.lookup,
				description: entry.lookup?.description,
			})),
	});

	// Data generators and file generators share one list: they are named the
	// same way and used in the same place, and the file icon already says which
	// of the two a line is - a second view (or a group level) would only add a
	// click without adding information.
	const generators = new FlatFileView(context, index, ['tdgen', 'filegen'], {
		icon: 'tdgen',
		contextValue: 'datenschmiede.generator',
		emptyText: vscode.l10n.t('No generators in this workspace.'),
		items: (snapshot) => [
			...snapshot.generators.map((entry) => ({
				uri: entry.uri,
				label: entry.generator?.name.trim() || entry.file?.name.trim() || entry.relativePath,
				path: entry.relativePath,
				valid: !!entry.file,
				icon: 'tdgen',
				description: entry.generator?.description ?? entry.file?.description,
			})),
			...snapshot.fileGenerators.map((entry) => ({
				uri: entry.uri,
				label: entry.file?.name.trim() || entry.relativePath,
				path: entry.relativePath,
				valid: !!entry.file,
				icon: 'filegen',
				description: entry.file?.description,
			})),
		],
	});

	context.subscriptions.push(
		...projects.register('datenschmiede.projectsView'),
		...schema.register('datenschmiede.schemaView'),
		...lookups.register('datenschmiede.lookupsView'),
		...generators.register('datenschmiede.generatorsView'),
		vscode.commands.registerCommand('datenschmiede.filterSchemaView', () => schema.promptFilter()),
		vscode.commands.registerCommand('datenschmiede.clearSchemaViewFilter', () => schema.clearFilter()),
		vscode.commands.registerCommand('datenschmiede.expandSchemaView', () => schema.expandAll()),
	);
	void vscode.commands.executeCommand('setContext', SCHEMA_FILTERED_KEY, false);
}
