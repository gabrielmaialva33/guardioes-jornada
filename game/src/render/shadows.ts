/**
 * Shadow tiers:
 * - low: no shadow map. Instanced blob shadows (one quad, one draw) under the
 *   avatar, animals and pickups; static assets carry baked AO and sky gradient
 *   in their vertex colours (ART.md §5), so the world stays grounded.
 * - medium: a 1024 shadow map that follows the player; only the avatar and
 *   animals cast. Pickups keep their blobs.
 * - high: 2048 over a wider area; static casters (trees, rocks, cabin) cast too.
 *
 * The shadow map is never re-rendered every frame for nothing:
 * `renderer.shadowMap.autoUpdate = false`, and `ShadowRig.update()` sets
 * `needsUpdate` only when the player has moved at least one shadow texel (the
 * light is snapped to the texel grid, which also stops shimmering), when a
 * caster moved or animated (`markMoved()`), or after `invalidate()` (tier or
 * sun change, static casters edited, context restored). While things move the
 * re-render is throttled to every `interval` frames.
 */
import {
	type ColorRepresentation,
	DataTexture,
	DirectionalLight,
	DynamicDrawUsage,
	Group,
	HemisphereLight,
	InstancedMesh,
	LinearFilter,
	LinearMipmapLinearFilter,
	type Material,
	MeshBasicMaterial,
	type Object3D,
	PCFShadowMap,
	PlaneGeometry,
	RGBAFormat,
	type ShadowMapType,
	Sphere,
	Vector3
} from 'three';
import { LIGHT } from '../style/palette.ts';
import type { LightVariant } from './fog-lod.ts';
import type { Quality } from './quality.ts';

/** Which blobs are drawn: all (low tier), only items (map tiers: actors cast real shadows), none. */
export type BlobMode = 'all' | 'items' | 'none';
export type BlobKind = 'actor' | 'item';
export type CasterKind = 'actor' | 'static';

export interface ShadowTierSettings {
	/** Shadow map side in texels; 0 means no shadow map. */
	readonly mapSize: number;
	/** Half side of the orthographic shadow camera around the player, in world units. */
	readonly extent: number;
	readonly blobs: BlobMode;
	/** Which registered casters cast into the map. */
	readonly casters: 'none' | 'actors' | 'all';
	/** Minimum frames between shadow renders while something moves (2 = at most 30 Hz on 60 Hz). */
	readonly interval: number;
}

export const SHADOW_TIERS: Readonly<Record<Quality, ShadowTierSettings>> = {
	low: { mapSize: 0, extent: 0, blobs: 'all', casters: 'none', interval: 0 },
	// 36 u across: the avatar at any zoom and the animals near it; 0.035 u texels.
	medium: { mapSize: 1024, extent: 18, blobs: 'items', casters: 'actors', interval: 2 },
	high: { mapSize: 2048, extent: 30, blobs: 'items', casters: 'all', interval: 1 }
};

/** Light intensities per variant (colours and sun elevation come from LIGHT). Tunable on the device. */
export const LIGHT_INTENSITY: Readonly<Record<LightVariant, { hemisphere: number; sun: number }>> = {
	daylight: { hemisphere: 1, sun: 1.6 },
	night: { hemisphere: 0.6, sun: 0.45 }
};

/** Sun azimuth, degrees from +z toward +x: 180 puts the sun behind the spawn's view (it faces +z). */
export const SUN_AZIMUTH_DEG = 180;

/** How far the light sits from the focus along its direction. */
const SUN_DISTANCE = 60;
/** Depth along the light is snapped coarsely: it moves the depth window, not the texels. */
const DEPTH_STEP = 4;
const DEG = Math.PI / 180;

/** Unit vector from the ground toward the sun. */
export function sunDirection(elevationDeg: number, azimuthDeg: number, target = new Vector3()): Vector3 {
	const el = elevationDeg * DEG;
	const az = azimuthDeg * DEG;
	return target.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
}

/** The scene's sky/ground fill light from the palette. */
export function createHemisphere(variant: LightVariant = 'daylight'): HemisphereLight {
	const light = new HemisphereLight();
	applyHemisphere(light, variant);
	return light;
}

/** Recolours only: never add or remove lights at runtime (it recompiles every material). */
export function applyHemisphere(light: HemisphereLight, variant: LightVariant): void {
	light.color.set(LIGHT[variant].hemisphereSky);
	light.groundColor.set(LIGHT[variant].hemisphereGround);
	light.intensity = LIGHT_INTENSITY[variant].hemisphere;
}

// --- Blob shadows ---------------------------------------------------------------

/** Peak opacity of a blob over the ground. */
export const BLOB_OPACITY = 0.5;
/** Blobs float this far above the ground (plus polygon offset) to avoid z-fighting. */
const BLOB_LIFT = 0.03;

/**
 * A radial gradient generated in code (no canvas, works in a Worker or Node):
 * white with alpha falling smoothly from the centre to 0 at the rim.
 */
export function createBlobTexture(size = 32): DataTexture {
	const data = new Uint8Array(size * size * 4);
	const half = size / 2;
	for (let j = 0; j < size; j++)
		for (let i = 0; i < size; i++) {
			const dx = (i + 0.5 - half) / half;
			const dy = (j + 0.5 - half) / half;
			const r = Math.min(1, Math.sqrt(dx * dx + dy * dy));
			// Smoothstep from a solid core at r = 0.25 to nothing at the rim.
			const t = Math.min(1, Math.max(0, (r - 0.25) / 0.75));
			const alpha = 1 - t * t * (3 - 2 * t);
			const o = (j * size + i) * 4;
			data[o] = 255;
			data[o + 1] = 255;
			data[o + 2] = 255;
			data[o + 3] = Math.round(alpha * 255);
		}
	const texture = new DataTexture(data, size, size, RGBAFormat);
	texture.magFilter = LinearFilter;
	texture.minFilter = LinearMipmapLinearFilter;
	texture.generateMipmaps = true;
	texture.needsUpdate = true;
	texture.name = 'blob-shadow';
	return texture;
}

/**
 * Blob shadows as one InstancedMesh of a ground quad: one draw call for all of
 * them. Ids are fixed slots; `set()` every frame for moving actors, once for
 * static items. Tinted with the hemisphere's ground colour, never black.
 */
export class BlobShadows {
	readonly mesh: InstancedMesh;
	readonly capacity: number;
	readonly #material: MeshBasicMaterial;
	readonly #texture: DataTexture;
	readonly #kind: Uint8Array;
	readonly #shown: Uint8Array;
	readonly #data: Float32Array;
	readonly #free: Int32Array;
	readonly #range = { start: 0, count: 0 };
	#freeTop: number;
	#mode: BlobMode = 'all';
	#dirty = true;

	constructor(capacity = 48, variant: LightVariant = 'daylight') {
		this.capacity = capacity;
		this.#texture = createBlobTexture();
		this.#material = new MeshBasicMaterial({
			name: 'blob-shadow',
			map: this.#texture,
			transparent: true,
			opacity: BLOB_OPACITY,
			depthWrite: false,
			polygonOffset: true,
			polygonOffsetFactor: -1,
			polygonOffsetUnits: -2
		});
		const quad = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
		quad.deleteAttribute('normal');
		this.mesh = new InstancedMesh(quad, this.#material, capacity);
		this.mesh.name = 'blob-shadows';
		this.mesh.count = 0;
		this.mesh.visible = false;
		this.mesh.frustumCulled = false;
		this.mesh.matrixAutoUpdate = false;
		// Fixed bounds: sorting never recomputes them per frame.
		this.mesh.boundingSphere = new Sphere(new Vector3(), Number.MAX_VALUE);
		this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
		this.#kind = new Uint8Array(capacity);
		this.#shown = new Uint8Array(capacity);
		this.#data = new Float32Array(capacity * 4);
		this.#free = new Int32Array(capacity);
		for (let i = 0; i < capacity; i++) this.#free[i] = capacity - 1 - i;
		this.#freeTop = capacity;
		this.setVariant(variant);
	}

	get mode(): BlobMode {
		return this.#mode;
	}

	set mode(mode: BlobMode) {
		if (mode === this.#mode) return;
		this.#mode = mode;
		this.#dirty = true;
	}

	/** Blobs drawn after the last sync. */
	get count(): number {
		return this.mesh.count;
	}

	get drawCalls(): number {
		return this.mesh.count > 0 ? 1 : 0;
	}

	setVariant(variant: LightVariant): void {
		this.#material.color.set(LIGHT[variant].hemisphereGround);
	}

	/** Reserves a blob; hidden until the first `set()`. Returns -1 when full. */
	add(kind: BlobKind): number {
		if (this.#freeTop === 0) return -1;
		const id = this.#free[--this.#freeTop];
		this.#kind[id] = kind === 'actor' ? 1 : 2;
		this.#shown[id] = 0;
		return id;
	}

	/**
	 * Places a blob on the ground under something of `radius`; `height` above
	 * the ground shrinks it (a jump), down to 45% at about 14 u.
	 */
	set(id: number, x: number, groundY: number, z: number, radius: number, height = 0): void {
		if (id < 0 || id >= this.capacity || this.#kind[id] === 0) return;
		const o = id * 4;
		this.#data[o] = x;
		this.#data[o + 1] = groundY + BLOB_LIFT;
		this.#data[o + 2] = z;
		this.#data[o + 3] = 2 * radius * Math.max(0.45, 1 - Math.max(0, height) * 0.04);
		this.#shown[id] = 1;
		this.#dirty = true;
	}

	/** Hides a blob without releasing it (e.g. no ground under the actor). */
	hide(id: number): void {
		if (id < 0 || id >= this.capacity || this.#shown[id] === 0) return;
		this.#shown[id] = 0;
		this.#dirty = true;
	}

	remove(id: number): void {
		if (id < 0 || id >= this.capacity || this.#kind[id] === 0) return;
		this.#kind[id] = 0;
		this.#shown[id] = 0;
		this.#free[this.#freeTop++] = id;
		this.#dirty = true;
	}

	/** Packs the shown blobs into the instance buffer. Once per frame, before rendering. */
	sync(): boolean {
		if (!this.#dirty) return false;
		this.#dirty = false;
		const out = this.mesh.instanceMatrix.array as Float32Array;
		let n = 0;
		if (this.#mode !== 'none')
			for (let id = 0; id < this.capacity; id++) {
				if (this.#shown[id] === 0) continue;
				if (this.#mode === 'items' && this.#kind[id] !== 2) continue;
				const o = id * 4;
				const d = this.#data[o + 3];
				const m = n * 16;
				out.fill(0, m, m + 16);
				out[m] = d;
				out[m + 5] = 1;
				out[m + 10] = d;
				out[m + 12] = this.#data[o];
				out[m + 13] = this.#data[o + 1];
				out[m + 14] = this.#data[o + 2];
				out[m + 15] = 1;
				n++;
			}
		this.mesh.count = n;
		this.mesh.visible = n > 0;
		if (n > 0) {
			const attribute = this.mesh.instanceMatrix;
			if (attribute.updateRanges.length === 0 || attribute.updateRanges[0] !== this.#range) {
				attribute.clearUpdateRanges();
				attribute.updateRanges.push(this.#range);
				this.#range.start = 0;
				this.#range.count = 0;
			}
			this.#range.count = Math.max(this.#range.count, n * 16);
			attribute.needsUpdate = true;
		}
		return true;
	}

	dispose(): void {
		this.mesh.geometry.dispose();
		this.mesh.dispose();
		this.#material.dispose();
		this.#texture.dispose();
	}
}

// --- Shadow rig --------------------------------------------------------------------

/** The part of WebGLRenderer the rig drives (structural, so tests need no WebGL). */
export interface ShadowRenderer {
	shadowMap: { enabled: boolean; autoUpdate: boolean; needsUpdate: boolean; type: ShadowMapType };
}

export interface ShadowRigOptions {
	/** Use an existing sun; by default the rig makes one from LIGHT. */
	sun?: DirectionalLight;
	/** Blob capacity: avatar + animals + pickups in view. */
	blobs?: number;
	variant?: LightVariant;
	azimuthDeg?: number;
}

/**
 * Owns the sun, the blob shadows and the shadow map policy. Add `object` to
 * the scene (it holds the sun, its target and the blobs).
 */
export class ShadowRig {
	readonly sun: DirectionalLight;
	readonly blobs: BlobShadows;
	/** Add to the scene: holds the sun, its target and the blob mesh. */
	readonly object: Group;
	/** Shadow map renders requested so far (for tests and the debug overlay). */
	renders = 0;
	readonly #renderer: ShadowRenderer;
	readonly #direction = new Vector3();
	readonly #right = new Vector3();
	readonly #up = new Vector3();
	readonly #casters = new Map<Object3D, CasterKind>();
	readonly #receivers = new Set<Object3D>();
	#tier: Quality = 'low';
	#settings: ShadowTierSettings = SHADOW_TIERS.low;
	#variant: LightVariant;
	#azimuth: number;
	#invalid = true;
	#moved = false;
	#frames = 0;
	#a = Number.NaN;
	#b = Number.NaN;
	#c = Number.NaN;

	constructor(renderer: ShadowRenderer, options: ShadowRigOptions = {}) {
		this.#renderer = renderer;
		this.#variant = options.variant ?? 'daylight';
		this.#azimuth = options.azimuthDeg ?? SUN_AZIMUTH_DEG;
		this.sun = options.sun ?? new DirectionalLight();
		this.sun.name = this.sun.name || 'sun';
		this.blobs = new BlobShadows(options.blobs ?? 48, this.#variant);
		this.object = new Group();
		this.object.name = 'shadow-rig';
		this.object.add(this.sun, this.sun.target, this.blobs.mesh);
		this.setVariant(this.#variant);
		this.setTier('low');
	}

	get tier(): Quality {
		return this.#tier;
	}

	get settings(): ShadowTierSettings {
		return this.#settings;
	}

	/**
	 * Switches the tier. Pass the scene when the shadow map turns on or off
	 * after the first render, so materials rebuild their programs (a hitch:
	 * follow with `renderer.compileAsync`). Low frees the shadow map's memory.
	 */
	setTier(tier: Quality, scene?: Object3D): void {
		const settings = SHADOW_TIERS[tier];
		const map = this.#renderer.shadowMap;
		const wasEnabled = map.enabled;
		const enabled = settings.mapSize > 0;
		this.#tier = tier;
		this.#settings = settings;
		map.enabled = enabled;
		map.type = PCFShadowMap;
		map.autoUpdate = false;
		map.needsUpdate = false;
		this.sun.castShadow = enabled;
		const shadow = this.sun.shadow;
		if (enabled) {
			shadow.mapSize.set(settings.mapSize, settings.mapSize);
			const camera = shadow.camera;
			camera.left = -settings.extent;
			camera.right = settings.extent;
			camera.top = settings.extent;
			camera.bottom = -settings.extent;
			camera.near = 1;
			camera.far = SUN_DISTANCE + 2 * settings.extent + DEPTH_STEP;
			camera.updateProjectionMatrix();
			shadow.bias = -0.0005;
			shadow.normalBias = 0.02;
		} else if (shadow.map) {
			shadow.map.dispose();
			shadow.map = null;
		}
		this.blobs.mode = settings.blobs;
		for (const [object, kind] of this.#casters) this.#applyCaster(object, kind);
		for (const object of this.#receivers) this.#applyReceiver(object);
		if (scene && wasEnabled !== enabled)
			scene.traverse((object) => {
				const material = (object as Object3D & { material?: Material | Material[] }).material;
				if (Array.isArray(material)) for (const m of material) m.needsUpdate = true;
				else if (material) material.needsUpdate = true;
			});
		this.invalidate();
	}

	/** Recolours the sun and blobs and moves the sun to the variant's elevation. */
	setVariant(variant: LightVariant): void {
		this.#variant = variant;
		this.sun.color.set(LIGHT[variant].sun as ColorRepresentation);
		this.sun.intensity = LIGHT_INTENSITY[variant].sun;
		this.blobs.setVariant(variant);
		this.#setDirection(LIGHT[variant].sunElevationDeg, this.#azimuth);
	}

	/** Moves the sun (day cycle); re-renders the shadow map at the next update. */
	setSun(elevationDeg: number, azimuthDeg: number): void {
		this.#azimuth = azimuthDeg;
		this.#setDirection(elevationDeg, azimuthDeg);
	}

	/**
	 * Registers objects that may cast: 'actor' (avatar, animals) casts on medium
	 * and high, 'static' (trees, rocks, cabin, instance pools) only on high.
	 */
	addCaster(object: Object3D, kind: CasterKind): void {
		this.#casters.set(object, kind);
		this.#applyCaster(object, kind);
		if (kind === 'static') this.invalidate();
	}

	/** Registers ground and large props that receive the map (medium and high). */
	addReceiver(object: Object3D): void {
		this.#receivers.add(object);
		this.#applyReceiver(object);
	}

	forget(object: Object3D): void {
		this.#casters.delete(object);
		this.#receivers.delete(object);
	}

	/** A caster moved or changed pose this frame (the avatar walking, an animal turning its head). */
	markMoved(): void {
		this.#moved = true;
	}

	/** Re-render the shadow map at the next update, whatever moved (static edits, context restored). */
	invalidate(): void {
		this.#invalid = true;
	}

	/**
	 * Once per frame before rendering, with the player's position: follows the
	 * player in texel steps and requests a shadow render only when needed.
	 * Returns true when one was requested. No allocation.
	 */
	update(x: number, y: number, z: number): boolean {
		const settings = this.#settings;
		if (settings.mapSize === 0) {
			this.#invalid = false;
			this.#moved = false;
			return false;
		}
		this.#frames++;
		const texel = (2 * settings.extent) / settings.mapSize;
		const d = this.#direction;
		const r = this.#right;
		const u = this.#up;
		const a = Math.round((x * r.x + y * r.y + z * r.z) / texel) * texel;
		const b = Math.round((x * u.x + y * u.y + z * u.z) / texel) * texel;
		const c = Math.round((x * d.x + y * d.y + z * d.z) / DEPTH_STEP) * DEPTH_STEP;
		const followed = a !== this.#a || b !== this.#b || c !== this.#c;
		const due = this.#frames >= settings.interval;
		if (!this.#invalid && !((followed || this.#moved) && due)) return false;
		this.#a = a;
		this.#b = b;
		this.#c = c;
		const tx = r.x * a + u.x * b + d.x * c;
		const ty = r.y * a + u.y * b + d.y * c;
		const tz = r.z * a + u.z * b + d.z * c;
		this.sun.target.position.set(tx, ty, tz);
		this.sun.position.set(tx + d.x * SUN_DISTANCE, ty + d.y * SUN_DISTANCE, tz + d.z * SUN_DISTANCE);
		this.sun.updateMatrixWorld();
		this.sun.target.updateMatrixWorld();
		this.#renderer.shadowMap.needsUpdate = true;
		this.#invalid = false;
		this.#moved = false;
		this.#frames = 0;
		this.renders++;
		return true;
	}

	dispose(): void {
		this.blobs.dispose();
		this.sun.shadow.dispose();
		this.sun.shadow.map = null;
		this.object.removeFromParent();
		this.#casters.clear();
		this.#receivers.clear();
	}

	#setDirection(elevationDeg: number, azimuthDeg: number): void {
		const d = sunDirection(elevationDeg, azimuthDeg, this.#direction);
		// Light-space basis for texel snapping: right ⟂ up ⟂ direction.
		this.#right.set(0, 1, 0).cross(d);
		if (this.#right.lengthSq() < 1e-8) this.#right.set(1, 0, 0);
		this.#right.normalize();
		this.#up.copy(d).cross(this.#right).normalize();
		this.#a = Number.NaN;
		this.invalidate();
	}

	#applyCaster(object: Object3D, kind: CasterKind): void {
		const casters = this.#settings.casters;
		const cast = casters === 'all' || (casters === 'actors' && kind === 'actor');
		object.traverse((child) => {
			if ((child as Object3D & { isMesh?: boolean }).isMesh) child.castShadow = cast;
		});
	}

	#applyReceiver(object: Object3D): void {
		const receive = this.#settings.mapSize > 0;
		object.traverse((child) => {
			if ((child as Object3D & { isMesh?: boolean }).isMesh) child.receiveShadow = receive;
		});
	}
}
