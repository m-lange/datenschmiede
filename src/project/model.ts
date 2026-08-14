/**
 * Data model of a .tdproject test data project.
 *
 * As with table/model.ts this is the "truth" the project webview works with;
 * the extension host builds it from the document's TOML text (see
 * project/toml.ts) and serializes it back to TOML after every change.
 */

/** One of the tables belonging to this project (selected via the table tree, see project/tree.ts). */
export interface ProjectTable {
	/** Workspace-relative path (POSIX separators) of the associated `.td` file. */
	path: string;
	/**
	 * Number of records to generate, as a compact string. For tables without a
	 * valid outgoing foreign key (primary tables) a fixed number ("100"); for
	 * tables with an outgoing foreign key (referenced, i.e. secondary tables)
	 * the count per record of the referenced table — a fixed number ("5") or a
	 * range ("1..3"), see table/cardinality.ts. Mandatory for every selected
	 * table; if the value is missing the project editor reports it in the
	 * Problems view (see buildRecordsDiagnostics in project/editorProvider.ts).
	 */
	records?: string;
}

/** The Python interpreter linked to this project (used by the generator run). */
export interface PythonLink {
	/** Path to the Python interpreter or to the environment folder. */
	path: string;
	/** ID of the environment from the Python extension, if known — best effort for re-resolution (see project/python.ts). */
	id?: string;
}

/** A complete `.tdproject` test data project. */
export interface Project {
	name: string;
	description: string;
	/** `null` while no Python interpreter has been linked yet. */
	python: PythonLink | null;
	/**
	 * Output folder of the generator run, relative to the project file
	 * (absolute paths allowed), as a template with `{…}` variables (date,
	 * timestamp, project name, … — resolved in python/generate.py). Empty ->
	 * `output`.
	 */
	outputPath: string;
	tables: ProjectTable[];
}

/** Creates a blank project, used when a new `.tdproject` file is created. */
export function createEmptyProject(name = ''): Project {
	return { name, description: '', python: null, outputPath: '', tables: [] };
}
