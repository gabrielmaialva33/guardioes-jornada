import { describe, expect, it } from 'vitest';
import { decodeGameManifest, GAME_ABI } from './abi.ts';

const file = { path: 'entry.js', bytes: 123, sha256: 'a'.repeat(64) };
const manifest = { packId: 'b'.repeat(64), abi: GAME_ABI, entry: file.path, files: [file] };
describe('independent game ABI', () => {
	it('accepts a complete versioned pack without any host runtime reference', () => {
		expect(decodeGameManifest(manifest)).toEqual(manifest);
	});
	it.each(['../app.js', '/app.js', 'https://evil.invalid/app.js', 'a%2fb.js', 'a.js?x', 'a\\b.js'])(
		'rejects files escaping the pack: %s',
		(path) =>
			expect(() => decodeGameManifest({ ...manifest, entry: path, files: [{ ...file, path }] })).toThrow()
	);
	it('rejects unknown ABI, duplicates, missing entry and excessive storage', () => {
		for (const invalid of [
			{ ...manifest, abi: 2 },
			{ ...manifest, files: [file, file] },
			{ ...manifest, entry: 'missing.js' },
			{ ...manifest, files: [{ ...file, bytes: 100_000_000 }] }
		])
			expect(() => decodeGameManifest(invalid)).toThrow();
	});
});
