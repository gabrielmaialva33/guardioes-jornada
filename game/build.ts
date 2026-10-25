import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { writePack } from './pack-build.ts';

await build({ configFile: fileURLToPath(new URL('./vite.config.ts', import.meta.url)) });
const manifest = await writePack(
	fileURLToPath(new URL('./.build/', import.meta.url)),
	fileURLToPath(new URL('../build/', import.meta.url))
);
console.info(
	`Independent game pack ${manifest.packId}: ${manifest.files.length} files, ${manifest.files.reduce((sum, file) => sum + file.bytes, 0)} bytes`
);
