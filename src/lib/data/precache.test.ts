import { expect, it } from 'vitest';
import { shellFiles } from './precache.ts';

it('prepares every route and its static dependencies without pulling dynamic 3D/cloud chunks', () => {
	const files = shellFiles({
		app: { file: 'app.js', isEntry: true, imports: ['shared'], dynamicImports: ['cloud'] },
		journey: { file: 'journey.js', isEntry: true, imports: ['shared'], css: ['journey.css'], dynamicImports: ['scene'] },
		shared: { file: 'shared.js', imports: ['app'], assets: ['alegreya-latin-wght-normal.hash.woff2', 'alegreya-latin-wght-italic.hash.woff2', 'alegreya-greek-wght-normal.hash.woff2'] },
		cloud: { file: 'cloud.js', isDynamicEntry: true }, scene: { file: 'scene.js', isDynamicEntry: true }
	});
	expect(new Set(files)).toEqual(new Set(['app.js', 'journey.js', 'shared.js', 'journey.css', 'alegreya-latin-wght-normal.hash.woff2']));
});
it('fails the build when a shell dependency is missing instead of declaring incomplete offline support', () => {
	expect(() => shellFiles({ app: { file: 'app.js', isEntry: true, imports: ['missing'] } })).toThrow();
});
