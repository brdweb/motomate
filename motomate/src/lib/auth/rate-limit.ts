// In-memory rate limiter (to be adjusted for distributed environments)
interface Bucket {
	count: number;
	resetAt: number;
}

const store = new Map<string, Bucket>();

// Purge expired buckets every 5 minutes to prevent unbounded memory growth.
setInterval(() => {
	const now = Date.now();
	for (const [key, bucket] of store) {
		if (now > bucket.resetAt) store.delete(key);
	}
}, 5 * 60_000);

/** True when allowed, false when limited; key is a unique bucket string like "login:email:{addr}" */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
	const now = Date.now();
	const bucket = store.get(key);

	if (!bucket || now > bucket.resetAt) {
		store.set(key, { count: 1, resetAt: now + windowMs });
		return true;
	}

	if (bucket.count >= max) return false;

	bucket.count++;
	return true;
}
