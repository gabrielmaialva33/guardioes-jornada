export const GAME_ABI = 1;
/** Every sound is exported twice; a device downloads and plays only the codec it chose. */
export type AudioCodec = 'webm' | 'm4a';
export const AUDIO_CODECS: readonly AudioCodec[] = ['webm', 'm4a'];
/** MIME types probed with canPlayType: Opus in WebM, then AAC. */
export const AUDIO_CODEC_TYPES: Readonly<Record<AudioCodec, string>> = {
	webm: 'audio/webm; codecs="opus"',
	m4a: 'audio/mp4; codecs="mp4a.40.2"'
};
export interface GameFile {
	path: string;
	bytes: number;
	sha256: string;
	/** Estimated HTTP transfer when the server serves the generated gzip variant. */
	gzipBytes?: number;
	/** Audio export: only devices that chose this codec need it. Untagged files are always required. */
	codec?: AudioCodec;
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
			f.path === '__complete__.json' ||
			f.path === 'manifest.json' ||
			typeof f.sha256 !== 'string' ||
			!hash.test(f.sha256) ||
			typeof f.bytes !== 'number' ||
			!Number.isSafeInteger(f.bytes) ||
			f.bytes < 0
		)
			throw new Error('invalid-game-file');
		seen.add(f.path);
		total += f.bytes;
		if (
			f.gzipBytes !== undefined &&
			(!Number.isSafeInteger(f.gzipBytes) || f.gzipBytes < 0 || f.gzipBytes > 64 * 1024 * 1024)
		)
			throw new Error('invalid-game-file');
		if (f.codec !== undefined && !AUDIO_CODECS.includes(f.codec)) throw new Error('invalid-game-file');
		return {
			path: f.path,
			bytes: f.bytes,
			sha256: f.sha256,
			...(f.gzipBytes !== undefined ? { gzipBytes: f.gzipBytes } : {}),
			...(f.codec !== undefined ? { codec: f.codec } : {})
		};
	});
	if (!seen.has(value.entry) || total > 64 * 1024 * 1024) throw new Error('invalid-game-manifest');
	return { packId: value.packId, abi: value.abi, entry: value.entry, files };
}

/**
 * The audio codecs this browser can play, best first: every 'probably' before
 * every 'maybe', Opus before AAC within each.
 */
export function audioCodecOrder(canPlayType: (type: string) => string): AudioCodec[] {
	const answers = AUDIO_CODECS.map((codec) => {
		let answer = '';
		try {
			answer = canPlayType(AUDIO_CODEC_TYPES[codec]);
		} catch {
			answer = '';
		}
		return { codec, answer };
	});
	return [
		...answers.filter((a) => a.answer === 'probably'),
		...answers.filter((a) => a.answer === 'maybe')
	].map((a) => a.codec);
}
/**
 * The one codec a device downloads and plays. The launcher (download) and the
 * game (audio bank) both ask this with the same browser, so they agree.
 * Null when neither plays: no audio is downloaded and the game keeps its placeholders.
 */
export function chooseAudioCodec(canPlayType: (type: string) => string): AudioCodec | null {
	return audioCodecOrder(canPlayType)[0] ?? null;
}
/**
 * The files a device needs: every untagged file plus the audio of `codec`.
 * `undefined` is a pack completed before codecs were chosen: it needs every file.
 */
export function requiredFiles(manifest: GameManifest, codec: AudioCodec | null | undefined): GameFile[] {
	if (codec === undefined) return manifest.files;
	return manifest.files.filter((file) => file.codec === undefined || file.codec === codec);
}
