import { assertSafeUrl } from './url-guard.js';

export type PaperlessConfig = { url: string; token: string };

const TIMEOUT_MS = 30_000;

// Formats the paperless consumer can parse. Office types need Tika, so a rejection is still possible.
const SUPPORTED_MIME = new Set([
	'application/pdf',
	'image/png',
	'image/jpeg',
	'image/tiff',
	'image/gif',
	'image/webp',
	'text/plain',
	'application/msword',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'application/vnd.oasis.opendocument.text',
	'application/vnd.ms-powerpoint',
	'application/vnd.openxmlformats-officedocument.presentationml.presentation',
	'application/vnd.oasis.opendocument.presentation',
	'application/vnd.ms-excel',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	'application/vnd.oasis.opendocument.spreadsheet'
]);

const SUPPORTED_EXT = new Set([
	'pdf',
	'png',
	'jpg',
	'jpeg',
	'tif',
	'tiff',
	'gif',
	'webp',
	'txt',
	'doc',
	'docx',
	'odt',
	'ppt',
	'pptx',
	'odp',
	'xls',
	'xlsx',
	'ods'
]);

// Browsers send junk mime types often enough that the extension is worth a second look.
export function paperlessSupports(mime: string, filename: string): boolean {
	if (SUPPORTED_MIME.has(mime.toLowerCase())) return true;
	return SUPPORTED_EXT.has(filename.split('.').pop()?.toLowerCase() ?? '');
}

// Paperless refused this specific file (unsupported type, duplicate, unreadable). Not a connection problem.
export class PaperlessRejection extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
		this.name = 'PaperlessRejection';
	}
}

// User-supplied URL: http(s) only, no redirects, so it cannot be bounced to another host.
async function base(url: string): Promise<string> {
	await assertSafeUrl(url);
	return url.replace(/\/+$/, '');
}

function headers(cfg: PaperlessConfig): Record<string, string> {
	return { Authorization: `Token ${cfg.token}`, Accept: 'application/json' };
}

export async function paperlessTest(cfg: PaperlessConfig): Promise<void> {
	const res = await fetch(`${await base(cfg.url)}/api/documents/?page_size=1`, {
		headers: headers(cfg),
		redirect: 'manual',
		signal: AbortSignal.timeout(TIMEOUT_MS)
	});
	if (res.status === 401 || res.status === 403) throw new Error('Paperless rejected the API token');
	if (!res.ok) throw new Error(`Paperless responded with ${res.status}`);
}

// Returns the consume task id. Duplicates are rejected by the paperless consumer, so reposting is safe.
export async function paperlessPost(
	cfg: PaperlessConfig,
	file: { buffer: Buffer; filename: string; mime: string; title?: string; created?: string }
): Promise<string> {
	const form = new FormData();
	form.append(
		'document',
		new Blob([new Uint8Array(file.buffer)], { type: file.mime }),
		file.filename
	);
	if (file.title) form.append('title', file.title);
	if (file.created) form.append('created', file.created);

	const res = await fetch(`${await base(cfg.url)}/api/documents/post_document/`, {
		method: 'POST',
		headers: headers(cfg),
		body: form,
		redirect: 'manual',
		signal: AbortSignal.timeout(TIMEOUT_MS)
	});
	if (!res.ok) {
		const detail = (await res.text().catch(() => '')).slice(0, 200).trim();
		const message = `Paperless responded with ${res.status}${detail ? `: ${detail}` : ''}`;
		if (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 403) {
			throw new PaperlessRejection(message, res.status);
		}
		throw new Error(message);
	}
	return (await res.text()).replace(/^"|"$/g, '');
}
