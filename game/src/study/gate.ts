/**
 * The gate of the LOCAL-ONLY Green Hell study mode.
 *
 * The owner extracted assets from Green Hell (Creepy Jar) into the git-ignored
 * `tmp/greenhell-port/`. They have no licence for redistribution, so they never
 * enter the repo, the game pack, a production build or the deployed site: the
 * dev server alone serves them (game/study-dev.ts, at STUDY_PREFIX), and every
 * runtime path is gated by `import.meta.env.DEV && ?estudo=greenhell`.
 *
 * Callers outside game/src/study/ must write the gate as
 * `import.meta.env.DEV && studyEnabled()` (or put a dynamic import behind it):
 * the literal `import.meta.env.DEV` folds to `false` in a build, so the branch,
 * this module and every string in it are tree-shaken away.
 */

/** URL prefix the dev middleware (game/study-dev.ts) serves `tmp/greenhell-port/` at. */
export const STUDY_PREFIX = '/__estudo/greenhell/';

/** `raw`: the source PBR materials. `painted` (default): our house look (stylize.ts). */
export type StudyLook = 'raw' | 'painted';

const currentSearch = () => (typeof location === 'undefined' ? '' : location.search);

/** True only on the dev server with `?estudo=greenhell`. Always false in a production build. */
export function studyEnabled(search: string = currentSearch()): boolean {
	return import.meta.env.DEV && new URLSearchParams(search).get('estudo') === 'greenhell';
}

/** `&look=raw|painted`, painted by default. */
export function studyLook(search: string = currentSearch()): StudyLook {
	return new URLSearchParams(search).get('look') === 'raw' ? 'raw' : 'painted';
}

/**
 * The dev URL of a file under `tmp/greenhell-port/`, e.g.
 * `studyUrl('animals/browser/Capybara-web.glb')`. Path segments are encoded
 * (some audio names have spaces); a leading slash is ignored.
 */
export function studyUrl(path: string): string {
	const clean = path.replace(/^\/+/, '');
	return `${STUDY_PREFIX}${clean.split('/').map(encodeURIComponent).join('/')}`;
}
