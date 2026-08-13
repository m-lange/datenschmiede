/**
 * Kardinalität zugehöriger Datensätze für eine Fremdschlüssel-Beziehung, als
 * kompakter String angegeben: entweder eine feste Zahl ("5") oder ein
 * Bereich ("1..3", beide Enden inklusive). Wird im Projekt gepflegt
 * (Datensätze-Feld referenzierter Tabellen im Projekt-Editor), nicht mehr in
 * der `.td`-Datei.
 *
 * Bewusst frei von jeder vscode-Abhängigkeit (einfach testbar); wird sowohl
 * von project/editorProvider.ts (Diagnostics) als auch — als kleines,
 * eigenständiges Gegenstück — von media/project.js für die sofortige
 * Eingabe-Rückmeldung genutzt.
 */
export interface Cardinality {
	min: number;
	max: number;
}

const CARDINALITY_PATTERN = /^\s*(\d+)\s*(?:\.\.\s*(\d+)\s*)?$/;

export function parseCardinality(raw: string): Cardinality | null {
	const match = CARDINALITY_PATTERN.exec(raw ?? '');
	if (!match) {
		return null;
	}
	const min = Number(match[1]);
	const max = match[2] !== undefined ? Number(match[2]) : min;
	if (min > max) {
		return null;
	}
	return { min, max };
}
