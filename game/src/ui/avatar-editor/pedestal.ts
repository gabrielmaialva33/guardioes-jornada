/**
 * The preview's little piece of forest floor: a mossy disc of soil with a few
 * moss tufts, fallen leaves and pebbles, merged into one flat-shaded,
 * vertex-coloured mesh (one draw call), plus a blob shadow under the feet (the
 * game's soft blob texture, tinted with the hemisphere's ground colour, never
 * black). Palette colours only (style/palette.ts). Deterministic.
 */
import {
	type BufferGeometry,
	CylinderGeometry,
	DodecahedronGeometry,
	Float32BufferAttribute,
	Group,
	IcosahedronGeometry,
	Mesh,
	MeshBasicMaterial,
	MeshLambertMaterial,
	PlaneGeometry,
	Shape,
	ShapeGeometry
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BLOB_OPACITY, createBlobTexture } from '../../render/shadows.ts';
import { stylize } from '../../render/stylized.ts';
import { ACCENT, LIGHT, RAMPS } from '../../style/palette.ts';

/** Top of the disc; the avatar's feet stand here. */
export const PEDESTAL_TOP = 0;
export const PEDESTAL_RADIUS = 1.32;
const THICKNESS = 0.26;

function hexColor(hex: string): [number, number, number] {
	const n = Number.parseInt(hex.slice(1), 16);
	// Vertex colours are linear in three.js: decode the sRGB palette value.
	const decode = (c: number) => {
		const s = c / 255;
		return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return [decode(n >> 16), decode((n >> 8) & 255), decode(n & 255)];
}

/** mulberry32, so the leaves always fall in the same places. */
function random(seed: number) {
	let state = seed | 0;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Non-indexed, no UVs, one colour per triangle picked by `paint(triangle, normalY)`. */
function colored(source: BufferGeometry, paint: (triangle: number, up: number) => string): BufferGeometry {
	const geometry = source.index ? source.toNonIndexed() : source;
	if (geometry !== source) source.dispose();
	geometry.deleteAttribute('uv');
	geometry.computeVertexNormals();
	const normals = geometry.getAttribute('normal');
	const count = geometry.getAttribute('position').count;
	const colors = new Float32Array(count * 3);
	for (let v = 0; v < count; v += 3) {
		const up = (normals.getY(v) + normals.getY(v + 1) + normals.getY(v + 2)) / 3;
		const [r, g, b] = hexColor(paint(v / 3, up));
		for (let k = 0; k < 3; k++) colors.set([r, g, b], (v + k) * 3);
	}
	geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
	return geometry;
}

function leafShape(length: number, width: number): Shape {
	const shape = new Shape();
	shape.moveTo(0, 0);
	shape.quadraticCurveTo(width, length * 0.45, 0, length);
	shape.quadraticCurveTo(-width, length * 0.45, 0, 0);
	return shape;
}

export interface Pedestal {
	readonly object: Group;
	dispose(): void;
}

export function createPedestal(): Pedestal {
	const rand = random(0x1eaf);
	const parts: BufferGeometry[] = [];

	// The disc: moss on top in two greens, soil on the sides, darker underneath.
	const moss = [RAMPS.grass[2], RAMPS.grass[3], RAMPS.leaf[2], RAMPS.grass[2]];
	const disc = colored(
		new CylinderGeometry(PEDESTAL_RADIUS, PEDESTAL_RADIUS + 0.1, THICKNESS, 20, 2),
		(t, up) =>
			up > 0.5
				? moss[(t * 7 + (t >> 2)) % moss.length]
				: up < -0.5
					? RAMPS.soil[0]
					: t % 2
						? RAMPS.soil[1]
						: RAMPS.soil[2]
	);
	disc.translate(0, PEDESTAL_TOP - THICKNESS / 2, 0);
	parts.push(disc);

	// Moss tufts around the rim, flattened.
	for (let i = 0; i < 7; i++) {
		const angle = (i / 7) * Math.PI * 2 + rand() * 0.5;
		const radius = PEDESTAL_RADIUS - 0.12 - rand() * 0.15;
		const tuft = colored(new IcosahedronGeometry(0.16 + rand() * 0.08, 0), (t) =>
			t % 3 === 0 ? RAMPS.grass[1] : RAMPS.grass[3]
		);
		tuft.scale(1.2, 0.5, 1);
		tuft.rotateY(rand() * Math.PI);
		tuft.translate(Math.cos(angle) * radius, PEDESTAL_TOP + 0.02, Math.sin(angle) * radius);
		parts.push(tuft);
	}

	// Fallen leaves lying flat, clear of the feet; one dry leaf and one ipê petal for warmth.
	const leafColors = [
		RAMPS.leaf[1],
		RAMPS.leaf[3],
		RAMPS.wood[3],
		RAMPS.leaf[2],
		ACCENT.ipeRosa,
		RAMPS.leaf[0]
	];
	for (let i = 0; i < leafColors.length; i++) {
		const angle = (i / leafColors.length) * Math.PI * 2 + 0.4 + rand() * 0.4;
		const radius = 0.62 + rand() * 0.42;
		const size = 0.3 + rand() * 0.14;
		const leaf = colored(new ShapeGeometry(leafShape(size, size * 0.42), 3), () => leafColors[i]);
		leaf.rotateX(-Math.PI / 2);
		leaf.rotateY(rand() * Math.PI * 2);
		leaf.translate(Math.cos(angle) * radius, PEDESTAL_TOP + 0.012 + i * 0.002, Math.sin(angle) * radius);
		parts.push(leaf);
	}

	// Two pebbles.
	for (const [x, z, r] of [
		[0.95, 0.55, 0.11],
		[-0.7, -0.85, 0.08]
	] as const) {
		const pebble = colored(new DodecahedronGeometry(r, 0), (t) => (t % 2 ? RAMPS.rock[2] : RAMPS.rock[3]));
		pebble.scale(1, 0.6, 1);
		pebble.translate(x, PEDESTAL_TOP + r * 0.3, z);
		parts.push(pebble);
	}

	const geometry = mergeGeometries(parts);
	for (const part of parts) part.dispose();
	if (!geometry) throw new Error('avatar-editor-pedestal');
	const material = stylize(new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
	const ground = new Mesh(geometry, material);
	ground.name = 'avatar-editor-pedestal';

	const blobTexture = createBlobTexture(32);
	const blobGeometry = new PlaneGeometry(1.5, 1.5).rotateX(-Math.PI / 2);
	const blobMaterial = new MeshBasicMaterial({
		map: blobTexture,
		color: LIGHT.daylight.hemisphereGround,
		transparent: true,
		opacity: BLOB_OPACITY,
		depthWrite: false,
		polygonOffset: true,
		polygonOffsetFactor: -2,
		polygonOffsetUnits: -2
	});
	// Darker than the hemisphere's ground so it reads on the moss.
	blobMaterial.color.multiplyScalar(0.45);
	const blob = new Mesh(blobGeometry, blobMaterial);
	blob.name = 'avatar-editor-blob';
	blob.position.y = PEDESTAL_TOP + 0.03;
	blob.renderOrder = 1;

	const object = new Group();
	object.name = 'avatar-editor-floor';
	object.add(ground, blob);
	return {
		object,
		dispose() {
			object.removeFromParent();
			geometry.dispose();
			material.dispose();
			blobGeometry.dispose();
			blobMaterial.dispose();
			blobTexture.dispose();
		}
	};
}
