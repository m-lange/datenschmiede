const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * Kopiert die Codicon-Assets (Icon-Font, wie sie VS Code selbst verwendet)
 * aus node_modules in den media-Ordner, damit die Webview sie referenzieren kann.
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

/** @type {import('esbuild').Plugin} */
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
