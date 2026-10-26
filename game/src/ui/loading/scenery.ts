/** Small helpers for the loading screen's painted forest (no DOM). */

/** Linear sRGB mix of two `#rrggbb` colours, `t` = share of `b`. */
export function mix(a: string, b: string, t: number) {
	let out = '#';
	for (let i = 1; i < 7; i += 2) {
		const value = Math.round(
			Number.parseInt(a.slice(i, i + 2), 16) * (1 - t) + Number.parseInt(b.slice(i, i + 2), 16) * t
		);
		out += value.toString(16).padStart(2, '0');
	}
	return out;
}

/**
 * A row of tree crowns along `y`, as `[x, y, r]` circles from x = 0 to `width`.
 * Deterministic for a given seed (the screenshots stay stable).
 */
export function crowns(seed: number, y: number, minR: number, maxR: number, width: number) {
	let state = seed >>> 0 || 1;
	const random = () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 2 ** 32;
	};
	const list: [number, number, number][] = [];
	for (let x = -maxR * 0.5; x < width + maxR; ) {
		const r = Math.round(minR + (maxR - minR) * random());
		list.push([Math.round(x), Math.round(y - r * 0.35 * random()), r]);
		x += r * (1.1 + 0.4 * random());
	}
	return list;
}

/** Araucária, trunk base at (0, 316): a straight trunk under a flat, upturned candelabra crown. */
export const ARAUCARIA =
	'M-4 316V196h8v120ZM-68 228c22-26 114-26 136 0l-8 8c-30-16-90-16-120 0ZM-46 206c16-18 76-18 92 0l-7 7c-22-11-56-11-78 0ZM-26 188c10-10 42-10 52 0l-6 6c-12-6-28-6-40 0Z';

/** Juçara palm fronds, a star from the crown at (0, 178); drawn as strokes. */
export const FRONDS =
	'M0 178q-30-6-52 14M0 178q30-6 52 14M0 178q-22-22-46-20M0 178q22-22 46-20M0 178q-4-26 6-40';
