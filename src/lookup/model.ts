/**
 * Datenmodell einer .lkp-Nachschlageliste (Lookup-Liste) für den
 * Testdaten-Generator.
 *
 * Analog zu table/model.ts ist dieses Modell die "Wahrheit", mit der die
 * Webview arbeitet. Es wird vom Extension-Host aus dem CSV-Text der
 * Dokument-Datei erzeugt (siehe lookup/csv.ts) und nach jeder Änderung
 * wieder zu CSV serialisiert.
 */

/**
 * Eine Wertezeile der Liste: die Werte je Spalte (in der Reihenfolge von
 * `LookupList.columns`) plus ihr Gewicht in Prozent. Das Gewicht bleibt
 * bewusst ein String (analog zu `records` in project/model.ts), damit eine
 * ungültige Eingabe erhalten bleibt und von der Validierung gemeldet werden
 * kann, statt sie stillschweigend zu verwerfen.
 */
export interface LookupRow {
	values: string[];
	/** Gewicht in Prozent ("25" oder "12.5"/"12,5") — alle Zeilen zusammen sollen 100 ergeben. */
	weight: string;
}

export interface LookupList {
	name: string;
	description: string;
	/** Namen der Wertespalten — die feste Gewichtsspalte ("weight") gehört nicht dazu, sie existiert immer als letzte Spalte. */
	columns: string[];
	rows: LookupRow[];
}

export function createEmptyLookup(name = ''): LookupList {
	return { name, description: '', columns: [], rows: [] };
}

/**
 * Liest ein Gewicht ("25", "12.5", auch mit Dezimal-Komma "12,5") als Zahl;
 * `null` bei leerer oder ungültiger Eingabe (z. B. negativ oder kein
 * Zahlenformat). Bewusst vscode-frei; die Webview (media/lookup.js) hält
 * eine gleichlautende Kopie, da sie ohne Modul-Bundling auskommt.
 *
 * Eine Summen-Prüfung („alle Gewichte = 100 %“) gibt es absichtlich nicht:
 * die eingegebenen Gewichte gelten unverändert (auch weit über 100 % in
 * Summe); die Summenzeile der Webview zeigt den Gesamtwert rein informativ.
 */
export function parseWeight(raw: string): number | null {
	const text = (raw ?? '').trim().replace(',', '.');
	if (!/^\d+(\.\d+)?$/.test(text)) {
		return null;
	}
	const value = Number(text);
	return Number.isFinite(value) ? value : null;
}
