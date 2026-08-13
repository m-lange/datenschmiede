import * as vscode from 'vscode';

/**
 * Gemeinsamer Output-Channel „Datenschmiede“ (Ansicht „Output“/„Ausgabe“ in
 * VS Code): vollständiges Protokoll der Generator-Läufe und Vorschauen —
 * inklusive kompletter Python-Tracebacks und stderr-Ausgaben, die in einer
 * Fehler-Notification keinen Platz hätten. Die Notifications bieten dafür
 * einen „Details anzeigen“-Knopf an (siehe project/run.ts, table/preview.ts).
 */
let channel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
	if (!channel) {
		channel = vscode.window.createOutputChannel('Datenschmiede');
	}
	return channel;
}

export function disposeOutputChannel(): void {
	channel?.dispose();
	channel = undefined;
}

/** Protokollzeile mit Zeitstempel. */
export function log(message: string): void {
	getOutputChannel().appendLine(`[${new Date().toISOString()}] ${message}`);
}

/** Fehler-Notification mit „Details anzeigen“-Knopf, der den Output-Channel öffnet. */
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
