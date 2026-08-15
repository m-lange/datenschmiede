import * as vscode from 'vscode';

/**
 * The shared "Datenschmiede" output channel (VS Code's "Output" view): the full
 * log of generator runs and previews — including complete Python tracebacks and
 * stderr output, which would not fit into an error notification. Notifications
 * offer a "Show Details" button for exactly this purpose (see project/run.ts,
 * table/preview.ts).
 */
let channel: vscode.OutputChannel | undefined;

/** Returns the output channel, creating it on first use. */
export function getOutputChannel(): vscode.OutputChannel {
	if (!channel) {
		channel = vscode.window.createOutputChannel('Datenschmiede');
	}
	return channel;
}

/** Disposes the output channel; called when the extension is deactivated. */
export function disposeOutputChannel(): void {
	channel?.dispose();
	channel = undefined;
}

/**
 * Formats a point in time as `yyyy-MM-dd HH:mm:ss` in local time - the one date
 * format the extension shows anywhere (the webviews use formatDateTime in
 * media/common.js for exactly the same result).
 */
export function formatDateTime(value: Date | number): string {
	const date = value instanceof Date ? value : new Date(value);
	const pad = (n: number) => String(n).padStart(2, '0');
	return (
		`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
		`${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
	);
}

/** Appends a timestamped log line. */
export function log(message: string): void {
	getOutputChannel().appendLine(`[${formatDateTime(new Date())}] ${message}`);
}

/** Error notification with a "Show Details" button that reveals the output channel. */
export function showErrorWithDetails(message: string, ...extraButtons: string[]): Thenable<string | undefined> {
	const detailsLabel = vscode.l10n.t('Show Details');
	return vscode.window.showErrorMessage(message, ...extraButtons, detailsLabel).then((choice) => {
		if (choice === detailsLabel) {
			getOutputChannel().show(true);
			return undefined;
		}
		return choice;
	});
}
