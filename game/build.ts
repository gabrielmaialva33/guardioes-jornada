import { cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { writePack } from './pack-build.ts';

await build({ configFile: fileURLToPath(new URL('./vite.config.ts', import.meta.url)) });
const manifest = await writePack(
	fileURLToPath(new URL('./.build/', import.meta.url)),
	fileURLToPath(new URL('../build/', import.meta.url))
);
// Kit preview serves output/client, whereas the deployed static adapter serves build/.
// Copy only after Kit has finalized the worker/manifest, so packs stay out of install.
await cp(
	fileURLToPath(new URL('../build/game-packs/', import.meta.url)),
	fileURLToPath(new URL('../.svelte-kit/output/client/game-packs/', import.meta.url)),
	{ recursive: true }
);
console.info(
	`Independent game pack ${manifest.packId}: ${manifest.files.length} files, ${manifest.files.reduce((sum, file) => sum + file.bytes, 0)} bytes`
);
