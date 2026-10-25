/**
 * Trees of the Atlantic Forest: canela-preta (dense round canopy), cedro-rosa
 * (broadleaf with a wide crown and woody fruits that stay on the branches), the deep forest's canopy trees, palmito-juçara
 * and samambaiaçu (tree fern). Each tree grows from its base: `order` (0..1)
 * staggers when it sprouts within its stage.
 */
import { blob, groundDisc, hash3, type MeshBuilder, prism, rng, type V3 } from './builder.ts';
import { FIRST_TREES, freeForTree, heightAt, RX, rimZ } from './layout.ts';

function growTree(b: MeshBuilder, base: V3, height: number, order: number, span = 0.55) {
	b.pivotAt = () => base;
	b.growAt = (p) => order * (1 - span) + Math.max(0, Math.min(1, (p[1] - base[1]) / height)) * span;
}

/** Shadow under a tree: a darker disc, shifted away from the sun. */
function shadow(b: MeshBuilder, base: V3, r: number) {
	groundDisc(b, [base[0] - r * 0.15, 0, base[2] - r * 0.1], r, 7, heightAt, {
		tone: 'ground',
		mix: 'canopy-dark',
		t: 0.5,
		k: 0.62
	});
}

export function canela(b: MeshBuilder, base: V3, s: number, order: number, seed: number) {
	growTree(b, base, 1.15 * s, order);
	shadow(b, base, 0.4 * s);
	prism(b, base, [base[0], base[1] + 0.5 * s, base[2]], 0.06 * s, 0.04 * s, 5, { tone: 'bark', k: 0.92 });
	const c: V3 = [base[0], base[1] + 0.8 * s, base[2]];
	const canopy = (n: V3) => ({
		tone: 'canopy-dark' as const,
		mix: 'canopy' as const,
		t: Math.max(0, n[1]) * 0.75,
		k: 1.08
	});
	b.aoAt = (p) => 0.78 + 0.22 * Math.min(1, Math.max(0, (p[1] - c[1] + 0.35 * s) / (0.7 * s)));
	blob(b, c, [0.38 * s, 0.36 * s, 0.36 * s], 1, canopy, 0.16, seed);
	blob(
		b,
		[c[0] + 0.24 * s, c[1] - 0.08 * s, c[2] + 0.1 * s],
		[0.22 * s, 0.2 * s, 0.22 * s],
		0,
		canopy,
		0.2,
		seed + 1
	);
	blob(
		b,
		[c[0] - 0.2 * s, c[1] + 0.14 * s, c[2] + 0.06 * s],
		[0.2 * s, 0.19 * s, 0.2 * s],
		0,
		canopy,
		0.2,
		seed + 2
	);
	b.aoAt = () => 1;
}

export function cedro(b: MeshBuilder, base: V3, s: number, order: number, seed: number) {
	growTree(b, base, 1.3 * s, order);
	shadow(b, base, 0.44 * s);
	// A broadleaf, not a conifer: tall straight trunk and a wide, open crown.
	const top: V3 = [base[0], base[1] + 0.78 * s, base[2]];
	prism(b, base, top, 0.055 * s, 0.035 * s, 5, { tone: 'bark', k: 0.92 });
	const crown = (n: V3) => ({
		tone: 'canopy-light' as const,
		mix: 'canopy' as const,
		t: 0.3 - Math.max(0, n[1]) * 0.2,
		k: 1.02
	});
	const rand = rng(seed);
	blob(b, [top[0], top[1] + 0.1 * s, top[2]], [0.4 * s, 0.18 * s, 0.38 * s], 1, crown, 0.18, seed);
	for (let i = 0; i < 3; i++) {
		const a = (i / 3) * Math.PI * 2 + rand();
		const lobe: V3 = [
			top[0] + Math.cos(a) * 0.24 * s,
			top[1] + (0.06 + rand() * 0.08) * s,
			top[2] + Math.sin(a) * 0.22 * s
		];
		blob(b, lobe, [0.2 * s, 0.12 * s, 0.2 * s], 0, crown, 0.2, seed + 1 + i);
	}
	// Woody fruit capsules, which often stay on the branches (Embrapa).
	for (let k = 0; k < 6; k++) {
		const a = rand() * Math.PI * 2;
		const r = (0.26 + rand() * 0.14) * s;
		const p: V3 = [top[0] + Math.cos(a) * r, top[1] + (rand() * 0.06 - 0.02) * s, top[2] + Math.sin(a) * r];
		blob(
			b,
			p,
			[0.045 * s, 0.04 * s, 0.045 * s],
			0,
			() => ({ tone: 'bark', mix: 'sun', t: 0.3, k: 1.15 }),
			0.2,
			seed * 7 + k
		);
	}
}

/** The deep forest's canopy trees: taller, darker, irregular crowns. */
function canopyTree(
	b: MeshBuilder,
	base: V3,
	s: number,
	order: number,
	seed: number,
	tone: 'canopy-dark' | 'canopy'
) {
	growTree(b, base, 1.3 * s, order);
	shadow(b, base, 0.38 * s);
	const top: V3 = [base[0], base[1] + 0.7 * s, base[2]];
	prism(b, base, top, 0.06 * s, 0.04 * s, 5, { tone: 'bark', mix: 'ground', t: 0.3, k: 0.85 });
	const paint = (n: V3) => ({
		tone,
		mix: tone === 'canopy' ? ('canopy-light' as const) : ('canopy' as const),
		t: Math.max(0, n[1]) * 0.45,
		k: 1.05
	});
	b.aoAt = (p) => 0.75 + 0.25 * Math.min(1, Math.max(0, (p[1] - top[1] + 0.2 * s) / (0.6 * s)));
	blob(b, [top[0], top[1] + 0.22 * s, top[2]], [0.42 * s, 0.32 * s, 0.4 * s], 1, paint, 0.2, seed);
	blob(
		b,
		[top[0] + 0.15 * s, top[1] + 0.48 * s, top[2] - 0.05 * s],
		[0.26 * s, 0.22 * s, 0.26 * s],
		0,
		paint,
		0.22,
		seed + 3
	);
	b.aoAt = () => 1;
}

/** Palmito-juçara: slender trunk, a star of arching fronds. */
function jucara(b: MeshBuilder, base: V3, s: number, order: number, seed: number) {
	const h = 1.35 * s;
	growTree(b, base, h + 0.3 * s, order, 0.7);
	shadow(b, base, 0.26 * s);
	const top: V3 = [base[0] + 0.04 * s, base[1] + h, base[2]];
	prism(b, base, top, 0.035 * s, 0.025 * s, 4, { tone: 'bark', mix: 'text-soft', t: 0.15, k: 0.95 });
	for (let i = 0; i < 7; i++) {
		const a = (i / 7) * Math.PI * 2 + seed;
		const dir: V3 = [Math.cos(a), 0, Math.sin(a)];
		const len = 0.5 * s * (0.85 + hash3([i, seed, 1]) * 0.3);
		const mid: V3 = [top[0] + dir[0] * len * 0.5, top[1] + 0.12 * s, top[2] + dir[2] * len * 0.5];
		const tip: V3 = [top[0] + dir[0] * len, top[1] - 0.16 * s, top[2] + dir[2] * len];
		const w: V3 = [-dir[2] * 0.06 * s, 0, dir[0] * 0.06 * s];
		const paint = { tone: 'canopy' as const, mix: 'canopy-light' as const, t: 0.3, k: 1.05 };
		b.tri(top, [mid[0] + w[0], mid[1], mid[2] + w[2]], mid, paint, [mid[0], mid[1] - 1, mid[2]]);
		b.tri(top, mid, [mid[0] - w[0], mid[1], mid[2] - w[2]], paint, [mid[0], mid[1] - 1, mid[2]]);
		b.tri([mid[0] + w[0], mid[1], mid[2] + w[2]], tip, mid, paint, [mid[0], mid[1] - 1, mid[2]]);
		b.tri(mid, tip, [mid[0] - w[0], mid[1], mid[2] - w[2]], paint, [mid[0], mid[1] - 1, mid[2]]);
	}
}

/** Samambaiaçu: a short dark trunk crowned by a rosette of fronds. */
function treeFern(b: MeshBuilder, base: V3, s: number, order: number, seed: number) {
	const h = 0.55 * s;
	growTree(b, base, h + 0.2 * s, order, 0.7);
	const top: V3 = [base[0], base[1] + h, base[2]];
	prism(b, base, top, 0.05 * s, 0.045 * s, 5, { tone: 'bark', mix: 'canopy-dark', t: 0.45, k: 0.75 });
	for (let i = 0; i < 9; i++) {
		const a = (i / 9) * Math.PI * 2 + seed * 0.7;
		const dir: V3 = [Math.cos(a), 0, Math.sin(a)];
		const len = 0.42 * s;
		const mid: V3 = [top[0] + dir[0] * len * 0.55, top[1] + 0.1 * s, top[2] + dir[2] * len * 0.55];
		const tip: V3 = [top[0] + dir[0] * len, top[1] - 0.04 * s, top[2] + dir[2] * len];
		const w: V3 = [-dir[2] * 0.08 * s, 0, dir[0] * 0.08 * s];
		const paint = { tone: 'canopy-light' as const, mix: 'canopy', t: 0.35, k: 1.0 } as const;
		b.tri(top, [mid[0] + w[0], mid[1], mid[2] + w[2]], tip, paint, [mid[0], mid[1] - 1, mid[2]]);
		b.tri(top, tip, [mid[0] - w[0], mid[1], mid[2] - w[2]], paint, [mid[0], mid[1] - 1, mid[2]]);
	}
}

/** Stage 1: the trail's first trees. */
export function buildFirstTrees(b: MeshBuilder, startAt: number) {
	FIRST_TREES.forEach((t, i) => {
		const base: V3 = [t.x, heightAt(t.x, t.z), t.z];
		const order = startAt + (i / FIRST_TREES.length) * (1 - startAt) * 0.6;
		if (t.kind === 'canela') canela(b, base, t.s, order, 11 + i);
		else cedro(b, base, t.s, order, 21 + i);
	});
}

/** Stage 3: the forest thickens along the back and the sides. */
export function buildDeepForest(b: MeshBuilder, count: number) {
	const rand = rng(31);
	const placed: [number, number][] = [];
	let tries = 0;
	while (placed.length < count && tries++ < 2000) {
		// Bias towards the back band and the left/right ends.
		const x = (rand() * 2 - 1) * RX * 0.95;
		const back = -rimZ(x) * (0.4 + rand() * 0.36);
		const side = Math.abs(x) > RX * 0.7;
		const z = side && rand() < 0.45 ? (rand() * 1.1 - 0.6) * rimZ(x) : back;
		if (!freeForTree(x, z, 0.02)) continue;
		if (placed.some(([px, pz]) => Math.hypot(px - x, (pz - z) * 1.3) < 0.5)) continue;
		placed.push([x, z]);
	}
	// Grow from the back rows forwards, left to right.
	placed.sort((a, c) => a[1] - c[1] || a[0] - c[0]);
	placed.forEach(([x, z], i) => {
		const base: V3 = [x, heightAt(x, z), z];
		const order = (i / placed.length) * 0.75;
		const roll = hash3([x, 5, z]);
		const s = 0.7 + roll * 0.32 - (z > -0.5 ? 0.1 : 0);
		if (roll < 0.14) jucara(b, base, s, order, i);
		else if (roll > 0.9) treeFern(b, base, s, order, i);
		else canopyTree(b, base, s, order, 100 + i, roll < 0.55 ? 'canopy-dark' : 'canopy');
	});
	return placed.length;
}
