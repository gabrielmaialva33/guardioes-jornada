/**
 * The shared wind field of ART.md §7: one direction plus slow gust noise that
 * drives grass, canopies, falling leaves and the flocks' drift, so everything
 * moves together.
 *
 * The same field exists twice, written from the same constants so the two can
 * never drift apart:
 * - `windAt()` on the CPU (particles, flocks), writing into an output object;
 * - `WIND_GLSL` for vertex shaders, with the shared `windUniforms` (direction,
 *   time, strength) that the living world updates once per frame.
 *
 * The field returns a horizontal vector of length ≤ 1 (exactly 1 at the
 * strongest gust): a material multiplies it by its own sway amplitude
 * (ART.md: grass tips ≤ 0.15 u, canopy tops ≤ 0.1 u, trunks still), and the
 * particles by the air speed. The prevailing direction is the sea breeze: from
 * the sea at x = 0 toward the serra, turned 20° south. With reduced motion the
 * strength goes to 0 and nothing sways.
 *
 * Time terms use whole cycles per WIND.period, so the field is periodic and
 * the time sent to the GPU is wrapped without a jump or a float32 precision
 * loss on long sessions.
 */
import type { Material } from 'three';

const TAU = Math.PI * 2;
const DIRECTION_DEG = 20;

/** Tuning [engine]. */
export const WIND = {
	/** Prevailing direction on the ground plane (unit x, z): the sea breeze, toward +x and a little +z. */
	dirX: Math.cos((DIRECTION_DEG * Math.PI) / 180),
	dirZ: Math.sin((DIRECTION_DEG * Math.PI) / 180),
	/** Seconds after which the whole field repeats exactly. */
	period: 600,
	/** Air speed at the strongest gust, u/s: falling leaves, pollen and butterflies drift with it. */
	speed: 1.1,
	/** Sway amplitudes of ART.md §7, u: what applyWind multiplies the field by. */
	grassSway: 0.15,
	canopySway: 0.1
} as const;

// Field constants. Spatial frequencies in rad/u along and across the wind, time
// frequencies as whole cycles per period (so the field is periodic).
const K_ALONG_1 = 0.11;
const K_ACROSS_1 = 0.05;
const K_ALONG_2 = 0.27;
const K_ACROSS_2 = 0.13;
const K_ALONG_3 = 0.6;
const K_ACROSS_3 = 0.4;
const W_GUST = (TAU * 86) / WIND.period;
const W_RIPPLE = (TAU * 200) / WIND.period;
const W_FLUTTER = (TAU * 315) / WIND.period;
const GUST_MEAN = 0.55;
const GUST_WAVE = 0.3;
const GUST_RIPPLE = 0.15;
const FLUTTER = 0.25;
/** 1 / |(1, FLUTTER)|: the strongest gust with the strongest flutter has length 1. */
const NORM = 1 / Math.sqrt(1 + FLUTTER * FLUTTER);

/**
 * The field at a point: set atX, atZ, time and strength, call read(), use x, z
 * and gust. Inputs travel through fields so the per-frame paths pass no
 * number arguments (V8 boxes them in calls it does not inline).
 */
export class WindSample {
	/** Output: the horizontal field (|x, z| ≤ 1) and the gust strength 0..1. */
	x = 0;
	z = 0;
	gust = 0;
	/** Input: the ground point, the clock (any value, it is wrapped) and the strength (0 with reduced motion). */
	atX = 0;
	atZ = 0;
	time = 0;
	strength = 1;

	read(): this {
		let t = this.time % WIND.period;
		if (t < 0) t += WIND.period;
		if (Number.isNaN(t)) t = 0;
		const along = this.atX * WIND.dirX + this.atZ * WIND.dirZ;
		const across = -this.atX * WIND.dirZ + this.atZ * WIND.dirX;
		const gust =
			GUST_MEAN +
			GUST_WAVE * Math.sin(K_ALONG_1 * along - W_GUST * t + 0.7 * Math.sin(K_ACROSS_1 * across)) +
			GUST_RIPPLE * Math.sin(K_ALONG_2 * along + K_ACROSS_2 * across - W_RIPPLE * t);
		const flutter = FLUTTER * gust * Math.sin(K_ALONG_3 * along + K_ACROSS_3 * across - W_FLUTTER * t);
		const s = this.strength * NORM;
		this.x = (WIND.dirX * gust - WIND.dirZ * flutter) * s;
		this.z = (WIND.dirZ * gust + WIND.dirX * flutter) * s;
		this.gust = gust * this.strength;
		return this;
	}
}

/** A float uniform with its own class, so writing a new value updates it in place (no heap number). */
export class FloatUniform {
	value = 0;
	constructor(value: number) {
		this.value = value;
	}
}

/** Shared uniforms of every wind-patched material; the living world refreshes them each frame. */
export const windUniforms = {
	uWindDirection: { value: [WIND.dirX, WIND.dirZ] as [number, number] },
	uWindTime: new FloatUniform(0.5),
	uWindStrength: new FloatUniform(1)
};

/** Wraps a clock to the field's period. */
export function windTime(time: number): number {
	const t = Number.isFinite(time) ? time % WIND.period : 0;
	return t < 0 ? t + WIND.period : t;
}

/**
 * Refreshes the shared uniforms: the wrapped time, and strength 0 with reduced
 * motion (ART.md §7: wind sway goes to zero). Call once per frame.
 */
export function updateWind(time: number, reducedMotion: boolean) {
	windClock.time = time;
	windClock.reducedMotion = reducedMotion;
	windClock.update();
}

/** updateWind through fields, for the per-frame path: set time and reducedMotion, call update(). */
export const windClock = {
	time: 0.5,
	reducedMotion: false,
	update() {
		let t = this.time % WIND.period;
		if (t < 0) t += WIND.period;
		if (Number.isNaN(t)) t = 0;
		windUniforms.uWindTime.value = t;
		windUniforms.uWindStrength.value = this.reducedMotion ? 0 : 1;
	}
};

/**
 * The field at a ground point and a time (seconds, any value: it is wrapped),
 * scaled by `strength` (0 with reduced motion). Writes into `out`; allocates
 * nothing. The same math as WIND_GLSL's lifeWind().
 */
export function windAt(x: number, z: number, time: number, strength: number, out: WindSample): WindSample {
	out.atX = x;
	out.atZ = z;
	out.time = time;
	out.strength = strength;
	return out.read();
}

const f = (value: number) => {
	const text = value.toFixed(7);
	return text.includes('.') ? text : `${text}.0`;
};

/**
 * Uniforms and the field as GLSL (vertex stage). `lifeWind(p)` takes a world
 * ground point (x, z) and returns the field in .xy (|xy| ≤ 1) and the gust in .z.
 */
export const WIND_GLSL = /* glsl */ `
uniform vec2 uWindDirection;
uniform float uWindTime;
uniform float uWindStrength;
vec3 lifeWind( vec2 p ) {
	float along = dot( p, uWindDirection );
	float across = dot( p, vec2( -uWindDirection.y, uWindDirection.x ) );
	float t = uWindTime;
	float gust = ${f(GUST_MEAN)} + ${f(GUST_WAVE)} * sin( ${f(K_ALONG_1)} * along - ${f(W_GUST)} * t + 0.7 * sin( ${f(K_ACROSS_1)} * across ) )
		+ ${f(GUST_RIPPLE)} * sin( ${f(K_ALONG_2)} * along + ${f(K_ACROSS_2)} * across - ${f(W_RIPPLE)} * t );
	float flutter = ${f(FLUTTER)} * gust * sin( ${f(K_ALONG_3)} * along + ${f(K_ACROSS_3)} * across - ${f(W_FLUTTER)} * t );
	float s = uWindStrength * ${f(NORM)};
	return vec3( ( uWindDirection * gust + vec2( -uWindDirection.y, uWindDirection.x ) * flutter ) * s, gust * uWindStrength );
}
`;

/** Per-material sway settings (see applyWind). */
export interface WindOptions {
	/** Sway at full height, world units: WIND.grassSway for grass, WIND.canopySway for canopies. */
	amplitude: number;
	/** Local (model) heights where the sway starts (trunk top: no sway below) and reaches full amplitude. */
	from: number;
	to: number;
	/**
	 * Where the field is read: 'vertex' (every vertex: ripples run across a grass
	 * field) or 'origin' (the instance or object origin: a crown sways as one).
	 */
	sample?: 'vertex' | 'origin';
}

/** Per-material uniforms written by applyWind (also kept in material.userData.lifeWind). */
export interface WindMaterialUniforms {
	uWindAmplitude: { value: number };
	uWindFrom: { value: number };
	uWindTo: { value: number };
}

export const WIND_HEADER = `${WIND_GLSL}
uniform float uWindAmplitude;
uniform float uWindFrom;
uniform float uWindTo;
`;

/**
 * The displacement, inserted after <begin_vertex>. It works in world units
 * under any instance or object transform made of a rotation and a uniform
 * scale (every placed tree and grass chunk): the world offset is taken back to
 * local space with M⁻¹ = Mᵀ / s². Normals are left as they are (sways are
 * small). The height mask uses the local y, so trunks stay still.
 */
export function windVertex(sample: 'vertex' | 'origin' = 'vertex') {
	return /* glsl */ `
	#ifdef USE_INSTANCING
		mat4 lifeWindModel = modelMatrix * instanceMatrix;
	#else
		mat4 lifeWindModel = modelMatrix;
	#endif
	vec2 lifeWindPoint = ( lifeWindModel * vec4( ${sample === 'origin' ? 'vec3( 0.0 )' : 'transformed'}, 1.0 ) ).xz;
	float lifeWindMask = smoothstep( uWindFrom, max( uWindTo, uWindFrom + 0.001 ), transformed.y );
	vec2 lifeWindOffset = lifeWind( lifeWindPoint ).xy * ( uWindAmplitude * lifeWindMask );
	mat3 lifeWindBasis = mat3( lifeWindModel );
	float lifeWindScale2 = max( dot( lifeWindBasis[ 0 ], lifeWindBasis[ 0 ] ), 0.00000001 );
	transformed += ( transpose( lifeWindBasis ) * vec3( lifeWindOffset.x, 0.0, lifeWindOffset.y ) ) / lifeWindScale2;
`;
}

interface PatchableShader {
	vertexShader: string;
	uniforms: Record<string, { value: unknown }>;
}

function insertAfter(source: string, anchor: string, code: string): string {
	const first = source.indexOf(anchor);
	if (first < 0 || source.indexOf(anchor, first + anchor.length) >= 0)
		throw new Error(`life wind: expected exactly one ${anchor} in the vertex shader`);
	return source.replace(anchor, `${anchor}\n${code}`);
}

/** Patches a vertex shader in place (onBeforeCompile). Throws if three renames an anchor chunk. */
export function patchWind(
	shader: PatchableShader,
	uniforms: WindMaterialUniforms,
	sample: 'vertex' | 'origin' = 'vertex'
) {
	Object.assign(shader.uniforms, windUniforms, uniforms);
	shader.vertexShader = insertAfter(shader.vertexShader, '#include <common>', WIND_HEADER);
	shader.vertexShader = insertAfter(shader.vertexShader, '#include <begin_vertex>', windVertex(sample));
}

/**
 * Makes a material sway in the shared wind: chains onBeforeCompile and extends
 * customProgramCacheKey, so a swaying and a still copy of the same material
 * never share a program. Safe before or after stylize() / houseMaterial()
 * (stylize keeps the previous key since 84ff816); after is the usual order.
 * Returns the material; its uniforms are in material.userData.lifeWind.
 */
export function applyWind<T extends Material>(material: T, options: WindOptions): T {
	const sample = options.sample ?? 'vertex';
	const uniforms: WindMaterialUniforms = {
		uWindAmplitude: { value: options.amplitude },
		uWindFrom: { value: options.from },
		uWindTo: { value: options.to }
	};
	const previous = material.onBeforeCompile;
	material.onBeforeCompile = (shader, renderer) => {
		previous.call(material, shader, renderer);
		patchWind(shader, uniforms, sample);
	};
	const key = material.customProgramCacheKey;
	material.customProgramCacheKey = () => `${key.call(material)}|life-wind:${sample}`;
	material.userData.lifeWind = uniforms;
	material.needsUpdate = true;
	return material;
}
