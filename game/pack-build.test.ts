import { expect, it } from 'vitest';
import { makeManifest } from './pack-build.ts';

it('pins a pack identity to all runtime bytes and is independent of file order', () => {
	const entry = new TextEncoder().encode('export function mountGame() {}');
	const model = new Uint8Array([1, 2, 3]);
	const a = makeManifest(
		new Map([
			['entry.js', entry],
			['assets/tree.glb', model]
		])
	);
	const b = makeManifest(
		new Map([
			['assets/tree.glb', model],
			['entry.js', entry]
		])
	);
	expect(a).toEqual(b);
	expect(a.files.find((file) => file.path.endsWith('.glb'))?.bytes).toBe(3);
	expect(
		makeManifest(
			new Map([
				['entry.js', new Uint8Array([9])],
				['assets/tree.glb', model]
			])
		).packId
	).not.toBe(a.packId);
});
