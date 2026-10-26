/** One atlas and one instanced draw for every species outside the detailed tree band. */

import {
	type Box3,
	type BufferGeometry,
	CanvasTexture,
	Color,
	DoubleSide,
	InstancedBufferAttribute,
	InstancedMesh,
	Matrix4,
	Mesh,
	type Object3D,
	PlaneGeometry,
	ShaderMaterial,
	SRGBColorSpace,
	type Texture,
	Vector3
} from 'three';
import { LOOK_GLSL, lookUniforms } from '../render/look.ts';
import type { Quality } from '../render/quality.ts';
import { RAMPS } from '../style/palette.ts';
import type { SurvivalWorld } from '../survival/types.ts';
import { detailDistances, farUniforms } from './far-field.ts';
export interface TreePrototype {
	kind: string;
	model: Object3D;
	bounds: Box3;
}
const TILE_W = 64,
	TILE_H = 128,
	COLS = 5;
function canvas(w: number, h: number) {
	const c = document.createElement('canvas');
	c.width = w;
	c.height = h;
	return c;
}
/** Symmetric horizontal frame keeps the GLB trunk origin at the billboard's centre. */
export function impostorFrame(bounds: Box3) {
	return {
		radius: Math.max(
			Math.abs(bounds.min.x),
			Math.abs(bounds.max.x),
			Math.abs(bounds.min.z),
			Math.abs(bounds.max.z)
		),
		height: bounds.max.y - bounds.min.y
	};
}
/** Canvas affine UV projection, preserving every alpha-MASK hole instead of painting a solid card. */
export function triangleTransform(
	uv: readonly number[],
	p: readonly number[]
): [number, number, number, number, number, number] | null {
	const [u0, v0, u1, v1, u2, v2] = uv,
		d = u0 * (v1 - v2) + u1 * (v2 - v0) + u2 * (v0 - v1);
	if (Math.abs(d) < 1e-10) return null;
	const project = (a: number, b: number, c: number) => [
		(a * (v1 - v2) + b * (v2 - v0) + c * (v0 - v1)) / d,
		(a * (u2 - u1) + b * (u0 - u2) + c * (u1 - u0)) / d,
		(a * (u1 * v2 - u2 * v1) + b * (u2 * v0 - u0 * v2) + c * (u0 * v1 - u1 * v0)) / d
	];
	const x = project(p[0], p[2], p[4]),
		y = project(p[1], p[3], p[5]);
	return [x[0], y[0], x[1], y[1], x[2], y[2]];
}
/** Orthographic, painter-sorted triangles of the real GLBs; no extra WebGL context or live previews. */
export function bakeTreeAtlas(prototypes: readonly TreePrototype[]) {
	const atlas = canvas(COLS * TILE_W, Math.ceil(prototypes.length / COLS) * TILE_H),
		ctx = atlas.getContext('2d');
	if (!ctx) throw new Error('tree-atlas-canvas');
	const point = new Vector3(),
		a = new Vector3(),
		b = new Vector3(),
		c = new Vector3(),
		color = new Color();
	prototypes.forEach((p, tile) => {
		const x0 = (tile % COLS) * TILE_W,
			y0 = Math.floor(tile / COLS) * TILE_H,
			frame = impostorFrame(p.bounds),
			w = frame.radius * 2,
			h = frame.height;
		const project = (v: Vector3) => [
			x0 + 2 + ((v.x + frame.radius) / w) * (TILE_W - 4),
			y0 + TILE_H - 2 - ((v.y - p.bounds.min.y) / h) * (TILE_H - 4)
		];
		const triangles: {
			p: number[];
			z: number;
			color: string;
			image?: HTMLCanvasElement;
			uv?: number[];
			shade: number;
		}[] = [];
		p.model.updateWorldMatrix(true, true);
		p.model.traverse((node) => {
			if (!(node instanceof Mesh)) return;
			const g: BufferGeometry = node.geometry;
			const pos = g.getAttribute('position'),
				vc = g.getAttribute('color'),
				uv = g.getAttribute('uv'),
				index = g.index;
			const materials = Array.isArray(node.material) ? node.material : [node.material];
			const palettes = new Map<unknown, { image: HTMLCanvasElement; w: number; h: number }>();
			for (const material of materials) {
				const map = 'map' in material ? material.map : null;
				if (!map || typeof map !== 'object' || !('image' in map)) continue;
				const image = map.image;
				if (
					!(
						image instanceof ImageBitmap ||
						image instanceof HTMLImageElement ||
						image instanceof HTMLCanvasElement
					)
				)
					continue;
				const imageCanvas = canvas(image.width, image.height),
					ic = imageCanvas.getContext('2d');
				if (!ic) continue;
				ic.drawImage(image, 0, 0);
				const pixels = ic.getImageData(0, 0, image.width, image.height);
				for (let k = 3; k < pixels.data.length; k += 4) pixels.data[k] = pixels.data[k] >= 128 ? 255 : 0;
				ic.putImageData(pixels, 0, 0);
				palettes.set(material, { image: imageCanvas, w: image.width, h: image.height });
			}
			const count = index ? index.count : pos.count;
			for (let i = 0; i < count; i += 3) {
				const ia = index ? index.getX(i) : i,
					ib = index ? index.getX(i + 1) : i + 1,
					ic = index ? index.getX(i + 2) : i + 2;
				a.fromBufferAttribute(pos, ia).applyMatrix4(node.matrixWorld);
				b.fromBufferAttribute(pos, ib).applyMatrix4(node.matrixWorld);
				c.fromBufferAttribute(pos, ic).applyMatrix4(node.matrixWorld);
				const group = g.groups.find((group) => i >= group.start && i < group.start + group.count),
					material = materials[group?.materialIndex ?? 0] ?? materials[0];
				if ('color' in material && material.color instanceof Color) color.copy(material.color);
				else color.set(RAMPS.leaf[2]);
				if (vc) {
					point.set(
						(vc.getX(ia) + vc.getX(ib) + vc.getX(ic)) / 3,
						(vc.getY(ia) + vc.getY(ib) + vc.getY(ic)) / 3,
						(vc.getZ(ia) + vc.getZ(ib) + vc.getZ(ic)) / 3
					);
					color.r *= point.x;
					color.g *= point.y;
					color.b *= point.z;
				}
				const palette = palettes.get(material);

				triangles.push({
					p: [...project(a), ...project(b), ...project(c)],
					z: (a.z + b.z + c.z) / 3,
					color: color.getStyle(),
					shade: (color.r + color.g + color.b) / 3,
					image: palette?.image,
					uv:
						palette && uv
							? [
									uv.getX(ia) * palette.w,
									uv.getY(ia) * palette.h,
									uv.getX(ib) * palette.w,
									uv.getY(ib) * palette.h,
									uv.getX(ic) * palette.w,
									uv.getY(ic) * palette.h
								]
							: undefined
				});
			}
		});
		triangles.sort((a, b) => a.z - b.z);
		ctx.save();
		ctx.beginPath();
		ctx.rect(x0, y0, TILE_W, TILE_H);
		ctx.clip();
		for (const t of triangles) {
			ctx.fillStyle = t.color;
			ctx.beginPath();
			ctx.moveTo(t.p[0], t.p[1]);
			ctx.lineTo(t.p[2], t.p[3]);
			ctx.lineTo(t.p[4], t.p[5]);
			ctx.closePath();
			if (t.image && t.uv) {
				const matrix = triangleTransform(t.uv, t.p);
				if (matrix) {
					ctx.save();
					ctx.clip();
					ctx.filter = `brightness(${t.shade})`;
					ctx.transform(...matrix);
					ctx.drawImage(t.image, 0, 0);
					ctx.restore();
				}
			} else ctx.fill();
		}
		ctx.restore();
	});
	const texture = new CanvasTexture(atlas);
	texture.colorSpace = SRGBColorSpace;
	texture.generateMipmaps = true;
	return texture;
}
export function createTreeImpostors(
	prototypes: readonly TreePrototype[],
	trees: SurvivalWorld['trees'],
	quality: Quality,
	options: { capacity?: number; atlas?: Texture } = {}
) {
	const capacity = options.capacity ?? trees.count;
	const texture = options.atlas ?? bakeTreeAtlas(prototypes),
		geometry = new PlaneGeometry(1, 1),
		tiles = new Float32Array(capacity),
		matrix = new Matrix4();
	const material = new ShaderMaterial({
		uniforms: {
			uAtlas: { value: texture },
			uGrid: { value: [COLS, Math.ceil(prototypes.length / COLS)] },
			uTreeRange: { value: detailDistances(quality).trees },
			...farUniforms,
			...lookUniforms
		},
		vertexShader: `attribute float tile;varying vec2 vUv;varying float vTile,vDistance;varying vec3 vWorld;void main(){
 vUv=uv;vTile=tile;vec4 center=instanceMatrix*vec4(0.,0.,0.,1.);
 vec3 right=normalize(vec3(viewMatrix[0][0],0.,viewMatrix[2][0]));
 vec3 p=center.xyz+right*position.x*length(instanceMatrix[0].xyz)+vec3(0.,position.y*length(instanceMatrix[1].xyz),0.);
 vWorld=p;vDistance=length(center.xz-cameraPosition.xz);gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);
 gl_Position.z=min(gl_Position.z,gl_Position.w*(1.-0.00001));
 }`,
		fragmentShader: `${LOOK_GLSL}
uniform sampler2D uAtlas;uniform vec2 uGrid;uniform float uTreeRange,uFarEnd;uniform vec3 uFarMist;
 varying vec2 vUv;varying float vTile,vDistance;varying vec3 vWorld;
 void main(){vec2 tileXY=vec2(mod(vTile,uGrid.x),floor(vTile/uGrid.x));
 vec2 uv=vec2((tileXY.x+vUv.x)/uGrid.x,1.-(tileXY.y+1.-vUv.y)/uGrid.y);
 vec4 texel=texture2D(uAtlas,uv);if(texel.a<.5)discard;
 vec2 pixel=mod(floor(gl_FragCoord.xy),4.);float threshold=(mod(pixel.x*2.+pixel.y*3.,4.)*4.+mod(pixel.x+pixel.y*2.,4.)+.5)/16.;
 if(smoothstep(uTreeRange-6.,uTreeRange+6.,vDistance)<=1.-threshold)discard;
 vec3 color=texel.rgb;float haze=smoothstep(uTreeRange,uFarEnd*1.3,vDistance)*.48;
 gl_FragColor=vec4(lookGrade(mix(color,uFarMist,haze)),1.);
 #include <colorspace_fragment>
 }`,
		side: DoubleSide
	});
	const object = new InstancedMesh(geometry, material, capacity);
	const tileAttribute = new InstancedBufferAttribute(tiles, 1);
	geometry.setAttribute('tile', tileAttribute);
	const free = new Int32Array(capacity),
		dense = new Int32Array(capacity),
		slots = new Int32Array(capacity).fill(-1);
	for (let i = 0; i < capacity; i++) free[i] = capacity - i - 1;
	let freeCount = capacity;
	const byKind = new Map(prototypes.map((p, i) => [p.kind, i]));
	let count = 0;
	const add = (kind: string, x: number, y: number, z: number, k: number) => {
		const tile = byKind.get(kind);
		if (tile === undefined || !freeCount) return -1;
		const b = prototypes[tile].bounds,
			width = (impostorFrame(b).radius * 2 * k * TILE_W) / (TILE_W - 4),
			height = (impostorFrame(b).height * k * TILE_H) / (TILE_H - 4);
		matrix.makeScale(width, height, 1);
		matrix.setPosition(x, y + (b.min.y + b.max.y) * 0.5 * k, z);
		object.setMatrixAt(count, matrix);
		const id = free[--freeCount];
		slots[id] = count;
		dense[count] = id;
		tiles[count++] = tile;
		object.count = count;
		object.instanceMatrix.needsUpdate = true;
		tileAttribute.needsUpdate = true;
		return id;
	};
	const remove = (id: number) => {
		if (id < 0 || id >= capacity || slots[id] < 0) return;
		const at = slots[id],
			last = --count;
		if (at !== last) {
			matrix.fromArray(object.instanceMatrix.array, last * 16);
			object.setMatrixAt(at, matrix);
			tiles[at] = tiles[last];
			dense[at] = dense[last];
			slots[dense[at]] = at;
		}
		slots[id] = -1;
		free[freeCount++] = id;
		object.count = count;
		object.instanceMatrix.needsUpdate = true;
		tileAttribute.needsUpdate = true;
	};
	for (let i = 0; i < trees.count; i++)
		add(trees.kinds[trees.kind[i]], trees.x[i], trees.y[i], trees.z[i], trees.scale[i]);
	object.count = count;
	object.name = 'far-tree-impostors';
	object.frustumCulled = false;
	object.userData.noShadow = true;
	return {
		object,
		add,
		remove,
		setQuality(q: Quality) {
			material.uniforms.uTreeRange.value = detailDistances(q).trees;
		},
		dispose() {
			object.removeFromParent();
			object.dispose();
			geometry.dispose();
			material.dispose();
			texture.dispose();
		}
	};
}
