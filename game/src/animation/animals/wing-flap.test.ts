import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { ShaderChunk, ShaderLib } from 'three';
import { describe, expect, it } from 'vitest';
import {
	createWingFlapUniforms,
	patchWingFlap,
	WING_FLAP_ATTRIBUTE,
	WING_FLAP_HEADER,
	WING_FLAP_NORMAL,
	WING_FLAP_POSITION,
	WING_FLAP_PRESETS
} from './wing-flap.ts';

const MATERIALS = {
	lambert: ShaderLib.lambert,
	toon: ShaderLib.toon,
	basic: ShaderLib.basic,
	phong: ShaderLib.phong
};

function patched(source: string) {
	const shader = { vertexShader: source, uniforms: {} as Record<string, { value: unknown }> };
	patchWingFlap(shader, createWingFlapUniforms(WING_FLAP_PRESETS.butterfly));
	return shader;
}

/** three's include resolution (WebGLProgram resolveIncludes), recursive. */
function expand(source: string): string {
	return source.replace(/^[ \t]*#include +<([\w\d./]+)>/gm, (_, name: string) => {
		const chunk = (ShaderChunk as Record<string, string>)[name];
		if (chunk === undefined) throw new Error(`unknown chunk ${name}`);
		return expand(chunk);
	});
}

const count = (text: string, needle: string) => text.split(needle).length - 1;

const balanced = (code: string) => {
	let depth = 0;
	for (const c of code.replace(/\/\/.*$/gm, '')) {
		if (c === '(' || c === '{') depth++;
		if (c === ')' || c === '}') depth--;
		if (depth < 0) return false;
	}
	return depth === 0;
};

describe('wing-flap shader patch', () => {
	for (const [name, lib] of Object.entries(MATERIALS)) {
		it(`patches the ${name} material once per anchor, in order`, () => {
			const shader = patched(lib.vertexShader);
			const source = shader.vertexShader;
			expect(count(source, WING_FLAP_HEADER)).toBe(1);
			expect(count(source, WING_FLAP_NORMAL)).toBe(1);
			expect(count(source, WING_FLAP_POSITION)).toBe(1);
			const header = source.indexOf(WING_FLAP_HEADER);
			expect(header).toBeGreaterThan(source.indexOf('#include <common>'));
			expect(header).toBeLessThan(source.indexOf('void main()'));
			expect(source.indexOf(WING_FLAP_NORMAL)).toBeGreaterThan(
				source.indexOf('#include <beginnormal_vertex>')
			);
			expect(source.indexOf(WING_FLAP_POSITION)).toBeGreaterThan(source.indexOf('#include <begin_vertex>'));
			// The deformation runs in local space, before instancing and projection.
			expect(source.indexOf(WING_FLAP_POSITION)).toBeLessThan(source.indexOf('#include <project_vertex>'));
			for (const uniform of Object.keys(createWingFlapUniforms(WING_FLAP_PRESETS.bird)))
				expect(shader.uniforms[uniform]).toBeDefined();
		});

		it(`uses only names the expanded ${name} shader declares before them`, () => {
			const source = expand(patched(lib.vertexShader).vertexShader);
			const transformed = source.indexOf('vec3 transformed');
			const objectNormal = source.indexOf('vec3 objectNormal');
			const position = source.indexOf('transformed = wingFlapPosition');
			const normal = source.indexOf('objectNormal = wingFlapNormal');
			expect(transformed).toBeGreaterThan(-1);
			expect(position).toBeGreaterThan(transformed);
			expect(objectNormal).toBeGreaterThan(-1);
			expect(normal).toBeGreaterThan(objectNormal);
			for (const fn of ['wingFlapAngle', 'wingFlapPosition', 'wingFlapNormal', 'wingFlapMask'])
				expect(source.indexOf(`${fn}(`)).toBeLessThan(source.indexOf('void main()'));
		});
	}

	it('injects well-formed GLSL with no reserved identifiers', () => {
		for (const code of [WING_FLAP_HEADER, WING_FLAP_NORMAL, WING_FLAP_POSITION])
			expect(balanced(code)).toBe(true);
		expect(WING_FLAP_HEADER).toContain(`attribute float ${WING_FLAP_ATTRIBUTE};`);
		// `out`, `in`, `inout` and `sample` are keywords in GLSL ES 3.00.
		expect(WING_FLAP_HEADER).not.toMatch(/\b(?:float|vec3)\s+(?:out|in|inout|sample|flat)\b/);
		// Every float literal has a decimal point (GLSL ES has no implicit int to float).
		expect(WING_FLAP_HEADER).not.toMatch(/[^\w.]\d+\s*\)/);
	});

	it('fails loudly if three renames an anchor chunk', () => {
		const shader = { vertexShader: 'void main() {}', uniforms: {} };
		expect(() => patchWingFlap(shader, createWingFlapUniforms(WING_FLAP_PRESETS.bird))).toThrow(
			/expected exactly one/
		);
	});

	const validator = ['/usr/bin/glslangValidator', '/usr/sbin/glslangValidator'].find((path) =>
		existsSync(path)
	);
	it.skipIf(!validator)('compiles as GLSL ES 3.00 the way three builds an instanced Lambert program', () => {
		// The prefix WebGLProgram adds for a WebGL2 built-in material with instancing.
		const prefix = [
			'#version 300 es',
			'#define attribute in',
			'#define varying out',
			'#define texture2D texture',
			'precision highp float;',
			'precision highp int;',
			'#define HIGH_PRECISION',
			'#define SHADER_TYPE MeshLambertMaterial',
			'#define SHADER_NAME MeshLambertMaterial',
			'#define USE_INSTANCING',
			'#define USE_INSTANCING_COLOR',
			'#define FLAT_SHADED',
			// glslang reserves `average` (three's common chunk defines one; browsers accept it).
			'#define average threeAverage',
			'uniform mat4 modelMatrix;',
			'uniform mat4 modelViewMatrix;',
			'uniform mat4 projectionMatrix;',
			'uniform mat4 viewMatrix;',
			'uniform mat3 normalMatrix;',
			'uniform vec3 cameraPosition;',
			'uniform bool isOrthographic;',
			'attribute mat4 instanceMatrix;',
			'attribute vec3 instanceColor;',
			'attribute vec3 position;',
			'attribute vec3 normal;',
			'attribute vec2 uv;',
			''
		].join('\n');
		const body = expand(patched(ShaderLib.lambert.vertexShader).vertexShader).replace(/NUM_[A-Z_]+/g, '0');
		const compile = (source: string) =>
			execFileSync(validator as string, ['--stdin', '-S', 'vert'], { input: source, encoding: 'utf8' });
		expect(compile(prefix + body)).not.toMatch(/ERROR/);
		// The check is not vacuous: a broken injection fails.
		expect(() => compile(prefix + body.replace('wingFlapAngle() );', 'wingFlapAngle( 1.0 ) );'))).toThrow();
	});
});
