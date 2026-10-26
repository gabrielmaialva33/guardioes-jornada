/**
 * The layer's shader patches: the wind (for Codex's grass and canopy
 * materials), the pet material (palette switch on a skinned Lambert) and the
 * particles' per-instance opacity. Static checks always run; where
 * glslangValidator exists, the fully expanded programs are compiled as
 * GLSL ES 3.00 the way three's WebGLProgram would build them.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { MeshLambertMaterial, ShaderChunk, ShaderLib } from 'three';
import { describe, expect, it } from 'vitest';
import { patchStylizedShader, stylize } from '../render/stylized.ts';
import { PARTICLE_ALPHA, patchParticleShader } from './particles.ts';
import { PET_MAP_ATTRIBUTE, patchPetShader, petMaterial } from './pets.ts';
import {
	applyWind,
	patchWind,
	WIND,
	WIND_HEADER,
	type WindMaterialUniforms,
	WindSample,
	windAt,
	windUniforms,
	windVertex
} from './wind.ts';

const validator = ['/usr/bin/glslangValidator', '/usr/sbin/glslangValidator'].find((path) =>
	existsSync(path)
);

/** three's include resolution (WebGLProgram resolveIncludes), recursive. */
function expand(source: string): string {
	return source.replace(/^[ \t]*#include +<([\w\d./]+)>/gm, (_, name: string) => {
		const chunk = (ShaderChunk as Record<string, string>)[name];
		if (chunk === undefined) throw new Error(`unknown chunk ${name}`);
		return expand(chunk);
	});
}

const VERTEX_PREFIX = (defines: string[], attributes: string[]) =>
	[
		'#version 300 es',
		'#define attribute in',
		'#define varying out',
		'#define texture2D texture',
		'precision highp float;',
		'precision highp int;',
		'precision highp sampler2D;',
		'#define HIGH_PRECISION',
		...defines.map((d) => `#define ${d}`),
		'#define average threeAverage',
		'uniform mat4 modelMatrix;',
		'uniform mat4 modelViewMatrix;',
		'uniform mat4 projectionMatrix;',
		'uniform mat4 viewMatrix;',
		'uniform mat3 normalMatrix;',
		'uniform vec3 cameraPosition;',
		'uniform bool isOrthographic;',
		'attribute vec3 position;',
		'attribute vec3 normal;',
		'attribute vec2 uv;',
		...attributes,
		''
	].join('\n');

const FRAGMENT_PREFIX = (defines: string[]) =>
	[
		'#version 300 es',
		'#define varying in',
		'layout(location = 0) out highp vec4 pc_fragColor;',
		'#define gl_FragColor pc_fragColor',
		'#define texture2D texture',
		'precision highp float;',
		'precision highp int;',
		'precision highp sampler2D;',
		'#define HIGH_PRECISION',
		...defines.map((d) => `#define ${d}`),
		'#define average threeAverage',
		'uniform mat4 viewMatrix;',
		'uniform vec3 cameraPosition;',
		'uniform bool isOrthographic;',
		'vec4 linearToOutputTexel( vec4 value ) { return value; }',
		// three's WebGLProgram prepends this to every fragment program (sRGBTransferEOTF/OETF,
		// which the stylized look's fog grade uses).
		(ShaderChunk as Record<string, string>).colorspace_pars_fragment,
		''
	].join('\n');

function compile(stage: 'vert' | 'frag', source: string) {
	return execFileSync(validator as string, ['--stdin', '-S', stage], { input: source, encoding: 'utf8' });
}

const count = (text: string, needle: string) => text.split(needle).length - 1;

describe('the wind field', () => {
	const out = new WindSample();

	it('is a horizontal vector of length ≤ 1 with a gust in 0..1, blowing toward the serra', () => {
		let mean = 0;
		let samples = 0;
		for (let x = 0; x <= 160; x += 7)
			for (let z = 0; z <= 160; z += 11)
				for (let t = 0; t < 600; t += 13.7) {
					windAt(x, z, t, 1, out);
					expect(Math.hypot(out.x, out.z)).toBeLessThanOrEqual(1 + 1e-9);
					expect(out.gust).toBeGreaterThanOrEqual(0.1 - 1e-9);
					expect(out.gust).toBeLessThanOrEqual(1 + 1e-9);
					mean += out.x * WIND.dirX + out.z * WIND.dirZ;
					samples++;
				}
		expect(mean / samples).toBeGreaterThan(0.4);
	});

	it('repeats exactly every period and changes smoothly in time', () => {
		const a = new WindSample();
		windAt(37, 81, 12.5, 1, out);
		windAt(37, 81, 12.5 + WIND.period * 3, 1, a);
		expect(a.x).toBeCloseTo(out.x, 9);
		expect(a.z).toBeCloseTo(out.z, 9);
		windAt(37, 81, 12.5 + 1 / 60, 1, a);
		expect(Math.hypot(a.x - out.x, a.z - out.z)).toBeLessThan(0.05);
	});

	it('goes still with reduced motion', () => {
		windAt(10, 10, 3, 0, out);
		expect(out.x).toBe(0);
		expect(out.z).toBe(0);
	});

	it('keeps ART.md §7 sway limits in its amplitudes', () => {
		expect(WIND.grassSway).toBeLessThanOrEqual(0.15);
		expect(WIND.canopySway).toBeLessThanOrEqual(0.1);
	});
});

describe('applyWind', () => {
	const uniforms = (): WindMaterialUniforms => ({
		uWindAmplitude: { value: WIND.grassSway },
		uWindFrom: { value: 0 },
		uWindTo: { value: 1 }
	});

	it('patches a vertex shader once per anchor, after the stylized chunk, with the shared uniforms', () => {
		const material = stylize(new MeshLambertMaterial({ vertexColors: true }), { vegetation: true });
		const plainKey = material.customProgramCacheKey();
		applyWind(material, { amplitude: WIND.canopySway, from: 6, to: 10, sample: 'origin' });
		expect(material.customProgramCacheKey()).not.toBe(plainKey);
		expect(material.customProgramCacheKey()).toContain('life-wind:origin');
		const shader = {
			vertexShader: ShaderLib.lambert.vertexShader,
			fragmentShader: ShaderLib.lambert.fragmentShader,
			uniforms: {} as Record<string, { value: unknown }>
		};
		material.onBeforeCompile(shader as never, undefined as never);
		expect(count(shader.vertexShader, 'vec3 lifeWind( vec2 p )')).toBe(1);
		expect(count(shader.vertexShader, 'lifeWindOffset')).toBeGreaterThan(0);
		expect(shader.vertexShader).toContain('vStylizedWorld');
		expect(shader.uniforms.uWindTime).toBe(windUniforms.uWindTime);
		expect((shader.uniforms.uWindAmplitude as { value: number }).value).toBe(WIND.canopySway);
		expect(material.userData.lifeWind.uWindFrom.value).toBe(6);
	});

	it('fails loudly if three renames an anchor chunk', () => {
		expect(() => patchWind({ vertexShader: 'void main() {}', uniforms: {} }, uniforms())).toThrow(
			/exactly one/
		);
	});

	for (const sample of ['vertex', 'origin'] as const)
		it.skipIf(!validator)(`compiles (${sample}) as GLSL ES 3.00 in an instanced stylized Lambert`, () => {
			const shader = {
				vertexShader: ShaderLib.lambert.vertexShader,
				fragmentShader: ShaderLib.lambert.fragmentShader,
				uniforms: {} as Record<string, { value: unknown }>
			};
			patchStylizedShader(shader, { vegetation: true });
			patchWind(shader, uniforms(), sample);
			const prefix = VERTEX_PREFIX(
				['USE_INSTANCING', 'USE_INSTANCING_COLOR', 'USE_COLOR', 'SHADER_NAME MeshLambertMaterial'],
				['attribute mat4 instanceMatrix;', 'attribute vec3 instanceColor;', 'attribute vec3 color;']
			);
			const body = expand(shader.vertexShader).replace(/NUM_[A-Z_]+/g, '0');
			expect(compile('vert', prefix + body)).not.toMatch(/ERROR/);
			expect(() =>
				compile('vert', prefix + body.replace('lifeWind( lifeWindPoint )', 'lifeWind( 1.0 )'))
			).toThrow();
		});

	it('injects well-formed GLSL', () => {
		for (const code of [WIND_HEADER, windVertex('vertex'), windVertex('origin')]) {
			let depth = 0;
			for (const c of code) {
				if (c === '(' || c === '{') depth++;
				if (c === ')' || c === '}') depth--;
				expect(depth).toBeGreaterThanOrEqual(0);
			}
			expect(depth).toBe(0);
			// Every float literal has a decimal point (GLSL ES has no implicit int to float).
			expect(code).not.toMatch(/[^\w.]\d+\s*\)/);
		}
	});
});

describe('the pet material', () => {
	it('switches the palette per vertex, stays in the stylized family with the rim, and has its own program', () => {
		const material = petMaterial(null);
		expect(material.userData.stylized).toBe(true);
		expect(material.customProgramCacheKey()).toContain('life-pet');
		const shader = {
			vertexShader: ShaderLib.lambert.vertexShader,
			fragmentShader: ShaderLib.lambert.fragmentShader,
			uniforms: {} as Record<string, { value: unknown }>
		};
		material.onBeforeCompile(shader as never, undefined as never);
		expect(count(shader.vertexShader, `attribute float ${PET_MAP_ATTRIBUTE};`)).toBe(1);
		expect(shader.fragmentShader).toContain('mix( vec4( 1.0 ), sampledDiffuseColor, vLifeMap )');
		expect(shader.fragmentShader).not.toContain('#include <map_fragment>');
		expect((shader.uniforms.uRim as { value: number }).value).toBeGreaterThan(0);
		material.dispose();
	});

	it.skipIf(!validator)('compiles as a skinned, mapped, vertex-coloured Lambert (both stages)', () => {
		const shader = {
			vertexShader: ShaderLib.lambert.vertexShader,
			fragmentShader: ShaderLib.lambert.fragmentShader,
			uniforms: {} as Record<string, { value: unknown }>
		};
		patchPetShader(shader);
		patchStylizedShader(shader, { rim: true });
		const defines = [
			'USE_MAP',
			'MAP_UV uv',
			'USE_COLOR',
			'USE_SKINNING',
			'FLAT_SHADED',
			'DOUBLE_SIDED',
			'USE_FOG'
		];
		const vertex =
			VERTEX_PREFIX(defines, [
				'attribute vec3 color;',
				'attribute vec4 skinIndex;',
				'attribute vec4 skinWeight;'
			]) + expand(shader.vertexShader).replace(/NUM_[A-Z_]+/g, '0');
		expect(compile('vert', vertex)).not.toMatch(/ERROR/);
		const fragment = FRAGMENT_PREFIX(defines) + expand(shader.fragmentShader).replace(/NUM_[A-Z_]+/g, '0');
		expect(compile('frag', fragment)).not.toMatch(/ERROR/);
	});
});

describe('the particle material', () => {
	it.skipIf(!validator)('compiles an instanced basic material with per-instance opacity', () => {
		const shader = {
			vertexShader: ShaderLib.basic.vertexShader,
			fragmentShader: ShaderLib.basic.fragmentShader
		};
		patchParticleShader(shader);
		expect(count(shader.vertexShader, `attribute float ${PARTICLE_ALPHA};`)).toBe(1);
		const defines = ['USE_INSTANCING', 'USE_INSTANCING_COLOR', 'DOUBLE_SIDED', 'USE_FOG'];
		const vertex =
			VERTEX_PREFIX(defines, ['attribute mat4 instanceMatrix;', 'attribute vec3 instanceColor;']) +
			expand(shader.vertexShader).replace(/NUM_[A-Z_]+/g, '0');
		expect(compile('vert', vertex)).not.toMatch(/ERROR/);
		const fragment = FRAGMENT_PREFIX(defines) + expand(shader.fragmentShader).replace(/NUM_[A-Z_]+/g, '0');
		expect(compile('frag', fragment)).not.toMatch(/ERROR/);
	});
});
