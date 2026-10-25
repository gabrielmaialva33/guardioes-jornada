export const GAME_ABI = 1;
export interface GameFile {
	path: string;
	bytes: number;
	sha256: string;
}
export interface GameManifest {
	packId: string;
	abi: number;
	entry: string;
	files: GameFile[];
}
const hash = /^[a-f0-9]{64}$/;
const path = /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+$/;
/** Disk, HTTP and worker messages all cross this boundary as untrusted data. */
export function decodeGameManifest(input: unknown): GameManifest {
	if (!input || typeof input !== 'object') throw new Error('invalid-game-manifest');
	const value = input as Partial<GameManifest>;
	if (
		value.abi !== GAME_ABI ||
		typeof value.packId !== 'string' ||
		!hash.test(value.packId) ||
		typeof value.entry !== 'string' ||
		!value.entry.endsWith('.js') ||
		!Array.isArray(value.files) ||
		value.files.length === 0 ||
		value.files.length > 2048
	)
		throw new Error('invalid-game-manifest');
	const seen = new Set<string>();
	let total = 0;
	const files = value.files.map((file: unknown): GameFile => {
		if (!file || typeof file !== 'object') throw new Error('invalid-game-file');
		const f = file as Partial<GameFile>;
		if (
			typeof f.path !== 'string' ||
			!path.test(f.path) ||
			f.path.split('/').some((p) => p === '.' || p === '..') ||
			seen.has(f.path) ||
			typeof f.sha256 !== 'string' ||
			!hash.test(f.sha256) ||
			typeof f.bytes !== 'number' ||
			!Number.isSafeInteger(f.bytes) ||
			f.bytes < 0
		)
			throw new Error('invalid-game-file');
		seen.add(f.path);
		total += f.bytes;
		return { path: f.path, bytes: f.bytes, sha256: f.sha256 };
	});
	if (!seen.has(value.entry) || total > 64 * 1024 * 1024) throw new Error('invalid-game-manifest');
	return { packId: value.packId, abi: value.abi, entry: value.entry, files };
}
