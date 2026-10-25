import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
	root: fileURLToPath(new URL('.', import.meta.url)),
	base: './',
	publicDir: false,
	plugins: [svelte({ configFile: false })],
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
