import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { makeManifest, writePack } from './pack-build.ts';

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

it('publishes all files and creates real gzip/Brotli encodings for GLB and runtime', async () => {
	const root = process.env.TMPDIR ?? join(homedir(), '.cache/agents/2026-10-25-trilha-secreta/tests');
	await mkdir(root, { recursive: true });
	const dir = await mkdtemp(join(root, 'pack-test-'));
	try {
		const source = join(dir, 'input'),
			output = join(dir, 'output');
		await mkdir(source);
		await mkdir(output);
		await writeFile(join(source, 'entry.js'), 'export const abi=1;');
		await writeFile(join(source, 'tree.glb'), 'synthetic glb bytes');
		const manifest = await writePack(source, output),
			glb = join(output, 'game-packs', manifest.packId, 'tree.glb');
		expect(gunzipSync(await readFile(`${glb}.gz`)).toString()).toBe('synthetic glb bytes');
		expect(brotliDecompressSync(await readFile(`${glb}.br`)).toString()).toBe('synthetic glb bytes');
		expect(JSON.parse(await readFile(join(output, 'game-packs/latest.json'), 'utf8'))).toEqual(manifest);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
