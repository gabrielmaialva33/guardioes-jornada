/** One Lambert shader family. Resources are owned by the level, never by a material hook. */
import { Color, type IUniform, type MeshLambertMaterial, ShaderChunk, type Texture } from 'three';
import { testing } from '../scene/testing.ts';
import { LIGHT } from '../style/palette.ts';
export interface StylizedOptions {
	vegetation?: boolean;
	canopyBase?: number;
	cover?: boolean;
	rim?: boolean;
	terrain?: boolean;
}
export interface ShaderSource {
	vertexShader: string;
	fragmentShader: string;
	uniforms: Record<string, IUniform>;
}
export const lighting = {
	uShadeMap: { value: null as Texture | null },
	uShadeSize: { value: 160 },
	uTreeRange: { value: 48 },
	uShadeEnabled: { value: 0 },
	uVisualTime: { value: 0 },
	uSunSpots: { value: 1 },
	uHemisphereSky: { value: new Color(LIGHT.daylight.hemisphereSky) },
	uHemisphereGround: { value: new Color(LIGHT.daylight.hemisphereGround) },
	uHeightFog: { value: 1 },
	uMistBase: { value: 2 }
};
/** Comparison switches are dev/acceptance-only; shipped games always use the full look. */
export function visualStep(): number {
	if (testing) return 0;
	if (typeof location === 'undefined') return 4;
	const q = new URLSearchParams(location.search);
	if (!import.meta.env.DEV || !q.has('golden')) return 4;
	const v = Number(q.get('look') ?? 4);
	return Number.isFinite(v) ? Math.max(0, Math.min(4, v)) : 4;
}
export function patchStylizedShader(shader: ShaderSource, options: StylizedOptions = {}) {
	Object.assign(shader.uniforms, lighting, {
		uRim: { value: options.rim ? 0.09 : 0 },
		uShadeReceiver: { value: options.vegetation && !options.cover && !options.terrain ? 0 : 1 }
	});
	const world = `
 vec4 stylizedWorld = vec4( transformed, 1.0 );
 #ifdef USE_INSTANCING
 stylizedWorld = instanceMatrix * stylizedWorld;
 #endif
 vStylizedWorld = (modelMatrix * stylizedWorld).xyz;
 `;
	shader.vertexShader = shader.vertexShader.replace(
		'#include <common>',
		'#include <common>\nvarying vec3 vStylizedWorld;'
	);
	shader.vertexShader = shader.vertexShader.replace(
		'#include <project_vertex>',
		`#include <project_vertex>\n${world}`
	);
	shader.fragmentShader = shader.fragmentShader.replace(
		'#include <common>',
		`#include <common>
 varying vec3 vStylizedWorld;
 uniform sampler2D uShadeMap;
 uniform float uShadeSize, uShadeEnabled, uShadeReceiver, uVisualTime, uSunSpots, uRim, uHeightFog, uMistBase;
 uniform vec3 uHemisphereSky, uHemisphereGround;
 `
	);
	const lambert = ShaderChunk.lights_lambert_pars_fragment
		.replace(
			'saturate( dot( geometryNormal, directLight.direction ) )',
			'smoothstep( -0.15, 0.55, dot( geometryNormal, directLight.direction ) )'
		)
		.replace(
			'irradiance * BRDF_Lambert( material.diffuseColor )',
			'irradiance * BRDF_Lambert( material.diffuseColor )'
		)
		.replace(
			'reflectedLight.indirectDiffuse += irradiance',
			'reflectedLight.indirectDiffuse += mix( vec3(1.0), mix(uHemisphereGround, uHemisphereSky, 0.7), 0.16 ) * irradiance'
		);
	shader.fragmentShader = shader.fragmentShader.replace('#include <lights_lambert_pars_fragment>', lambert);
	shader.fragmentShader = shader.fragmentShader.replace(
		'#include <aomap_fragment>',
		`
 if (uShadeEnabled > 0.5 && uShadeReceiver > 0.5) {
  vec2 shadeUV = vStylizedWorld.xz / uShadeSize;
  float insideMap = step(0.0, shadeUV.x) * step(0.0, shadeUV.y) * step(shadeUV.x,1.0) * step(shadeUV.y,1.0);
  float shade = mix(1.0, texture2D(uShadeMap, shadeUV).r, insideMap);
  float noise = sin(vStylizedWorld.x * 2.7 + uVisualTime * 0.18) * sin(vStylizedWorld.z * 2.1 - uVisualTime * 0.12);
  float spot = smoothstep(0.25, 0.85, noise) * (1.0-shade) * uSunSpots;
  reflectedLight.directDiffuse *= mix(0.45, 1.0, clamp(shade + spot * 0.7, 0.0, 1.0));
  reflectedLight.indirectDiffuse *= mix(vec3(0.77,0.88,0.82), vec3(1.0), shade);
 }
 #include <aomap_fragment>
 `
	);
	shader.fragmentShader = shader.fragmentShader.replace(
		'vec3 outgoingLight =',
		`
 float rim = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0) * uRim;
 totalEmissiveRadiance += diffuseColor.rgb * uHemisphereSky * rim;
 vec3 outgoingLight =`
	);
	shader.fragmentShader = shader.fragmentShader.replace(
		'#include <fog_fragment>',
		`
 #ifdef USE_FOG
  #ifdef FOG_EXP2
   float linearMist = 1.0 - exp(-fogDensity*fogDensity*vFogDepth*vFogDepth);
  #else
   float linearMist = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  float heightMist = 0.32 * exp(-max(vStylizedWorld.y-uMistBase,0.0)*0.22) * smoothstep(8.0,60.0,vFogDepth) * uHeightFog;
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, max(linearMist, heightMist));
 #endif
 `
	);
	if (options.canopyBase !== undefined) {
		shader.uniforms.uCanopyBase = { value: options.canopyBase };
		shader.vertexShader = shader.vertexShader.replace(
			'#include <common>',
			`#include <common>
#ifdef USE_INSTANCING
attribute float instanceFade;
uniform float uCanopyBase,uTreeRange;
varying float vCanopyFade;
#endif`
		);
		shader.vertexShader = shader.vertexShader.replace(
			'#include <begin_vertex>',
			`#include <begin_vertex>
#ifdef USE_INSTANCING
vCanopyFade=mix(1.0,instanceFade,smoothstep(uCanopyBase,uCanopyBase+0.7,position.y));
vec4 treeCenter=modelMatrix*instanceMatrix*vec4(0.,0.,0.,1.);
vCanopyFade*=1.0-smoothstep(uTreeRange-6.0,uTreeRange+6.0,length(treeCenter.xz-cameraPosition.xz));
#endif`
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <common>',
			`#include <common>
#ifdef USE_INSTANCING
varying float vCanopyFade;
#endif`
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <alphatest_fragment>',
			`#include <alphatest_fragment>
#ifdef USE_INSTANCING
// Stable ordered dither keeps depth writing, single-pass instancing and opaque sorting.
vec2 ditherPixel=mod(floor(gl_FragCoord.xy),4.0);
float ditherValue=mod(ditherPixel.x*2.0+ditherPixel.y*3.0,4.0)*4.0+mod(ditherPixel.x+ditherPixel.y*2.0,4.0);
if(vCanopyFade<(ditherValue+0.5)/16.0)discard;
#endif`
		);
	}
	if (options.cover)
		shader.vertexShader = shader.vertexShader.replace(
			'#include <beginnormal_vertex>',
			'#include <beginnormal_vertex>\nobjectNormal = vec3(0.,1.,0.);'
		);
	if (options.terrain) {
		shader.vertexShader = shader.vertexShader.replace(
			'varying vec3 vStylizedWorld;',
			'varying vec3 vStylizedWorld;\nattribute vec2 shore;\nvarying vec2 vShore;'
		);
		shader.vertexShader = shader.vertexShader.replace(
			'#include <begin_vertex>',
			'#include <begin_vertex>\nvShore = shore;'
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'varying vec3 vStylizedWorld;',
			'varying vec3 vStylizedWorld;\nvarying vec2 vShore;'
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <color_fragment>',
			`#include <color_fragment>
  float bank = 1.0 - smoothstep(0.0, 2.0, vShore.y);
  float wet = (1.0-smoothstep(0.12,0.55,abs(vStylizedWorld.y-vShore.x))) * bank;
  diffuseColor.rgb *= 1.0 - 0.22 * wet;
  float foam = (1.0-smoothstep(0.025,0.10,abs(vStylizedWorld.y-vShore.x))) * bank;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.67,0.82,0.72), foam * 0.75);
  `
		);
	}
}
export function stylize<T extends MeshLambertMaterial>(material: T, options: StylizedOptions = {}): T {
	if (visualStep() < 1) return material;
	material.flatShading = !options.vegetation;
	const previousKey = material.customProgramCacheKey();
	const previous = material.onBeforeCompile.bind(material);
	material.onBeforeCompile = (shader, renderer) => {
		previous(shader, renderer);
		patchStylizedShader(shader, options);
	};
	material.customProgramCacheKey = () =>
		`${previousKey}|guardioes-lambert-v2:${!!options.vegetation}:${!!options.cover}:${!!options.terrain}:${options.canopyBase !== undefined}`;
	material.userData.stylized = true;
	return material;
}
