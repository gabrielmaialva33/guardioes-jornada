/**
 * Low-poly geometry builder. Everything in the diorama is flat-shaded
 * triangles whose light and ambient occlusion are baked into vertex colours,
 * so the scene renders with unlit materials and no lights at all.
 *
 * Each vertex also carries what the growth shader needs: a pivot it
 * collapses to before it has grown, and a growth threshold (0..1).
 */
import { BufferAttribute, BufferGeometry, IcosahedronGeometry } from 'three';
import { TONE, type Palette, type Tone } from './palette.ts';

export type V3 = [number, number, number];

export interface Paint {
	tone: Tone;
	/** Second tone to mix towards. */
	mix?: Tone;
	/** Mix amount towards `mix` (0..1). */
	t?: number;
	/** Brightness multiplier on top of the baked light. */
	k?: number;
}

/** Sun from the upper right, where the SVG landscape puts it. */
const SUN = normalize([0.55, 0.78, 0.42]);

export function normalize(v: V3): V3 {
	const l = Math.hypot(v[0], v[1], v[2]) || 1;
	return [v[0] / l, v[1] / l, v[2] / l];
}

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const lerp3 = (a: V3, b: V3, t: number): V3 => [
	a[0] + (b[0] - a[0]) * t,
	a[1] + (b[1] - a[1]) * t,
	a[2] + (b[2] - a[2]) * t
];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0]
];

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const smoothstep = (a: number, b: number, v: number) => {
	const t = clamp((v - a) / (b - a));
	return t * t * (3 - 2 * t);
};

/** Baked light for a face normal: sky fill from above plus a soft sun. */
function light(n: V3): number {
	const hemi = 0.5 + 0.5 * n[1];
	const sun = Math.max(0, dot(n, SUN));
	return (0.5 + 0.5 * hemi) * (0.64 + 0.56 * sun);
}

/** Deterministic PRNG (mulberry32), so the forest is the same on every phone. */
export function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
export type Rng = ReturnType<typeof rng>;

/** Smooth-ish value noise from a position, stable for shared vertices. */
export function hash3(p: V3, seed = 0): number {
	const s = Math.sin(p[0] * 127.1 + p[1] * 311.7 + p[2] * 74.7 + seed * 19.19) * 43758.5453;
	return s - Math.floor(s);
}

/** Geometry plus the per-vertex tone data needed to repaint it for another theme. */
export interface Paintable {
	geometry: BufferGeometry;
	toneA: Uint8Array;
	toneB: Uint8Array;
	mix: Float32Array;
	shade: Float32Array;
	/** Optional per-vertex alpha (glow discs). */
	alpha?: Float32Array;
}

export class MeshBuilder {
	private pos: number[] = [];
	private toneA: number[] = [];
	private toneB: number[] = [];
	private mixT: number[] = [];
	private shade: number[] = [];
	private grow: number[] = [];
	private pivot: number[] = [];
	private extra: number[] = [];

	/** Growth pivot for the next triangles (or a function of each vertex). */
	pivotAt: (p: V3) => V3 = () => [0, 0, 0];
	/** Growth threshold for each vertex of the next triangles. */
	growAt: (p: V3) => number = () => 0;
	/** Per-vertex ambient occlusion for the next triangles. */
	aoAt: (p: V3) => number = () => 1;
	/** Extra per-vertex attribute (e.g. water flow coordinates). */
	extraAt: ((p: V3) => number[]) | null = null;

	constructor(private readonly extraSize = 0) {}

	get triangles() {
		return this.pos.length / 9;
	}

	/**
	 * Adds a flat-shaded triangle. `outFrom` is a point the face should look
	 * away from: the winding is flipped if needed, so primitives can be built
	 * without caring about vertex order.
	 */
	tri(a: V3, b: V3, c: V3, paint: Paint, outFrom?: V3) {
		let n = cross(sub(b, a), sub(c, a));
		if (outFrom) {
			const centroid: V3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
			if (dot(n, sub(centroid, outFrom)) < 0) {
				[b, c] = [c, b];
				n = scale(n, -1);
			}
		}
		const lit = light(normalize(n)) * (paint.k ?? 1);
		const ta = TONE[paint.tone];
		const tb = TONE[paint.mix ?? paint.tone];
		for (const p of [a, b, c]) {
			this.pos.push(p[0], p[1], p[2]);
			this.toneA.push(ta);
			this.toneB.push(tb);
			this.mixT.push(paint.t ?? 0);
			this.shade.push(lit * this.aoAt(p));
			const pv = this.pivotAt(p);
			this.pivot.push(pv[0], pv[1], pv[2]);
			this.grow.push(clamp(this.growAt(p)));
			if (this.extraAt) this.extra.push(...this.extraAt(p));
		}
	}

	quad(a: V3, b: V3, c: V3, d: V3, paint: Paint, outFrom?: V3) {
		this.tri(a, b, c, paint, outFrom);
		this.tri(a, c, d, paint, outFrom);
	}

	build(palette: Palette, attrs: { growth?: boolean; extraName?: string } = {}): Paintable {
		const geometry = new BufferGeometry();
		geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
		const count = this.pos.length / 3;
		geometry.setAttribute('color', new BufferAttribute(new Float32Array(count * 3), 3));
		if (attrs.growth) {
			geometry.setAttribute('aGrow', new BufferAttribute(new Float32Array(this.grow), 1));
			geometry.setAttribute('aPivot', new BufferAttribute(new Float32Array(this.pivot), 3));
		}
		if (attrs.extraName && this.extraSize) {
			geometry.setAttribute(
				attrs.extraName,
				new BufferAttribute(new Float32Array(this.extra), this.extraSize)
			);
		}
		geometry.computeBoundingSphere();
		const paintable: Paintable = {
			geometry,
			toneA: new Uint8Array(this.toneA),
			toneB: new Uint8Array(this.toneB),
			mix: new Float32Array(this.mixT),
			shade: new Float32Array(this.shade)
		};
		repaint(paintable, palette);
		return paintable;
	}
}

/** Writes the vertex colours for the given theme. */
export function repaint(p: Paintable, palette: Palette) {
	const attr = p.geometry.getAttribute('color') as BufferAttribute;
	const out = attr.array as Float32Array;
	const size = attr.itemSize;
	const { colors } = palette;
	for (let i = 0; i < p.toneA.length; i++) {
		const a = colors[p.toneA[i]];
		const b = colors[p.toneB[i]];
		const t = p.mix[i];
		const s = p.shade[i];
		out[i * size] = (a.r + (b.r - a.r) * t) * s;
		out[i * size + 1] = (a.g + (b.g - a.g) * t) * s;
		out[i * size + 2] = (a.b + (b.b - a.b) * t) * s;
		if (size === 4) out[i * size + 3] = p.alpha?.[i] ?? 1;
	}
	attr.needsUpdate = true;
}

// --- Primitives -------------------------------------------------------------

/** Unit icosphere triangles, cached per detail level. */
const icoCache = new Map<number, V3[]>();
function icoTriangles(detail: number): V3[] {
	let tris = icoCache.get(detail);
	if (!tris) {
		const geo = new IcosahedronGeometry(1, detail);
		const arr = geo.getAttribute('position').array;
		tris = [];
		for (let i = 0; i < arr.length; i += 3) tris.push([arr[i], arr[i + 1], arr[i + 2]]);
		geo.dispose();
		icoCache.set(detail, tris);
	}
	return tris;
}

/**
 * A jittered low-poly blob (tree canopies, tufts, rocks, clouds). Shared
 * vertices jitter by the same amount, so the surface stays closed.
 */
export function blob(
	b: MeshBuilder,
	center: V3,
	radius: V3,
	detail: number,
	paint: (normal: V3, p: V3) => Paint,
	jitter = 0.18,
	seed = 0
) {
	const tris = icoTriangles(detail);
	const place = (u: V3): V3 => {
		const j = 1 + (hash3(u, seed) - 0.5) * 2 * jitter;
		return [
			center[0] + u[0] * radius[0] * j,
			center[1] + u[1] * radius[1] * j,
			center[2] + u[2] * radius[2] * j
		];
	};
	for (let i = 0; i < tris.length; i += 3) {
		const a = place(tris[i]);
		const c1 = place(tris[i + 1]);
		const c2 = place(tris[i + 2]);
		const mid = normalize(add(add(tris[i], tris[i + 1]), tris[i + 2]));
		b.tri(a, c1, c2, paint(mid, a), center);
	}
}

/** Tapered prism between two points (trunks, branches). No caps. */
export function prism(
	b: MeshBuilder,
	from: V3,
	to: V3,
	r0: number,
	r1: number,
	sides: number,
	paint: Paint,
	twist = 0
) {
	const axis = normalize(sub(to, from));
	const helper: V3 = Math.abs(axis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
	const u = normalize(cross(axis, helper));
	const v = cross(axis, u);
	const ring = (c: V3, r: number, i: number): V3 => {
		const a = (i / sides) * Math.PI * 2 + twist;
		return add(c, add(scale(u, Math.cos(a) * r), scale(v, Math.sin(a) * r)));
	};
	const mid = lerp3(from, to, 0.5);
	for (let i = 0; i < sides; i++) {
		const a0 = ring(from, r0, i);
		const a1 = ring(from, r0, i + 1);
		const b0 = ring(to, r1, i);
		const b1 = ring(to, r1, i + 1);
		if (r1 > 0.0001) b.quad(a0, a1, b1, b0, paint, mid);
		else b.tri(a0, a1, to, paint, mid);
	}
}

/** Open cone (cedro layers, mountains are built separately). */
export function cone(
	b: MeshBuilder,
	base: V3,
	height: number,
	radius: number,
	sides: number,
	paint: (i: number) => Paint,
	twist = 0
) {
	const apex: V3 = [base[0], base[1] + height, base[2]];
	const inside: V3 = [base[0], base[1] + height * 0.3, base[2]];
	for (let i = 0; i < sides; i++) {
		const a0 = (i / sides) * Math.PI * 2 + twist;
		const a1 = ((i + 1) / sides) * Math.PI * 2 + twist;
		const p0: V3 = [base[0] + Math.cos(a0) * radius, base[1], base[2] + Math.sin(a0) * radius];
		const p1: V3 = [base[0] + Math.cos(a1) * radius, base[1], base[2] + Math.sin(a1) * radius];
		b.tri(p0, p1, apex, paint(i), inside);
		// Underside, so layers read as solid when the camera sways.
		b.tri(p0, p1, [base[0], base[1] + height * 0.12, base[2]], { ...paint(i), k: (paint(i).k ?? 1) * 0.55 }, [
			base[0],
			base[1] + height,
			base[2]
		]);
	}
}

/** Flat disc hugging the ground: baked blob shadow under trees. */
export function groundDisc(
	b: MeshBuilder,
	center: V3,
	radius: number,
	sides: number,
	heightAt: (x: number, z: number) => number,
	paint: Paint,
	lift = 0.014
) {
	const c: V3 = [center[0], heightAt(center[0], center[2]) + lift, center[2]];
	for (let i = 0; i < sides; i++) {
		const a0 = (i / sides) * Math.PI * 2;
		const a1 = ((i + 1) / sides) * Math.PI * 2;
		const x0 = center[0] + Math.cos(a0) * radius;
		const z0 = center[2] + Math.sin(a0) * radius * 0.8;
		const x1 = center[0] + Math.cos(a1) * radius;
		const z1 = center[2] + Math.sin(a1) * radius * 0.8;
		b.tri(c, [x0, heightAt(x0, z0) + lift, z0], [x1, heightAt(x1, z1) + lift, z1], paint, [
			c[0],
			c[1] - 5,
			c[2]
		]);
	}
}
