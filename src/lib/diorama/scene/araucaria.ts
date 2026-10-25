/**
 * Araucaria angustifolia, the heart of the forest (stage 5). A straight
 * trunk, whorls of branches that run out and then curve up, and flat tufts
 * at their tips: the candelabra silhouette of the Paraná pine.
 *
 * It grows in order: the trunk rises, each whorl unfolds as the trunk
 * passes it, and the tufts pop at the branch tips.
 */
import { add, blob, groundDisc, hash3, type MeshBuilder, prism, scale, type V3 } from './builder.ts';
import { heightAt } from './layout.ts';

export interface AraucariaOptions {
	height: number;
	whorls: number;
	branches: number;
	/** When this tree starts growing within the stage (0..1). */
	order: number;
	seed: number;
}

export function araucaria(b: MeshBuilder, base: V3, o: AraucariaOptions) {
	const H = o.height;
	const k = H / 2.5;
	// Growth thresholds are compressed into what is left after `order`.
	const span = 1 - o.order;
	const at = (f: number) => o.order + f * span;

	b.pivotAt = () => base;
	b.growAt = () => at(0);
	groundDisc(b, [base[0] - 0.12 * k, 0, base[2] - 0.08 * k], 0.62 * k, 8, heightAt, {
		tone: 'ground',
		mix: 'canopy-dark',
		t: 0.55,
		k: 0.58
	});

	// Trunk: rises during the first half of the growth.
	const trunkTop = 0.95 * H;
	b.growAt = (p) => at(Math.max(0, Math.min(1, (p[1] - base[1]) / H)) * 0.5);
	const segs = 4;
	for (let i = 0; i < segs; i++) {
		const y0 = (i / segs) * trunkTop;
		const y1 = ((i + 1) / segs) * trunkTop;
		const r0 = (0.075 - 0.045 * (i / segs)) * k;
		const r1 = (0.075 - 0.045 * ((i + 1) / segs)) * k;
		prism(
			b,
			[base[0], base[1] + y0, base[2]],
			[base[0], base[1] + y1, base[2]],
			r0,
			r1,
			6,
			{ tone: 'bark', k: 0.88 - i * 0.03 },
			i * 0.3
		);
	}

	const tuftPaint = (n: V3) => ({
		tone: 'canopy-dark' as const,
		mix: 'canopy' as const,
		t: Math.max(0, n[1]) * 0.85,
		k: 1.14
	});

	for (let w = 0; w < o.whorls; w++) {
		const f = o.whorls === 1 ? 0.75 : w / (o.whorls - 1);
		const y = base[1] + H * (0.58 + 0.33 * f);
		const L = H * (0.42 - 0.27 * f);
		// Branches run out almost level, then hook upwards: every tip ends near
		// the same height, which gives the flat-topped candelabra crown.
		const rise = base[1] + H * (0.93 + 0.04 * f) - y;
		const start = 0.5 * (0.58 + 0.33 * f) + 0.02;
		const count = o.branches + (w % 2 === 0 ? 0 : -1);
		for (let j = 0; j < count; j++) {
			const a = (j / count) * Math.PI * 2 + w * 0.62 + o.seed + (hash3([w, j, o.seed]) - 0.5) * 0.5;
			const dir: V3 = [Math.cos(a), 0, Math.sin(a)];
			const len = L * (0.88 + hash3([j, w, 7]) * 0.24);
			const p0: V3 = [base[0], y, base[2]];
			const path: V3[] = [
				p0,
				add(p0, add(scale(dir, len * 0.55), [0, rise * 0.05, 0])),
				add(p0, add(scale(dir, len * 0.86), [0, rise * 0.32, 0])),
				add(p0, add(scale(dir, len * 0.94), [0, rise, 0]))
			];
			b.pivotAt = () => p0;
			b.growAt = (p) => {
				const out = Math.hypot(p[0] - p0[0], p[2] - p0[2]) / len;
				return at(start + Math.min(1, out) * 0.3);
			};
			for (let s = 0; s < path.length - 1; s++) {
				const r0 = (0.024 - s * 0.005) * k;
				prism(b, path[s], path[s + 1], r0, r0 - 0.005 * k, 4, {
					tone: 'bark',
					mix: 'canopy-dark',
					t: 0.3,
					k: 0.8
				});
			}
			// Foliage brushes: a wide flat tuft at the tip, a crest above it and,
			// on the long lower branches, one more where the branch turns up.
			const tip = path[path.length - 1];
			b.pivotAt = () => tip;
			b.growAt = () => at(start + 0.3);
			const tr = (0.21 + 0.09 * (1 - f)) * k;
			blob(b, tip, [tr, 0.1 * k, tr], 0, tuftPaint, 0.25, w * 10 + j);
			blob(
				b,
				[tip[0], tip[1] + 0.08 * k, tip[2]],
				[tr * 0.6, 0.08 * k, tr * 0.6],
				0,
				tuftPaint,
				0.25,
				w * 10 + j + 50
			);
			if (f < 0.6) {
				const bend = path[2];
				b.pivotAt = () => bend;
				b.growAt = () => at(start + 0.26);
				blob(
					b,
					[bend[0], bend[1] + 0.03 * k, bend[2]],
					[tr * 0.62, 0.075 * k, tr * 0.62],
					0,
					tuftPaint,
					0.25,
					w * 10 + j + 90
				);
			}
		}
	}

	// Crown centre.
	const crown: V3 = [base[0], base[1] + trunkTop, base[2]];
	b.pivotAt = () => crown;
	b.growAt = () => at(0.62);
	blob(b, crown, [0.26 * k, 0.11 * k, 0.26 * k], 0, tuftPaint, 0.2, o.seed + 99);
}
