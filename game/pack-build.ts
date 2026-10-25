import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { decodeGameManifest, GAME_ABI, type GameManifest } from './protocol.ts';

export function makeManifest(files: Map<string, Uint8Array>): GameManifest {
	const list = [...files]
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([path, bytes]) => ({
			path,
			bytes: bytes.byteLength,
			sha256: createHash('sha256').update(bytes).digest('hex'),
			...(/\.(js|css|json|svg|wasm|txt|glb)$/.test(path)
				? { gzipBytes: gzipSync(bytes, { level: 9 }).length }
				: {})
		}));
	const content = { abi: GAME_ABI, entry: 'entry.js', files: list };
	const packId = createHash('sha256').update(JSON.stringify(content)).digest('hex');
	return decodeGameManifest({ packId, ...content });
}
export async function walk(directory: string): Promise<string[]> {
	const files: string[] = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...(await walk(path)));
		else files.push(path);
	}
	return files;
}
export async function writePack(source: string, output: string): Promise<GameManifest> {
	const files = new Map<string, Uint8Array>();
	for (const file of await walk(source))
		files.set(relative(source, file).replaceAll('\\', '/'), await readFile(file));
	const manifest = makeManifest(files);
	const directory = join(output, 'game-packs', manifest.packId);
	for (const [path, bytes] of files) {
		await mkdir(dirname(join(directory, path)), { recursive: true });
		await writeFile(join(directory, path), bytes);
	}
	await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
	await writeFile(join(output, 'game-packs', 'latest.json'), JSON.stringify(manifest));
	// Kit's precompress list omits GLB. Pack files and all deployed GLBs get both encodings.
	for (const file of await walk(output)) {
		if (
			!file.endsWith('.glb') &&
			!(file.startsWith(join(output, 'game-packs')) && /\.(js|css|json|svg|wasm|txt)$/.test(file))
		)
			continue;
		const bytes = await readFile(file);
		await writeFile(`${file}.gz`, gzipSync(bytes, { level: 9 }));
		await writeFile(
			`${file}.br`,
			brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } })
		);
	}
	return manifest;
}
