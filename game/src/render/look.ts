import { Color } from 'three';
import type { ShaderSource } from './stylized.ts';

export const LOOK = { exposure: 1.0, saturation: 1.16, gamma: 0.97 } as const;
export const lookUniforms = { uLookNight: { value: 0 } };
/** Linear-sRGB ACES fit/matrices from three's MIT tonemapping chunk, followed by one shared grade. */
export const LOOK_GLSL = `
uniform float uLookNight;
vec3 lookGrade(vec3 c) {
 c*=1.0/.6;
 c=mat3(.59719,.07600,.02840,.35458,.90834,.13383,.04823,.01566,.83777)*c;
 c=(c*(c+.0245786)-.000090537)/(c*(.983729*c+.4329510)+.238081);
 c=clamp(mat3(1.60475,-.10208,-.00327,-.53108,1.10813,-.07276,-.07367,-.00605,1.07602)*c,0.,1.);
 float l=dot(c,vec3(.2126,.7152,.0722));
 c=mix(vec3(l),c,1.16)*vec3(1.045,1.015,.96);
 vec3 lift=mix(vec3(.008,.013,.023),vec3(.003,.006,.012),uLookNight);
 return clamp(pow(max(c+lift,vec3(0.)),vec3(.97))*mix(1.,.72,uLookNight),0.,.985);
}
`;
/** Numeric reference used by the GPU regression fixture; no per-frame CPU grading. */
export function gradeColor(input: Color, out = new Color(), night = false) {
	const r = (input.r * LOOK.exposure) / 0.6,
		g = (input.g * LOOK.exposure) / 0.6,
		b = (input.b * LOOK.exposure) / 0.6;
	const fit = (v: number) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
	const x = fit(0.59719 * r + 0.35458 * g + 0.04823 * b),
		y = fit(0.076 * r + 0.90834 * g + 0.01566 * b),
		z = fit(0.0284 * r + 0.13383 * g + 0.83777 * b);
	const clamp = (v: number) => Math.max(0, Math.min(1, v));
	const rr = clamp(1.60475 * x - 0.53108 * y - 0.07367 * z),
		gg = clamp(-0.10208 * x + 1.10813 * y - 0.00605 * z),
		bb = clamp(-0.00327 * x - 0.07276 * y + 1.07602 * z),
		l = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
	const channel = (v: number, gain: number, lift: number) =>
		Math.max(
			0,
			Math.min(
				0.985,
				Math.max(0, (l + (v - l) * LOOK.saturation) * gain + lift) ** LOOK.gamma * (night ? 0.72 : 1)
			)
		);
	return out.setRGB(
		channel(rr, 1.045, night ? 0.003 : 0.008),
		channel(gg, 1.015, night ? 0.006 : 0.013),
		channel(bb, 0.96, night ? 0.012 : 0.023)
	);
}
/** Reusable by Lambert, sky and impostors. Canvas toneMapping stays off: exactly one grade per shader. */
export function patchLook(shader: ShaderSource) {
	Object.assign(shader.uniforms, lookUniforms);
	shader.fragmentShader = shader.fragmentShader.replace(
		'#include <common>',
		`#include <common>\n${LOOK_GLSL}`
	);
	shader.fragmentShader = shader.fragmentShader.replace(
		'#include <tonemapping_fragment>',
		'gl_FragColor.rgb=lookGrade(gl_FragColor.rgb);'
	);
}
