/** Prefer a meaningful autosaved text value without hiding the persisted value behind a blank draft. */
export function resolveDraftField(draftValue: unknown, fallback: string): string {
	return typeof draftValue === 'string' && draftValue.trim() !== '' ? draftValue : fallback;
}
