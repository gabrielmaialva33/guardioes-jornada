import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { greenHellStudyDev } from './study-dev.ts';

export default defineConfig({
	root: fileURLToPath(new URL('.', import.meta.url)),
	base: './',
	publicDir: false,
	server: { watch: { ignored: ['**/.build/**', '**/build/**'] } },
	resolve: { dedupe: ['svelte', 'three'] },
	plugins: [
		svelte({ configFile: false }),
		// Local-only study of the owner's Green Hell extraction (tmp/, git-ignored): `serve` only, never in a build.
		greenHellStudyDev(),
		{
			name: 'independent-game-runtime',
			generateBundle(_options, bundle) {
				this.emitFile({
					type: 'asset',
					fileName: 'licenses/phosphor.txt',
					source: readFileSync(new URL('./PHOSPHOR-LICENSE.txt', import.meta.url), 'utf8')
				});
				for (const file of Object.values(bundle)) {
					if (file.type !== 'chunk') continue;
					for (const dependency of [...file.imports, ...file.dynamicImports]) {
						if (!(dependency in bundle)) this.error(`Game pack imports an external module: ${dependency}`);
					}
				}
			}
		}
	],
	define: {
		__PACK_BUILD__: JSON.stringify(process.env.GAME_BUILD_TAG ?? ''),
		__PACK_SOFTWARE_TEST__: process.env.GAME_ALLOW_SOFTWARE_TEST === '1'
	},
	build: {
		outDir: '.build',
		emptyOutDir: true,
		assetsInlineLimit: 0,
		cssCodeSplit: false,
		rolldownOptions: {
			// The entry is the small loader (loading screen); the game is a chunk it imports (P11).
			input: { entry: fileURLToPath(new URL('./src/ui/loading/entry.ts', import.meta.url)) },
			preserveEntrySignatures: 'strict',
			output: { format: 'es', entryFileNames: 'entry.js', chunkFileNames: 'chunks/[name]-[hash].js' }
		}
	}
});
