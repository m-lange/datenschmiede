import { GeneratorBase } from '../base';

/**
 * Eingebauter Generator: realistisch wirkende Werte über die Python-Bibliothek
 * Faker (https://faker.readthedocs.io/). `provider` ist der Name einer
 * Faker-Methode — als vordefinierte Liste der gängigsten Provider angeboten
 * (siehe types.ts zu choices). Python-Gegenstück in python/generate.py; dort
 * wird ein fehlendes `faker`-Paket mit einer verständlichen Meldung samt
 * Installationshinweis gemeldet.
 */
export const FAKER_PROVIDERS = [
	'name',
	'first_name',
	'last_name',
	'email',
	'phone_number',
	'street_address',
	'city',
	'postcode',
	'country',
	'company',
	'job',
	'word',
	'sentence',
	'text',
	'url',
	'user_name',
	'iban',
	'credit_card_number',
	'license_plate',
	'color_name',
	'currency_code',
	'date_of_birth',
	'uuid4',
] as const;

export const FAKER_LOCALES = ['de_DE', 'de_AT', 'de_CH', 'en_US', 'en_GB', 'fr_FR', 'it_IT', 'es_ES', 'nl_NL', 'pl_PL', 'cs_CZ', 'ja_JP'] as const;

class FakerGenerator extends GeneratorBase {
	constructor() {
		super({
			id: 'faker',
			name: 'Faker',
			description: 'Realistic fake values (names, addresses, e-mail addresses, …) using the Python "faker" package.',
			displayTemplate: '{provider} ({locale})',
			parameters: [
				{
					name: 'provider',
					type: 'string',
					description: 'Faker provider (method) that produces the values, e.g. "first_name".',
					choices: [...FAKER_PROVIDERS],
					required: true,
				},
				{
					name: 'locale',
					type: 'string',
					description: 'Locale for the generated values, e.g. "de_DE".',
					choices: [...FAKER_LOCALES],
				},
			],
		});
	}
}

export const fakerGenerator = new FakerGenerator();
