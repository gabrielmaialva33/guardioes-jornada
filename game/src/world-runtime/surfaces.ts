import {
	CanvasTexture,
	Color,
	LinearFilter,
	LinearMipmapLinearFilter,
	SRGBColorSpace,
	type Texture,
	Vector2,
	Vector3
} from 'three';
import atlasUrl from '../assets/skins/ground-atlas.png?url';
import type { Trail } from '../level/types.ts';
import { lighting, type ShaderSource } from '../render/stylized.ts';
import type { SurvivalWorld } from '../survival/types.ts';
import { bakeGroundField } from './ground-field.ts';

export type SurfaceKind = 'ground' | 'trail' | 'water';
/** One 128px atlas, shared by all ground/path materials; no texture is created per chunk. */
export function createSurfaces(world?: SurvivalWorld, trails: readonly Trail[] = []) {
	const field = world && trails.length ? bakeGroundField(world, trails) : undefined;
	const uniforms = {
		uGroundAtlas: { value: null as Texture | null },
		uGroundDetail: { value: 0 },
		uGroundPaths: { value: field?.texture ?? (null as Texture | null) },
		uGroundSize: { value: world?.size ?? 160 },
		uGroundOrigin: { value: new Vector2() },
		uGroundPathsEnabled: { value: field ? 1 : 0 },
		uRockWarm: { value: new Color('#baa88b') },
		uRockCool: { value: new Color('#54747a') },
		uGroundWarm: { value: new Color('#94ac52') },
		uGroundCool: { value: new Color('#438573') },
		uGroundDry: { value: new Color('#a6a660') },
		uGroundLitter: { value: new Color('#79583f') },
		uGroundSoil: { value: new Color('#a2805a') },
		uGrassMean: { value: new Vector3(0.12, 0.24, 0.1) },
		uSoilMean: { value: new Vector3(0.2, 0.12, 0.06) },
		uRockMean: { value: new Vector3(0.3, 0.35, 0.3) }
	};
	const textures: Texture[] = field ? [field.texture] : [];
	let disposed = false;
	return {
		textures,
		setField(texture: Texture, origin: Vector2, size: number) {
			uniforms.uGroundPaths.value = texture;
			uniforms.uGroundOrigin.value.copy(origin);
			uniforms.uGroundSize.value = size;
			uniforms.uGroundPathsEnabled.value = 1;
		},
		field,
		patch(shader: ShaderSource, kind: SurfaceKind) {
			Object.assign(shader.uniforms, uniforms, { uVisualTime: lighting.uVisualTime });
			const attribute = kind === 'water' ? 'water' : kind === 'trail' ? 'trail' : null;
			if (attribute) {
				shader.vertexShader = shader.vertexShader.replace(
					'#include <common>',
					`#include <common>\nattribute vec2 ${attribute}; varying vec2 vSurface;`
				);
				shader.vertexShader = shader.vertexShader.replace(
					'#include <begin_vertex>',
					`#include <begin_vertex>\nvSurface=${attribute};`
				);
			}
			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <common>',
				`#include <common>
${attribute ? 'varying vec2 vSurface;' : ''}
uniform sampler2D uGroundAtlas,uGroundPaths;
uniform float uGroundSize,uGroundPathsEnabled;
uniform vec2 uGroundOrigin;
uniform vec3 uGroundWarm,uGroundCool,uGroundDry,uGroundLitter,uGroundSoil,uRockWarm,uRockCool;
uniform float uGroundDetail;
uniform vec3 uGrassMean,uSoilMean,uRockMean;
float groundNoise(vec2 p) { return sin(p.x*1.31+sin(p.y*.7))*sin(p.y*1.73+p.x*.23); }
float groundHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float groundFieldNoise(vec2 p){vec2 cell=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(groundHash(cell),groundHash(cell+vec2(1.,0.)),f.x),mix(groundHash(cell+vec2(0.,1.)),groundHash(cell+1.),f.x),f.y);}
vec3 groundTile(vec2 p,vec2 tile) {
 // Keep the sample inside its tile at every mip; the atlas contains four painted tiles.
 vec2 uv=(tile+(vec2(1.5)+fract(p)*61.0)/64.0)*.5;
 return texture2D(uGroundAtlas,uv).rgb;
}
`
			);
			let fragment: string;
			if (kind === 'water')
				fragment = `
 // Signed union of river and pool: there is no interior ellipse/ribbon foam seam.
 float shoreNoise=groundNoise(vStylizedWorld.xz*2.4)*.08;
 float edge=1.0-smoothstep(-.25,.12,vSurface.x+shoreNoise);
 if(edge<.01)discard;
 // Ordered alpha coverage retains opaque depth sorting on low-end WebGL2 devices.
 float coverage=fract(dot(floor(gl_FragCoord.xy),vec2(.75487766,.56984029)));
 if(edge<coverage)discard;
 float ripple=sin(vStylizedWorld.x*2.0+vStylizedWorld.z*1.3-uVisualTime*.65)*sin(vStylizedWorld.z*3.1+uVisualTime*.4);
 diffuseColor.rgb*=.94+.06*ripple;
 vec2 sparkleCell=floor(vStylizedWorld.xz*1.15);
 float sparkleSeed=groundHash(sparkleCell);
 vec2 sparklePoint=vec2(sparkleSeed,groundHash(sparkleCell+19.));
 vec2 sparkleDelta=abs(fract(vStylizedWorld.xz*1.15)-sparklePoint);
 float sparkle=(1.-smoothstep(.01,.055,max(sparkleDelta.x*.6,sparkleDelta.y)))*pow(.5+.5*sin(uVisualTime*1.5+sparkleSeed*18.),8.)*step(.92,sparkleSeed);
 totalEmissiveRadiance+=vec3(.78,.87,.72)*sparkle*.6;
 float foam=(1.0-smoothstep(.10,.52,abs(vSurface.x+.24+shoreNoise+sin(vStylizedWorld.x*1.2+vStylizedWorld.z*.8-uVisualTime*.7)*.08)))*.62;
 diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.72,.92,.85),foam);
`;
			else if (kind === 'trail')
				fragment = `
 if(vSurface.y>.5) {
  float edge=1.0-smoothstep(.54,1.0,abs(vSurface.x)+groundNoise(vStylizedWorld.xz*2.0)*.10);
  float coverage=fract(dot(floor(gl_FragCoord.xy),vec2(.75487766,.56984029)));
  if(edge<coverage)discard;
  vec3 detail=groundTile(vStylizedWorld.xz*.55,vec2(1.,1.));
  vec3 litter=groundTile(vStylizedWorld.xz*.75,vec2(0.,0.));
  diffuseColor.rgb=mix(uGroundSoil,uGroundLitter*clamp(litter/vec3(.16,.2,.09),vec3(.75),vec3(1.2)),smoothstep(.52,.95,abs(vSurface.x))*.72);
  diffuseColor.rgb*=mix(vec3(1.),clamp(detail/uSoilMean,vec3(.77),vec3(1.18)),uGroundDetail*.48);
 }
`;
			else
				fragment = `
 vec3 surfaceNormal=normalize(cross(dFdx(vStylizedWorld),dFdy(vStylizedWorld)));
 float steep=1.0-smoothstep(.45,.82,abs(surfaceNormal.y));
 float macro=groundFieldNoise(vStylizedWorld.xz/50.+13.);
 float meso=groundFieldNoise(vStylizedWorld.xz/8.+71.);
 float fine=groundFieldNoise(vStylizedWorld.xz*1.1);
 vec2 groundUV=(vStylizedWorld.xz-uGroundOrigin)/uGroundSize;
 float inside=step(0.,groundUV.x)*step(0.,groundUV.y)*step(groundUV.x,1.)*step(groundUV.y,1.);
 float shade=uShadeEnabled>.5?mix(1.,texture2D(uShadeMap,groundUV).r,inside):1.;
 float pathDistance=8.;if(uGroundPathsEnabled>.5 && inside>.5)pathDistance=texture2D(uGroundPaths,groundUV).r*8.-2.;
 vec3 groundBase=mix(uGroundWarm,uGroundCool,smoothstep(.22,.78,macro));
 groundBase=mix(groundBase,uGroundDry,smoothstep(.5,.85,meso)*.65*shade);
 float litterPatch=smoothstep(.35,.7,meso)*(1.-shade)*.85;
 float trailLitter=(1.-smoothstep(.25,1.6,pathDistance+groundNoise(vStylizedWorld.xz*.9)*.24))*.62;
 groundBase=mix(groundBase,uGroundLitter,max(litterPatch,trailLitter));
 groundBase=mix(groundBase,uGroundSoil,1.-smoothstep(-.45,.25,pathDistance));
 groundBase*=mix(vec3(.64,.8,.93),vec3(1.),shade);
 float soilMask=step(.3,max(litterPatch,trailLitter));
 vec3 groundPigment=groundTile(vStylizedWorld.xz,vec2(soilMask,1.));
 vec3 groundMean=mix(uGrassMean,uSoilMean,soilMask);
 diffuseColor.rgb=mix(diffuseColor.rgb,groundBase,.86*(1.-steep));
 diffuseColor.rgb*=.92+.14*fine;
 vec2 cliffUV=abs(surfaceNormal.x)>abs(surfaceNormal.z)?vStylizedWorld.zy:vStylizedWorld.xy;
 vec3 stone=groundTile(cliffUV*.32,vec2(1.,0.));
 vec3 detail=mix(clamp(groundPigment/groundMean,vec3(.8),vec3(1.16)),clamp(stone/uRockMean,vec3(.66),vec3(1.2)),steep);
 float layer=.5+.5*sin(vStylizedWorld.y*.95+groundFieldNoise(vStylizedWorld.xz*.18)*3.);
 vec3 rockBase=mix(uRockCool,uRockWarm,smoothstep(.18,.82,layer));
 diffuseColor.rgb=mix(diffuseColor.rgb,rockBase,steep*.72);
 float strata=sin(vStylizedWorld.y*3.3+groundNoise(vStylizedWorld.xz*.22)*1.4)*.16;
 float moss=smoothstep(.2,.8,groundNoise(vStylizedWorld.xz*.37+vStylizedWorld.y*.1))*.35*steep;
 diffuseColor.rgb*=mix(vec3(1.),detail,uGroundDetail*.55)*(1.0+strata*steep);
 diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.73,1.08,.72),moss);
`;
			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <color_fragment>',
				`#include <color_fragment>\n${fragment}`
			);
		},
		async load(signal: AbortSignal) {
			const response = await fetch(atlasUrl, { signal });
			if (!response.ok) throw new Error(`ground-atlas:${response.status}`);
			const image = await createImageBitmap(await response.blob());
			try {
				if (disposed || signal.aborted) return;
				const canvas = document.createElement('canvas');
				canvas.width = canvas.height = 128;
				const context = canvas.getContext('2d');
				if (!context) return;
				context.drawImage(image, 0, 0, 128, 128);
				const pixels = context.getImageData(0, 0, 128, 128).data;
				const linear = (v: number) => (v <= 10.31475 ? v / 3294.6 : ((v / 255 + 0.055) / 1.055) ** 2.4);
				for (const [mean, tx, ty] of [
					[uniforms.uGrassMean.value, 0, 0],
					[uniforms.uSoilMean.value, 64, 0],
					[uniforms.uRockMean.value, 64, 64]
				] as const) {
					mean.set(0, 0, 0);
					for (let y = ty; y < ty + 64; y++)
						for (let x = tx; x < tx + 64; x++) {
							const i = (y * 128 + x) * 4;
							mean.x += linear(pixels[i]);
							mean.y += linear(pixels[i + 1]);
							mean.z += linear(pixels[i + 2]);
						}
					mean.multiplyScalar(1 / 4096);
				}
				const texture = new CanvasTexture(canvas);
				texture.colorSpace = SRGBColorSpace;
				texture.magFilter = LinearFilter;
				texture.minFilter = LinearMipmapLinearFilter;
				textures.push(texture);
				uniforms.uGroundAtlas.value = texture;
				uniforms.uGroundDetail.value = 1;
			} finally {
				image.close();
			}
		},
		dispose() {
			disposed = true;
			field?.dispose();
			uniforms.uGroundAtlas.value?.dispose();
			textures.length = 0;
			uniforms.uGroundAtlas.value = null;
			uniforms.uGroundDetail.value = 0;
		}
	};
}
