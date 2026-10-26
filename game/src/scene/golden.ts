import type { Quality } from '../render/index.ts';

declare const __PACK_SOFTWARE_TEST__: boolean;
export function readGolden(search: string, allowed: boolean) {
	const q = new URLSearchParams(search),
		enabled = allowed && q.has('golden');
	const numbers = (text: string | null, lengths: number[]) => {
		if (!text) return null;
		const a = text.split(',').map(Number);
		return lengths.includes(a.length) && a.every(Number.isFinite) ? a : null;
	};
	const time = Number(q.get('t') ?? 10),
		seed = Number(q.get('seed') ?? 20261025);
	const requested = q.get('tier');
	return {
		enabled,
		time: Number.isFinite(time) ? Math.max(0, Math.min(60, time)) : 10,
		seed: Number.isFinite(seed) ? seed >>> 0 : 20261025,
		tier: (requested === 'low' || requested === 'medium' || requested === 'high'
			? requested
			: 'low') as Quality,
		camera: numbers(q.get('cam'), [6, 7]),
		avatar: numbers(q.get('avatar'), [3]),
		night: q.get('time') === 'night',
		lineup: q.get('scene') === 'lineup',
		lifeScenario:
			q.get('life') === 'companion' ? 'companion' : q.get('life') === 'butterflies' ? 'butterflies' : null
	};
}
export const golden = readGolden(
	typeof location === 'undefined' ? '' : location.search,
	import.meta.env.DEV || (typeof __PACK_SOFTWARE_TEST__ !== 'undefined' && __PACK_SOFTWARE_TEST__)
);
