import { describe, expect, it } from 'vitest';
import { UserSettingsSchema } from '$lib/validators/schemas.js';

describe('account currency settings', () => {
	it.each(['EUR', 'GBP', 'CHF', 'USD'])('accepts the supported %s currency', (currency) => {
		expect(UserSettingsSchema.safeParse({ currency }).success).toBe(true);
	});

	it.each(['XXX', 'usd', 'USD ', 'US'])('rejects an unsupported currency code: %s', (currency) => {
		expect(UserSettingsSchema.safeParse({ currency }).success).toBe(false);
	});
});
