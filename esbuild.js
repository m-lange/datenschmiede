// Build script: bundles the extension host (src/extension.ts) with esbuild and
// copies the codicon assets into media/. The webview scripts in media/ are
// deliberately NOT bundled — they are loaded as plain, uncompiled scripts.

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * Copies the codicon assets (the icon font VS Code itself uses) from
 * node_modules into the media folder, so the webviews can reference them.
 */
function copyCodicons() {
	const srcDir = path.join(__dirname, 'node_modules', '@vscode', 'codicons', 'dist');
	const destDir = path.join(__dirname, 'media');
	if (!fs.existsSync(destDir)) {
		fs.mkdirSync(destDir, { recursive: true });
	}
	for (const file of ['codicon.css', 'codicon.ttf']) {
		fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
	}
}

/**
 * Prints build start/end and errors in the format the watch task's problem
 * matcher expects (see .vscode/tasks.json).
 * @type {import('esbuild').Plugin}
 */
const problemMatcherPlugin = {
	name: 'problem-matcher',
	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			for (const { text, location } of result.errors) {
				console.error(`✘ [ERROR] ${text}`);
				if (location) {
					console.error(`    ${location.file}:${location.line}:${location.column}:`);
				}
			}
			console.log('[watch] build finished');
		});
	},
};

/** Runs a single build, or starts watch mode with `--watch`. */
async function main() {
	copyCodicons();

	const ctx = await esbuild.context({
		entryPoints: ['src/extension.ts'],
		bundle: true,
		format: 'cjs',
		platform: 'node',
		target: 'node20',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		logLevel: 'silent',
		plugins: [problemMatcherPlugin],
	});

	if (watch) {
		await ctx.watch();
	} else {
		await ctx.rebuild();
		await ctx.dispose();
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
