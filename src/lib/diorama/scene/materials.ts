/**
 * Unlit materials. Light is baked into vertex colours (builder.ts), so every
 * mesh uses MeshBasicMaterial with small shader patches:
 * - growth: vertices collapse to their pivot until `uGrowth` passes their
 *   threshold, with a slight overshoot so things "pop" like they grew.
 * - water: growth plus flowing highlight stripes driven by `uTime`.
 * Fireflies are one Points draw call with a tiny custom shader.
 */
import {
	AdditiveBlending,
	Color,
	DoubleSide,
	MeshBasicMaterial,
	NormalBlending,
	ShaderMaterial,
	type IUniform
} from 'three';

export interface GrowthUniforms {
	uGrowth: IUniform<number>;
}

const GROWTH_VERTEX = /* glsl */ `
	float g = smoothstep(aGrow, aGrow + 0.22, uGrowth * 1.22);
	// easeOutBack: a 10% overshoot reads as organic growth.
	float gm = g - 1.0;
	g = 1.0 + 2.6 * gm * gm * gm + 1.6 * gm * gm;
	transformed = aPivot + (transformed - aPivot) * g;
`;

export function growthMaterial(): { material: MeshBasicMaterial; uniforms: GrowthUniforms } {
	const uniforms: GrowthUniforms = { uGrowth: { value: 1 } };
	const material = new MeshBasicMaterial({ vertexColors: true });
	material.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, uniforms);
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				'#include <common>\nattribute float aGrow;\nattribute vec3 aPivot;\nuniform float uGrowth;'
			)
			.replace('#include <begin_vertex>', `#include <begin_vertex>\n${GROWTH_VERTEX}`);
	};
	material.customProgramCacheKey = () => 'diorama-growth';
	return { material, uniforms };
}

export interface WaterUniforms extends GrowthUniforms {
	uTime: IUniform<number>;
}

export function waterMaterial(): { material: MeshBasicMaterial; uniforms: WaterUniforms } {
	const uniforms: WaterUniforms = { uGrowth: { value: 1 }, uTime: { value: 0 } };
	const material = new MeshBasicMaterial({ vertexColors: true });
	material.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, uniforms);
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				'#include <common>\nattribute float aGrow;\nattribute vec3 aPivot;\nattribute vec2 aFlow;\nuniform float uGrowth;\nvarying vec2 vFlow;'
			)
			.replace('#include <begin_vertex>', `#include <begin_vertex>\n${GROWTH_VERTEX}\nvFlow = aFlow;`);
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec2 vFlow;')
			.replace(
				'#include <color_fragment>',
				/* glsl */ `#include <color_fragment>
				// Dashed highlights drifting downstream, like the SVG river's shine.
				float lane = 1.0 - smoothstep(0.12, 0.42, abs(vFlow.y + 0.18 * sin(vFlow.x * 3.1)));
				float dash = smoothstep(0.78, 0.86, fract(vFlow.x * 1.35 - uTime * 0.45));
				dash *= 1.0 - smoothstep(0.9, 0.98, fract(vFlow.x * 1.35 - uTime * 0.45));
				diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), dash * lane * 0.5);`
			);
	};
	material.customProgramCacheKey = () => 'diorama-water';
	return { material, uniforms };
}

/** Soft additive (Mata) or alpha (Sol) glow disc behind the araucária. */
export function glowMaterial(): MeshBasicMaterial {
	return new MeshBasicMaterial({
		vertexColors: true,
		transparent: true,
		depthWrite: false,
		fog: false
	});
}

export function birdMaterial(): MeshBasicMaterial {
	return new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide });
}

export interface FireflyUniforms {
	uTime: IUniform<number>;
	uOpacity: IUniform<number>;
	uScale: IUniform<number>;
	uColor: IUniform<Color>;
}

export function fireflyMaterial(): { material: ShaderMaterial; uniforms: FireflyUniforms } {
	const uniforms: FireflyUniforms = {
		uTime: { value: 0 },
		uOpacity: { value: 0 },
		uScale: { value: 400 },
		uColor: { value: new Color(1, 0.8, 0.4) }
	};
	const material = new ShaderMaterial({
		uniforms: uniforms as unknown as Record<string, IUniform>,
		transparent: true,
		depthWrite: false,
		blending: AdditiveBlending,
		vertexShader: /* glsl */ `
			attribute float aPhase;
			uniform float uTime;
			uniform float uOpacity;
			uniform float uScale;
			varying float vAlpha;
			void main() {
				vec3 p = position;
				float ph = aPhase * 6.2831;
				p.x += sin(uTime * 0.55 + ph) * 0.14;
				p.y += sin(uTime * 0.8 + ph * 1.7) * 0.09;
				p.z += cos(uTime * 0.45 + ph * 1.3) * 0.12;
				vec4 mv = modelViewMatrix * vec4(p, 1.0);
				gl_Position = projectionMatrix * mv;
				gl_PointSize = uScale * 0.15 / -mv.z;
				float twinkle = 0.5 + 0.5 * sin(uTime * 2.3 + ph * 3.0);
				vAlpha = uOpacity * (0.35 + 0.65 * twinkle);
			}`,
		fragmentShader: /* glsl */ `
			uniform vec3 uColor;
			varying float vAlpha;
			void main() {
				float d = length(gl_PointCoord - 0.5);
				float core = 1.0 - smoothstep(0.0, 0.5, d);
				float a = core * core * vAlpha;
				gl_FragColor = vec4(mix(uColor, vec3(1.0), core * core * 0.35), a);
				#include <colorspace_fragment>
			}`
	});
	return { material, uniforms };
}

export function setFireflyBlending(material: ShaderMaterial, dark: boolean) {
	const blending = dark ? AdditiveBlending : NormalBlending;
	if (material.blending !== blending) {
		material.blending = blending;
		material.needsUpdate = true;
	}
}
