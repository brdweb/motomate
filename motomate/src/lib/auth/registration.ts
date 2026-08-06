import { env } from '$env/dynamic/private';
import { hasAnyUser } from '$lib/db/repositories/users.js';

// Closed unlesss explicitly opened. The empty-database exception is unconditional so a fresh deployment can always onboard its first user
export async function isRegistrationOpen(): Promise<boolean> {
	if (env.AUTH_ALLOW_REGISTRATION === 'true') return true;
	return !(await hasAnyUser());
}
