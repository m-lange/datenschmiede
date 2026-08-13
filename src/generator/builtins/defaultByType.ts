import { GeneratorBase } from '../base';

/**
 * Eingebauter Generator: bewusst gewählter Standard je Datentyp — dieselben
 * Werte, die der Lauf für Spalten ganz ohne Generator erzeugt (laufende
 * Nummer für integer, UUID4, Zufallsdatum, …; siehe default_by_type in
 * python/generate.py). Anders als „— keiner —“ ist die Auswahl damit
 * explizit dokumentiert und löst keine Warnung in der Problems-Ansicht aus.
 */
class DefaultByTypeGenerator extends GeneratorBase {
	constructor() {
		super({
			id: 'default',
			name: 'Default by Type',
			description:
				"Sensible default values based on the column's data type: sequence for integers, UUID4, random dates, generic strings, …",
			parameters: [],
		});
	}
}

export const defaultByTypeGenerator = new DefaultByTypeGenerator();
