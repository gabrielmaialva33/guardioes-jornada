/**
 * Wingbeats in the vertex shader, so a whole flock is one InstancedMesh and one
 * draw call (animacoes.md §5.2; the three example webgl_gpgpu_birds beats its
 * wings by phase in the shader the same way).
 *
 * The geometry faces +z with its wings along ±x. Every vertex beyond the hinge
 * (|x| > uFlapHinge) rotates about the hinge line, a line parallel to z, by
 *   angle = uFlapBias + uFlapAmplitude · sin(2π (uFlapTime · uFlapRate + aFlapPhase))
 * (wing tip up for angle > 0), and its normal turns with it. aFlapPhase is a
 * per-instance attribute, so the flock does not beat in unison. With
 * uFlapBurst > 0 the wings beat for that share of each burst cycle and fold to
 * uFlapFold in between: the flap-bounding flight of small passerines (Tobalske
 * 2007, J. Exp. Biol. 210:3135–3146).
 *
 * patchWingFlap is a pure string patch for Material.onBeforeCompile on three's
 * built-in materials (Lambert per ART.md §5, Toon, Basic): it adds the header
 * after <common> and the deformation after <beginnormal_vertex> and
 * <begin_vertex>, and throws if three ever renames those chunks.
 */
import { DEG } from './scalar.ts';

export const WING_FLAP_ATTRIBUTE = 'aFlapPhase';

export interface WingFlapSettings {
	/** Beats per second. */
	rate: number;
	/** Half the stroke and its mean (dihedral), radians. */
	amplitude: number;
	bias: number;
	/** |x| of the wing root in the geometry, model units. */
	hinge: number;
	/** 0 for continuous flapping, else the flapping share of a burst cycle. */
	burst: number;
	/** Burst cycles per second, and the folded wing angle between bursts, radians. */
	burstRate: number;
	fold: number;
}

/**
 * Butterflies beat slowly for insects, about 5–12 Hz, through a wide stroke
 * (Dudley 2000, The Biomechanics of Insect Flight, Princeton UP). Small birds
 * beat faster and flap-bound (Tobalske 2007).
 */
export const WING_FLAP_PRESETS: Readonly<Record<'butterfly' | 'bird', WingFlapSettings>> = {
	butterfly: { rate: 8, amplitude: 60 * DEG, bias: 20 * DEG, hinge: 0.02, burst: 0, burstRate: 1, fold: 0 },
	bird: {
		rate: 12,
		amplitude: 50 * DEG,
		bias: 5 * DEG,
		hinge: 0.05,
		burst: 0.6,
		burstRate: 1.4,
		fold: -75 * DEG
	}
};

export interface WingFlapUniforms {
	uFlapTime: { value: number };
	uFlapRate: { value: number };
	uFlapAmplitude: { value: number };
	uFlapBias: { value: number };
	uFlapHinge: { value: number };
	uFlapBurst: { value: number };
	uFlapBurstRate: { value: number };
	uFlapFold: { value: number };
}

export function createWingFlapUniforms(settings: WingFlapSettings): WingFlapUniforms {
	return {
		uFlapTime: { value: 0 },
		uFlapRate: { value: settings.rate },
		uFlapAmplitude: { value: settings.amplitude },
		uFlapBias: { value: settings.bias },
		uFlapHinge: { value: settings.hinge },
		uFlapBurst: { value: settings.burst },
		uFlapBurstRate: { value: settings.burstRate },
		uFlapFold: { value: settings.fold }
	};
}

/** Declarations and helpers, inserted after #include <common>. */
export const WING_FLAP_HEADER = /* glsl */ `
attribute float ${WING_FLAP_ATTRIBUTE};
uniform float uFlapTime;
uniform float uFlapRate;
uniform float uFlapAmplitude;
uniform float uFlapBias;
uniform float uFlapHinge;
uniform float uFlapBurst;
uniform float uFlapBurstRate;
uniform float uFlapFold;

float wingFlapAngle() {
	float stroke = uFlapBias + uFlapAmplitude * sin( 6.283185307 * ( uFlapTime * uFlapRate + ${WING_FLAP_ATTRIBUTE} ) );
	if ( uFlapBurst > 0.0 ) {
		float cycle = fract( uFlapTime * uFlapBurstRate + ${WING_FLAP_ATTRIBUTE} * 0.618034 );
		stroke = mix( uFlapFold, stroke, step( cycle, uFlapBurst ) );
	}
	return stroke;
}

// 1 beyond the hinge (the wings), 0 on the body.
float wingFlapMask( vec3 p ) {
	return step( uFlapHinge, abs( p.x ) );
}

vec3 wingFlapPosition( vec3 p, float angle ) {
	float side = p.x < 0.0 ? -1.0 : 1.0;
	float out_ = abs( p.x ) - uFlapHinge;
	float c = cos( angle );
	float s = sin( angle );
	vec3 bent = vec3( side * ( uFlapHinge + out_ * c - p.y * s ), out_ * s + p.y * c, p.z );
	return mix( p, bent, wingFlapMask( p ) );
}

vec3 wingFlapNormal( vec3 p, vec3 n, float angle ) {
	float side = p.x < 0.0 ? -1.0 : 1.0;
	float nx = side * n.x;
	float c = cos( angle );
	float s = sin( angle );
	vec3 bent = vec3( side * ( nx * c - n.y * s ), nx * s + n.y * c, n.z );
	return mix( n, bent, wingFlapMask( p ) );
}
`;

/** After #include <beginnormal_vertex>: objectNormal is declared there. */
export const WING_FLAP_NORMAL = /* glsl */ `
	objectNormal = wingFlapNormal( position, objectNormal, wingFlapAngle() );
`;

/** After #include <begin_vertex>: transformed is declared there (local space, before instancing). */
export const WING_FLAP_POSITION = /* glsl */ `
	transformed = wingFlapPosition( transformed, wingFlapAngle() );
`;

const ANCHORS = {
	common: '#include <common>',
	normal: '#include <beginnormal_vertex>',
	position: '#include <begin_vertex>'
} as const;

/** The part of a three shader object onBeforeCompile hands over that the patch touches. */
export interface PatchableShader {
	vertexShader: string;
	uniforms: Record<string, { value: unknown }>;
}

/** Injects the wingbeat into a built-in material's vertex shader and adds the uniforms. */
export function patchWingFlap(shader: PatchableShader, uniforms: WingFlapUniforms): PatchableShader {
	let source = shader.vertexShader;
	for (const anchor of Object.values(ANCHORS)) {
		const first = source.indexOf(anchor);
		if (first < 0 || source.indexOf(anchor, first + anchor.length) >= 0)
			throw new Error(`wing flap: expected exactly one "${anchor}" in the vertex shader`);
	}
	source = source.replace(ANCHORS.common, `${ANCHORS.common}\n${WING_FLAP_HEADER}`);
	source = source.replace(ANCHORS.normal, `${ANCHORS.normal}\n${WING_FLAP_NORMAL}`);
	source = source.replace(ANCHORS.position, `${ANCHORS.position}\n${WING_FLAP_POSITION}`);
	shader.vertexShader = source;
	Object.assign(shader.uniforms, uniforms);
	return shader;
}

/** Cache key for Material.customProgramCacheKey, so patched and plain programs never mix. */
export const WING_FLAP_CACHE_KEY = 'wing-flap-v1';
