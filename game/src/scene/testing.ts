/** Explicit fixture mode, compiled out of public packs. Physics and story stay real. */
declare const __PACK_SOFTWARE_TEST__: boolean;
export function readTesting(search: string, allowed: boolean) {
	return allowed && new URLSearchParams(search).has('e2e');
}
export const testing = readTesting(
	typeof location === 'undefined' ? '' : location.search,
	import.meta.env.DEV || (typeof __PACK_SOFTWARE_TEST__ !== 'undefined' && __PACK_SOFTWARE_TEST__)
);
