import { describe, expect, it } from 'vitest';
import { resolveDraftField } from '$lib/utils/draft-values.js';

describe('resolveDraftField', () => {
	it('falls back to the persisted odometer when an autosaved draft has a blank value', () => {
		expect(resolveDraftField('', '16093')).toBe('16093');
	});

	it('restores a nonblank draft value', () => {
		expect(resolveDraftField('10000', '16093')).toBe('10000');
	});
});
