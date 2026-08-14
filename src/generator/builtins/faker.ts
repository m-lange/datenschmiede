import { GeneratorBase } from '../base';

/**
 * Built-in generator: realistic-looking values via the Python library Faker
 * (https://faker.readthedocs.io/). `provider` is the name of a Faker method —
 * offered as a predefined list of the most common providers (see `choices` in
 * types.ts). Its Python counterpart lives in python/generate.py, which reports
 * a missing `faker` package with an understandable message including
 * installation instructions.
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
	'date_this_year',
	'date_time_this_year',
	'boolean',
	'uuid4',
] as const;

/** Locales offered for the `locale` parameter. */
export const FAKER_LOCALES = ['de_DE', 'de_AT', 'de_CH', 'en_US', 'en_GB', 'fr_FR', 'it_IT', 'es_ES', 'nl_NL', 'pl_PL', 'cs_CZ', 'ja_JP'] as const;

/** See the module doc comment above. */
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
