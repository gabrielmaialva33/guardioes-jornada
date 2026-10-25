import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
	root: fileURLToPath(new URL('.', import.meta.url)),
	base: './',
	publicDir: false,
	resolve: { dedupe: ['svelte', 'three'] },
	plugins: [svelte({ configFile: false }), {
		name: 'independent-game-runtime',
		generateBundle(_options, bundle) {
			for (const file of Object.values(bundle)) {
				if (file.type !== 'chunk') continue;
				for (const dependency of [...file.imports, ...file.dynamicImports]) {
					if (!(dependency in bundle)) this.error(`Game pack imports an external module: ${dependency}`);
				}
			}
		}
	}],
	define: { __PACK_BUILD__: JSON.stringify(process.env.GAME_BUILD_TAG ?? '') },
	build: {
		outDir: '.build',
		emptyOutDir: true,
		assetsInlineLimit: 0,
		cssCodeSplit: false,
		rolldownOptions: {
			input: { entry: fileURLToPath(new URL('./src/main.ts', import.meta.url)) },
			preserveEntrySignatures: 'strict',
			output: { format: 'es', entryFileNames: 'entry.js', codeSplitting: false }
		}
	}
});
