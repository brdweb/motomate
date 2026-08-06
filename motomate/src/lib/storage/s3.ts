import {
	S3Client,
	PutObjectCommand,
	HeadObjectCommand,
	HeadBucketCommand,
	PutObjectTaggingCommand
} from '@aws-sdk/client-s3';

export type S3Config = {
	endpoint?: string;
	region?: string;
	bucket: string;
	access_key: string;
	secret_key: string;
};

const TIMEOUT_MS = 20_000;

const clients = new Map<string, S3Client>();

function fingerprint(cfg: S3Config): string {
	return [cfg.endpoint, cfg.region, cfg.access_key, cfg.secret_key].join('|');
}

// Self-hosted providers (MinIO, SeaweedFS, Garage) address buckets by path, AWS does not.
export function s3ClientConfig(cfg: S3Config) {
	return {
		region: cfg.region || 'eu-west-1',
		endpoint: cfg.endpoint || undefined,
		forcePathStyle: !!cfg.endpoint,
		credentials: { accessKeyId: cfg.access_key, secretAccessKey: cfg.secret_key }
	};
}

function client(cfg: S3Config): S3Client {
	const fp = fingerprint(cfg);
	const cached = clients.get(fp);
	if (cached) return cached;
	const created = new S3Client(s3ClientConfig(cfg));
	clients.set(fp, created);
	return created;
}

function signal(): AbortSignal {
	return AbortSignal.timeout(TIMEOUT_MS);
}

export async function s3Put(cfg: S3Config, key: string, body: Buffer, mime: string): Promise<void> {
	await client(cfg).send(
		new PutObjectCommand({
			Bucket: cfg.bucket,
			Key: key,
			Body: body,
			ContentType: mime,
			ContentLength: body.byteLength
		}),
		{ abortSignal: signal() }
	);
}

export async function s3Exists(cfg: S3Config, key: string): Promise<boolean> {
	try {
		await client(cfg).send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }), {
			abortSignal: signal()
		});
		return true;
	} catch {
		return false;
	}
}

// Marks the backup copy instead of removing it, so the owner disposes of it with a lifecycle rule
export async function s3MarkDeleted(cfg: S3Config, key: string): Promise<void> {
	await client(cfg).send(
		new PutObjectTaggingCommand({
			Bucket: cfg.bucket,
			Key: key,
			Tagging: {
				TagSet: [
					{ Key: 'motomate-status', Value: 'deleted' },
					{ Key: 'motomate-deleted-at', Value: new Date().toISOString().slice(0, 10) }
				]
			}
		}),
		{ abortSignal: signal() }
	);
}

export async function s3Test(cfg: S3Config): Promise<void> {
	await client(cfg).send(new HeadBucketCommand({ Bucket: cfg.bucket }), {
		abortSignal: signal()
	});
}
