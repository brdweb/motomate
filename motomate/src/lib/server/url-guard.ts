import { lookup } from 'node:dns/promises';

// Link-local only; private and loopback stay reachable since homelab webhooks legitimatly target the LAN
function isLinkLocal(address: string): boolean {
	return address.startsWith('169.254.') || /^fe[89ab]/i.test(address);
}

export async function assertSafeUrl(raw: string): Promise<URL> {
	const url = new URL(raw);
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error('URL must use http or https');
	}
	// An IP literal resolves to itself; strip the brackets URL keeps on IPv6 since lookup reject them
	const { address } = await lookup(url.hostname.replace(/^\[|\]$/g, ''));
	if (isLinkLocal(address)) {
		throw new Error('URL resolves to a link-local address');
	}
	return url;
}
