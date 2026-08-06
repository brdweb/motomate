import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { env } from '$env/dynamic/private';

const BASE_PATH = env.STORAGE_LOCAL_PATH ?? './uploads';

async function ensureDir(dir: string): Promise<void> {
	await fs.mkdir(dir, { recursive: true });
}

export class LocalStorageAdapter {
	private base: string;

	constructor(basePath = BASE_PATH) {
		this.base = basePath;
	}

	private filePath(key: string): string {
		// Prevent path traversal
		const safe = key.replace(/\.\./g, '').replace(/^\/+/, '');
		return path.join(this.base, safe);
	}

	async put(key: string, body: Buffer | Uint8Array, _mime: string): Promise<void> {
		const fp = this.filePath(key);
		await ensureDir(path.dirname(fp));
		// Convert Uint8Array to Buffer if needed
		const data = Buffer.isBuffer(body) ? body : Buffer.from(body);
		await fs.writeFile(fp, data);
	}

	async getBuffer(key: string): Promise<Buffer> {
		return fs.readFile(this.filePath(key));
	}

	async delete(key: string): Promise<void> {
		try {
			await fs.unlink(this.filePath(key));
		} catch (e: unknown) {
			if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
		}
	}

	async presignedUrl(key: string, expiresInSeconds: number): Promise<string> {
		// Sign with HMAC so the serve endpoint can verify authenticity
		const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
		const secret = env.AUTH_SECRET!;
		const sig = crypto.createHmac('sha256', secret).update(`${key}:${expires}`).digest('hex');
		// Relative URL so it always hits the origin the app is served from, whatever PUBLIC_APP_URL says
		const params = new URLSearchParams({ key, expires: String(expires), sig });
		return `/api/files?${params}`;
	}
}
