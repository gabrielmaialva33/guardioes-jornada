/**
 * The gate of the LOCAL-ONLY Green Hell study mode.
 *
 * The owner extracted assets from Green Hell (Creepy Jar) into the git-ignored
 * `tmp/greenhell-port/`. PARK.md §10 authorizes direct reuse in the project.
 * This gate describes the current DEV-only delivery path, not a reuse policy:
 * the dev server serves the files (game/study-dev.ts, at STUDY_PREFIX), and
 * production pack integration has not been implemented here.
 *
 * On the dev server the mode is ON by default (the owner's local game):
 * - `?estudo=off` turns it off; `?estudo=greenhell` forces it on, even in an
 *   automated run (the study's own captures use it);
 * - automated runs never see it unless forced: `?golden`, `?e2e`, the software
 *   GPU test build (`__PACK_SOFTWARE_TEST__`), WebDriver (`navigator.webdriver`,
 *   so Playwright) and Vitest (`MODE === 'test'`), and Node without a DOM.
 *
 * Callers outside game/src/study/ gate with `import.meta.env.DEV` and reach the
 * folder through a dynamic `import()` inside that branch, then ask
 * `studyEnabled()`: the literal folds to `false` in a build, so the branch,
 * this folder and every string in it are tree-shaken away.
 */

declare const __PACK_SOFTWARE_TEST__: boolean;

/** URL prefix the dev middleware (game/study-dev.ts) serves `tmp/greenhell-port/` at. */
export const STUDY_PREFIX = '/__estudo/greenhell/';

/** `raw`: the source PBR materials. `painted` (default): our house look (stylize.ts). */
export type StudyLook = 'raw' | 'painted';

/** What the gate reads besides the URL (injectable for the tests). */
export interface StudyContext {
	/** The dev server (import.meta.env.DEV). */
	dev: boolean;
	/** A page with a DOM (false in Node). */
	browser: boolean;
	/** Vitest (MODE === 'test'). */
	test: boolean;
	/** navigator.webdriver: Playwright, Selenium. */
	webdriver: boolean;
	/** The software-GPU test build (GAME_ALLOW_SOFTWARE_TEST=1). */
	softwareTest: boolean;
}

const currentSearch = () => (typeof location === 'undefined' ? '' : location.search);

export function studyContext(): StudyContext {
	return {
		dev: import.meta.env.DEV,
		browser: typeof document !== 'undefined',
		test: import.meta.env.MODE === 'test',
		webdriver: typeof navigator !== 'undefined' && navigator.webdriver === true,
		softwareTest: typeof __PACK_SOFTWARE_TEST__ !== 'undefined' && __PACK_SOFTWARE_TEST__
	};
}

/** An automated run: golden captures, e2e and acceptance runs, software-GPU tests, WebDriver, Vitest. */
export function studyAutomated(search: string, context: StudyContext): boolean {
	const q = new URLSearchParams(search);
	return q.has('golden') || q.has('e2e') || context.test || context.webdriver || context.softwareTest;
}

/** Whether this page shows the study. Always false in a production build. */
export function studyEnabled(
	search: string = currentSearch(),
	context: StudyContext = studyContext()
): boolean {
	if (!import.meta.env.DEV || !context.dev) return false;
	const mode = new URLSearchParams(search).get('estudo');
	if (mode === 'off' || !context.browser) return false;
	if (mode === 'greenhell') return true;
	return !studyAutomated(search, context);
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
