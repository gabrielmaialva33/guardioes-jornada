/**
 * The floating island (stage 0, with the clearing's flowers), the trail
 * (stage 1) and the Serra de Paranapiacaba with its mist (stage 4).
 */
import { blob, hash3, MeshBuilder, rng, smoothstep, type Paint, type V3 } from './builder.ts';
import {
	CLEARING,
	distanceToPath,
	heightAt,
	PEAKS,
	RIVER,
	RX,
	RZ,
	rimDistance,
	rimZ,
	TRAIL
} from './layout.ts';

export interface Detail {
	rings: number;
	segments: number;
	flowers: number;
	grass: number;
}

/** Island top and its rocky underside. Never grows: it is the stage itself. */
export function buildIsland(b: MeshBuilder, d: Detail) {
	const rand = rng(7);
	const top: V3[][] = [];
	for (let i = 0; i <= d.rings; i++) {
		const r = i / d.rings;
		const ring: V3[] = [];
		for (let j = 0; j < d.segments; j++) {
			const a = (j / d.segments) * Math.PI * 2;
			// Light jitter keeps the facets irregular and hand-made.
			const jr = i > 0 && i < d.rings ? ((hash3([i, j, 1]) - 0.5) * 0.35) / d.rings : 0;
			const x = Math.cos(a) * (r + jr) * RX;
			const z = Math.sin(a) * (r + jr) * RZ;
			ring.push([x, heightAt(x, z), z]);
		}
		top.push(ring);
	}

	const grassPaint = (p: V3): Paint => {
		const n = hash3([Math.round(p[0] * 3), 0, Math.round(p[2] * 3)], 3);
		const meadow = 1 - smoothstep(0.6, 1.5, Math.hypot(p[0] - CLEARING[0], (p[2] - CLEARING[1]) * 1.3));
		if (meadow > 0.4) return { tone: 'meadow', mix: 'hill', t: n * 0.5, k: 1.02 };
		const front = smoothstep(-0.2, 1, p[2] / RZ);
		return { tone: 'hill', mix: 'ground', t: 0.15 + front * 0.45 + (n - 0.5) * 0.3, k: 1 };
	};

	const below: V3 = [0, -5, 0];
	for (let i = 0; i < d.rings; i++) {
		for (let j = 0; j < d.segments; j++) {
			const j1 = (j + 1) % d.segments;
			const a = top[i][j];
			const bb = top[i][j1];
			const c = top[i + 1][j1];
			const e = top[i + 1][j];
			const mid: V3 = [(a[0] + c[0]) / 2, 0, (a[2] + c[2]) / 2];
			if (i === 0) b.tri(a, c, e, grassPaint(mid), below);
			else b.quad(a, bb, c, e, grassPaint(mid), below);
		}
	}

	// Underside: grass lip, soil strata, then rock tapering to a point.
	const skirt: [number, number, Paint][] = [
		[1.012, -0.13, { tone: 'ground', k: 0.9 }],
		[0.985, -0.34, { tone: 'soil', k: 0.95 }],
		[0.95, -0.56, { tone: 'soil', mix: 'bark', t: 0.4, k: 0.78 }],
		[0.86, -0.8, { tone: 'soil', k: 0.7 }],
		[0.68, -1.02, { tone: 'rock', k: 0.95 }],
		[0.44, -1.24, { tone: 'rock', k: 0.85 }],
		[0.2, -1.42, { tone: 'rock', k: 0.75 }]
	];
	let prev = top[d.rings];
	for (let k = 0; k < skirt.length; k++) {
		const [r, y, paint] = skirt[k];
		const ring: V3[] = [];
		for (let j = 0; j < d.segments; j++) {
			const a = (j / d.segments) * Math.PI * 2;
			const jr = r * (1 + (hash3([k, j, 2]) - 0.5) * (k < 2 ? 0.02 : 0.12));
			const jy = y + (hash3([k, j, 3]) - 0.5) * (k < 1 ? 0.02 : 0.12);
			ring.push([Math.cos(a) * jr * RX, jy, Math.sin(a) * jr * RZ]);
		}
		for (let j = 0; j < d.segments; j++) {
			const j1 = (j + 1) % d.segments;
			const axis: V3 = [0, (prev[j][1] + ring[j][1]) / 2, 0];
			b.quad(prev[j], prev[j1], ring[j1], ring[j], paint, axis);
		}
		prev = ring;
	}
	const tip: V3 = [0.15, -1.62, 0.05];
	for (let j = 0; j < d.segments; j++) {
		b.tri(prev[j], prev[(j + 1) % d.segments], tip, { tone: 'rock', k: 0.62 }, [0, -1.2, 0]);
	}

	// Flowers in the clearing: tiny pyramids in blossom pink and sun yellow.
	for (let i = 0; i < d.flowers; i++) {
		const a = rand() * Math.PI * 2;
		const r = Math.sqrt(rand()) * 1.45;
		const x = CLEARING[0] + Math.cos(a) * r * 1.25;
		const z = CLEARING[1] + Math.sin(a) * r * 0.75;
		if (rimDistance(x, z) > 0.92) continue;
		flower(b, [x, heightAt(x, z), z], rand() < 0.62 ? 'blossom' : 'sun', 0.05 + rand() * 0.03);
	}

	// Grass tufts everywhere, a little texture on the flat facets.
	for (let i = 0; i < d.grass; i++) {
		const x = (rand() * 2 - 1) * RX;
		const z = (rand() * 2 - 1) * RZ;
		if (rimDistance(x, z) > 0.94) continue;
		tuft(b, [x, heightAt(x, z), z], 0.06 + rand() * 0.06, rand() * Math.PI);
	}

	// Mossy boulders on the rim.
	for (let i = 0; i < 9; i++) {
		const a = rand() * Math.PI * 2;
		const x = Math.cos(a) * RX * 0.93;
		const z = Math.sin(a) * RZ * 0.93;
		const s = 0.08 + rand() * 0.1;
		// Keep the river's way out to the waterfall clear.
		if (distanceToPath(RIVER, x, z) < 0.55) continue;
		blob(
			b,
			[x, heightAt(x, z) + s * 0.3, z],
			[s * 1.3, s, s * 1.1],
			0,
			(n) => ({ tone: 'rock', mix: 'canopy', t: n[1] > 0.5 ? 0.45 : 0, k: 1.1 }),
			0.25,
			i
		);
	}
}

function flower(b: MeshBuilder, base: V3, tone: 'blossom' | 'sun', size: number) {
	const top: V3 = [base[0], base[1] + size * 1.6, base[2]];
	const ring: V3[] = [0, 1, 2].map((i) => {
		const a = (i / 3) * Math.PI * 2 + base[0] * 3;
		return [base[0] + Math.cos(a) * size, base[1] + size * 0.9, base[2] + Math.sin(a) * size];
	});
	for (let i = 0; i < 3; i++) b.tri(ring[i], ring[(i + 1) % 3], top, { tone, k: 1.15 }, base);
}

function tuft(b: MeshBuilder, base: V3, h: number, a: number) {
	for (let i = 0; i < 2; i++) {
		const ang = a + i * 1.7;
		const dx = Math.cos(ang) * h * 0.35;
		const dz = Math.sin(ang) * h * 0.35;
		b.tri(
			[base[0] - dx, base[1], base[2] - dz],
			[base[0] + dx, base[1], base[2] + dz],
			[base[0] + dx * 0.4, base[1] + h, base[2] + dz * 0.4 + 0.01],
			{ tone: 'canopy-light', mix: 'hill', t: 0.5, k: 0.95 },
			[base[0], base[1] + h * 0.3, base[2] - 1]
		);
	}
}

/** Stepping stones from the front rim to the clearing. */
export function buildTrail(b: MeshBuilder, growFrom: number, growSpan: number) {
	const pts: [number, number][] = [];
	for (let i = 0; i < TRAIL.length - 1; i++) {
		const [ax, az] = TRAIL[i];
		const [bx, bz] = TRAIL[i + 1];
		const len = Math.hypot(bx - ax, bz - az);
		const n = Math.max(1, Math.round(len / 0.2));
		for (let k = 0; k < n; k++) pts.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
	}
	pts.forEach(([x, z], i) => {
		const s = 0.07 + hash3([x, 0, z]) * 0.025;
		const c: V3 = [x + (hash3([z, 1, x]) - 0.5) * 0.08, 0, z];
		c[1] = heightAt(c[0], c[2]) + 0.018;
		b.pivotAt = () => c;
		b.growAt = () => growFrom + (i / pts.length) * growSpan;
		for (let k = 0; k < 6; k++) {
			const a0 = (k / 6) * Math.PI * 2 + i;
			const a1 = ((k + 1) / 6) * Math.PI * 2 + i;
			b.tri(
				c,
				[c[0] + Math.cos(a0) * s * 1.3, c[1] - 0.008, c[2] + Math.sin(a0) * s],
				[c[0] + Math.cos(a1) * s * 1.3, c[1] - 0.008, c[2] + Math.sin(a1) * s],
				{ tone: 'bark', mix: 'sun', t: 0.18, k: 1.05 },
				[c[0], c[1] - 3, c[2]]
			);
		}
	});
}

/** The Serra rises from behind the forest; its mist drifts at mid-height. */
export function buildMountains(b: MeshBuilder, sides: number) {
	PEAKS.forEach(([px, height, width], idx) => {
		const z = -rimZ(px) * 0.9;
		const baseY = heightAt(px, z) - 0.08;
		const center: V3 = [px, baseY, z];
		b.pivotAt = (p) => [p[0], baseY - 0.05, p[2]];
		b.growAt = (p) => (idx / PEAKS.length) * 0.45 + ((p[1] - baseY) / height) * 0.5;
		const levels = [
			{ r: 1, y: 0 },
			{ r: 0.62, y: 0.45 },
			{ r: 0.3, y: 0.78 }
		];
		const rings = levels.map((lv, li) =>
			Array.from({ length: sides }, (_, j): V3 => {
				const a = (j / sides) * Math.PI * 2 + idx;
				const jit = li === 0 ? 0.08 : 0.2;
				const r = lv.r * width * (1 + (hash3([idx, li, j]) - 0.5) * jit);
				return [
					px + Math.cos(a) * r * 1.25,
					baseY + lv.y * height + (li > 0 ? (hash3([j, li, idx]) - 0.5) * 0.12 * height : 0),
					z + Math.sin(a) * r * 0.75
				];
			})
		);
		const peak: V3 = [px + (hash3([idx, 9, 9]) - 0.5) * 0.2, baseY + height, z];
		const paintAt = (y: number): Paint => {
			const f = (y - baseY) / height;
			// Forested slopes, rocky crests fading into the sky's mist.
			if (f < 0.35) return { tone: 'canopy-dark', mix: 'hill-far', t: 0.25, k: 1.05 };
			if (f < 0.7) return { tone: 'hill-far', mix: 'canopy-dark', t: 0.45, k: 1.1 };
			return { tone: 'hill-far', mix: 'mist', t: 0.12, k: 1.18 };
		};
		for (let li = 0; li < rings.length - 1; li++) {
			for (let j = 0; j < sides; j++) {
				const j1 = (j + 1) % sides;
				const a = rings[li][j];
				const c = rings[li + 1][j1];
				b.quad(a, rings[li][j1], c, rings[li + 1][j], paintAt((a[1] + c[1]) / 2), center);
			}
		}
		const last = rings[rings.length - 1];
		for (let j = 0; j < sides; j++)
			b.tri(last[j], last[(j + 1) % sides], peak, paintAt(baseY + height * 0.9), center);
	});

	// Paranapiacaba's famous fog: soft cloud banks hugging the slopes.
	const banks: [number, number, number, number][] = [
		[-1.85, 0.95, 1, 0],
		[0.45, 1.25, 0.8, 1],
		[2.7, 0.9, 0.9, 2]
	];
	const puffs: [number, number, number, number][] = [
		[-0.4, 0, 0, 0.19],
		[-0.08, 0.07, 0.03, 0.26],
		[0.28, 0.02, 0, 0.21],
		[0.1, -0.05, 0.14, 0.17]
	];
	for (const [x, y, s, i] of banks) {
		const z = -rimZ(x) * 0.66;
		const c: V3 = [x, heightAt(x, z) + y, z];
		b.pivotAt = () => c;
		b.growAt = () => 0.5 + i * 0.12;
		for (const [ox, oy, oz, r] of puffs) {
			blob(
				b,
				[c[0] + ox * s, c[1] + oy * s, c[2] + oz * s],
				[r * s * 1.25, r * s * 0.6, r * s * 0.9],
				1,
				(n) => ({ tone: 'mist', k: 0.94 + Math.max(0, n[1]) * 0.1 }),
				0.1,
				40 + i * 7 + ox * 10
			);
		}
	}
}
