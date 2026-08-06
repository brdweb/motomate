import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		// CSRF is enforced in hooks.server.ts instead: it covers every method and content type, not
		// just form posts, and matches on hostname so a TLS-terminating proxy cannot 403 real users.
		csrf: {
			trustedOrigins: ['*']
		}
	}
};

export default config;
