import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: { AUTH_SECRET: 'test-secret-at-least-32-characters-long' }
}));
vi.mock('$lib/db/repositories/users.js', () => ({
	getUserById: vi.fn(),
	getUserIdsWithIntegrations: vi.fn(async () => []),
	updateUserSettings: vi.fn()
}));
vi.mock('$lib/db/repositories/documents.js', () => ({ getDocumentsByUser: vi.fn() }));
vi.mock('$lib/db/repositories/vehicles.js', () => ({ getVehiclesByUser: vi.fn() }));
vi.mock('$lib/workflow/channels/inapp.js', () => ({
	raiseSystemAlert: vi.fn(async () => {}),
	clearSystemAlert: vi.fn(async () => {})
}));
vi.mock('$lib/storage/index.js', () => ({ getStorage: vi.fn() }));
vi.mock('$lib/storage/s3.js', async (original) => ({
	...(await original<Record<string, unknown>>()),
	s3Put: vi.fn(),
	s3Exists: vi.fn(),
	s3MarkDeleted: vi.fn(),
	s3Test: vi.fn()
}));
vi.mock('$lib/server/paperless.js', async (original) => ({
	...(await original<Record<string, unknown>>()),
	paperlessPost: vi.fn(),
	paperlessTest: vi.fn()
}));

import {
	getUserById,
	getUserIdsWithIntegrations,
	updateUserSettings
} from '$lib/db/repositories/users.js';
import { getDocumentsByUser } from '$lib/db/repositories/documents.js';
import { getVehiclesByUser } from '$lib/db/repositories/vehicles.js';
import { raiseSystemAlert, clearSystemAlert } from '$lib/workflow/channels/inapp.js';
import { getStorage } from '$lib/storage/index.js';
import { s3Put, s3Exists, s3ClientConfig } from '$lib/storage/s3.js';
import { paperlessPost, PaperlessRejection } from '$lib/server/paperless.js';
import { encryptSecret, decryptSecret, redactCredentials } from '$lib/server/secrets.js';
import { resolveIntegrations, syncAll, runIntegrationSync } from '$lib/server/integrations.js';
import type { UserSettings } from '$lib/db/schema.js';

function settings(overrides: Record<string, unknown> = {}): UserSettings {
	return {
		theme: 'system',
		currency: 'EUR',
		odometer_unit: 'km',
		locale: 'en',
		integrations: {
			s3: {
				enabled: true,
				endpoint: 'http://minio.local:9000',
				region: 'eu-west-1',
				bucket: 'motomate',
				access_key: 'AKIA_TEST',
				secret_key: encryptSecret('s3-secret'),
				last_sync_at: null
			},
			paperless: {
				enabled: true,
				url: 'http://paperless.local',
				token: encryptSecret('pl-token'),
				last_sync_at: null
			},
			...(overrides.integrations as object)
		},
		...overrides
	} as unknown as UserSettings;
}

function doc(id: string, created_at: string) {
	return {
		id,
		name: `${id}.pdf`,
		title: null,
		storage_key: `files/u1/${id}.pdf`,
		mime_type: 'application/pdf',
		created_at
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(getStorage).mockReturnValue({
		getBuffer: vi.fn().mockResolvedValue(Buffer.from('file'))
	} as never);
	vi.mocked(getVehiclesByUser).mockResolvedValue([]);
	vi.mocked(getDocumentsByUser).mockResolvedValue([]);
	vi.mocked(s3Exists).mockResolvedValue(false);
	vi.mocked(s3Put).mockResolvedValue(undefined);
	vi.mocked(paperlessPost).mockResolvedValue('task-id');
	vi.mocked(raiseSystemAlert).mockResolvedValue(undefined);
	vi.mocked(clearSystemAlert).mockResolvedValue(undefined);
});

describe('credential storage', () => {
	it('round-trips an encrypted secret', () => {
		const stored = encryptSecret('hunter2');
		expect(stored).not.toContain('hunter2');
		expect(decryptSecret(stored)).toBe('hunter2');
	});

	it('reads back values written before encryption existed', () => {
		expect(decryptSecret('plain-value')).toBe('plain-value');
	});

	it('strips credentials before a user object is exposed', () => {
		const redacted = redactCredentials({ id: 'u1', settings: settings() });
		expect(redacted.settings.integrations?.s3?.secret_key).toBeUndefined();
		expect(redacted.settings.integrations?.s3?.access_key).toBeUndefined();
		expect(redacted.settings.integrations?.paperless?.token).toBeUndefined();
		expect(redacted.settings.integrations?.s3?.bucket).toBe('motomate');
	});
});

describe('resolveIntegrations', () => {
	it('decrypts credentials for an enabled target', () => {
		const { s3, paperless } = resolveIntegrations(settings());
		expect(s3?.secret_key).toBe('s3-secret');
		expect(paperless?.token).toBe('pl-token');
	});

	it('returns null when disabled or incomplete', () => {
		const off = resolveIntegrations(
			settings({ integrations: { s3: { enabled: false }, paperless: { enabled: true } } })
		);
		expect(off.s3).toBeNull();
		expect(off.paperless).toBeNull();
	});
});

describe('S3 client config', () => {
	it('uses path-style addressing for self-hosted providers', () => {
		for (const endpoint of ['http://minio.local:9000', 'http://seaweedfs.local:8333']) {
			const cfg = s3ClientConfig({
				endpoint,
				bucket: 'motomate',
				access_key: 'a',
				secret_key: 'b'
			});
			expect(cfg.forcePathStyle).toBe(true);
			expect(cfg.endpoint).toBe(endpoint);
		}
	});

	it('uses virtual-host addressing and a default region for AWS', () => {
		const cfg = s3ClientConfig({ bucket: 'motomate', access_key: 'a', secret_key: 'b' });
		expect(cfg.forcePathStyle).toBe(false);
		expect(cfg.endpoint).toBeUndefined();
		expect(cfg.region).toBe('eu-west-1');
	});
});

describe('syncAll', () => {
	it('uploads what is missing and skips what the bucket already has', async () => {
		vi.mocked(getUserById).mockResolvedValue({ id: 'u1', settings: settings() } as never);
		vi.mocked(getDocumentsByUser).mockResolvedValue([
			doc('a', '2026-01-01 10:00:00'),
			doc('b', '2026-01-02 10:00:00')
		] as never);
		vi.mocked(s3Exists).mockImplementation(async (_cfg, key) => key.endsWith('a.pdf'));

		const summary = await syncAll('u1');

		expect(summary.filesSkipped).toBe(1);
		expect(summary.filesUploaded).toBe(1);
		expect(vi.mocked(s3Put)).toHaveBeenCalledTimes(1);
		expect(summary.docsPushed).toBe(2);
		expect(vi.mocked(clearSystemAlert)).toHaveBeenCalledWith('u1', 's3');
	});

	it('reports failures, keeps the paperless cursor and raises one alert', async () => {
		vi.mocked(getUserById).mockResolvedValue({ id: 'u1', settings: settings() } as never);
		vi.mocked(getDocumentsByUser).mockResolvedValue([doc('a', '2026-01-01 10:00:00')] as never);
		vi.mocked(paperlessPost).mockRejectedValue(new Error('connect ECONNREFUSED'));

		const summary = await syncAll('u1');

		expect(summary.docsFailed).toBe(1);
		expect(summary.errors[0]).toContain('ECONNREFUSED');
		expect(vi.mocked(raiseSystemAlert)).toHaveBeenCalledWith(
			'u1',
			'paperless',
			expect.any(String),
			expect.stringContaining('ECONNREFUSED'),
			'/settings/integrations'
		);
		const saved = vi.mocked(updateUserSettings).mock.calls[0][1];
		expect(saved.integrations?.paperless?.last_sync_at).toBeNull();
		expect(saved.integrations?.s3?.last_sync_at).not.toBeNull();
	});

	it('only sends documents added since the last successful run', async () => {
		vi.mocked(getUserById).mockResolvedValue({
			id: 'u1',
			settings: settings({
				integrations: {
					paperless: {
						enabled: true,
						url: 'http://paperless.local',
						token: encryptSecret('pl-token'),
						last_sync_at: '2026-01-02 00:00:00'
					}
				}
			})
		} as never);
		vi.mocked(getDocumentsByUser).mockResolvedValue([
			doc('old', '2026-01-01 10:00:00'),
			doc('new', '2026-01-03 10:00:00')
		] as never);

		const summary = await syncAll('u1');

		expect(summary.docsPushed).toBe(1);
		expect(vi.mocked(paperlessPost).mock.calls[0][1].filename).toBe('new.pdf');
	});

	it('skips file types paperless cannot parse and still mirrors them to S3', async () => {
		vi.mocked(getUserById).mockResolvedValue({ id: 'u1', settings: settings() } as never);
		vi.mocked(getDocumentsByUser).mockResolvedValue([
			{
				id: 'gpx',
				name: 'day-1.gpx',
				title: null,
				storage_key: 'files/u1/gpx.gpx',
				mime_type: 'application/gpx+xml',
				created_at: '2026-01-01 10:00:00'
			},
			doc('invoice', '2026-01-02 10:00:00')
		] as never);

		const summary = await syncAll('u1');

		expect(summary.docsSkipped).toBe(1);
		expect(summary.docsPushed).toBe(1);
		expect(summary.docsFailed).toBe(0);
		expect(vi.mocked(paperlessPost).mock.calls[0][1].filename).toBe('invoice.pdf');
		expect(vi.mocked(s3Put)).toHaveBeenCalledTimes(2);
	});

	it('never archives a report this app generated, whatever the file is called', async () => {
		const { PDFDocument } = await import('pdf-lib');
		const report = await PDFDocument.create();
		report.addPage();
		report.setAuthor('MotoMate');
		const reportBytes = Buffer.from(await report.save());

		const scan = await PDFDocument.create();
		scan.addPage();
		scan.setAuthor('Some Scanner');
		const scanBytes = Buffer.from(await scan.save());

		vi.mocked(getStorage).mockReturnValue({
			getBuffer: vi.fn(async (key: string) => (key.includes('report') ? reportBytes : scanBytes))
		} as never);
		vi.mocked(getUserById).mockResolvedValue({ id: 'u1', settings: settings() } as never);
		vi.mocked(getDocumentsByUser).mockResolvedValue([
			{
				id: 'r',
				name: 'Werkplaatsfactuur 2026.pdf',
				title: null,
				storage_key: 'files/u1/report.pdf',
				mime_type: 'application/pdf',
				created_at: '2026-01-01 10:00:00'
			},
			{
				id: 's',
				name: 'maintenance-report-lookalike.pdf',
				title: null,
				storage_key: 'files/u1/scan.pdf',
				mime_type: 'application/pdf',
				created_at: '2026-01-02 10:00:00'
			}
		] as never);

		const summary = await syncAll('u1');

		expect(summary.docsSkipped).toBe(1);
		expect(summary.skipped[0]).toContain('Werkplaatsfactuur 2026.pdf');
		expect(summary.docsPushed).toBe(1);
		expect(vi.mocked(paperlessPost).mock.calls[0][1].filename).toBe(
			'maintenance-report-lookalike.pdf'
		);
	});

	it('archives reports when the user asks for them', async () => {
		const { PDFDocument } = await import('pdf-lib');
		const report = await PDFDocument.create();
		report.addPage();
		report.setAuthor('MotoMate');
		const bytes = Buffer.from(await report.save());

		vi.mocked(getStorage).mockReturnValue({ getBuffer: vi.fn(async () => bytes) } as never);
		vi.mocked(getUserById).mockResolvedValue({
			id: 'u1',
			settings: settings({
				integrations: {
					paperless: {
						enabled: true,
						url: 'http://paperless.local',
						token: encryptSecret('pl-token'),
						include_reports: true,
						last_sync_at: null
					}
				}
			})
		} as never);
		vi.mocked(getDocumentsByUser).mockResolvedValue([doc('a', '2026-01-01 10:00:00')] as never);

		const summary = await syncAll('u1');

		expect(summary.docsSkipped).toBe(0);
		expect(summary.docsPushed).toBe(1);
	});

	it('counts a paperless rejection as skipped rather than a failure', async () => {
		vi.mocked(getUserById).mockResolvedValue({ id: 'u1', settings: settings() } as never);
		vi.mocked(getDocumentsByUser).mockResolvedValue([doc('a', '2026-01-01 10:00:00')] as never);
		vi.mocked(paperlessPost).mockRejectedValue(
			new PaperlessRejection('Paperless responded with 400: unsupported', 400)
		);

		const summary = await syncAll('u1');

		expect(summary.docsSkipped).toBe(1);
		expect(summary.docsFailed).toBe(0);
		expect(vi.mocked(raiseSystemAlert)).not.toHaveBeenCalled();
		expect(vi.mocked(clearSystemAlert)).toHaveBeenCalledWith('u1', 'paperless');
	});

	it('resends everything when the archive was emptied', async () => {
		const withCursor = {
			id: 'u1',
			settings: settings({
				integrations: {
					paperless: {
						enabled: true,
						url: 'http://paperless.local',
						token: encryptSecret('pl-token'),
						last_sync_at: '2026-02-01 00:00:00'
					}
				}
			})
		};
		vi.mocked(getUserById).mockResolvedValue(withCursor as never);
		vi.mocked(getDocumentsByUser).mockResolvedValue([
			doc('a', '2026-01-01 10:00:00'),
			doc('b', '2026-01-02 10:00:00')
		] as never);

		const normal = await syncAll('u1');
		expect(normal.docsPushed).toBe(0);
		expect(normal.docsAlreadySent).toBe(2);

		const resent = await syncAll('u1', { resend: true });
		expect(resent.docsPushed).toBe(2);
		expect(resent.docsAlreadySent).toBe(0);
	});

	it('repairs on a schedule only for users who enabled an integration', async () => {
		vi.mocked(getUserIdsWithIntegrations).mockResolvedValue(['u1']);
		vi.mocked(getUserById).mockResolvedValue({ id: 'u1', settings: settings() } as never);
		vi.mocked(getDocumentsByUser).mockResolvedValue([doc('a', '2026-01-01 10:00:00')] as never);

		await runIntegrationSync();

		expect(vi.mocked(s3Put)).toHaveBeenCalledTimes(1);
		expect(vi.mocked(paperlessPost)).toHaveBeenCalledTimes(1);
	});

	it('keeps running for other users when one of them fails', async () => {
		vi.mocked(getUserIdsWithIntegrations).mockResolvedValue(['broken', 'u1']);
		vi.mocked(getUserById).mockImplementation(async (id: string) => {
			if (id === 'broken') throw new Error('db read failed');
			return { id: 'u1', settings: settings() } as never;
		});
		vi.mocked(getDocumentsByUser).mockResolvedValue([doc('a', '2026-01-01 10:00:00')] as never);

		await runIntegrationSync();

		expect(vi.mocked(paperlessPost)).toHaveBeenCalledTimes(1);
	});

	it('reads each file from disk once, not once per target', async () => {
		const getBuffer = vi.fn(async () => Buffer.from('file'));
		vi.mocked(getStorage).mockReturnValue({ getBuffer } as never);
		vi.mocked(getUserById).mockResolvedValue({ id: 'u1', settings: settings() } as never);
		vi.mocked(getDocumentsByUser).mockResolvedValue([
			doc('a', '2026-01-01 10:00:00'),
			doc('b', '2026-01-02 10:00:00')
		] as never);

		const summary = await syncAll('u1');

		expect(summary.filesUploaded).toBe(2);
		expect(summary.docsPushed).toBe(2);
		expect(getBuffer).toHaveBeenCalledTimes(2);
	});

	it('does nothing when no integration is enabled', async () => {
		vi.mocked(getUserById).mockResolvedValue({
			id: 'u1',
			settings: settings({
				integrations: { s3: { enabled: false }, paperless: { enabled: false } }
			})
		} as never);

		const summary = await syncAll('u1');

		expect(summary).toMatchObject({ filesUploaded: 0, docsPushed: 0 });
		expect(vi.mocked(updateUserSettings)).not.toHaveBeenCalled();
	});
});
