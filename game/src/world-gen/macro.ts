/**
 * Layer 0 and the relief detail (WORLD.md §1, f-mundo-infinito.md §4.1, §4.5
 * step 2, §4.6): the sea to the west, a coast running north–south, and a
 * profile across it that climbs without end to the east: restinga, baixada,
 * encosta, serra, the crest with its campos, then the araucária planalto.
 *
 * The profile is calibrated on the Reserva (LEVEL.md §3): within its z range
 * the coast sits at x = 0 and the serra foot at x = 132, and the formula is
 * level/build.ts shapeRelief's (restinga 0.5 to x 10, baixada 1.6 → 2.8 with
 * ±1 noise clamped to 1–4 up to x 110, encosta 3 → 6 to x 126, 7.5 at x 132),
 * then the serra rising 11 → 18 over x 136–160 and on. Away from the Reserva
 * the coast meanders, the coast-to-serra distance alternates between costões
 * (~130 u) and wide baixadas (~600 u) along z, and the coordinates are
 * domain-warped; near it (within the stitch band) both stay at the Reserva's.
 */
import { clamp, fbm, valueNoise } from '../survival/noise.ts';
import { WATER_LEVEL } from '../survival/types.ts';
import {
	type LayerSeeds,
	layerSeeds,
	outsideReserveZ,
	reserveDistance,
	STITCH_BAND,
	WORLD_SEED
} from './constants.ts';
import { CoarseField, smooth as smoothstep } from './math.ts';

/** Coast-to-serra-foot distance at the Reserva and at the costões. */
export const COSTAO_FOOT = 132;
/** The same distance in the widest baixadas. */
export const BAIXADA_FOOT = 600;
/** The crest, as a distance past the serra foot; the planalto starts PLANALTO_S past the foot. */
export const CREST_S = 240;
export const PLANALTO_S = CREST_S + 60;

/** Domain warp: amplitude in u and frequency per u (2 octaves keep the warped x monotone in x). */
const WARP = 25;
const WARP_FREQ = 0.006;
/** Node spacing of the low-frequency fields (math.ts CoarseField): 1/20 of the warp's shortest wavelength. */
const WARP_STEP = 8;
const MORRO_STEP = 4;
const EXPOSURE_STEP = 8;
/** Warp, morros and coast meanders grow from 0 at the stitch band to full over this distance. */
const CALM_DISTANCE = 300;

/**
 * A seed's layer streams and its low-frequency fields, read through
 * world-aligned coarse grids: the warp, the morros and the crest's exposure.
 */
export class MacroFields {
	readonly layers: LayerSeeds;
	readonly warpX: CoarseField;
	readonly warpZ: CoarseField;
	readonly morro: CoarseField;
	readonly exposure: CoarseField;

	constructor(seed: number) {
		const layers = layerSeeds(seed);
		this.layers = layers;
		this.warpX = new CoarseField(WARP_STEP, (x, z) => fbm(x * WARP_FREQ, z * WARP_FREQ, layers.warpX, 2));
		this.warpZ = new CoarseField(WARP_STEP, (x, z) =>
			fbm(x * WARP_FREQ + 5.2, z * WARP_FREQ + 1.3, layers.warpZ, 2)
		);
		this.morro = new CoarseField(MORRO_STEP, (x, z) => fbm(x * 0.011, z * 0.011, layers.morro, 3));
		this.exposure = new CoarseField(EXPOSURE_STEP, (x, z) => fbm(x * 0.008, z * 0.008, layers.exposure, 2));
	}

	/** Tabulates the fields' nodes over a rectangle about to be sampled (only saves time). */
	prepare(x0: number, z0: number, x1: number, z1: number) {
		this.warpX.prepare(x0, z0, x1, z1);
		this.warpZ.prepare(x0, z0, x1, z1);
		this.morro.prepare(x0, z0, x1, z1);
		this.exposure.prepare(x0, z0, x1, z1);
	}
}

const fieldsBySeed = new Map<number, MacroFields>();

export function clearMacroCaches() {
	fieldsBySeed.clear();
}

/** The shared fields of a seed. */
export function macroFields(seed: number): MacroFields {
	let fields = fieldsBySeed.get(seed);
	if (!fields) {
		if (fieldsBySeed.size > 8) fieldsBySeed.clear();
		fields = new MacroFields(seed);
		fieldsBySeed.set(seed, fields);
	}
	return fields;
}

/** Coast line x(z): straight at the Reserva, meandering ±40 u away from it. */
export function coastX(z: number, layers: LayerSeeds): number {
	const a = smoothstep(STITCH_BAND, 400, outsideReserveZ(z));
	return a > 0 ? 40 * a * fbm(z * 0.004, 0.5, layers.coast, 3) : 0;
}

/**
 * Distance from the coast to the serra foot at z: COSTAO_FOOT next to the
 * Reserva, then low-frequency noise (~1.8 km cells) pushes it between the
 * costões and BAIXADA_FOOT, so the variety shows on the 2–4 km scale.
 */
export function serraFoot(z: number, layers: LayerSeeds): number {
	const a = smoothstep(2 * STITCH_BAND, 500, outsideReserveZ(z));
	if (a === 0) return COSTAO_FOOT;
	const t = smoothstep(-0.3, 0.3, fbm(z * 0.00055, 0.5, layers.foot, 2));
	return COSTAO_FOOT + (BAIXADA_FOOT - COSTAO_FOOT) * t * a;
}

/**
 * The serra above the encosta's 7.5 u, by distance s past the foot: 10 at s 4,
 * just under 18 at 28 (the Reserva's east edge, x 160), 24 at 60, 44 at ~170,
 * the crest's 52 at 240, then the planalto's 44.
 */
export function serraRise(s: number): number {
	if (s <= 0) return 0;
	return (
		3.5 * smoothstep(0, 6, s) +
		7 * smoothstep(4, 30, s) +
		6 * smoothstep(28, 60, s) +
		20 * smoothstep(55, 175, s) +
		8 * smoothstep(160, CREST_S, s) -
		8 * smoothstep(CREST_S + 10, CREST_S + 100, s)
	);
}

/** LEVEL.md §3's encosta at Reserva-equivalent x = k: 3 → 6 linearly over 110–126, then 6 → 7.5 by 132. */
function encosta(k: number): number {
	return k <= 126 ? 3 + (3 * clamp(k - 110, 0, 16)) / 16 : 6 + 1.5 * smoothstep(126, 132, k);
}

/** Large-scale height (no detail) at warped coast distance e, with the serra foot at `foot`. */
export function macroHeight(e: number, foot: number): number {
	if (e < 0) return -3 + 3.5 * smoothstep(-24, 0, e);
	const k = e - foot + COSTAO_FOOT;
	const base = 1.6 + 1.2 * smoothstep(10, foot - 22, e);
	let h = 0.5 + (base - 0.5) * smoothstep(9, 14, e);
	h += (encosta(k) - h) * smoothstep(104, 112, k);
	return h + serraRise(e - foot);
}

/** Amplitude of the serra's fBm hills, by distance past the foot (gentler on the planalto). */
export const hillsAmplitude = (s: number) =>
	7 * smoothstep(-10, 80, s) * (1 - 0.6 * smoothstep(CREST_S + 20, CREST_S + 120, s));
/** Amplitude of the ridged noise: the serra's crests and gullies, gone on the planalto. */
export const ridgeAmplitude = (s: number) =>
	7 * smoothstep(0, 100, s) * (1 - smoothstep(CREST_S + 10, CREST_S + 90, s));

/** One point of the macro layer, filled in place by samplePoint (no allocation per vertex). */
export interface MacroPoint {
	/** Warped coordinates the detail noise reads. */
	wx: number;
	wz: number;
	/** Warped distance from the coast (east positive) and past the serra foot. */
	e: number;
	s: number;
	foot: number;
	/** Distance to the Reserva's square. */
	reserve: number;
	/** 0 within the stitch band, 1 far from the Reserva. */
	calm: number;
	/** Macro height, no detail: what the biome ladder reads. */
	macro: number;
	/** Ground with the detail, before the rivers carve it. */
	ground: number;
	/** A height the ground never goes below around here: river water stays under it. */
	floor: number;
}

export function newMacroPoint(): MacroPoint {
	return { wx: 0, wz: 0, e: 0, s: 0, foot: 0, reserve: 0, calm: 0, macro: 0, ground: 0, floor: 0 };
}

/**
 * Samples (x, z). `coast` and `foot` are coastX(z) and serraFoot(z) of the
 * same fields' layers, passed in so a row computes them once; they are pure
 * functions of z, so every chunk gets the same values.
 */
export function samplePoint(
	x: number,
	z: number,
	coast: number,
	foot: number,
	fields: MacroFields,
	out: MacroPoint
): MacroPoint {
	const layers = fields.layers;
	const reserve = reserveDistance(x, z);
	const calm = smoothstep(STITCH_BAND, CALM_DISTANCE, reserve);
	let wx = x;
	let wz = z;
	if (calm > 0) {
		wx = x + WARP * calm * fields.warpX.at(x, z);
		wz = z + WARP * calm * fields.warpZ.at(x, z);
	}
	const e = wx - coast;
	const s = e - foot;
	out.wx = wx;
	out.wz = wz;
	out.e = e;
	out.s = s;
	out.foot = foot;
	out.reserve = reserve;
	out.calm = calm;
	const macro = macroHeight(e, foot);
	out.macro = macro;
	if (e < 0) {
		out.ground = macro;
		out.floor = macro;
		return out;
	}

	// LEVEL.md §3 with noise: the baixada's ±1 clamped to 1–4, the encosta's ±0.3.
	const k = e - foot + COSTAO_FOOT;
	const n = fbm(wx * 0.045, wz * 0.045, layers.plain, 3);
	const base = 1.6 + 1.2 * smoothstep(10, foot - 22, e);
	let h = 0.5 + (clamp(base + n, 1, 4) - 0.5) * smoothstep(9, 14, e);
	const east = smoothstep(104, 112, k);
	h += (encosta(k) + 0.3 * n - h) * east;

	// Morros (isolated hills) in the baixadas far from the Reserva: only ever adds height.
	const morro = 9 * smoothstep(150, 700, reserve) * smoothstep(20, 60, e) * (1 - east);
	if (morro > 0) h += morro * Math.max(0, fields.morro.at(x, z) - 0.15);

	h += serraRise(s);
	const hills = hillsAmplitude(s);
	if (hills > 0) h += hills * fbm(wx * 0.02, wz * 0.02, layers.hills, 4);
	const ridge = ridgeAmplitude(s);
	if (ridge > 0) {
		let sum = 0;
		let amp = 1;
		let freq = 0.011;
		for (let o = 0; o < 3; o++) {
			const v = 1 - Math.abs(valueNoise(wx * freq, wz * freq, layers.ridge + o));
			sum += v * v * amp;
			amp *= 0.5;
			freq *= 2.03;
		}
		// sum is in [0, 1.75]: centred to [−1, 1].
		h += ridge * (sum / 0.875 - 1);
	}
	out.ground = h;
	out.floor = macro - 1.3 - hills - ridge;
	return out;
}

/**
 * Where a river node's water would sit: at sea level by the coast, rising
 * 0.25 u per 100 u across the baixada (never above 0.5, so 0.5 u under its
 * lowest ground), then 85% of the floor's height in the serra. Always under
 * the ground around the node; rivers.ts makes it fall along every river.
 */
export function riverWaterTarget(p: MacroPoint): number {
	if (p.e < 0) return WATER_LEVEL;
	return WATER_LEVEL + Math.min(1, 0.0025 * p.e) + 0.85 * Math.max(0, p.floor - 1.5);
}

/**
 * Heights for the horizon ring (ART.md §5, f-mundo-infinito.md §4.10): a
 * (cells + 1)² grid from (x0, z0) every `step` u, row-major. By default the
 * macro height alone (no warp, no detail, no rivers): a closed form, about
 * 0.1 µs a sample, which the fog makes indistinguishable from the chunks'
 * ground. With `detail`, the chunks' uncarved ground (warp, hills, ridges,
 * morros), several times dearer. The Reserva and its band read as the macro.
 */
export function farHeights(
	x0: number,
	z0: number,
	cells: number,
	step: number,
	seed: number = WORLD_SEED,
	detail = false
): Float32Array {
	const fields = macroFields(seed);
	const side = cells + 1;
	const out = new Float32Array(side * side);
	const p = newMacroPoint();
	for (let j = 0; j < side; j++) {
		const z = z0 + j * step;
		const coast = coastX(z, fields.layers);
		const foot = serraFoot(z, fields.layers);
		for (let i = 0; i < side; i++) {
			const x = x0 + i * step;
			out[j * side + i] = detail
				? samplePoint(x, z, coast, foot, fields, p).ground
				: macroHeight(x - coast, foot);
		}
	}
	return out;
}
