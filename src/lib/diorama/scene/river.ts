/**
 * Stage 2: the spring and its river. The water runs from the spring across
 * the island and falls off the front rim as a small waterfall. It grows
 * along its course: each cross-section widens from the centre line once the
 * growth front passes it.
 *
 * Two builders: the water (flow-stripe shader, `aFlow` = [distance, across])
 * and its bed (dark banks and the stones around the spring).
 */
import { blob, hash3, MeshBuilder, smoothstep, type V3 } from './builder.ts';
import { heightAt, RIVER, RX, RZ, SPRING } from './layout.ts';

function catmull(p0: number, p1: number, p2: number, p3: number, t: number) {
	const t2 = t * t;
	const t3 = t2 * t;
	return (
		0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
	);
}

/** Samples the river's centre line in (x, z). */
function sampleRiver(perSegment: number): [number, number][] {
	const pts: [number, number][] = [];
	const n = RIVER.length;
	for (let i = 0; i < n - 1; i++) {
		const p0 = RIVER[Math.max(0, i - 1)];
		const p1 = RIVER[i];
		const p2 = RIVER[i + 1];
		const p3 = RIVER[Math.min(n - 1, i + 2)];
		for (let k = 0; k < perSegment; k++) {
			const t = k / perSegment;
			pts.push([catmull(p0[0], p1[0], p2[0], p3[0], t), catmull(p0[1], p1[1], p2[1], p3[1], t)]);
		}
	}
	pts.push(RIVER[n - 1]);
	return pts;
}

export function buildRiver(water: MeshBuilder, bed: MeshBuilder, perSegment: number) {
	const pts = sampleRiver(perSegment);
	const dist: number[] = [0];
	for (let i = 1; i < pts.length; i++)
		dist.push(dist[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
	const total = dist[dist.length - 1];
	// The plateau course takes 85% of the growth, the waterfall the rest.
	const plateau = 0.85;

	type Section = { c: V3; l: V3; r: V3; bl: V3; br: V3; s: number; g: number };
	const sections: Section[] = pts.map(([x, z], i) => {
		const prev = pts[Math.max(0, i - 1)];
		const next = pts[Math.min(pts.length - 1, i + 1)];
		const tx = next[0] - prev[0];
		const tz = next[1] - prev[1];
		const tl = Math.hypot(tx, tz) || 1;
		const nx = -tz / tl;
		const nz = tx / tl;
		const f = dist[i] / total;
		const w = 0.05 + 0.13 * smoothstep(0, 0.6, f);
		const bank = w + 0.08;
		const y =
			Math.max(heightAt(x, z), heightAt(x + nx * w, z + nz * w), heightAt(x - nx * w, z - nz * w)) + 0.022;
		const by = (px: number, pz: number) => heightAt(px, pz) + 0.012;
		return {
			c: [x, y, z],
			l: [x + nx * w, y, z + nz * w],
			r: [x - nx * w, y, z - nz * w],
			bl: [x + nx * bank, by(x + nx * bank, z + nz * bank), z + nz * bank],
			br: [x - nx * bank, by(x - nx * bank, z - nz * bank), z - nz * bank],
			s: dist[i],
			g: f * plateau
		};
	});

	// Water surface: left half and right half of each section strip.
	const down: V3 = [0, -5, 0];
	for (let i = 0; i < sections.length - 1; i++) {
		const a = sections[i];
		const b = sections[i + 1];
		for (const [side, acr] of [
			['l', 1],
			['r', -1]
		] as const) {
			const flowOf = (p: V3) => {
				const own = p === a.c || p === a[side] ? a : b;
				return [own.s, p === own.c ? 0 : acr];
			};
			water.extraAt = flowOf;
			water.pivotAt = (p) => (p === a.c || p === a[side] ? a.c : b.c);
			water.growAt = (p) => (p === a.c || p === a[side] ? a.g : b.g);
			const edgeK = 0.86;
			water.tri(a.c, a[side], b[side], { tone: 'water', k: edgeK }, down);
			water.tri(a.c, b[side], b.c, { tone: 'water', k: 1.0 }, down);
		}
		// Banks under the water, dark and wet.
		bed.pivotAt = (p) => (p === a.bl || p === a.br ? a.c : b.c);
		bed.growAt = (p) => (p === a.bl || p === a.br ? a.g : b.g);
		bed.quad(a.bl, b.bl, b.br, a.br, { tone: 'ground', mix: 'soil', t: 0.3, k: 0.62 }, down);
	}

	// Waterfall over the front rim.
	const end = sections[sections.length - 1];
	const theta = Math.atan2(end.c[2] / RZ, end.c[0] / RX);
	const drops = [
		{ y: end.c[1], r: 1.0, w: 1 },
		{ y: -0.16, r: 1.035, w: 0.95 },
		{ y: -0.4, r: 1.03, w: 0.85 },
		{ y: -0.66, r: 1.0, w: 0.7 },
		{ y: -0.9, r: 0.93, w: 0.45 },
		{ y: -1.1, r: 0.84, w: 0.12 }
	];
	const halfW = Math.hypot(end.l[0] - end.c[0], end.l[2] - end.c[2]);
	const tangent: V3 = [-Math.sin(theta), 0, Math.cos(theta)];
	const falls = drops.map((d, i) => {
		const c: V3 = [Math.cos(theta) * RX * d.r, d.y, Math.sin(theta) * RZ * d.r];
		if (i === 0) c[0] = end.c[0];
		if (i === 0) c[2] = end.c[2];
		const w = halfW * d.w;
		return {
			c,
			l: [c[0] + tangent[0] * w, c[1], c[2] + tangent[2] * w] as V3,
			r: [c[0] - tangent[0] * w, c[1], c[2] - tangent[2] * w] as V3,
			s: end.s + (end.c[1] - d.y) * 1.6,
			g: plateau + (i / (drops.length - 1)) * (1 - plateau)
		};
	});
	for (let i = 0; i < falls.length - 1; i++) {
		const a = falls[i];
		const b = falls[i + 1];
		const inside: V3 = [0, (a.c[1] + b.c[1]) / 2, 0];
		const own = (p: V3) => (p === a.c || p === a.l || p === a.r ? a : b);
		water.extraAt = (p) => [own(p).s, p === own(p).c ? 0 : 1];
		water.pivotAt = (p) => own(p).c;
		water.growAt = (p) => own(p).g;
		const k = 1.05 - i * 0.04;
		water.quad(a.l, a.c, b.c, b.l, { tone: 'water', k }, inside);
		water.quad(a.c, a.r, b.r, b.c, { tone: 'water', k: k * 0.92 }, inside);
	}

	// The spring: a small pool ringed by stones.
	const sc: V3 = [SPRING[0], heightAt(SPRING[0], SPRING[2]) + 0.03, SPRING[2]];
	water.extraAt = () => [0, 3];
	water.pivotAt = () => sc;
	water.growAt = () => 0;
	for (let i = 0; i < 8; i++) {
		const a0 = (i / 8) * Math.PI * 2;
		const a1 = ((i + 1) / 8) * Math.PI * 2;
		water.tri(
			sc,
			[sc[0] + Math.cos(a0) * 0.2, sc[1], sc[2] + Math.sin(a0) * 0.15],
			[sc[0] + Math.cos(a1) * 0.2, sc[1], sc[2] + Math.sin(a1) * 0.15],
			{ tone: 'water', k: 1.08 },
			down
		);
	}
	water.extraAt = null;
	for (let i = 0; i < 7; i++) {
		const a = (i / 7) * Math.PI * 2 + 0.4;
		if (Math.cos(a) > 0.75 && Math.sin(a) > 0) continue; // the outlet
		const s = 0.05 + hash3([i, 3, 1]) * 0.04;
		const p: V3 = [sc[0] + Math.cos(a) * 0.27, sc[1] + 0.005, sc[2] + Math.sin(a) * 0.2];
		bed.pivotAt = () => p;
		bed.growAt = () => 0.02 + i * 0.01;
		blob(
			bed,
			p,
			[s * 1.2, s * 0.8, s],
			0,
			(n) => ({ tone: 'rock', mix: 'canopy', t: n[1] > 0.6 ? 0.35 : 0, k: 1.15 }),
			0.25,
			70 + i
		);
	}
}
