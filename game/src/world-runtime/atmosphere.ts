/** Fog-free, palette-premixed backdrop. It owns no gameplay transforms or lights. */
import {
	BackSide,
	BufferGeometry,
	Color,
	DataTexture,
	DoubleSide,
	Float32BufferAttribute,
	Group,
	InstancedMesh,
	LinearFilter,
	Matrix4,
	Mesh,
	MeshBasicMaterial,
	type PerspectiveCamera,
	PlaneGeometry,
	RGBAFormat,
	ShaderMaterial,
	SphereGeometry,
	Vector2
} from 'three';
import type { Quality } from '../render/quality.ts';
import { LIGHT, RAMPS, VIEW } from '../style/palette.ts';

const smooth = (a: number, b: number, v: number) => {
	const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
	return t * t * (3 - 2 * t);
};
function paintedClouds() {
	const width = 256,
		height = 128,
		pixels = new Uint8Array(width * height * 4);
	const top = new Color('#fff1d0'),
		bottom = new Color('#9ebfcc'),
		c = new Color();
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const shape = Math.floor(x / 64),
				u = (x % 64) / 64,
				v = y / height;
			let field = -1;
			for (let l = 0; l < 5; l++) {
				const cx = 0.16 + l * 0.17,
					cy = 0.43 + 0.08 * Math.sin(l * 2 + shape),
					rx = 0.17 + 0.02 * Math.sin(l + shape),
					ry = 0.18 + 0.07 * Math.cos(l + shape);
				field = Math.max(field, 1 - Math.hypot((u - cx) / rx, (v - cy) / ry));
			}
			const alpha = smooth(-0.16, 0.1, field) * smooth(0.08, 0.24, v) * (1 - smooth(0.8, 0.95, v));
			c.copy(bottom).lerp(top, smooth(0.3, 0.7, v));
			const i = (y * width + x) * 4;
			pixels[i] = Math.round(c.r * 255);
			pixels[i + 1] = Math.round(c.g * 255);
			pixels[i + 2] = Math.round(c.b * 255);
			pixels[i + 3] = Math.round(alpha * 255);
		}
	const texture = new DataTexture(pixels, width, height, RGBAFormat);
	texture.minFilter = texture.magFilter = LinearFilter;
	texture.generateMipmaps = false;
	texture.needsUpdate = true;
	return texture;
}
const billboard = `varying vec2 vUv; varying float vTile; uniform float uTime; uniform vec2 uSize; void main(){
 vUv=uv;vTile=0.0;
 vec4 center=vec4(0.,0.,0.,1.);
 #ifdef USE_INSTANCING
 center=instanceMatrix*center;vTile=mod(float(gl_InstanceID),4.0);
 #endif
 vec4 mv=modelViewMatrix*center;mv.xy+=position.xy*uSize;
 gl_Position=projectionMatrix*mv;
}`;
function bands() {
	const g = new BufferGeometry(),
		positions: number[] = [],
		colors: number[] = [],
		indices: number[] = [];
	const horizon = new Color(LIGHT.daylight.horizon),
		shade = new Color(RAMPS.leaf[1]),
		c = new Color();
	for (let layer = 0; layer < 3; layer++)
		for (let i = 0; i <= 96; i++) {
			const theta = (i / 96) * Math.PI * 2,
				x = Math.sin(theta),
				z = Math.cos(theta);
			const west = smooth(-0.55, 0.05, x);
			const peak =
				(0.055 +
					0.035 * Math.sin(theta * 5 + layer) +
					0.025 * Math.sin(theta * 11 + layer * 2) +
					0.018 * Math.sin(theta * 21)) *
				west;
			const radius = 0.91 - layer * 0.055;
			for (const top of [false, true]) {
				positions.push(x * radius, top ? peak * (1 + layer * 0.7) + 0.015 : -0.28, z * radius);
				c.copy(shade).lerp(horizon, 0.78 - layer * 0.13);
				if (!top) c.lerp(horizon, 0.7);
				colors.push(c.r, c.g, c.b);
			}
			if (i) {
				const k = (layer * 97 + i) * 2;
				indices.push(k - 2, k, k - 1, k - 1, k, k + 1);
			}
		}
	g.setAttribute('position', new Float32BufferAttribute(positions, 3));
	g.setAttribute('color', new Float32BufferAttribute(colors, 3));
	g.setIndex(indices);
	return g;
}
/** One low-resolution canopy carpet beyond the four playable sides, never inside the map. */
function carpet(size: number) {
	const p: number[] = [],
		c: number[] = [],
		ix: number[] = [],
		color = new Color(RAMPS.leaf[1]).lerp(new Color(LIGHT.daylight.horizon), 0.46);
	for (let side = 0; side < 4; side++)
		for (let d = 4; d <= 84; d += 8)
			for (let t = 0; t <= size; t += 8) {
				const n = t / 8,
					r = (d - 4) / 8,
					offset = side * 11 * 21;
				const x = side === 0 ? t : side === 1 ? size + d : side === 2 ? size - t : -d;
				const z = side === 0 ? -d : side === 1 ? t : side === 2 ? size + d : size - t;
				const y = side === 3 ? -2 : 7 + Math.sin(x * 0.25) * Math.sin(z * 0.3) * 2 + d * 0.075;
				p.push(x, y, z);
				const k = 0.92 + 0.08 * Math.sin(x * 0.3 + z * 0.4);
				c.push(color.r * k, color.g * k, color.b * k);
				if (n > 0 && r > 0) {
					const i = offset + r * 21 + n;
					ix.push(i - 22, i - 21, i - 1, i - 1, i - 21, i);
				}
			}
	const g = new BufferGeometry();
	g.setAttribute('position', new Float32BufferAttribute(p, 3));
	g.setAttribute('color', new Float32BufferAttribute(c, 3));
	g.setIndex(ix);
	return g;
}
export function createAtmosphere(size: number, waterLevel = 0) {
	const object = new Group(),
		sky = new Group();
	object.add(sky);
	const geometries: BufferGeometry[] = [],
		materials: (MeshBasicMaterial | ShaderMaterial)[] = [];
	const own = <T extends Mesh>(mesh: T, parent = sky) => {
		geometries.push(mesh.geometry);
		materials.push(
			...((Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as (
				| MeshBasicMaterial
				| ShaderMaterial
			)[])
		);
		mesh.frustumCulled = false;
		mesh.userData.noShadow = true;
		parent.add(mesh);
		return mesh;
	};
	const domeGeometry = new SphereGeometry(0.98, 24, 12),
		domeColors = new Float32Array(domeGeometry.getAttribute('position').count * 3);
	domeGeometry.setAttribute('color', new Float32BufferAttribute(domeColors, 3));
	const dome = own(
		new Mesh(
			domeGeometry,
			new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false })
		)
	);
	dome.renderOrder = -3000;
	dome.material.depthTest = false;
	const mountains = own(
		new Mesh(
			bands(),
			new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, fog: false, depthWrite: false })
		)
	);
	mountains.renderOrder = -2999;
	mountains.material.depthTest = false;
	const seaGeo = new BufferGeometry();
	seaGeo.setAttribute(
		'position',
		new Float32BufferAttribute(
			[
				0,
				waterLevel,
				-size * 3,
				0,
				waterLevel,
				size * 4,
				-size * 3,
				waterLevel,
				-size * 3,
				-size * 3,
				waterLevel,
				size * 4
			],
			3
		)
	);
	seaGeo.setIndex([0, 1, 2, 2, 1, 3]);
	const sea = own(
		new Mesh(
			seaGeo,
			new MeshBasicMaterial({
				color: new Color(RAMPS.water[1]).lerp(new Color(LIGHT.daylight.horizon), 0.65),
				side: DoubleSide,
				fog: false,
				depthWrite: false
			})
		),
		object
	);
	sea.name = 'sea-west';
	sea.renderOrder = -1900;
	const carpetMesh = own(
		new Mesh(carpet(size), new MeshBasicMaterial({ vertexColors: true, fog: false, side: DoubleSide })),
		object
	);
	carpetMesh.name = 'canopy-apron';
	const cloudTexture = paintedClouds();
	const cloudMaterial = new ShaderMaterial({
		uniforms: {
			uSize: { value: new Vector2(1, 1) },
			uMap: { value: cloudTexture },
			uTime: { value: 0 },
			uTint: { value: new Color('#ffffff') }
		},
		vertexShader: billboard,
		fragmentShader: `varying vec2 vUv;varying float vTile;uniform sampler2D uMap;uniform vec3 uTint;void main(){vec4 c=texture2D(uMap,vec2((vUv.x+vTile)/4.0,vUv.y));gl_FragColor=vec4(c.rgb*uTint,c.a*.85);\n#include <colorspace_fragment>\n}`,
		transparent: true,
		depthWrite: false,
		fog: false
	});
	const clouds = new InstancedMesh(new PlaneGeometry(1, 1), cloudMaterial, 12);
	own(clouds);
	clouds.renderOrder = 1003;
	const sunMaterial = new ShaderMaterial({
		uniforms: {
			uSize: { value: new Vector2(1, 1) },
			uSun: { value: new Color(LIGHT.daylight.sun) },
			uTime: { value: 0 }
		},
		vertexShader: billboard,
		fragmentShader: `varying vec2 vUv;uniform vec3 uSun;void main(){float r=length(vUv-.5);float disc=1.0-smoothstep(.11,.125,r);float halo=pow(max(0.,1.-r*2.),3.)*.24;gl_FragColor=vec4(uSun,max(disc,halo));\n#include <colorspace_fragment>\n}`,
		transparent: true,
		depthWrite: false,
		fog: false
	});
	const sun = own(new Mesh(new PlaneGeometry(1, 1), sunMaterial));
	sun.renderOrder = 1004;
	const matrix = new Matrix4(),
		top = new Color(),
		horizon = new Color(),
		tint = new Color();
	let variant = '',
		far = 0,
		disposed = false;
	return {
		object,
		sky,
		cloudTexture,
		update(camera: PerspectiveCamera, time: number, quality: Quality, day: 'day' | 'night') {
			sky.position.copy(camera.position);
			const f = VIEW[quality].far;
			if (f !== far) {
				far = f;
				dome.scale.setScalar(f);
				mountains.scale.setScalar(f);

				sunMaterial.uniforms.uSize.value.set(f * 0.22, f * 0.22);
				cloudMaterial.uniforms.uSize.value.set(f * 0.2, f * 0.075);
			}
			if (variant !== day) {
				variant = day;
				const light = day === 'night' ? LIGHT.night : LIGHT.daylight;
				top.set(light.skyTop);
				horizon.set(light.horizon);
				const pos = domeGeometry.getAttribute('position'),
					col = domeGeometry.getAttribute('color');
				for (let i = 0; i < pos.count; i++) {
					tint.copy(horizon).lerp(top, smooth(-0.05, 0.8, pos.getY(i)));
					col.setXYZ(i, tint.r, tint.g, tint.b);
				}
				col.needsUpdate = true;
				sunMaterial.uniforms.uSun.value.set(light.sun);
				cloudMaterial.uniforms.uTint.value.set(day === 'night' ? '#486477' : '#ffffff');
				mountains.material.color.set(day === 'night' ? '#426250' : '#ffffff');
				carpetMesh.material.color.set(day === 'night' ? '#486454' : '#ffffff');
				sea.material.color.set(
					day === 'night'
						? '#294d50'
						: new Color(RAMPS.water[1]).lerp(new Color(LIGHT.daylight.horizon), 0.65)
				);
			}
			sun.position.set(0, f * 0.6, -f * 0.6);
			const count = quality === 'low' ? 6 : 12;
			clouds.count = count;
			for (let i = 0; i < count; i++) {
				const a = (i / count) * Math.PI * 2 + Math.sin(time * 0.008) * 0.015;
				matrix.makeTranslation(
					Math.sin(a) * f * 0.7,
					(0.2 + 0.08 * Math.sin(i * 2)) * f,
					Math.cos(a) * f * 0.7
				);
				clouds.setMatrixAt(i, matrix);
			}
			clouds.instanceMatrix.needsUpdate = true;
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			clouds.dispose();
			for (const g of new Set(geometries)) g.dispose();
			for (const m of new Set(materials)) m.dispose();
			cloudTexture.dispose();
			object.removeFromParent();
			object.clear();
		}
	};
}
